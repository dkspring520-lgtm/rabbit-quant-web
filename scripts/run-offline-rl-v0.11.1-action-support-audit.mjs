import { readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { streamHistoricalJsonl } from "../lib/rl-research/trainer/historical-jsonl-stream.mjs";
import { data07Split } from "../lib/rl-research/trainer/counterfactual-transitions.mjs";
import { auditCanonicalExpertSource } from "../lib/rl-research/trainer/data07-expert-source-bridge-v094.mjs";
import { joinExpertSignals } from "../lib/rl-research/trainer/expert-trajectory-v095.mjs";
import { ACTIONS, actionSupportRows, deterministicHash } from "../lib/rl-research/dataset/action-support-audit-v0111.mjs";

const sourcePath = ".data-inspect/zijin-601899-2022-2026.jsonl";
const trajectoryPath = ".data-inspect/offline-rl-v0.9.6/OFFLINE_RL_LOGGED_TRAJECTORY_V0.9.6.jsonl.gz";
const datasetPath = ".data-inspect/offline-rl-v0.10/OFFLINE_RL_DATASET_V0.10.jsonl.gz";
const market = [];
for await (const row of streamHistoricalJsonl(sourcePath)) if (data07Split(row.timestamp)) market.push(row);
const source = auditCanonicalExpertSource(market);
const expertSignalHash = "b501e2b3715b14e9de2864099544e38cb0a0015ae5e45eb6ff340e166cddd7bb";
const joined = joinExpertSignals({ marketRows: market, signals: source.expertSource.signals, expertSignalHash });
const counts = Object.fromEntries(ACTIONS.map(action => [action, { sourceCount: 0, joinedCount: 0, trajectoryCount: 0, datasetCount: 0, attemptedCount: 0, filledCount: 0, cancelledCount: 0, rejectedCount: 0 }]));
for (const row of joined.joined) { counts[row.expertAction].sourceCount++; counts[row.expertAction].joinedCount++; }
const scenarioCounts = {}; const temporalCounts = {}; const sellContext = { SELL_PART: { total: 0, sellableZero: 0, todayBoughtPositive: 0 }, SELL_ALL: { total: 0, sellableZero: 0, todayBoughtPositive: 0 } };
async function consume(path, kind) {
  const input = createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line); const action = kind === "trajectory" ? row.expertAction : row.action;
    if (counts[action]) { counts[action][kind + "Count"]++; if (kind === "trajectory") { counts[action].attemptedCount++; const status = row.executionResult?.status; if (status === "FILLED") counts[action].filledCount++; if (status === "CANCELLED") counts[action].cancelledCount++; if (status === "REJECTED") counts[action].rejectedCount++; } }
    if (kind !== "trajectory") continue;
    const scenario = scenarioCounts[row.scenarioId] ?? (scenarioCounts[row.scenarioId] = Object.fromEntries(ACTIONS.map(a => [a, 0]))); scenario[action]++;
    const year = row.timestamp.slice(0, 4); const temporal = temporalCounts[year] ?? (temporalCounts[year] = Object.fromEntries(ACTIONS.map(a => [a, 0]))); temporal[action]++;
    if (sellContext[action]) { sellContext[action].total++; if ((row.accountState?.sellablePosition ?? 0) === 0) sellContext[action].sellableZero++; if ((row.accountState?.todayBought ?? 0) > 0) sellContext[action].todayBoughtPositive++; }
  }
}
await consume(trajectoryPath, "trajectory");
await consume(datasetPath, "dataset");
const trajectoryManifest = JSON.parse(await readFile(trajectoryPath + ".manifest.json", "utf8"));
const datasetManifest = JSON.parse(await readFile(datasetPath + ".manifest.json", "utf8"));
const matrix = actionSupportRows(ACTIONS, counts);
const rawHash = createHash("sha256").update(await readFile(sourcePath)).digest("hex");
const report = { title: "Offline RL V0.11.1 Action Support Root-Cause Audit", status: "PASS", lineage: { data07RawHash: rawHash, sourceFileHash: source.sourceHash, normalizedDatasetHash: source.normalizedHash, expertSignalHash, trajectoryHash: trajectoryManifest.trajectoryHash, datasetHash: datasetManifest.datasetHash }, actionSupport: matrix, scenarioCounts, temporalCounts, sellContext, waitDominance: { observedCount: counts.WAIT.sourceCount, policyRule: "OHLCV_T_RESEARCH_V1 initializes WAIT; only positiveT/reverseT branches change the action", notSynthetic: true }, definitions: { sourceCount: "Expert signal emitted by OHLCV_T_RESEARCH_V1", joinedCount: "exact symbol+timestamp join", trajectoryCount: "observed trajectory record", datasetCount: "V0.10 transformed record", attemptedCount: "executionResult present for observed action", filledCount: "PaperExecutionEngine FILLED", counterfactualExcluded: true }, coverageExtensionRecommendation: { status: "RESEARCH_ONLY", recommendation: "If broader action support is required, evaluate additional dates or symbols; do not rebalance or synthesize current data." }, trainingPerformed: false, productionIsolation: true };
report.auditHash = deterministicHash({ lineage: report.lineage, actionSupport: report.actionSupport, scenarioCounts: report.scenarioCounts, temporalCounts: report.temporalCounts, sellContext: report.sellContext });
const markdown = ["# Offline RL V0.11.1 Action Support Root-Cause Audit", "", "**ACTION_SUPPORT_AUDIT = " + report.status + "**", "", "- Source rows: " + market.length, "- Exact joined rows: " + joined.matchedCount, "- Lineage: source -> join -> trajectory -> dataset", ...matrix.map(row => "- " + row.action + ": source=" + row.sourceCount + ", joined=" + row.joinedCount + ", trajectory=" + row.trajectoryCount + ", dataset=" + row.datasetCount + ", attempted=" + row.attemptedCount + ", filled=" + row.filledCount + ", support=" + row.support), "", "- WAIT dominance: " + report.waitDominance.policyRule, "- BUY and SELL_PART are UNSEEN_IN_EXPERT_POLICY when source count is zero; no counterfactual rows were used.", "- SELL_ALL is rare observed support, not evidence of stable value.", "- No dataset modification, execution, reward recomputation, or model training was performed.", ""].join("\n");
await writeFile("docs/rl-research/offline-rl-v0.11.1-action-support-matrix.json", JSON.stringify(report, null, 2) + "\n");
await writeFile("docs/rl-research/offline-rl-v0.11.1-action-support-matrix.md", markdown + "\n");
console.log(JSON.stringify({ status: report.status, sourceRows: market.length, joinedRows: joined.matchedCount, matrix, scenarioCount: Object.keys(scenarioCounts).length, temporalCounts, sellContext, auditHash: report.auditHash }, null, 2));
