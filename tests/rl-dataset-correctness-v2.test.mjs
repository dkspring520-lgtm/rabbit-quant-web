import assert from "node:assert/strict";
import test from "node:test";
import { buildOfflineRLDataset, normalizePositionDeltaAction, positionDeltaLabel, SeededRandomBaseline, calculateRateReward } from "../lib/rl-research/index.mjs";

const make = (action, raw = .02) => buildOfflineRLDataset([{ action, futureReturn: raw, feeRate: 0, slippageRate: 0 }])[0];
test("action conditioned returns respect magnitude and WAIT", () => {
  assert.equal(make("BUY").actionConditionedReturnRate, .02);
  assert.equal(make("SELL_ALL").actionConditionedReturnRate, -.02);
  assert.equal(make("SELL_PART").actionConditionedReturnRate, -.005);
  assert.equal(make("WAIT").actionConditionedReturnRate, 0);
});
test("cost rates remain normalized and reward carries V2 version", () => {
  assert.equal(calculateRateReward({ futureReturnRate: .02, feeRate: .001, slippageRate: .002 }), .017);
  const row = buildOfflineRLDataset([{ action: "BUY", futureReturn: .02, feeRate: .001, slippageRate: .002 }])[0];
  assert.equal(row.rewardVersion, "rate-v2");
});
test("arbitrary numeric actions map to a legal discrete action", () => {
  assert.deepEqual([.37, -.62].map(normalizePositionDeltaAction), [.5, -.25]);
  assert.equal(positionDeltaLabel(.37), "BUY_SMALL");
});
test("seeded random baseline is reproducible", () => {
  const a = SeededRandomBaseline(42); const b = SeededRandomBaseline(42);
  assert.deepEqual(Array.from({ length: 8 }, () => a()), Array.from({ length: 8 }, () => b()));
});
