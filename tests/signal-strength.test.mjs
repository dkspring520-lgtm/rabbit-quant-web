import test from "node:test";
import assert from "node:assert/strict";
import { observationConfirmationScore, signalStrengthPresentation } from "../lib/signal-strength.mjs";

test("scores are displayed in points, never as percentages or win rates", () => {
  const result = signalStrengthPresentation({ score: 70 });
  assert.equal(result.label, "70分");
  assert.match(result.detail, /历史胜率待校准/);
  assert.doesNotMatch(result.label, /%/);
  assert.equal(signalStrengthPresentation({ score: 0 }).label, "0分");
});

test("invalid and missing scores never turn into zero", () => {
  for (const score of [null, undefined, NaN, Infinity, -1, 101, "70", ""]) {
    assert.equal(signalStrengthPresentation({ score }).label, "待评分");
  }
});

test("the existing calibrated price-path statistic is explicitly a hit rate", () => {
  const result = signalStrengthPresentation({ score: 85, historicalProbability: 70 });
  assert.equal(result.label, "命中 70%");
  assert.match(result.detail, /不是扣费后的交易胜率/);
  assert.equal(signalStrengthPresentation({ score: 85, historicalProbability: NaN }).label, "85分");
});

test("each strategy keeps its own scoring scale, not its entry threshold", () => {
  assert.equal(observationConfirmationScore({ confirmationScore: 75, score: 0 }, "v1"), 75);
  assert.equal(observationConfirmationScore({ score: 0 }, "v1"), null);
  assert.equal(observationConfirmationScore({ score: 3, threshold: 3 }, "v29"), 75);
  assert.equal(observationConfirmationScore({ score: 0 }, "v29"), 0);
  assert.equal(observationConfirmationScore({ score: 5 }, "v29"), null);
  assert.equal(observationConfirmationScore({ score: 5, scoreBreakdown: {direction:90,location:60,trigger:75} }, "closure"), 75);
  assert.equal(observationConfirmationScore({ score: 5 }, "closure"), null);
  assert.equal(observationConfirmationScore({ scoreBreakdown: {direction:90,location:null,trigger:75} }, "closure"), null);
});
