import test from "node:test";
import assert from "node:assert/strict";
import {
  ZIJIN_SHADOW_EXPERIMENTS_VERSION,
  ZIJIN_SHADOW_EXPERIMENTS,
  evaluateFiveMinuteExhaustion,
  evaluateL2OrderLifecycle,
  evaluateFirstProbeResponse,
  evaluateZijinShadowExperiments,
} from "../lib/zijin-shadow-experiments.mjs";

function minute(time, price, volume = 100, extra = {}) {
  return { time, price, open: price, high: price, low: price, close: price, volume, ...extra };
}

test("three experiments are explicitly research-only", () => {
  assert.equal(ZIJIN_SHADOW_EXPERIMENTS.length, 3);
  assert.match(ZIJIN_SHADOW_EXPERIMENTS_VERSION, /shadow/);
  const result = evaluateZijinShadowExperiments({ minutes: [minute("0930", 10)], index: 0 });
  assert.equal(result.researchOnly, true);
  assert.equal(result.shadowOnly, true);
  assert.equal(result.canCreateSignal, false);
  assert.equal(result.affectsProduction, false);
});

test("five-minute exhaustion never uses an incomplete current bucket", () => {
  const rows = Array.from({ length: 60 }, (_, index) => {
    const price = index < 55 ? 10 + index * 0.01 : 10.56 + (index - 55) * 0.005;
    return minute(String(930 + index).padStart(4, "0"), price, index >= 55 ? 30 : 100);
  });
  const incomplete = evaluateFiveMinuteExhaustion({ minutes: rows, index: 58 });
  const complete = evaluateFiveMinuteExhaustion({ minutes: rows, index: 59 });
  assert.equal(incomplete.id, "five-minute-exhaustion");
  assert.notEqual(incomplete.asOfTime, rows[58].time);
  assert.equal(complete.asOfTime, rows[59].time);
});

test("L2 lifecycle requires live depth and real active trades", () => {
  const rows = [0, 1, 2, 3].map(index => minute(String(1000 + index).padStart(4, "0"), 10, 100, {
    l2: {
      status: { authorized: true, stale: false },
      flow: { activeBuyVolume: 60, activeSellVolume: 40, activeBuyRatio: 0.6 },
      book: { bidVolumes: [100, 80], askVolumes: [60, 50] },
    },
  }));
  const result = evaluateL2OrderLifecycle({ points: rows, index: 3, direction: "正T" });
  assert.equal(result.confirmed, true);
  assert.equal(result.metrics.activeBuyRatio, 0.6);
  const missing = evaluateL2OrderLifecycle({ points: rows.map(row => ({ ...row, l2: { ...row.l2, status: { authorized: true, stale: true } } })), index: 3, direction: "正T" });
  assert.equal(missing.confirmed, false);
});

test("first probe separates partial entry from second-probe wait", () => {
  const rows = [
    10.0, 9.9, 9.8, 9.7, 9.6, 9.62, 9.66, 9.70, 9.72,
  ].map((price, index) => minute(String(1030 + index).padStart(4, "0"), price, 100, {
    l2: { flow: { activeBuyVolume: 70, activeSellVolume: 30, activeBuyRatio: 0.7 }, status: { authorized: true, stale: false } },
  }));
  const partial = evaluateFirstProbeResponse({ minutes: rows, index: rows.length - 1, config: { firstProbeLookback: 3 } });
  assert.equal(partial.decision, "先做一半");
  const secondProbeRows = [...rows, minute("1040", 9.55, 100)];
  const wait = evaluateFirstProbeResponse({ minutes: secondProbeRows, index: secondProbeRows.length - 1, config: { firstProbeLookback: 3 } });
  assert.equal(wait.decision, "等待第二次探底");
});
