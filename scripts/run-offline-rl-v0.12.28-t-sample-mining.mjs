import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { streamHistoricalJsonl } from "../lib/rl-research/trainer/historical-jsonl-stream.mjs";
import { TReplayEngine } from "../lib/t-replay/index.mjs";

const input = process.argv.find(value => value.startsWith("--input="))?.slice(8) ?? ".data-inspect/zijin-601899-2022-2026.jsonl";
const outputRoot = process.argv.find(value => value.startsWith("--output="))?.slice(9) ?? ".data-inspect/t-sample-mining/v0.12.28";
const symbol = "601899.SH";
const miningRunId = `t-sample-mining-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
const sourceBytes = await readFile(input);
const datasetHash = createHash("sha256").update(sourceBytes).digest("hex");
const rowsByDate = new Map();
let loaderEvents = 0;
for await (const row of streamHistoricalJsonl(input, { symbol, onEvent: () => { loaderEvents += 1; } })) {
  const date = String(row.timestamp).slice(0, 10);
  if (!rowsByDate.has(date)) rowsByDate.set(date, []);
  rowsByDate.get(date).push(row);
}

const outputDir = `${outputRoot}/${miningRunId}`;
await mkdir(outputDir, { recursive: true });
const assetPath = `${outputDir}/t-samples.jsonl.gz`;
const gzip = createGzip();
const sink = createWriteStream(assetPath);
const writing = pipeline(gzip, sink);
const count = values => Object.fromEntries([...values.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, value]));
const increment = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const stateDistribution = new Map(); const opportunityDistribution = new Map(); const structureDistribution = new Map(); const outcomeDistribution = new Map(); const regimeDistribution = new Map();
const outcomeStats = Object.fromEntries([1, 3, 5, 10].map(horizon => [`${horizon}bar`, { count: 0, complete: 0, returnSum: 0, favorableSum: 0, adverseSum: 0 }]));
const boundarySamples = []; const failureSamples = [];
let replayBars = 0; let validSamples = 0; let invalidSamples = 0; let warmupSamples = 0; let sampleCount = 0; let previousTimestamp = null; const sampleIds = new Set();
const replay = new TReplayEngine();
for (const [date, dayRows] of rowsByDate) {
  const result = replay.replay(dayRows, { symbol, dataSource: "DATA-07", collectSamples: false, onSample: sample => {
    sample.mining = { miningRunId, miningTimestamp: new Date().toISOString(), sourceDatasetHash: datasetHash };
    gzip.write(`${JSON.stringify(sample)}\n`);
    sampleCount += 1; replayBars += 1;
    if (sample.valid) validSamples += 1; else invalidSamples += 1;
    if (sample.featureSnapshot?.validity === "WARMUP" || sample.stateSnapshot?.validity === "STATE_WARMUP") warmupSamples += 1;
    increment(stateDistribution, sample.stateSnapshot?.state ?? "UNKNOWN"); increment(opportunityDistribution, sample.opportunitySnapshot?.type ?? "UNKNOWN"); increment(structureDistribution, sample.label?.structureLabel ?? "UNKNOWN"); increment(outcomeDistribution, sample.label?.outcomeLabel ?? "UNKNOWN");
    const state = sample.stateSnapshot?.state; const feature = sample.featureSnapshot;
    const regime = state === "UPTREND" || state === "DOWNTREND" ? "TRENDING" : state === "RANGE" ? "RANGING" : state === "PULLBACK" ? "PULLBACK" : state === "REBOUND" ? "REBOUND" : state === "HIGH_LEVEL_EXHAUSTION" ? "UPWARD_EXHAUSTION" : state === "LOW_LEVEL_EXHAUSTION" ? "DOWNWARD_EXHAUSTION" : "NEUTRAL";
    increment(regimeDistribution, regime);
    for (const horizon of [1, 3, 5, 10]) { const stat = outcomeStats[`${horizon}bar`]; stat.count += 1; if (sample.outcome?.[`complete_${horizon}bar`]) { stat.complete += 1; if (Number.isFinite(sample.outcome?.[`futureReturn_${horizon}bar`])) stat.returnSum += sample.outcome[`futureReturn_${horizon}bar`]; } if (Number.isFinite(sample.outcome?.[`futureMaxFavorableExcursion_${horizon}bar`])) stat.favorableSum += sample.outcome[`futureMaxFavorableExcursion_${horizon}bar`]; if (Number.isFinite(sample.outcome?.[`futureMaxAdverseExcursion_${horizon}bar`])) stat.adverseSum += sample.outcome[`futureMaxAdverseExcursion_${horizon}bar`]; }
    if (state === "HIGH_LEVEL_EXHAUSTION" || state === "LOW_LEVEL_EXHAUSTION" || sample.opportunitySnapshot?.type === "POSITIVE_T_ENVIRONMENT" || sample.opportunitySnapshot?.type === "COUNTER_T_ENVIRONMENT") {
      const return5 = sample.outcome?.futureReturn_5bar; const contrary = (state === "HIGH_LEVEL_EXHAUSTION" && return5 > 0) || (state === "LOW_LEVEL_EXHAUSTION" && return5 < 0) || (sample.opportunitySnapshot?.type === "POSITIVE_T_ENVIRONMENT" && return5 < 0) || (sample.opportunitySnapshot?.type === "COUNTER_T_ENVIRONMENT" && return5 > 0);
      if (contrary) { const item = { sampleId: sample.sampleId, timestamp: sample.timestamp, state, opportunity: sample.opportunitySnapshot?.type, futureReturn_5bar: return5 }; boundarySamples.push(item); failureSamples.push(item); }
    }
    if (sampleIds.has(sample.sampleId)) throw new Error(`DUPLICATE_SAMPLE:${sample.sampleId}`); sampleIds.add(sample.sampleId);
    if (previousTimestamp && String(sample.timestamp) <= String(previousTimestamp)) throw new Error(`TIMESTAMP_REGRESSION:${sample.timestamp}`); previousTimestamp = sample.timestamp;
    if (sample.mining.sourceDatasetHash !== datasetHash) throw new Error(`DATASET_HASH_MISMATCH:${sample.sampleId}`);
    void feature;
  } });
  if (result.count !== dayRows.length) throw new Error(`REPLAY_COUNT_MISMATCH:${date}`);
}
gzip.end();
await writing;
const miningRun = { runId: miningRunId, datasetHash, symbol, timeRange: { start: [...rowsByDate.keys()][0] ?? null, end: [...rowsByDate.keys()].at(-1) ?? null }, barCount: replayBars, sampleCount, validSamples, invalidSamples, warmupSamples, featureVersion: "1.0.0", stateVersion: "1.0.0", opportunityVersion: "1.0.0", replayVersion: "1.0.0", sampleVersion: "1.0.0", createdAt: new Date().toISOString(), loaderEvents, assetPath };
await writeFile(`${outputDir}/mining-run.json`, JSON.stringify(miningRun, null, 2));
const report = [
  "# OFFLINE RL V0.12.28 — T Sample Mining V1 Report", "", `Mining Run ID: ${miningRunId}`, "", "## Dataset", "", "- Source: DATA-07", `- Symbol: ${symbol}`, `- Dataset Hash: ${datasetHash}`, `- Source path: ${input}`, "- Data loader: existing historical JSONL stream", "", "## Replay Range", "", `- Start: ${miningRun.timeRange.start}`, `- End: ${miningRun.timeRange.end}`, `- Replay bars: ${replayBars}`, "", "## Sample Count", "", `- Total samples: ${sampleCount}`, `- Valid samples: ${validSamples}`, `- Invalid samples: ${invalidSamples}`, `- Warmup samples: ${warmupSamples}`, "", "## State Distribution", "", JSON.stringify(count(stateDistribution)), "", "## Opportunity Distribution", "", JSON.stringify(count(opportunityDistribution)), "", "## Structure Distribution", "", JSON.stringify(count(structureDistribution)), "", "## Outcome Distribution", "", JSON.stringify(count(outcomeDistribution)), "", "## MFE / MAE and Future Returns", "", JSON.stringify(outcomeStats, null, 2), "", "## Boundary / Failure Samples", "", `- Boundary samples: ${boundarySamples.length}`, `- Counter-example samples: ${failureSamples.length}`, "- Samples were retained; no rule or threshold was modified to remove them.", "", "## Market Regime Distribution", "", JSON.stringify(count(regimeDistribution)), "", "## Temporal Isolation", "", "- TEMPORAL_ISOLATION = NOT_RUN_IN_MINING_RUN", "- The causal mutation test remains covered by Replay Engine tests; this run did not mutate DATA-07.", "", "## Data Quality", "", "- Monotonic sample timestamps: PASS", "- Unique sample IDs: PASS", "- Dataset hash consistency: PASS", `- Existing loader events: ${loaderEvents}`, "", "## Provenance", "", "- Feature / State / Opportunity / Replay / Sample versions recorded in every sample.", "- datasetHash recorded from DATA-07 source bytes.", "", "## Limitations", "", "- These are descriptive historical sample distributions, not predictive probabilities or trading success rates.", "- DATA-07 is 1-minute research data; results do not establish Tick/L2 or millisecond microstructure validity.", "- The current Sample Store is in-memory; this run writes a compressed research sample asset and mining metadata, not an RL Dataset.", "", "## Safety Gate", "", "T_SAMPLE_RL_ELIGIBLE = FALSE", "RL_INTEGRATION = BLOCKED", "VALUE_Q_TARGET = BLOCKED", "RL_TRAINING = NOT_STARTED", "HARD_STOP = TRUE", ""
].join("\n");
await writeFile("docs/rl-research/results/offline-rl-v0.12.28-t-sample-mining-v1-report.md", report);
console.log(JSON.stringify(miningRun, null, 2));
