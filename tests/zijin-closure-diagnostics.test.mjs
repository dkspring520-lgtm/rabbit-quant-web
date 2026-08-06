import assert from "node:assert/strict";
import test from "node:test";

import {
  addClosureReplayResult,
  classifyClosureFailure,
  classifyEntryWindow,
  classifyHoldingDuration,
  classifyVwapLocation,
  createClosureDiagnosticsBucket,
  finalizeClosureDiagnosticsBucket,
} from "../lib/zijin-closure-diagnostics.mjs";

test("closure diagnostics classify the causal entry context without changing replay decisions", () => {
  assert.equal(classifyEntryWindow("0940", false), "opening-0930-0944");
  assert.equal(classifyEntryWindow("0950", false), "morning-0945-1030");
  assert.equal(classifyVwapLocation(-0.50), "far-below-vwap");
  assert.equal(classifyVwapLocation(0.02), "near-vwap");
  assert.equal(classifyHoldingDuration(46), "46-60m");
  assert.deepEqual(
    classifyClosureFailure({ net: -12, gross: 6, exitReason: "time exit" }),
    { rootCause: "cost-and-slippage", trigger: "time-exit" },
  );
});

test("closure diagnostics produce loss attribution and state-by-direction backtest slices", () => {
  const bucket = createClosureDiagnosticsBucket();
  addClosureReplayResult(bucket, {
    trades: 2,
    wins: 1,
    net: -10,
    gross: 20,
    fees: 12,
    executionCost: 18,
    cycleNets: [-30, 20],
    actions: [
      { cycleId: 1, time: "0950", direction: "正T", meta: { phase: "entry", regime: "downtrend", deviation: -0.52, trendRiskVotes: 0 } },
      { cycleId: 1, time: "1015", reason: "stop loss", meta: { phase: "exit", hold: 25, cycleGross: -12, cycleFees: 8, cycleExecution: 10 } },
      { cycleId: 2, time: "1020", direction: "反T", meta: { phase: "entry", regime: "downtrend", deviation: 0.24, trendRiskVotes: 1 } },
      { cycleId: 2, time: "1050", reason: "take-profit", meta: { phase: "exit", hold: 30, cycleGross: 32, cycleFees: 4, cycleExecution: 8 } },
    ],
  });

  const report = finalizeClosureDiagnosticsBucket(bucket);
  assert.equal(report.cyclesPer100Days, 200);
  assert.equal(report.slices.regimeDirection["downtrend:正T"].net, -30);
  assert.equal(report.slices.regimeDirection["downtrend:反T"].winRate, 1);
  assert.equal(report.slices.failureRootCause["price-direction"].cycles, 1);
  assert.equal(report.slices.failureTrigger.stop.cycles, 1);
  assert.equal(report.failureAttribution.lossCycles, 1);
  assert.deepEqual(report.failureAttribution.worstSegments, []);
});
