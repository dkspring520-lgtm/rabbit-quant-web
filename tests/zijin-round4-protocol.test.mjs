import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const protocolUrl = new URL("../scripts/zijin-round4-protocol.json", import.meta.url);

async function loadProtocol() {
  return JSON.parse(await readFile(protocolUrl, "utf8"));
}

test("Zijin round four freezes 2026 and cannot tune against it", async () => {
  const protocol = await loadProtocol();
  assert.equal(protocol.round, 4);
  assert.equal(protocol.status, "preregistered");
  assert.equal(protocol.affectsV4, false);
  assert.equal(protocol.automaticPromotion, false);
  assert.equal(protocol.dataPolicy.selectionEnd, "2025-12-31");
  assert.equal(protocol.dataPolicy.sealedFinalBlindPeriod.allowParameterSelection, false);
  assert.equal(protocol.dataPolicy.sealedFinalBlindPeriod.allowFeatureSelection, false);
  assert.equal(protocol.dataPolicy.sealedFinalBlindPeriod.allowRepeatedInspection, false);
});

test("Zijin round four tests four independent compact hypotheses", async () => {
  const protocol = await loadProtocol();
  assert.deepEqual(
    protocol.hypotheses.map((item) => item.id),
    ["opening-repair", "vwap-mean-reversion", "peak-exhaustion", "sector-divergence"],
  );
  for (const hypothesis of protocol.hypotheses) {
    assert.ok(hypothesis.features.length >= 8, `${hypothesis.id} has too few factors`);
    assert.ok(hypothesis.features.length <= 12, `${hypothesis.id} has too many factors`);
    assert.equal(new Set(hypothesis.features).size, hypothesis.features.length);
  }
});

test("Zijin round four uses rolling OOS, honest baselines, and multiple-testing controls", async () => {
  const protocol = await loadProtocol();
  assert.equal(protocol.validation.method, "anchored-walk-forward-quarterly");
  assert.equal(protocol.dataPolicy.embargoTradingDays, 1);
  assert.deepEqual(protocol.baselines.map((item) => item.id), ["no-trade", "simple-vwap", "smart-t-v4"]);
  assert.equal(protocol.multipleTesting.trialLedgerRequired, true);
  assert.equal(protocol.multipleTesting.probabilityOfBacktestOverfitting.method, "CSCV");
  assert.equal(protocol.multipleTesting.deflatedSharpe.usesAllRecordedTrials, true);
});

test("Zijin round four can only reach shadow observation after every gate", async () => {
  const protocol = await loadProtocol();
  assert.equal(protocol.promotionGates.minimumOutOfSampleWinRate, 0.65);
  assert.equal(protocol.promotionGates.mustBeatAllBaselines, true);
  assert.equal(protocol.promotionGates.finalBlindTestRequired, true);
  assert.equal(protocol.promotionGates.manualReviewRequired, true);
  assert.equal(protocol.promotionGates.nextStage, "shadow-observation-only");
  assert.equal(protocol.shadowReconciliation.reconcileEverySignal, true);
  assert.equal(protocol.shadowReconciliation.unmatchedSignalsCountAsFailures, true);
});
