import assert from "node:assert/strict";
import test from "node:test";
import { calculateRateReward, normalizePositionDeltaAction, replayToRLDataset, buildRLDatasetReport } from "../lib/rl-research/index.mjs";

test("position delta action conversion is deterministic", () => {
  assert.deepEqual(["BUY", "BUY_SMALL", "WAIT", "SELL_PART", "SELL_ALL"].map(normalizePositionDeltaAction), [1, .5, 0, -.25, -1]);
});
test("rate reward uses percentage units only", () => {
  assert.equal(calculateRateReward({ futureReturnRate: .1, feeRate: .01, slippageRate: .02, drawdownRate: .01, tradePenalty: .005 }), .055);
});
test("historical replay adapts into an offline dataset", () => {
  const minutes = Array.from({ length: 7 }, (_, i) => ({ time: `09:${String(30 + i).padStart(2, "0")}`, price: 10 + i * .01, close: 10 + i * .01, volume: 1000, open: 10, high: 10.1, low: 9.9 }));
  const result = replayToRLDataset({ symbol: "600000", dataset: { date: "20260105", minutes }, initialCash: 100000, signalSource: () => ({ side: "BUY", quantity: 100 }) });
  assert.equal(result.dataset.length, 7);
  assert.equal(result.dataset[0].positionDelta, 1);
  assert.equal(result.report.trainingPerformed, false);
});
test("dataset audit reports sample and action statistics", () => {
  const report = buildRLDatasetReport([{ state: { trend: "UP" }, positionDelta: 1, expertAction: "BUY", futureReturnRate: .01, reward: .005 }]);
  assert.equal(report.sampleCount, 1);
  assert.equal(report.actionDistribution[1], 1);
  assert.equal(report.rewardDistribution.average, .005);
});
