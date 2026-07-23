import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeZijinFactorResearch,
  calculateZijinFactorSnapshot,
  calculateZijinTrendContinuationRisk,
} from "../lib/zijin-factor-research.mjs";

function minute(index, price, volume = 100) {
  const total = 9 * 60 + 30 + index;
  return { time:`${String(Math.floor(total / 60)).padStart(2, "0")}${String(total % 60).padStart(2, "0")}`, price, volume };
}

test("live factor snapshot is causal and stable when later minutes are withheld", () => {
  const prefix = Array.from({length:24}, (_, index) => minute(index, 10 - index * 0.01, 100));
  prefix[21] = minute(21, 9.72, 220);
  prefix[22] = minute(22, 9.76, 240);
  prefix[23] = minute(23, 9.82, 260);
  const future = [...prefix, minute(24, 11.5, 9999), minute(25, 8.5, 9999)];
  const before = calculateZijinFactorSnapshot(prefix, 10);
  const fromSamePrefix = calculateZijinFactorSnapshot(future.slice(0, prefix.length), 10);
  assert.deepEqual(fromSamePrefix, before);
  assert.equal(before.asOfTime, "0953");
  assert.equal(before.direction, "positive");
  assert.equal(before.directionLabel, "正T");
});

test("factor research is isolated from V4 and does not invent validation evidence", () => {
  const result = analyzeZijinFactorResearch({liveMinutes:[], sessions:[]});
  assert.equal(result.mode, "research-only");
  assert.equal(result.affectsV4, false);
  assert.equal(result.evidence.validationWinRate, null);
  assert.equal(result.evidence.ready, false);
  assert.match(result.evidence.label, /样本积累中/);
});

test("completed-day labels are separated from the live factor snapshot", () => {
  const session = {
    date:"20260701",
    previousClose:10,
    minutes:Array.from({length:100}, (_, index) => minute(index, 10 + Math.sin(index / 7) * 0.12, 100 + (index % 9) * 20)),
  };
  const livePrefix = session.minutes.slice(0, 25);
  const result = analyzeZijinFactorResearch({sessions:[session], liveMinutes:livePrefix, previousClose:10});
  assert.equal(result.live.points, 25);
  assert.equal(result.evidence.sessions, 1);
  assert.equal(result.evidence.ready, false);
});

test("Zijin hard gate blocks buying a falling continuation and selling a rising continuation", () => {
  const falling = Array.from({ length: 35 }, (_, index) => minute(index, 30 - index * 0.04, 100));
  falling.push(minute(35, 28.72, 180), minute(36, 28.76, 190), minute(37, 28.80, 200));
  const buyRisk = calculateZijinTrendContinuationRisk(falling, "正T");
  assert.equal(buyRisk.blocked, true);
  assert.match(buyRisk.reason, /下行|下跌|急跌|弱势/);

  const rising = Array.from({ length: 35 }, (_, index) => minute(index, 30 + index * 0.04, 100));
  rising.push(minute(35, 31.28, 180), minute(36, 31.24, 190), minute(37, 31.20, 200));
  const sellRisk = calculateZijinTrendContinuationRisk(rising, "反T");
  assert.equal(sellRisk.blocked, true);
  assert.match(sellRisk.reason, /上行|上涨|急升|强势/);
});

test("Zijin hard gate is causal and ignores all unseen minutes", () => {
  const prefix = Array.from({ length: 36 }, (_, index) => minute(index, 30 - index * 0.035, 100));
  const before = calculateZijinTrendContinuationRisk(prefix, "正T");
  const future = [...prefix, minute(36, 99, 9999), minute(37, 1, 9999)];
  const samePrefix = calculateZijinTrendContinuationRisk(future.slice(0, prefix.length), "正T");
  assert.deepEqual(samePrefix, before);
});
