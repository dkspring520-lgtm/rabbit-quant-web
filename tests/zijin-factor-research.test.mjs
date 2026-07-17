import test from "node:test";
import assert from "node:assert/strict";
import { analyzeZijinFactorResearch, calculateZijinFactorSnapshot } from "../lib/zijin-factor-research.mjs";

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
