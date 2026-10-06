import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_INDICATOR_REGISTRY, IndicatorEngine, auditAlignment, auditRegistry, auditTemporal, auditWarmup } from "../lib/indicators/index.mjs";

function bars(count = 80) {
  return Array.from({ length: count }, (_, index) => {
    const price = 10 + index * 0.02 + Math.sin(index / 4) * 0.05;
    return { timestamp: "2026-10-05T" + String(930 + index).padStart(4, "0"), price, open: price - 0.01, high: price + 0.03, low: price - 0.03, close: price, volume: 1000 + index * 10 };
  });
}

test("registry has metadata-complete proposal-only indicators", () => {
  const items = DEFAULT_INDICATOR_REGISTRY.list();
  assert.ok(items.length >= 25);
  assert.equal(new Set(items.map(item => item.id)).size, items.length);
  assert.ok(items.every(item => item.rlEligible === false && item.lookahead === false && item.futureData === false));
  assert.equal(auditRegistry(DEFAULT_INDICATOR_REGISTRY).pass, true);
});

test("provider adapter returns unified single and multi-value output", () => {
  const engine = new IndicatorEngine();
  const input = bars();
  const ema = engine.calculate("EMA_20", input);
  assert.equal(ema.indicatorId, "EMA_20");
  assert.equal(ema.timestamp, input.at(-1).timestamp);
  assert.equal(typeof ema.value, "number");
  const macd = engine.calculate("MACD_12_26_9", input);
  assert.deepEqual(Object.keys(macd.value), ["macd", "signal", "histogram"]);
});

test("warmup and alignment preserve nulls instead of filtering them", () => {
  const engine = new IndicatorEngine();
  const input = bars();
  const warmup = auditWarmup(engine, "RSI_14", input);
  assert.ok(warmup.firstValidIndex >= 14);
  assert.equal(warmup.nullBeforeFirstValid, true);
  const alignment = auditAlignment(engine, "EMA_20", input);
  assert.equal(alignment.pass, true);
  assert.equal(alignment.actualCount, input.length);
});

test("temporal audit is future invariant", () => {
  const engine = new IndicatorEngine();
  const input = bars();
  const audit = auditTemporal(engine, "MACD_12_26_9", input, [30, 60, 79]);
  assert.equal(audit.pass, true);
});

test("snapshot is research-only and never emits an action", () => {
  const engine = new IndicatorEngine();
  const snapshot = engine.snapshot(bars(), { symbol: "601899.SH", indicatorIds: ["RSI_14", "EMA_20", "VWAP_SESSION"] });
  assert.equal(snapshot.status, "RESEARCH_ONLY");
  assert.equal(snapshot.rlEligible, false);
  assert.equal(Object.hasOwn(snapshot, "action"), false);
  assert.ok(Object.hasOwn(snapshot.indicators, "RSI_14"));
});

test("duplicate and unordered timestamps are rejected", () => {
  const engine = new IndicatorEngine();
  assert.throws(() => engine.calculate("EMA_5", [{ timestamp: "2", price: 10 }, { timestamp: "2", price: 11 }]), /unique and ordered/);
  assert.throws(() => engine.calculate("EMA_5", [{ timestamp: "2", price: 10 }, { timestamp: "1", price: 11 }]), /unique and ordered/);
});
