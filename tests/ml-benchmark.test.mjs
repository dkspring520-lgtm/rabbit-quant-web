import test from "node:test";
import assert from "node:assert/strict";
import { classWeights, trainLogistic, trainTree, trainMLP, benchmarkMetrics, thresholdEvaluation } from "../lib/rl-research/trainer/ml-benchmark.mjs";
const samples = Array.from({ length: 30 }, (_, i) => ({ expertAction: i < 20 ? "WAIT" : i < 28 ? "BUY_SMALL" : "SELL_ALL", state: { return1: i, volume: i, sentimentScore: i } }));
test("benchmark models emit probabilities and metrics", () => { const cw = classWeights(samples); for (const model of [trainLogistic(samples, { classWeight: cw.weights }), trainTree(samples, { classWeight: cw.weights }), trainMLP(samples, { classWeight: cw.weights })]) { const m = benchmarkMetrics(samples, model); assert.equal(m.predictions.length, samples.length); assert.equal(m.predictions[0].probabilities.length, 3); assert.ok(Number.isFinite(m.macroF1)); } });
test("BUY_SMALL threshold evaluation is deterministic", () => { const model = trainLogistic(samples); const a = thresholdEvaluation(samples, model); const b = thresholdEvaluation(samples, model); assert.deepEqual(a, b); assert.deepEqual(a.map(x => x.threshold), [0.5, 0.6, 0.7, 0.8]); });
