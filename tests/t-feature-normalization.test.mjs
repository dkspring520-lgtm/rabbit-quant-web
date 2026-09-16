import test from "node:test";
import assert from "node:assert/strict";
import { causalTFeatureSnapshot, rollingZScore } from "../lib/t-feature-normalization.mjs";

test("rolling z-score only uses data through the current index", () => {
  const values = [1, 1, 1, 2, 1000];
  assert.equal(rollingZScore(values, 3, 10), 1.7320508075688774);
});

test("causal T features expose relative price, momentum and volume", () => {
  const points = [
    { price: 10, volume: 10 },
    { price: 10.2, volume: 20 },
    { price: 10.4, volume: 40 },
  ];
  const snapshot = causalTFeatureSnapshot(points, 2, [10, 10.1, 10.2], 3);
  assert.equal(snapshot.vwapBias > 0, true);
  assert.equal(snapshot.momentum > 0, true);
  assert.equal(Number.isFinite(snapshot.volumeZ), true);
});
