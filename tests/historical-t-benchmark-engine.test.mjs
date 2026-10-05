import assert from "node:assert/strict";
import test from "node:test";
import { runHistoricalTBenchmark } from "../lib/rl-research/index.mjs";

function bars(prices, date = "2026-09-30") {
  return prices.map((price, index) => ({
    timestamp: date + "T" + ("0" + (930 + index)).slice(-4),
    date,
    time: ("0" + (930 + index)).slice(-4),
    price,
    volume: 1000,
  }));
}

test("benchmark runner returns all five strategies without generating artifacts", () => {
  const result = runHistoricalTBenchmark({ bars: bars([10, 10.01, 10.02, 9.99, 10.03, 10.04, 10.02]), initialCash: 100000, corePosition: 3400, tPosition: 1000, initialAverageCost: 10 });
  assert.deepEqual(Object.keys(result.reports), ["BUY_HOLD", "FIXED_POSITIVE_T", "FIXED_REVERSE_T", "BIDIRECTIONAL_T", "EXPERT_PRIOR"]);
  assert.equal(result.sourceDataset, "DATA-07");
  assert.equal(result.executionRule, "CURRENT_BAR_SIGNAL_NEXT_BAR_EXECUTION");
  assert.equal(result.reports.BUY_HOLD.tradeLedger.length, 0);
});

test("T action uses next bar execution and sizes from T position only", () => {
  const result = runHistoricalTBenchmark({
    bars: bars([10, 10.5, 10.4, 10.3]),
    initialCash: 100000,
    corePosition: 3400,
    tPosition: 1000,
    initialAverageCost: 10,
    strategies: {
      TEST: ({ state }) => state.timestamp.endsWith("0930") ? "REDUCE_T_10" : "WAIT",
    },
  });
  const report = result.reports.TEST;
  assert.equal(report.tradeLedger.length, 1);
  assert.equal(report.tradeLedger[0].shares, 100);
  assert.equal(report.tradeLedger[0].signal_timestamp.endsWith("0930"), true);
  assert.equal(report.tradeLedger[0].execution_timestamp.endsWith("0931"), true);
  assert.equal(report.tradeLedger[0].sell_price, 10.4979);
  assert.equal(report.equityPath[1].position, 4300);
});

test("T+1 prevents same-day re-selling of a rebuilt T position", () => {
  let sellableAt0932 = null;
  const result = runHistoricalTBenchmark({
    bars: bars([10, 10.2, 10.1, 10.0, 9.9]),
    initialCash: 100000,
    corePosition: 3400,
    tPosition: 1000,
    initialAverageCost: 10,
    strategies: {
      TEST: ({ state, context }) => {
        if (state.timestamp.endsWith("0930")) return "REDUCE_T_10";
        if (context.openTrades.length && state.timestamp.endsWith("0931")) return "REBUILD_T_FULL";
        if (state.timestamp.endsWith("0932")) { sellableAt0932 = state.tSellablePosition; return "REDUCE_T_10"; }
        return "WAIT";
      },
    },
  });
  const report = result.reports.TEST;
  assert.equal(report.tradeLedger[0].shares, 100);
  assert.equal(report.tradeLedger[0].outcome, "FAILED_REBUY");
  assert.equal(sellableAt0932, 900);
});

test("Expert Prior keeps candidate pattern separate from action mapping", () => {
  const result = runHistoricalTBenchmark({
    bars: bars([10, 10.01, 10.02, 10.03, 10.02, 10.01, 10.00]),
    strategies: ["EXPERT_PRIOR"],
    strategyConfigs: { EXPERT_PRIOR: { expertPriorActionMapper: () => "WAIT" } },
  });
  const report = result.reports.EXPERT_PRIOR;
  assert.equal(report.tradeLedger.length, 0);
  assert.ok(Array.isArray(report.candidateEvents));
});
