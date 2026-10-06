import assert from "node:assert/strict";
import test from "node:test";
import { TFeatureEngine, auditFeatureSnapshot } from "../lib/t-features/index.mjs";
import { TStateEngine, auditStateSnapshot } from "../lib/t-state/index.mjs";
import { TOpportunityEngine, auditOpportunitySnapshot } from "../lib/t-opportunity/index.mjs";
import { buildTObservation } from "../lib/t-observation.mjs";

const points = Array.from({ length: 24 }, (_, index) => ({ timestamp: `09${String(30 + index).padStart(2, "0")}`, price: 100 + index * .2, close: 100 + index * .2, open: 100 + index * .2, high: 100.3 + index * .2, low: 99.7 + index * .2, volume: 1000 + index * 10 }));
const indicators = { VWAP_SESSION: 101.5, EMA_20: 101.4, VWMA_20: 101.3, RSI_14: 60, ATR_14: .5, MFI_14: 55, HISTORICAL_VOLATILITY_20: .02 };

test("Feature snapshot obeys schema and research boundary", () => {
  const snapshot = new TFeatureEngine().calculate(points, { index: 23, symbol: "TEST", indicators });
  assert.equal(snapshot.researchOnly, true); assert.equal(snapshot.rlEligible, false); assert.equal(snapshot.validity, "VALID");
  assert.equal(auditFeatureSnapshot(snapshot).pass, true); assert.equal(snapshot.dependencies.temporal.futureData, false);
});

test("Feature calculation is causal", () => {
  const engine = new TFeatureEngine();
  const prefix = engine.calculate(points, { index: 10, indicators });
  const changedFuture = points.map((item, index) => index > 10 ? { ...item, price: item.price + 999, close: item.close + 999, volume: item.volume * 99 } : item);
  const same = engine.calculate(changedFuture, { index: 10, indicators });
  assert.deepEqual(same.trend, prefix.trend); assert.deepEqual(same.momentum, prefix.momentum);
});

test("State engine emits no action and preserves invalid dependency", () => {
  const features = new TFeatureEngine().calculateSeries(points, { symbol: "TEST", indicators });
  const states = new TStateEngine().calculateSeries(features);
  assert.ok(states.length === points.length); assert.equal(auditStateSnapshot(states.at(-1)).pass, true); assert.equal(states.at(-1).rlEligible, false);
  const invalid = new TStateEngine().calculate({ validity: "INVALID", valid: false, timestamp: "0930", symbol: "TEST" });
  assert.equal(invalid.state, "INVALID"); assert.equal(invalid.validity, "STATE_INVALID");
});

test("Opportunity contract exposes only environment types", () => {
  const feature = new TFeatureEngine().calculate(points, { index: 23, indicators });
  const state = { state: "HIGH_LEVEL_EXHAUSTION", validity: "STATE_VALID", confirmed: true, timestamp: feature.timestamp, symbol: "TEST" };
  const result = new TOpportunityEngine().calculate(feature, state);
  assert.equal(result.type, "COUNTER_T_ENVIRONMENT"); assert.equal(result.scoreMeaning, "T_STRUCTURE_STRENGTH_ONLY");
  assert.equal(auditOpportunitySnapshot(result).pass, true); assert.deepEqual(Object.keys(result).filter(key => /buy|sell|auto/i.test(key)), []);
});

test("Market data to observation integration is research-only", () => {
  const observation = buildTObservation({ minutes: points, symbol: "TEST" });
  assert.equal(observation.researchOnly, true); assert.equal(observation.rlEligible, false); assert.ok(observation.feature); assert.ok(observation.state); assert.ok(observation.opportunity);
});
