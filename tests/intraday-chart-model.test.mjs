import test from "node:test";
import assert from "node:assert/strict";
import { cumulativeIntradayAverage, symmetricIntradayScale } from "../lib/intraday-chart-model.mjs";

test("uses the provider's exact cumulative amount average", () => {
  assert.deepEqual(cumulativeIntradayAverage([
    { price:31.20, volume:23_776, averagePrice:31.1988 },
    { price:31.07, volume:59_140, averagePrice:31.1895 },
  ]), [31.1988, 31.1895]);
});

test("falls back to a causal minute-volume weighted average", () => {
  assert.deepEqual(cumulativeIntradayAverage([
    { price:10, volume:100 },
    { price:12, volume:300 },
  ]), [10, 11.5]);
});

test("centres intraday price and percentage axes on previous close", () => {
  const scale = symmetricIntradayScale([31.20, 31.58], 31.77);
  assert.ok(scale);
  assert.equal(scale.ticks.length, 9);
  assert.ok(Math.abs((scale.max - 31.77) - (31.77 - scale.min)) < 1e-10);
  assert.equal(scale.ticks[4].value, 31.77);
  assert.ok(Math.abs(scale.ticks[0].percent + scale.ticks[8].percent) < 1e-10);
});
