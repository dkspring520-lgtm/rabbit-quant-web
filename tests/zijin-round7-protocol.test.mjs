import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const protocol = JSON.parse(await readFile(new URL("../scripts/zijin-round7-protocol.json", import.meta.url), "utf8"));
const runner = await readFile(new URL("../scripts/run_zijin_round4_experiments.py", import.meta.url), "utf8");
const scheduler = await readFile(new URL("../scripts/zijin-auto-trainer.py", import.meta.url), "utf8");

function configurationCount(grid) {
  return Object.values(grid).reduce((count, values) => count * values.length, 1);
}

test("round seven preregisters two independent, compact VWAP hypotheses", () => {
  assert.equal(protocol.round, 7);
  assert.equal(protocol.status, "preregistered");
  assert.equal(protocol.affectsV4, false);
  assert.equal(protocol.automaticPromotion, false);
  assert.equal(protocol.independentHypothesisCount, 2);
  assert.deepEqual(protocol.hypotheses.map((item) => item.id), [
    "vwap-downside-reclaim-quality",
    "vwap-upside-rejection-quality",
  ]);
  for (const hypothesis of protocol.hypotheses) {
    assert.equal(hypothesis.features.length, 10);
    assert.equal(new Set(hypothesis.features).size, 10);
    assert.equal(configurationCount(hypothesis.parameterGrid), 8);
  }
});

test("round seven seals 2026 and preserves causal decision timing", () => {
  assert.equal(protocol.dataPolicy.selectionEnd, "2025-12-31");
  assert.equal(protocol.dataPolicy.sealedFinalBlindPeriod.allowParameterSelection, false);
  assert.equal(protocol.dataPolicy.sealedFinalBlindPeriod.allowFeatureSelection, false);
  assert.equal(protocol.dataPolicy.sealedFinalBlindPeriod.allowRepeatedInspection, false);
  assert.equal(protocol.dataPolicy.decisionTimestamp, "minute_t_close");
  assert.equal(protocol.dataPolicy.fillTimestamp, "minute_t_plus_1_open");
  assert.equal(protocol.dataPolicy.futureMinutesAllowedOnlyForOutcomeLabels, true);
});

test("round seven small-grid feasibility never grants promotion", () => {
  assert.equal(protocol.feasibilityGate.configurationsPerHypothesis, 8);
  assert.equal(protocol.feasibilityGate.minimumOutOfSampleTrades, 40);
  assert.equal(protocol.feasibilityGate.minimumCoveredOuterQuarters, 6);
  assert.equal(protocol.feasibilityGate.doesNotGrantPromotion, true);
  assert.equal(protocol.promotionGates.minimumOutOfSampleWinRate, 0.65);
  assert.equal(protocol.multipleTesting.probabilityOfBacktestOverfitting.maximum, 0.2);
  assert.equal(protocol.multipleTesting.deflatedSharpe.minimumProbability, 0.95);
  assert.equal(protocol.promotionGates.manualReviewRequired, true);
});

test("runner implements current-minute turn confirmation and reports feasibility", () => {
  assert.match(runner, /vwap-downside-reclaim-quality/);
  assert.match(runner, /vwap-upside-rejection-quality/);
  assert.match(runner, /rows\["ma5SlopePct"\] > 0/);
  assert.match(runner, /rows\["ma5SlopePct"\] < 0/);
  assert.match(runner, /rows\["return3Pct"\] > 0/);
  assert.match(runner, /rows\["return3Pct"\] < 0/);
  assert.match(runner, /"feasibility": feasibility/);
  assert.match(runner, /"doesNotGrantPromotion"/);
  assert.match(scheduler, /zijin-round7-protocol\.json/);
  assert.match(scheduler, /zijin-round7-report\.json/);
});
