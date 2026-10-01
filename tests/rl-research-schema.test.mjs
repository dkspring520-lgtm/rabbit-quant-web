import assert from "node:assert/strict";
import test from "node:test";
import {
  createExecutionRecord,
  createModelVersion,
  createObservation,
  createSignalSample,
  normalizeResearchAction,
} from "../lib/rl-research/index.mjs";

const identity = { symbol: "601899", date: "20260930", time: "0935", asOf: "2026-09-30T01:35:00.000Z" };

test("research contracts normalize causal identity and preserve missing data as null", () => {
  const observation = createObservation({ ...identity, price: "29.4", volume: "bad", factors: { vwapBias: -0.02 } });
  assert.equal(observation.price, 29.4);
  assert.equal(observation.volume, 0);
  assert.equal(observation.vwap, null);
  assert.deepEqual(observation.factors, { vwapBias: -0.02 });
  assert.equal(Object.isFrozen(observation), true);
});

test("unknown research actions are safely downgraded to WAIT", () => {
  const action = normalizeResearchAction({ ...identity, action: "AUTO_ORDER", source: "experimental", quantity: 250 });
  assert.equal(action.action, "WAIT");
  assert.equal(action.quantity, 250);
  assert.equal(action.source, "experimental");
});

test("execution record keeps T+1 sellable inventory separate from total position", () => {
  const record = createExecutionRecord({
    ...identity,
    action: "BUY",
    quantity: 500,
    positionBefore: 1000,
    positionAfter: 1500,
    sellableBefore: 1000,
    sellableAfter: 1000,
    cashBefore: 50_000,
    cashAfter: 35_000,
    status: "filled",
  });
  assert.equal(record.side, "BUY");
  assert.equal(record.positionAfter, 1500);
  assert.equal(record.sellableAfter, 1000);
});

test("sample and model records keep experimental output separated from baseline", () => {
  const sample = createSignalSample({ ...identity, source: "experimental", modelVersion: "RL-V0.1", signal: "BUY", futureReturns: { "5m": 0.01 } });
  const model = createModelVersion({ modelVersion: "RL-V0.1", source: "experimental", algorithm: "offline-research", enabled: false });
  assert.equal(sample.source, "experimental");
  assert.equal(sample.modelVersion, "RL-V0.1");
  assert.equal(model.enabled, false);
  assert.equal(Object.isFrozen(model), true);
});
