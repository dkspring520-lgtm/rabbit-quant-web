import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";

const artifact = process.argv[2] || ".data-inspect/offline-rl-v0.10/OFFLINE_RL_DATASET_V0.10.jsonl.gz";
const manifest = JSON.parse(await readFile(artifact + ".manifest.json", "utf8"));
const required = ["datasetVersion", "state", "action", "reward", "nextState", "done", "timestamp", "symbol", "scenarioId", "episodeId", "strategyId", "strategyVersion", "sourceDatasetHash", "normalizedDatasetHash", "expertSignalHash", "trajectoryDatasetHash", "stateDatasetHash", "executionVersion", "rewardVersion", "costModelVersion", "observedExpertBehavior"];
const input = createInterface({ input: createReadStream(artifact).pipe(createGunzip()), crlfDelay: Infinity });
const hash = createHash("sha256");
const errors = [];
const seen = new Set();
const scenarios = new Set();
const episodes = new Set();
const actions = { WAIT: 0, BUY_SMALL: 0, BUY: 0, SELL_PART: 0, SELL_ALL: 0 };
let count = 0;
let rewardCount = 0;
let rewardNullCount = 0;
let previous = "";
for await (const line of input) {
  if (!line.trim()) continue;
  hash.update(line + "\n");
  let row;
  try { row = JSON.parse(line); } catch { errors.push("invalid JSON row " + count); continue; }
  count++;
  for (const key of required) if (!Object.hasOwn(row, key)) errors.push("row " + count + " missing " + key);
  if (row.datasetVersion !== "OFFLINE_RL_V0.10") errors.push("row " + count + " datasetVersion");
  if (row.observedExpertBehavior !== true) errors.push("row " + count + " observed behavior");
  if (row.state?.marketState?.schemaVersion !== "ValidatedStatePriceOnlyV0.1") errors.push("row " + count + " state schema");
  if (!Object.prototype.hasOwnProperty.call(actions, row.action)) errors.push("row " + count + " action");
  if (row.done && row.nextState !== null) errors.push("row " + count + " done nextState");
  if (!row.done && row.nextState === null) errors.push("row " + count + " missing nextState");
  const key = row.scenarioId + "|" + row.episodeId + "|" + row.timestamp;
  if (seen.has(key)) errors.push("row " + count + " duplicate");
  seen.add(key);
  const order = key;
  if (previous && order < previous) errors.push("row " + count + " chronology");
  previous = order;
  scenarios.add(row.scenarioId); episodes.add(row.episodeId); actions[row.action]++;
  if (row.reward === null || row.reward === undefined) rewardNullCount++; else rewardCount++;
}
const datasetHash = hash.digest("hex");
const result = { status: errors.length === 0 && count === manifest.recordCount && datasetHash === manifest.datasetHash && scenarios.size === manifest.scenarioCount && episodes.size === manifest.episodeCount ? "PASS" : "FAIL", count, manifestCount: manifest.recordCount, scenarioCount: scenarios.size, episodeCount: episodes.size, actions, rewardCount, rewardNullCount, datasetHash, manifestMatch: datasetHash === manifest.datasetHash, errors: errors.slice(0, 20) };
await writeFile("docs/rl-research/offline-rl-v0.10-dataset-summary.json", JSON.stringify({ title: "Offline RL V0.10 Dataset Summary", ...result, datasetVersion: manifest.datasetVersion, sourceTrajectoryVersion: manifest.sourceTrajectoryVersion, sourceTrajectoryHash: manifest.sourceTrajectoryHash, sourceDatasetHash: manifest.sourceDatasetHash, normalizedDatasetHash: manifest.normalizedDatasetHash, expertSignalHash: manifest.expertSignalHash, trainingPerformed: false }, null, 2) + "\n");
await writeFile("docs/rl-research/offline-rl-v0.10-dataset-summary.md", ["# Offline RL V0.10 Dataset Summary", "", "**OFFLINE_RL_V0.10_DATASET_AUDIT = " + result.status + "**", "", "- Records: " + result.count, "- Scenarios: " + result.scenarioCount, "- Episodes: " + result.episodeCount, "- Actions: " + JSON.stringify(result.actions), "- Reward count: " + result.rewardCount + "; null reward count: " + result.rewardNullCount, "- Dataset hash: " + result.datasetHash, "- Source trajectory hash: " + manifest.sourceTrajectoryHash, "- V0.10 is a pure persisted-trajectory transformation; no execution/reward/nextState/done recomputation or RL training was performed.", ""].join("\n") + "\n");
await writeFile("docs/rl-research/offline-rl-v0.10-dataset-schema.md", ["# Offline RL V0.10 Dataset Schema", "", "Core: state, action, reward, nextState, done.", "", "Lineage: timestamp, symbol, scenarioId, episodeId, strategyId, strategyVersion, sourceDatasetHash, normalizedDatasetHash, expertSignalHash, trajectoryDatasetHash, stateDatasetHash, executionVersion, rewardVersion, costModelVersion, observedExpertBehavior.", "", "The builder reads the persisted V0.9.6 logged trajectory artifact only; it does not import or call PaperExecutionEngine or materializeScenario.", ""].join("\n") + "\n");
console.log(JSON.stringify(result, null, 2));
if (result.status !== "PASS") process.exitCode = 1;
