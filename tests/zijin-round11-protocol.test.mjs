import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const protocol = JSON.parse(
  await readFile(new URL("../scripts/zijin-round11-protocol.json", import.meta.url), "utf8"),
);
const runner = await readFile(
  new URL("../scripts/run_zijin_round4_experiments.py", import.meta.url),
  "utf8",
);
const scheduler = await readFile(
  new URL("../scripts/zijin-auto-trainer.py", import.meta.url),
  "utf8",
);
const compose = await readFile(new URL("../compose.web.yml", import.meta.url), "utf8");

function configurationCount(grid) {
  return Object.values(grid).reduce((count, values) => count * values.length, 1);
}

test("round eleven freezes one explainable positive-T stability hypothesis", () => {
  assert.equal(protocol.round, 11);
  assert.equal(protocol.independentHypothesisCount, 1);
  assert.equal(protocol.status, "preregistered");
  assert.equal(protocol.researchStage, "mechanism-validation-only");
  assert.equal(protocol.hypotheses.length, 1);
  const hypothesis = protocol.hypotheses[0];
  assert.equal(hypothesis.id, "morning-positive-vwap-stability");
  assert.equal(hypothesis.direction, "positive");
  assert.equal(hypothesis.session, "09:33-10:15");
  assert.equal(hypothesis.features.length, 10);
  assert.equal(new Set(hypothesis.features).size, 10);
  assert.equal(configurationCount(hypothesis.parameterGrid), 16);
  assert.equal(hypothesis.fixedRules.minimumPeerCoverage, 0.8);
  assert.equal(hypothesis.fixedRules.volumeIsHardGate, true);
  assert.equal(hypothesis.fixedRules.entry, "next-minute-open");
});

test("round eleven explicitly addresses coverage without pretending the reused data is new", () => {
  assert.equal(protocol.discoveryDisclosure.roundTenPositiveWinRate, 0.6667);
  assert.equal(protocol.discoveryDisclosure.roundTenPositiveTrades, 18);
  assert.equal(protocol.discoveryDisclosure.roundTenPositiveQuarterRatio, 0.375);
  assert.equal(protocol.discoveryDisclosure.sameDataIsPristineOutOfSample, false);
  assert.equal(protocol.discoveryDisclosure.maySupportPromotion, false);
  assert.equal(protocol.promotionPolicy.currentRunCanPromote, false);
  assert.equal(protocol.validation.resultsArePromotionEligible, false);
  assert.equal(protocol.promotionPolicy.v4MustRemainUnchanged, true);
});

test("round eleven is causal, costed and keeps 2026 sealed", () => {
  assert.equal(protocol.dataPolicy.selectionEnd, "2025-12-31");
  assert.equal(protocol.dataPolicy.sealedFinalBlindPeriod.locked, true);
  assert.equal(protocol.dataPolicy.futureMinuteFeaturesAllowed, false);
  assert.equal(protocol.dataPolicy.futureMinutesAllowedOnlyForOutcomeLabels, true);
  assert.equal(protocol.dataPolicy.decisionTimestamp, "minute_t_close");
  assert.equal(protocol.dataPolicy.fillTimestamp, "minute_t_plus_1_open");
  assert.equal(protocol.outcomePolicy.selectionUsesFutureOutcome, false);
  assert.equal(protocol.outcomePolicy.minimumNetTargetPct, 0.64);
  assert.equal(protocol.outcomePolicy.maximumNetTargetPct, 1);
  assert.equal(protocol.validation.baseRoundTripCostPct, 0.12);
  assert.equal(protocol.validation.stressRoundTripCostPct, 0.18);
});

test("round eleven retains strict stability and multiple-testing gates", () => {
  assert.equal(protocol.promotionGates.minimumOutOfSampleWinRate, 0.65);
  assert.equal(protocol.promotionGates.minimumPositiveQuarterRatio, 0.75);
  assert.equal(protocol.multipleTesting.includePriorRoundsInTrialCount, true);
  assert.equal(protocol.multipleTesting.countMechanismChangeAsAdditionalTrial, true);
  assert.equal(protocol.multipleTesting.probabilityOfBacktestOverfitting.maximum, 0.2);
  assert.equal(protocol.multipleTesting.deflatedSharpe.minimumProbability, 0.95);
  assert.deepEqual(protocol.baselines.map((item) => item.id), [
    "no-trade",
    "simple-vwap",
    "smart-t-v4",
  ]);
});

test("executor implements the fixed positive VWAP, breadth and volume gates", () => {
  assert.match(runner, /hypothesis_id == "morning-positive-vwap-stability"/);
  assert.match(runner, /rows\["direction"\] == "positive"/);
  assert.match(runner, /rows\["minuteOfDay"\] <= 10 \* 60 \+ 15/);
  assert.match(runner, /rows\["peerCoverage"\] >= 0\.8/);
  assert.match(runner, /rows\["peerBreadth3"\] >= minimum_breadth/);
  assert.match(runner, /rows\["volumeRatio"\] >= minimum_volume/);
});

test("production scheduler activates round eleven and writes a separate report", () => {
  assert.match(scheduler, /zijin-round11-protocol\.json/);
  assert.match(scheduler, /zijin-round11-report\.json/);
  assert.match(compose, /ZIJIN_TRAINING_PROTOCOL: \/app\/scripts\/zijin-round11-protocol\.json/);
  assert.match(compose, /ZIJIN_TRAINING_REPORT_PATH: \/training-state\/zijin-round11-report\.json/);
});
