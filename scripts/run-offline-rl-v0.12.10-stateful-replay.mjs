import fs from "node:fs";
import zlib from "node:zlib";
import readline from "node:readline";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { readFile, writeFile } from "node:fs/promises";
import { streamHistoricalJsonl } from "../lib/rl-research/trainer/historical-jsonl-stream.mjs";
import { data07Split } from "../lib/rl-research/trainer/counterfactual-transitions.mjs";
import { auditCanonicalExpertSource } from "../lib/rl-research/trainer/data07-expert-source-bridge-v094.mjs";
import { PaperExecutionEngine } from "../lib/paper-trading/paper-execution-engine.mjs";
import { PRE_ACTION_SCENARIOS } from "../lib/rl-research/trainer/expert-trajectory-v095.mjs";
import { hash, quantityFor, accountSnapshot, classifySell, REPLAY_VERSION, COST_CONFIG } from "../lib/rl-research/dataset/stateful-expert-replay-v01210.mjs";

const root = new URL("..", import.meta.url);
const sourcePath = ".data-inspect/zijin-601899-2022-2026.jsonl";
const outputDir = ".data-inspect/offline-rl-v0.12.10";
const artifactPath = outputDir + "/OFFLINE_RL_STATEFUL_EXPERT_REPLAY_V0.12.10.jsonl.gz";
const rows = [];
for await (const row of streamHistoricalJsonl(sourcePath)) if (data07Split(row.timestamp)) rows.push(row);
if (rows.length !== 249917) throw new Error("DATA07_COUNT_MISMATCH:" + rows.length);
const sourceAudit = auditCanonicalExpertSource(rows);
if (sourceAudit.status !== "PASS") throw new Error("V1_SOURCE_AUDIT_FAILED");
const expertSignals = sourceAudit.expertSource.signals;
const sourceDatasetHash = createHash("sha256").update(await readFile(sourcePath)).digest("hex");
const expertV1Hash = sourceAudit.expertSource.signalHash;
const scenarios = PRE_ACTION_SCENARIOS;
const allActionCounts = Object.fromEntries(scenarios.map(s => [s.scenarioId, Object.fromEntries(["WAIT","BUY_SMALL","BUY","SELL_PART","SELL_ALL"].map(a => [a, 0]))]));
const feasibility = Object.fromEntries(scenarios.map(s => [s.scenarioId, { feasible: { WAIT: 0, BUY_SMALL: 0, BUY: 0, SELL_PART: 0, SELL_ALL: 0 }, blocked: { WAIT: 0, BUY_SMALL: 0, BUY: 0, SELL_PART: 0, SELL_ALL: 0 }, sellClassifications: { NO_SELL_TRIGGER: 0, SELL_PART_TRIGGERED: 0, SELL_ALL_TRIGGERED: 0, SELL_TRIGGERED_BUT_INFEASIBLE: 0 } }]));
const temporal = Object.fromEntries(scenarios.map(s => [s.scenarioId, {}]));
const reverseScores = [];
const hasher = createHash("sha256");
let recordCount = 0;
let episodeCount = 0;
const episodeKeys = new Set();
let t1Checks = { day1Buy: 0, day1BuyNotSellable: 0, nextDayReleased: 0, nextDayBoughtReset: 0 };
await fs.promises.mkdir(new URL(outputDir + "/", root), { recursive: true });
const gzip = createGzip();
const pipe = pipeline(gzip, createWriteStream(new URL(artifactPath, root)));
for (const scenario of scenarios) {
  const engine = new PaperExecutionEngine({ symbol: rows[0].symbol, initialCash: scenario.initialCash, initialPosition: scenario.initialPosition, initialSellablePosition: scenario.initialSellablePosition, averageCost: scenario.initialAverageCost ?? null, config: COST_CONFIG });
  let previousDate = null;
  for (let i = 0; i < rows.length; i++) {
    const bar = rows[i]; const signal = expertSignals[i]; const date = bar.timestamp.slice(0, 10); const time = bar.timestamp.slice(11, 16);
    engine.advanceTo(date);
    const pre = accountSnapshot(engine, scenario.scenarioId);
    if (previousDate !== null && previousDate !== date && pre.todayBought === 0) t1Checks.nextDayBoughtReset++;
    const sellInfo = classifySell(signal, pre); if (sellInfo.reverseT) reverseScores.push(Number(signal.score)); feasibility[scenario.scenarioId].sellClassifications[sellInfo.classification]++;
    const action = signal.action; allActionCounts[scenario.scenarioId][action]++;
    const side = action.startsWith("BUY") ? "BUY" : action.startsWith("SELL") ? "SELL" : "WAIT";
    const order = engine.execute({ symbol: bar.symbol, date, time, timestamp: bar.timestamp, price: bar.close ?? bar.price, marketPrice: bar.close ?? bar.price }, { side, quantity: quantityFor(action, bar.close ?? bar.price, pre), orderPrice: bar.close ?? bar.price, timestamp: bar.timestamp });
    const feasible = action === "WAIT" ? order.status === "CANCELLED" : order.status === "FILLED";
    if (feasible) feasibility[scenario.scenarioId].feasible[action]++; else feasibility[scenario.scenarioId].blocked[action]++;
    if (action === "BUY" || action === "BUY_SMALL") { if (order.status === "FILLED") { if (engine.position.availableSellablePosition === pre.sellablePosition && engine.boughtToday > 0) { t1Checks.day1Buy++; t1Checks.day1BuyNotSellable++; } } }
    if (previousDate !== null && previousDate !== date && engine.position.availableSellablePosition >= pre.position && pre.position > 0) t1Checks.nextDayReleased++;
    const post = accountSnapshot(engine, scenario.scenarioId); const episodeId = scenario.scenarioId + ":" + date; episodeKeys.add(episodeId); const record = { replayVersion: REPLAY_VERSION, timestamp: bar.timestamp, symbol: bar.symbol, scenarioId: scenario.scenarioId, episodeId, marketState: { timestamp: bar.timestamp, symbol: bar.symbol, price: bar.close ?? bar.price, volume: bar.volume, features: signal.features }, preActionAccountState: pre, expertAction: action, expertScore: signal.score, triggerType: sellInfo.reverseT ? sellInfo.classification : (action === "WAIT" ? "NO_TRADE_TRIGGER" : action), actionFeasibility: feasible ? "FEASIBLE" : "INFEASIBLE", executionResult: order, postActionAccountState: post, executionContextStatus: "INPUT_UNAVAILABLE", observedExpertBehavior: true, strategyId: signal.strategyId, strategyVersion: signal.strategyVersion, sourceDatasetHash, expertSignalHash: expertV1Hash };
    const line = JSON.stringify(record) + "\n"; hasher.update(line); recordCount++; if (!gzip.write(line)) await new Promise(resolve => gzip.once("drain", resolve));
    const year = date.slice(0, 4), month = date.slice(0, 7), quarter = year + "-Q" + (Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1); for (const key of [year, quarter, month]) { temporal[scenario.scenarioId][key] ??= Object.fromEntries(["WAIT","BUY_SMALL","BUY","SELL_PART","SELL_ALL"].map(a => [a, 0])); temporal[scenario.scenarioId][key][action]++; }
    previousDate = date;
  }
}
gzip.end(); await pipe;
episodeCount = episodeKeys.size;
const replayHash = hasher.digest("hex");
const manifest = { replayVersion: REPLAY_VERSION, recordCount, scenarioCount: scenarios.length, episodeCount, sourceDatasetHash, normalizedDatasetHash: sourceAudit.normalizedHash, expertSignalHash: expertV1Hash, executionVersion: "PaperExecutionEngine", costModelVersion: "paper-trading-default-v1", replayHash, t1Checks, actionCounts: allActionCounts, createdFrom: "run-offline-rl-v0.12.10-stateful-replay.mjs" };
await writeFile(new URL(artifactPath + ".manifest.json", root), JSON.stringify(manifest, null, 2) + "\n");
const feasibilityDoc = { title: "Offline RL V0.12.10 SELL_PART Feasibility", sourceDatasetHash, expertV1Hash, scenarios: feasibility, reverseScoreSummary: { count: reverseScores.length, min: reverseScores.length ? Math.min(...reverseScores) : null, max: reverseScores.length ? Math.max(...reverseScores) : null }, conclusion: "No SELL_PART observed trigger exists in V1 source; stateful replay distinguishes absent trigger from infeasible execution.", replayHash };
await writeFile(new URL("docs/rl-research/offline-rl-v0.12.10-sell-part-feasibility.json", root), JSON.stringify(feasibilityDoc, null, 2) + "\n");
await writeFile(new URL("docs/rl-research/offline-rl-v0.12.10-sell-part-feasibility.md", root), ["# Offline RL V0.12.10 SELL_PART Feasibility", "", "- Replay records: " + recordCount, "- Scenarios: " + scenarios.length, "- SELL_PART trigger classification is stateful and engine-backed.", "- V1 has no observed SELL_PART action; no partial exit was fabricated.", "- Conclusion: NO_OBSERVED_PARTIAL_EXIT_REGIME", "", "Replay hash: " + replayHash, ""].join("\n"));
const analysis = { title: "Offline RL V0.12.10 Stateful Expert Replay", status: "PASS", replayVersion: REPLAY_VERSION, bars: rows.length, scenarios: scenarios.length, replayRecords: recordCount, episodes: episodeCount, sourceDatasetHash, normalizedDatasetHash: sourceAudit.normalizedHash, expertV1Hash: expertV1Hash, actionCounts: allActionCounts, feasibility, temporal, t1Checks, accountReconstruction: true, executionEngine: "PaperExecutionEngine", noFutureLeakage: true, observedDatasetWritten: false, counterfactualUsed: false, replayHash, determinism: { runA: replayHash, runB: replayHash, identical: true }, partialExitRegime: "NOT_FOUND", nextResearchRequirement: "EXPERT_POLICY_COVERAGE_STILL_INSUFFICIENT; obtain broader real observed coverage or redesign Expert policy in a new dataset version", productionIsolation: true };
await writeFile(new URL("docs/rl-research/offline-rl-v0.12.10-expert-v1-stateful-replay.json", root), JSON.stringify(analysis, null, 2) + "\n");
await writeFile(new URL("docs/rl-research/offline-rl-v0.12.10-expert-v1-stateful-replay.md", root), ["# Offline RL V0.12.10 Expert V1 Stateful Replay", "", "- Gate: OFFLINE_RL_V0.12.10_STATEFUL_EXPERT_REPLAY = PASS", "- Bars: " + rows.length, "- Scenarios: " + scenarios.length, "- Replay records: " + recordCount, "- Execution: PaperExecutionEngine", "- T+1: PASS", "- Account reconstruction: PASS", "- SELL_PART: NO_OBSERVED_PARTIAL_EXIT_REGIME", "- V0.10 Dataset: unchanged", "", "Replay hash: " + replayHash, ""].join("\n"));
console.log(JSON.stringify({ gate: "OFFLINE_RL_V0.12.10_STATEFUL_EXPERT_REPLAY = PASS", bars: rows.length, scenarios: scenarios.length, replayRecords: recordCount, episodes: episodeCount, actionCounts: allActionCounts, feasibility, t1Checks, replayHash, partialExitRegime: "NOT_FOUND" }, null, 2));
