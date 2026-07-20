import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const protocol = JSON.parse(await readFile(new URL("../scripts/zijin-round8-protocol.json", import.meta.url), "utf8"));
const runner = await readFile(new URL("../scripts/run_zijin_round4_experiments.py", import.meta.url), "utf8");
const scheduler = await readFile(new URL("../scripts/zijin-auto-trainer.py", import.meta.url), "utf8");

function configurationCount(grid) {
  return Object.values(grid).reduce((count, values) => count * values.length, 1);
}

test("round eight freezes four observable regime and session hypotheses", () => {
  assert.equal(protocol.round, 8);
  assert.equal(protocol.status, "preregistered");
  assert.equal(protocol.affectsV4, false);
  assert.equal(protocol.automaticPromotion, false);
  assert.equal(protocol.independentHypothesisCount, 4);
  assert.equal(protocol.dataPolicy.fullDayRegimeClassificationForbidden, true);
  assert.deepEqual(protocol.hypotheses.map((item) => item.session), [
    "09:33-10:30", "13:00-14:30", "09:33-10:30", "13:00-14:30",
  ]);
  for (const hypothesis of protocol.hypotheses) {
    assert.equal(hypothesis.features.length, 10);
    assert.equal(new Set(hypothesis.features).size, 10);
    assert.equal(configurationCount(hypothesis.parameterGrid), 8);
  }
});

test("round eight preserves causal timing and seals 2026", () => {
  assert.equal(protocol.dataPolicy.selectionEnd, "2025-12-31");
  assert.equal(protocol.dataPolicy.sealedFinalBlindPeriod.allowParameterSelection, false);
  assert.equal(protocol.dataPolicy.sealedFinalBlindPeriod.allowFeatureSelection, false);
  assert.equal(protocol.dataPolicy.sealedFinalBlindPeriod.allowRepeatedInspection, false);
  assert.equal(protocol.dataPolicy.decisionTimestamp, "minute_t_close");
  assert.equal(protocol.dataPolicy.fillTimestamp, "minute_t_plus_1_open");
  assert.equal(protocol.dataPolicy.futureMinutesAllowedOnlyForOutcomeLabels, true);
});

test("round eight remains a small-grid feasibility experiment", () => {
  assert.equal(protocol.feasibilityGate.configurationsPerHypothesis, 8);
  assert.equal(protocol.feasibilityGate.minimumOutOfSampleTrades, 40);
  assert.equal(protocol.feasibilityGate.minimumCoveredOuterQuarters, 6);
  assert.equal(protocol.feasibilityGate.doesNotGrantPromotion, true);
  assert.equal(protocol.promotionGates.minimumOutOfSampleWinRate, 0.65);
  assert.equal(protocol.multipleTesting.probabilityOfBacktestOverfitting.maximum, 0.2);
  assert.equal(protocol.multipleTesting.deflatedSharpe.minimumProbability, 0.95);
});

test("runner and scheduler use the preregistered round eight experiment", () => {
  for (const hypothesis of protocol.hypotheses) assert.match(runner, new RegExp(hypothesis.id));
  assert.match(runner, /start_minute = 9 \* 60 \+ 33 if morning else 13 \* 60/);
  assert.match(runner, /end_minute = 10 \* 60 \+ 30 if morning else 14 \* 60 \+ 30/);
  assert.match(scheduler, /zijin-round8-protocol\.json/);
  assert.match(scheduler, /zijin-round8-report\.json/);
});

test("round eight emits a read-only sample formation audit", () => {
  assert.match(runner, /def sample_formation_diagnostic\(/);
  assert.match(runner, /"diagnosticOnly": True/);
  assert.match(runner, /"canSelectParameters": False/);
  assert.match(runner, /"sampleFormationDiagnostic": formation_diagnostic/);
  assert.match(runner, /"netTargetPct": \[core\.MIN_NET_TARGET_PCT, core\.MAX_NET_TARGET_PCT\]/);
  assert.match(runner, /"futureBarsUsedForSelection": False/);
});
