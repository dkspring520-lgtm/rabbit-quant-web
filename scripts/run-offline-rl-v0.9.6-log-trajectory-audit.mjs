import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";

const artifact = process.argv[2] ?? ".data-inspect/offline-rl-v0.9.6/OFFLINE_RL_LOGGED_TRAJECTORY_V0.9.6.jsonl.gz";
const manifest = JSON.parse(await readFile(`${artifact}.manifest.json`, "utf8"));
const required = ["timestamp", "symbol", "scenarioId", "episodeId", "state", "accountState", "expertAction", "validAction", "executionResult", "rewardGross", "rewardNet", "reward", "nextState", "done", "strategyId", "strategyVersion", "sourceDatasetHash", "normalizedDatasetHash", "expertSignalHash", "trajectoryDatasetHash", "stateDatasetHash", "executionVersion", "rewardVersion", "costModelVersion", "executionContextStatus", "observedExpertBehavior"];
const actions = { WAIT: 0, BUY_SMALL: 0, BUY: 0, SELL_PART: 0, SELL_ALL: 0 };
const errors = []; const scenarios = new Set(); const episodes = new Set(); const seen = new Set(); const hash = createHash("sha256");
let count = 0; let previous = ""; let rewardCount = 0; let rewardNullCount = 0; let tPlusOneErrors = 0;
const input = createInterface({ input: createReadStream(artifact).pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  hash.update(line + "\n");
  let row; try { row = JSON.parse(line); } catch { errors.push(`invalid JSON at row ${count}`); continue; }
  count++; scenarios.add(row.scenarioId); episodes.add(row.episodeId); actions[row.expertAction] = (actions[row.expertAction] ?? 0) + 1;
  for (const key of required) if (!Object.hasOwn(row, key)) errors.push(`row ${count}: missing ${key}`);
  if (row.observedExpertBehavior !== true) errors.push(`row ${count}: not observed expert behavior`);
  if (!["WAIT", "BUY_SMALL", "BUY", "SELL_PART", "SELL_ALL"].includes(row.expertAction)) errors.push(`row ${count}: invalid action`);
  if (row.state?.marketState?.schemaVersion !== "ValidatedStatePriceOnlyV0.1") errors.push(`row ${count}: invalid state schema`);
  for (const key of ["cash", "position", "sellablePosition", "averageCost", "todayBought", "scenarioId"]) if (!Object.hasOwn(row.accountState ?? {}, key)) errors.push(`row ${count}: missing accountState.${key}`);
  if (row.done && row.nextState !== null) errors.push(`row ${count}: done transition has nextState`);
  if (!row.done && row.nextState === null) errors.push(`row ${count}: non-terminal transition missing nextState`);
  if (row.nextState && row.nextState.marketState?.timestamp <= row.timestamp) errors.push(`row ${count}: nextState is not future`);
  if (row.actionOutcomeMatrix || row.counterfactuals || row.counterfactualGroupId || row.bestAction) errors.push(`row ${count}: counterfactual contamination`);
  const order = `${row.scenarioId}|${row.episodeId}|${row.timestamp}`; if (previous && order < previous) errors.push(`row ${count}: chronology`); previous = order;
  const key = `${row.scenarioId}|${row.episodeId}|${row.timestamp}`; if (seen.has(key)) errors.push(`row ${count}: duplicate transition`); seen.add(key);
  if (row.reward === null || row.reward === undefined) rewardNullCount++; else rewardCount++;
  if (row.expertAction.startsWith("BUY") && row.nextState && row.nextState.accountState.sellablePosition > row.accountState.sellablePosition) tPlusOneErrors++;
}
const trajectoryHash = hash.digest("hex");
const manifestMatch = count === manifest.recordCount && scenarios.size === manifest.scenarioCount && episodes.size === manifest.episodeCount && trajectoryHash === manifest.trajectoryHash;
const result = { status: errors.length === 0 && manifestMatch && tPlusOneErrors === 0 ? "PASS" : "FAIL", count, manifestCount: manifest.recordCount, scenarioCount: scenarios.size, episodeCount: episodes.size, actions, rewardCount, rewardNullCount, chronologyAndSchemaErrors: errors.length, tPlusOneErrors, trajectoryHash, manifestMatch, errors: errors.slice(0, 20) };
console.log(JSON.stringify(result, null, 2));
if (result.status !== "PASS") process.exitCode = 1;
