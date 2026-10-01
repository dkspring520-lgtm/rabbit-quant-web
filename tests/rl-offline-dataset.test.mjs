import assert from "node:assert/strict";
import test from "node:test";
import { buildOfflineRLDataset, buildRLDatasetReport } from "../lib/rl-research/index.mjs";

const rows = [
  { sampleId: "s1", symbol: "601899", timestamp: "10:00", price: 10, marketRegime: { trend: "UP" }, factorSnapshot: { vwap: 9.9 }, decision: { finalDecision: "BUY" }, futureReturn: .02, fees: .001 },
  { sampleId: "s2", symbol: "601899", timestamp: "10:01", price: 10, marketRegime: { trend: "DOWN" }, factorSnapshot: {}, expertAction: "SELL_PART", futureReturn: -.01, fees: .001 },
];
test("offline dataset contains state expert action future return and reward", () => { const dataset = buildOfflineRLDataset(rows); assert.equal(dataset.length, 2); assert.equal(dataset[0].expertAction, "BUY"); assert.equal(dataset[0].futureReturn, .02); assert.equal(dataset[0].shadowOnly, true); assert.equal(dataset[0].executable, false); });
test("dataset report describes state action reward and return distributions", () => { const report = buildRLDatasetReport(buildOfflineRLDataset(rows)); assert.equal(report.sampleCount, 2); assert.equal(report.stateDistribution.UP, 1); assert.equal(report.actionDistribution.SELL_PART, 1); assert.equal(report.rewardDistribution.count, 2); assert.equal(report.trainingPerformed, false); });
test("same replay inputs create the same offline dataset", () => { assert.deepEqual(buildOfflineRLDataset(rows), buildOfflineRLDataset(rows)); });
test("smart-t and trading decision outputs are consumed as expert labels", () => {
  const dataset = buildOfflineRLDataset([
    { sampleId: "smart", smartT: { side: "BUY" }, futureReturn: .01 },
    { sampleId: "decision", tradingDecision: { finalDecision: "SELL_ALL" }, futureReturn: -.02 },
  ]);
  assert.equal(dataset[0].expertAction, "BUY");
  assert.equal(dataset[1].expertAction, "SELL_ALL");
  assert.equal(dataset[1].executable, false);
});
