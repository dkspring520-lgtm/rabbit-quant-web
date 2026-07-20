import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const protocol = JSON.parse(await readFile(new URL("../scripts/zijin-round6-protocol.json", import.meta.url), "utf8"));
const runner = await readFile(new URL("../scripts/run_zijin_round4_experiments.py", import.meta.url), "utf8");

test("round six preregisters two causal exhaustion hypotheses and seals 2026", () => {
  assert.equal(protocol.round, 6);
  assert.equal(protocol.status, "preregistered");
  assert.equal(protocol.independentHypothesisCount, 2);
  assert.equal(protocol.dataPolicy.selectionEnd, "2025-12-31");
  assert.equal(protocol.dataPolicy.decisionTimestamp, "minute_t_close");
  assert.equal(protocol.dataPolicy.fillTimestamp, "minute_t_plus_1_open");
  assert.equal(protocol.dataPolicy.sealedFinalBlindPeriod.allowParameterSelection, false);
  assert.equal(protocol.affectsV4, false);
  assert.equal(protocol.automaticPromotion, false);
  assert.deepEqual(protocol.hypotheses.map((item) => item.id), [
    "drop-exhaustion-confirmation",
    "spike-exhaustion-confirmation",
  ]);
});

test("round six freezes ten factors and eight configurations per hypothesis", () => {
  for (const hypothesis of protocol.hypotheses) {
    assert.equal(hypothesis.features.length, 10);
    assert.equal(new Set(hypothesis.features).size, 10);
    assert.equal(Object.values(hypothesis.parameterGrid).reduce((count, values) => count * values.length, 1), 8);
  }
});

test("round six runner waits for an observable turn instead of labeling future extrema", () => {
  assert.match(runner, /drop-exhaustion-confirmation/);
  assert.match(runner, /spike-exhaustion-confirmation/);
  assert.match(runner, /minuteOfDay.*9 \* 60 \+ 33/s);
  assert.match(runner, /return3Pct.*> 0/s);
  assert.match(runner, /return3Pct.*< 0/s);
  assert.match(runner, /minute_t_plus_1_open|minute t\+1 open/);
});

test("round six keeps commercial promotion gates strict", () => {
  assert.equal(protocol.promotionGates.minimumOutOfSampleWinRate, 0.65);
  assert.equal(protocol.promotionGates.minimumPositiveQuarterRatio, 0.75);
  assert.equal(protocol.multipleTesting.probabilityOfBacktestOverfitting.maximum, 0.2);
  assert.equal(protocol.multipleTesting.deflatedSharpe.minimumProbability, 0.95);
  assert.equal(protocol.promotionGates.manualReviewRequired, true);
  assert.equal(protocol.promotionGates.finalBlindTestRequired, true);
});
