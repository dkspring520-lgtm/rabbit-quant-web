import assert from "node:assert/strict";
import test from "node:test";

import {
  RABBIT_STUDIO_METRICS_CONTRACT,
  buildRabbitStudioMetrics,
  calculateRabbitStudioIntradayMetrics,
} from "../lib/rabbit-studio-metrics.mjs";

test("calculates factual weighted intraday metrics when every minute has volume", () => {
  const minutes = [
    { time: "09:30", price: 10, volume: 100 },
    { time: "09:31", price: 12, volume: 300 },
    { time: "09:32", price: 11, volume: 100 },
  ];
  const result = buildRabbitStudioMetrics(minutes, 10, { recentWindowBars: 3 });

  assert.equal(result.available, true);
  assert.equal(result.validMinutes, 3);
  assert.equal(result.vwap.method, "volume-weighted");
  assert.equal(result.vwap.isFallback, false);
  assert.equal(result.vwap.value, 11.4);
  assert.equal(result.dayRange.high.price, 12);
  assert.equal(result.dayRange.low.price, 10);
  assert.equal(result.dayRange.amplitudePct, 20);
  assert.equal(result.dayRange.pricePositionPct, 50);
  assert.equal(result.dayRange.position.key, "middle");
  assert.equal(result.supportResistance.support.price, 10);
  assert.equal(result.supportResistance.resistance.price, 12);
  assert.equal(result.tSpace.sessionGrossSpread, 2);
  assert.equal(result.tSpace.recentGrossSpreadPct, 20);
  assert.equal(result.rhythm.isSignal, false);
  assert.match(result.rhythm.explanation, /仅描述已发生/);
});

test("uses and clearly labels a price-average fallback when minute volume is missing", () => {
  const result = buildRabbitStudioMetrics([
    { time: "09:30", price: 10, volume: 100 },
    { time: "09:31", price: 12 },
    { time: "09:32", price: 11, volume: 100 },
  ], 10);

  assert.equal(result.vwap.value, 11);
  assert.equal(result.vwap.method, "price-average-fallback");
  assert.equal(result.vwap.isFallback, true);
  assert.equal(result.vwap.fallbackReason, "成交量不完整");
  assert.match(result.vwap.label, /价格平均/);
  assert.match(result.vwap.note, /不是成交量加权均价/);
  assert.equal(result.vwap.volumeCoverage.complete, false);
});

test("uses only the requested trailing window for causal support and resistance references", () => {
  const minutes = [
    { time: "09:30", price: 13, volume: 100 },
    { time: "09:31", price: 10, volume: 100 },
    { time: "09:32", price: 9, volume: 100 },
    { time: "09:33", price: 11, volume: 100 },
    { time: "09:34", price: 10, volume: 100 },
  ];
  const result = buildRabbitStudioMetrics(minutes, 10, { recentWindowBars: 3 });

  assert.equal(result.dayRange.high.price, 13);
  assert.equal(result.dayRange.low.price, 9);
  assert.equal(result.supportResistance.method, "causal-recent-extrema");
  assert.equal(result.supportResistance.support.price, 9);
  assert.equal(result.supportResistance.support.time, "09:32");
  assert.equal(result.supportResistance.resistance.price, 11);
  assert.equal(result.supportResistance.resistance.time, "09:33");
  assert.equal(result.supportResistance.support.causal, true);
  assert.equal(result.supportResistance.support.confirmed, false);
  assert.equal(result.supportResistance.resistance.ageBars, 1);
  assert.match(result.supportResistance.note, /不使用未来数据/);
});

test("falls back to the first observed price for amplitude when previous close is unavailable", () => {
  const result = buildRabbitStudioMetrics([
    { time: "09:30", price: 10 },
    { time: "09:31", price: 10.5 },
  ]);

  assert.equal(result.latest.changePct, null);
  assert.equal(result.dayRange.amplitudeReference, 10);
  assert.equal(result.dayRange.amplitudeBasis, "first-available-price-fallback");
  assert.equal(result.dayRange.amplitudePct, 5);
  assert.equal(result.tSpace.referenceBasis, "latest-price-fallback");
});

test("is robust for empty, invalid, and flat inputs without inventing a signal", () => {
  const empty = buildRabbitStudioMetrics([{ time: "", price: 10 }, { time: "09:30", price: 0 }], 10);
  assert.equal(empty.available, false);
  assert.equal(empty.rhythm.isSignal, false);
  assert.equal(empty.emitsSignals, false);

  const flat = calculateRabbitStudioIntradayMetrics([
    { time: "09:30", price: 10, volume: 0 },
    { time: "09:31", price: 10, volume: 0 },
  ], 10);
  assert.equal(flat.dayRange.isFlatRange, true);
  assert.equal(flat.dayRange.pricePositionPct, 50);
  assert.equal(flat.dayRange.position.key, "flat");
  assert.equal(flat.vwap.method, "price-average-fallback");
  assert.equal(flat.vwap.fallbackReason, "成交量合计为零");
  assert.equal(flat.tSpace.sessionGrossSpread, 0);
  assert.equal(flat.rhythm.isSignal, false);
});

test("contract excludes signals, scores, and probabilities", () => {
  assert.deepEqual(RABBIT_STUDIO_METRICS_CONTRACT, {
    version: "2026.09-light-metrics-v1",
    displayOnly: true,
    emitsSignals: false,
    emitsScores: false,
    emitsProbabilities: false,
    supportResistanceMethod: "causal-recent-extrema",
  });
});
