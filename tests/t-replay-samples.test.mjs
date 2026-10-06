import assert from "node:assert/strict";
import test from "node:test";
import { TReplayEngine, auditReplaySample } from "../lib/t-replay/index.mjs";
import { TSampleStore, REJECT_DUPLICATE, validateSample } from "../lib/t-samples/index.mjs";

const points = Array.from({ length: 16 }, (_, index) => { const close = 100 + index; return { timestamp: `09${String(30 + index).padStart(2, "0")}`, open: close - .2, high: close + .5, low: close - .5, close, price: close, volume: 1000 + index * 20 }; });

test("research replay is chronological and separates outcome from observation", () => {
  const result = new TReplayEngine().replay(points, { symbol: "TEST", dataSource: "SYNTHETIC" });
  assert.equal(result.mode, "RESEARCH_REPLAY"); assert.equal(result.samples.length, points.length);
  const sample = result.samples[5];
  assert.equal(sample.provenance.barIndex, 5); assert.equal(sample.provenance.lookahead, false);
  assert.equal(sample.featureSnapshot.futureReturn_5bar, undefined); assert.equal(sample.outcome.inputTimestamp, sample.timestamp);
  assert.equal(auditReplaySample(sample).pass, true);
});

test("future price changes only realized outcome, not the action-time observation", () => {
  const engine = new TReplayEngine(); const first = engine.replay(points, { symbol: "TEST" }).samples[5];
  const changed = points.map((point, index) => index > 5 ? { ...point, close: point.close + 50, price: point.price + 50, high: point.high + 50, low: point.low + 50 } : point);
  const second = engine.replay(changed, { symbol: "TEST" }).samples[5];
  assert.deepEqual(second.featureSnapshot, first.featureSnapshot); assert.deepEqual(second.stateSnapshot, first.stateSnapshot); assert.deepEqual(second.opportunitySnapshot, first.opportunitySnapshot);
  assert.notDeepEqual(second.outcome, first.outcome);
});

test("sample validator and store reject duplicates without overwrite", () => {
  const sample = new TReplayEngine().replay(points, { symbol: "TEST" }).samples[0];
  assert.equal(validateSample(sample).valid, true); const store = new TSampleStore(); store.add(sample);
  assert.throws(() => store.add(sample), error => error.code === REJECT_DUPLICATE); assert.equal(store.size(), 1);
});

test("sample query is descriptive and does not emit an action", () => {
  const store = new TSampleStore(new TReplayEngine().replay(points, { symbol: "TEST" }).samples);
  const rows = store.query({ outcomeLabel: "INSUFFICIENT_HORIZON" });
  assert.ok(rows.length > 0); assert.equal(Object.keys(rows[0]).some(key => /buy|sell|auto/i.test(key)), false);
});
