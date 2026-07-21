import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const protocol = JSON.parse(fs.readFileSync("scripts/zijin-super-turning-point-protocol.json", "utf8"));
const runner = fs.readFileSync("scripts/run_zijin_super_turning_point.py", "utf8");

test("super turning point experiment is isolated from V4 and keeps 2026 sealed", () => {
  assert.equal(protocol.isolation.affectsSmartTV4, false);
  assert.equal(protocol.isolation.automaticPromotion, false);
  assert.equal(protocol.dataPolicy.maximumLoadedDate, "2025-12-31");
  assert.equal(protocol.dataPolicy.sealedBlindYear, 2026);
});

test("super turning point signals are causal and use next-minute fills", () => {
  assert.equal(protocol.causality.signalTimestamp, "confirmation-minute");
  assert.equal(protocol.causality.earliestFill, "next-minute-open");
  assert.equal(protocol.causality.backfillSignalToHistoricalExtreme, false);
  assert.equal(protocol.causality.futureDailyHighLowAllowedAsFeature, false);
  assert.match(runner, /entry_index = int\(signal\.signalIndex\) \+ 1/);
  assert.match(runner, /actualDailyHighLowUsedAsInput": False/);
});

test("long-hold audit compares preregistered 60 90 and 120 minute horizons", () => {
  assert.deepEqual(protocol.outcomePolicy.fixedHoldingMinutes, [60, 90, 120]);
  assert.equal(protocol.outcomePolicy.roundTripCostPct, 0.12);
  assert.equal(protocol.signalPolicy.maximumSignalsPerDirectionPerDay, 1);
});
