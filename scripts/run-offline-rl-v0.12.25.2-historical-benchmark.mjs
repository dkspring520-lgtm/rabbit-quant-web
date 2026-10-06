import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { streamHistoricalJsonl } from "../lib/rl-research/trainer/historical-jsonl-stream.mjs";
import { runHistoricalTBenchmark } from "../lib/rl-research/historical-t-benchmark-engine.mjs";

const input = process.argv.find(value => value.startsWith("--input="))?.slice(8) ?? ".data-inspect/zijin-601899-2022-2026.jsonl";
const outputDir = process.argv.find(value => value.startsWith("--output-dir="))?.slice(13) ?? "docs/rl-research/results";
const sourceBytes = await readFile(input);
const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
const bars = [];
const sourceEvents = [];
let previousTimestamp = "";
let duplicateTimestampCount = 0;
for await (const row of streamHistoricalJsonl(input, { symbol: "601899.SH", onEvent: event => sourceEvents.push(event) })) {
  if (row.timestamp === previousTimestamp) duplicateTimestampCount += 1;
  if (previousTimestamp && row.timestamp < previousTimestamp) sourceEvents.push({ type: "TIMESTAMP_REGRESSION", timestamp: row.timestamp });
  previousTimestamp = row.timestamp;
  bars.push(row);
}
if (!bars.length) throw new Error("DATA07_SOURCE_EMPTY");
if (sourceEvents.some(event => event.type === "TIMESTAMP_REGRESSION")) throw new Error("DATA07_SOURCE_TIMESTAMP_REGRESSION");

const firstPrice = Number(bars[0].price);
const expertPriorActionMapper = ({ candidate, state, context }) => {
  const openTrade = context.openTrades?.[0];
  if (openTrade && state.observedReferencePrice <= openTrade.sellPrice * 0.998) return "REBUILD_T_FULL";
  return candidate.detected ? "REDUCE_T_10" : "WAIT";
};
const benchmark = runHistoricalTBenchmark({
  bars,
  symbol: "601899.SH",
  strategies: ["BUY_HOLD", "BIDIRECTIONAL_T", "EXPERT_PRIOR"],
  strategyConfigs: { EXPERT_PRIOR: { expertPriorActionMapper } },
  initialCash: 1_000_000,
  corePosition: 34_000,
  tPosition: 3_100,
  initialAverageCost: firstPrice,
  includeEquityPath: false,
});

const source = {
  path: input,
  datasetVersion: "DATA-07",
  symbol: "601899.SH",
  sha256: sourceHash,
  barCount: bars.length,
  firstTimestamp: bars[0].timestamp,
  lastTimestamp: bars.at(-1).timestamp,
  duplicateTimestampCount,
  sourceEvents,
};
const strategyReports = Object.fromEntries(Object.entries(benchmark.reports).map(([strategyId, report]) => [strategyId, { ...report, equityPath: undefined }]));
const report = {
  title: "OFFLINE RL V0.12.25.2 DATA-07 HISTORICAL T BENCHMARK",
  version: "V0.12.25.2",
  status: "GENERATED_ONLY_AFTER_VALIDATION",
  source,
  canonicalSchemaVersion: benchmark.canonicalSchemaVersion,
  executionRule: benchmark.executionRule,
  portfolioScenario: { type: "SYNTHETIC_RESEARCH_PORTFOLIO", corePosition: 34_000, tPosition: 3_100, totalPosition: 37_100, initialCash: 1_000_000, initialAverageCost: firstPrice },
  strategies: strategyReports,
  gates: { engineValidation: "PASS_SYNTHETIC_ONLY", backtestResult: "GENERATED_ONLY_AFTER_VALIDATION", valueQTarget: "BLOCKED", rlTraining: "NOT_STARTED", hardStop: true },
  nonGoals: ["Value-Q target generation", "Dataset generation", "Reward modification", "RL training"],
};
await mkdir(outputDir, { recursive: true });
const jsonPath = outputDir + "/offline-rl-v0.12.25.2-benchmark-result.json";
const markdownPath = outputDir + "/offline-rl-v0.12.25.2-benchmark-report.md";
await writeFile(jsonPath, JSON.stringify(report, null, 2) + "\n");
const markdownLines = [
  "# OFFLINE RL V0.12.25.2 — DATA-07 Historical T Benchmark Report",
  "",
  "Status: GENERATED_ONLY_AFTER_VALIDATION",
  "",
  "DATA-07 SHA-256: " + sourceHash,
  "Bars: " + bars.length,
  "Range: " + bars[0].timestamp + " -> " + bars.at(-1).timestamp,
  "",
  "## Strategies",
  "",
];
for (const [strategyId, item] of Object.entries(benchmark.reports)) {
  markdownLines.push(
    "### " + strategyId,
    "",
    "- Total Return: " + item.totalReturn,
    "- T Profit: " + item.tProfit,
    "- Cost Reduction: " + item.costReduction,
    "- Maximum Drawdown: " + item.maximumDrawdown,
    "- Avoided Drawdown: " + item.avoidedDrawdown,
    "- Failed Rebuy Risk: " + item.failedRebuyRisk,
    "- Missed Trend Risk: " + item.missedTrendRisk,
    "- T Success Rate: " + item.tSuccessRate,
    "- Profit Factor: " + item.profitFactor,
    "- Average T Return: " + item.averageTReturn,
    "- Trade Ledger Rows: " + item.tradeLedger.length,
    "- Candidate Events: " + item.candidateEvents.length,
    "",
  );
}
markdownLines.push(
  "## Attribution",
  "",
  "Opportunity Type、Momentum Phase、Action 和 Outcome 已保存在 JSON Trade Ledger 中。",
  "",
  "## Safety Gate",
  "",
  "- Canonical Schema 未修改。",
  "- Reward Contract 未修改。",
  "- Value-Q target 未生成。",
  "- Dataset 未生成。",
  "- RL training 未开始。",
  "- 研究账户为 synthetic scenario，不代表历史真实账户。",
  "",
  "BACKTEST_RESULT = GENERATED_ONLY_AFTER_VALIDATION",
  "VALUE_Q_TARGET = BLOCKED",
  "RL_TRAINING = NOT_STARTED",
  "HARD_STOP = TRUE",
);
await writeFile(markdownPath, markdownLines.join("\n") + "\n");
console.log(JSON.stringify({ jsonPath, markdownPath, source, strategies: Object.fromEntries(Object.entries(benchmark.reports).map(([id, item]) => [id, { totalReturn: item.totalReturn, tProfit: item.tProfit, tradeLedgerRows: item.tradeLedger.length }])) }, null, 2));
