import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scriptUrl = new URL("../scripts/train-zijin-round3-nested.py", import.meta.url);

test("Zijin round three uses nested chronological OOF selection", async () => {
  const source = await readFile(scriptUrl, "utf8");
  assert.match(source, /DecisionTreeRegressor/);
  assert.match(source, /INNER_FOLD_COUNT = 4/);
  assert.match(source, /EMBARGO_TRADING_DAYS = 1/);
  assert.match(source, /inner_predictions/);
  assert.match(source, /selectionUsesOuterQuarter": False/);
  assert.match(source, /selectionUsesWinRate": False/);
  assert.match(source, /rows\["date"\] < validation_start/);
});

test("Zijin round three optimizes net expectation and keeps 2026 sealed", async () => {
  const source = await readFile(scriptUrl, "utf8");
  assert.match(source, /STRESS_COST_PCT = 0\.18/);
  assert.match(source, /bootstrap95LowerPct/);
  assert.match(source, /stressBootstrap95LowerPct/);
  assert.match(source, /loaded2026Rows/);
  assert.match(source, /2026 保持封存/);
  assert.match(source, /"affectsV4": False/);
  assert.match(source, /下一分钟开盘价/);
  assert.match(source, /同柱止损优先/);
});

test("Zijin round three pre-registers direction and session guards", async () => {
  const source = await readFile(scriptUrl, "utf8");
  assert.match(source, /"opening": \(9 \* 60 \+ 33, 10 \* 60 \+ 30\)/);
  assert.match(source, /"regular": \(10 \* 60 \+ 31, 14 \* 60 \+ 30\)/);
  assert.match(source, /peerBreadth3/);
  assert.match(source, /vwapSlope5Pct/);
  assert.match(source, /positive.*reverse/s);
});

test("Zijin round three measures the best inner candidate without granting deployment eligibility", async () => {
  const source = await readFile(scriptUrl, "utf8");
  assert.match(source, /Always carry the strongest inner-OOF candidate/);
  assert.match(source, /"evaluated": selected is not None/);
  assert.match(source, /"innerEligible": bool\(selected and selected\["eligible"\]\)/);
  assert.match(source, /"innerEligibleFolds"/);
});
