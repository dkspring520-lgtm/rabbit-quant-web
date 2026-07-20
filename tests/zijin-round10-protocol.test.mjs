import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const protocol = JSON.parse(
  await readFile(new URL("../scripts/zijin-round10-protocol.json", import.meta.url), "utf8"),
);

function configurationCount(grid) {
  return Object.values(grid).reduce((count, values) => count * values.length, 1);
}

test("round ten discloses that its early window came from round-nine postmortem", () => {
  assert.equal(protocol.round, 10);
  assert.equal(protocol.status, "preregistered");
  assert.equal(protocol.researchStage, "replication-only");
  assert.equal(protocol.discoveryDisclosure.discoveredByPostmortem, true);
  assert.equal(protocol.discoveryDisclosure.discoveredWindow, "09:33-09:44");
  assert.equal(protocol.discoveryDisclosure.sameDataIsPristineOutOfSample, false);
  assert.equal(protocol.discoveryDisclosure.additionalTrialRequired, true);
  assert.equal(protocol.discoveryDisclosure.maySupportPromotion, false);
});

test("round ten keeps every decision causal and leaves 2026 sealed", () => {
  assert.equal(protocol.dataPolicy.selectionEnd, "2025-12-31");
  assert.equal(protocol.dataPolicy.sealedFinalBlindPeriod.locked, true);
  assert.equal(protocol.dataPolicy.sealedFinalBlindPeriod.allowParameterSelection, false);
  assert.equal(protocol.dataPolicy.sealedFinalBlindPeriod.allowFeatureSelection, false);
  assert.equal(protocol.dataPolicy.sealedFinalBlindPeriod.allowRepeatedInspection, false);
  assert.equal(protocol.dataPolicy.decisionTimestamp, "minute_t_close");
  assert.equal(protocol.dataPolicy.fillTimestamp, "minute_t_plus_1_open");
  assert.equal(protocol.dataPolicy.futureMinuteFeaturesAllowed, false);
  assert.equal(protocol.dataPolicy.futureMinutesAllowedOnlyForOutcomeLabels, true);
  assert.equal(protocol.outcomePolicy.selectionUsesFutureOutcome, false);
  assert.equal(protocol.outcomePolicy.minimumNetTargetPct, 0.64);
  assert.equal(protocol.outcomePolicy.maximumNetTargetPct, 1);
});

test("round ten splits positive and reverse research inside one fixed window", () => {
  assert.equal(protocol.fixedWindow.start, "09:33");
  assert.equal(protocol.fixedWindow.end, "09:44");
  assert.equal(protocol.fixedWindow.mayExpandAfterRun, false);
  assert.deepEqual(protocol.hypotheses.map((item) => item.direction), ["positive", "reverse"]);
  for (const hypothesis of protocol.hypotheses) {
    assert.equal(hypothesis.features.length, 8);
    assert.equal(new Set(hypothesis.features).size, 8);
    assert.equal(hypothesis.fixedRules.session, "09:33-09:44");
    assert.equal(hypothesis.fixedRules.directionMustEqual, hypothesis.direction);
    assert.equal(hypothesis.fixedRules.entry, "next-minute-open");
    assert.equal(configurationCount(hypothesis.parameterGrid), 8);
  }
});

test("round ten cannot tune itself into V4 or bypass multiple-testing controls", () => {
  assert.equal(protocol.affectsV4, false);
  assert.equal(protocol.automaticPromotion, false);
  assert.equal(protocol.validation.resultsArePromotionEligible, false);
  assert.equal(protocol.multipleTesting.includePriorRoundsInTrialCount, true);
  assert.equal(protocol.multipleTesting.countEachDirectionSeparately, true);
  assert.equal(protocol.multipleTesting.countPostmortemDerivedWindowAsAdditionalTrial, true);
  assert.equal(protocol.multipleTesting.probabilityOfBacktestOverfitting.maximum, 0.2);
  assert.equal(protocol.multipleTesting.deflatedSharpe.minimumProbability, 0.95);
  assert.equal(protocol.promotionPolicy.currentRunCanPromote, false);
  assert.equal(protocol.promotionPolicy.v4MustRemainUnchanged, true);
  assert.deepEqual(protocol.baselines.map((item) => item.id), [
    "no-trade",
    "simple-vwap",
    "smart-t-v4",
  ]);
});
