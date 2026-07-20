import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const protocol = JSON.parse(await readFile(new URL("../scripts/zijin-round9-protocol.json", import.meta.url), "utf8"));
const runner = await readFile(new URL("../scripts/run_zijin_round4_experiments.py", import.meta.url), "utf8");
const scheduler = await readFile(new URL("../scripts/zijin-auto-trainer.py", import.meta.url), "utf8");
const compose = await readFile(new URL("../compose.web.yml", import.meta.url), "utf8");

function configurationCount(grid) {
  return Object.values(grid).reduce((count, values) => count * values.length, 1);
}

test("round nine preregisters four fixed, explainable intraday patterns", () => {
  assert.equal(protocol.round, 9);
  assert.equal(protocol.status, "preregistered");
  assert.equal(protocol.affectsV4, false);
  assert.equal(protocol.automaticPromotion, false);
  assert.deepEqual(protocol.hypotheses.map((item) => item.id), [
    "opening-gap-repair-confirmed",
    "vwap-reversion-confirmed",
    "upside-exhaustion-confirmed",
    "peer-divergence-repair",
  ]);
  for (const hypothesis of protocol.hypotheses) {
    assert.equal(hypothesis.features.length, 8);
    assert.equal(new Set(hypothesis.features).size, 8);
    assert.equal(configurationCount(hypothesis.parameterGrid), 8);
    assert.equal(hypothesis.fixedRules.volumeIsHardGate, false);
    assert.equal("minimumVolumeRatio" in hypothesis.parameterGrid, false);
  }
});

test("round nine remains causal and keeps 2026 sealed", () => {
  assert.equal(protocol.dataPolicy.selectionEnd, "2025-12-31");
  assert.equal(protocol.dataPolicy.sealedFinalBlindPeriod.allowParameterSelection, false);
  assert.equal(protocol.dataPolicy.sealedFinalBlindPeriod.allowFeatureSelection, false);
  assert.equal(protocol.dataPolicy.sealedFinalBlindPeriod.allowRepeatedInspection, false);
  assert.equal(protocol.dataPolicy.decisionTimestamp, "minute_t_close");
  assert.equal(protocol.dataPolicy.fillTimestamp, "minute_t_plus_1_open");
  assert.equal(protocol.dataPolicy.futureMinutesAllowedOnlyForOutcomeLabels, true);
  assert.equal(protocol.outcomePolicy.selectionUsesFutureOutcome, false);
  assert.equal(protocol.outcomePolicy.minimumNetTargetPct, 0.64);
  assert.equal(protocol.outcomePolicy.maximumNetTargetPct, 1);
  assert.equal(protocol.outcomePolicy.maximumHoldMinutes, 60);
});

test("round nine preserves strict promotion and multiple-testing controls", () => {
  assert.equal(protocol.multipleTesting.includePriorRoundsInTrialCount, true);
  assert.equal(protocol.multipleTesting.probabilityOfBacktestOverfitting.maximum, 0.2);
  assert.equal(protocol.multipleTesting.deflatedSharpe.minimumProbability, 0.95);
  assert.equal(protocol.promotionGates.minimumOutOfSampleWinRate, 0.65);
  assert.equal(protocol.promotionGates.minimumPositiveQuarterRatio, 0.75);
  assert.equal(protocol.promotionGates.finalBlindTestRequired, true);
  assert.equal(protocol.promotionGates.manualReviewRequired, true);
  assert.equal(protocol.promotionGates.nextStage, "shadow-observation-only");
  assert.deepEqual(protocol.baselines.map((item) => item.id), ["no-trade", "simple-vwap", "smart-t-v4"]);
});

test("runner understands round nine but production remains on frozen round eight", () => {
  for (const hypothesis of protocol.hypotheses) assert.match(runner, new RegExp(hypothesis.id));
  assert.match(runner, /fixed-pattern-confirmation/);
  assert.match(runner, /"futureBarsUsedForSelection": False/);
  assert.match(scheduler, /zijin-round8-protocol\.json/);
  assert.match(scheduler, /zijin-round8-report\.json/);
  assert.match(compose, /ZIJIN_TRAINING_PROTOCOL: \/app\/scripts\/zijin-round8-protocol\.json/);
  assert.match(compose, /ZIJIN_TRAINING_REPORT_PATH: \/training-state\/zijin-round8-report\.json/);
  assert.doesNotMatch(scheduler, /zijin-round9-protocol\.json/);
  assert.doesNotMatch(compose, /zijin-round9-protocol\.json/);
});
