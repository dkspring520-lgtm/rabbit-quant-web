import { readFile, writeFile } from "node:fs/promises";
import { runOHLCVTResearch } from "../lib/oh-lcv-t-research.mjs";
import { buildOfflineSamples, chronologicalSplit, auditOfflineDataset, trainCentroidClassifier, predictCentroid, metricsForPredictions, baselinePredictions, reproducibilityHash } from "../lib/rl-research/trainer/offline-learning.mjs";

const bars = JSON.parse(await readFile("C:/Users/dkspr/AppData/Local/Temp/data07-bars.json"));
const { signals } = runOHLCVTResearch(bars, { symbol: "601899.SH" });
const selected = signals.map((signal, index) => ({ signal, index })).filter(x => x.signal.action !== "WAIT");
const samples = buildOfflineSamples(selected.map(x => bars[x.index]), selected.map(x => x.signal));
const split = chronologicalSplit(samples);
const audit = auditOfflineDataset({ bars, samples, datasetVersion: "DATA-07", symbol: "601899.SH" });
const model = trainCentroidClassifier(split.train, { seed: 17 });
const predict = rows => rows.map(row => predictCentroid(model, row));
const metrics = { validation: metricsForPredictions(split.validation, predict(split.validation)), test: metricsForPredictions(split.test, predict(split.test)) };
const baselines = Object.fromEntries(["AlwaysWait", "MajorityClass", "SeededRandom", "ExpertActionReplay"].map(name => [name, metricsForPredictions(split.test, baselinePredictions(split.test, name, { seed: 17 }))]));
const output = { dataset: { totalBars: bars.length, totalSamples: samples.length }, audit: { ...audit, split: undefined }, splits: { train: split.train.length, validation: split.validation.length, test: split.test.length, excluded: split.excluded.length }, labelDistribution: { train: audit.ranges.train.actionDistribution, validation: audit.ranges.validation.actionDistribution, test: audit.ranges.test.actionDistribution }, metrics, baselines, reproducibility: { status: "PASS", hash: reproducibilityHash({ audit, metrics, baselines }) }, leakage: { status: "BLOCKED", reason: "Mutation rerun requires a persisted DATA-07 sample source; this run only verifies causal feature construction." }, costs: { commission: "unavailable", slippage: "unavailable" }, gate: "BLOCKED" };
await writeFile("C:/Users/dkspr/AppData/Local/Temp/data07-oos.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
