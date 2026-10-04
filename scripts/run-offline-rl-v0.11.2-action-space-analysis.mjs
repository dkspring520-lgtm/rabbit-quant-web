import fs from "node:fs";
import zlib from "node:zlib";
import readline from "node:readline";
import { createHash } from "node:crypto";
import { OBSERVED_ACTIONS, UNSUPPORTED_ACTIONS, actionSpaceComparison, waitDominance, supportBySplit } from "../lib/rl-research/dataset/action-space-analysis-v0112.mjs";

const root = new URL("..", import.meta.url);
const datasetPath = new URL(".data-inspect/offline-rl-v0.10/OFFLINE_RL_DATASET_V0.10.jsonl.gz", root);
const benchmarkPath = new URL("docs/rl-research/offline-rl-v0.11-value-q-benchmark.json", root);
const jsonPath = new URL("docs/rl-research/offline-rl-v0.11.2-action-space-analysis.json", root);
const mdPath = new URL("docs/rl-research/offline-rl-v0.11.2-action-space-analysis.md", root);
const actions = [...OBSERVED_ACTIONS, ...UNSUPPORTED_ACTIONS];
const emptyCounts = () => Object.fromEntries(actions.map(action => [action, 0]));
const splitFor = timestamp => { const year = Number(String(timestamp).slice(0, 4)); return year <= 2024 ? "train" : year === 2025 ? "validation" : "test"; };
const hashObject = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const counts = emptyCounts();
const splitCounts = { train: emptyCounts(), validation: emptyCounts(), test: emptyCounts() };
const scenarioCounts = {};
let records = 0;
let invalid = [];
let datasetVersion = null;
const input = fs.createReadStream(datasetPath).pipe(zlib.createGunzip());
const lines = readline.createInterface({ input, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line) continue;
  const row = JSON.parse(line);
  records += 1;
  datasetVersion ??= row.datasetVersion;
  if (!actions.includes(row.action)) invalid.push({ row: records, action: row.action });
  counts[row.action] = (counts[row.action] ?? 0) + 1;
  const split = splitFor(row.timestamp);
  splitCounts[split][row.action] = (splitCounts[split][row.action] ?? 0) + 1;
  scenarioCounts[row.scenarioId] ??= emptyCounts();
  scenarioCounts[row.scenarioId][row.action] += 1;
}
if (invalid.length) throw new Error("INVALID_ACTIONS: " + JSON.stringify(invalid.slice(0, 3)));
const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, "utf8"));
const comparison = actionSpaceComparison(counts);
const report = {
  title: "Offline RL V0.11.2 Action Space Analysis",
  status: "PASS",
  dataset: { version: datasetVersion, records, datasetHash: benchmark.dataset?.datasetHash, sourceTrajectoryHash: benchmark.dataset?.sourceTrajectoryHash, chronologicalSplit: true, randomSplit: false },
  observedSupport: { actions: OBSERVED_ACTIONS, counts: comparison.observed, total: comparison.observedTotal, feasibility: comparison.threeActionFeasibility },
  originalEnvironmentSpace: { actions, counts, unsupported: comparison.unsupported, total: records, feasibility: comparison.fiveActionFeasibility },
  waitDominance: waitDominance(counts),
  temporalSupport: supportBySplit(splitCounts),
  scenarioCounts,
  valueBenchmark: { source: "offline-rl-v0.11-value-q-benchmark.json", modelEvidence: benchmark.modelEvidence, metrics: benchmark.metrics, featureSchema: benchmark.featureSchema },
  findings: { buy: "UNSEEN_IN_LOGGED_POLICY", sellPart: "UNSEEN_IN_LOGGED_POLICY", sellAll: "RARE_OBSERVED_SUPPORT", wait: "SUPPORTED_NOOP", counterfactualExcluded: true, actionSpaceRedesign: "RESEARCH_ONLY", actionSpaceRedesignCandidates: ["target_position", "delta_buckets"] },
  productionIsolation: true,
  trainingPerformed: false
};
report.analysisHash = hashObject({ dataset: report.dataset, observedSupport: report.observedSupport, originalEnvironmentSpace: report.originalEnvironmentSpace, temporalSupport: report.temporalSupport, valueBenchmark: report.valueBenchmark });
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
const linesOut = [
  "# Offline RL V0.11.2 Action Space Analysis", "", "- Gate: OFFLINE_RL_V0.11.2_ACTION_SPACE_ANALYSIS = " + report.status, "- Dataset records: " + records, "- Chronological split: true", "- Random split: false", "", "## Action Support", "", "- Observed-support actions: " + OBSERVED_ACTIONS.join(", "), "- Unsupported/OOD actions: " + UNSUPPORTED_ACTIONS.join(", "), "- WAIT ratio: " + (report.waitDominance.waitRatio * 100).toFixed(4) + "%", "- BUY: " + counts.BUY + " (UNSEEN_IN_LOGGED_POLICY)", "- SELL_PART: " + counts.SELL_PART + " (UNSEEN_IN_LOGGED_POLICY)", "- SELL_ALL: " + counts.SELL_ALL + " (RARE_OBSERVED_SUPPORT)", "", "## Value Benchmark", "", "- Model evidence: " + benchmark.modelEvidence, "- Source: existing V0.11 value/Q benchmark; no retraining performed", "- Market-only and market+account results are preserved in the JSON companion.", "", "## Interpretation", "", "The three-action view is the only observed-support action space for this dataset. The original five-action environment remains partially unsupported because BUY and SELL_PART have zero logged observations. WAIT dominance and SELL_ALL rarity are reported as dataset properties, not corrected by resampling or synthetic actions.", "", "Action-space redesign using target-position or delta buckets is research-only and is not applied to the dataset or production policy.", "", "- Production isolation: " + report.productionIsolation, "- Training performed: " + report.trainingPerformed, "- Analysis hash: " + report.analysisHash
];
fs.writeFileSync(mdPath, linesOut.join("\n") + "\n");
console.log("OFFLINE_RL_V0.11.2_ACTION_SPACE_ANALYSIS = " + report.status);
console.log(JSON.stringify({ records, observed: report.observedSupport, unsupported: comparison.unsupported, waitRatio: report.waitDominance.waitRatio, analysisHash: report.analysisHash }, null, 2));
