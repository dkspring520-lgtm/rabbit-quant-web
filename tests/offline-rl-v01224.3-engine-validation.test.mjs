import assert from "node:assert/strict";
import test from "node:test";
import { runHistoricalTBenchmark } from "../lib/rl-research/index.mjs";

function scenarioBars(prices, volumes = [], date = "2026-09-30") {
  return prices.map((price, index) => {
    const clock = String(930 + index).padStart(4, "0");
    return { date, time: clock, timestamp: date + "T" + clock, price, volume: volumes[index] ?? 1000 };
  });
}

const account = { initialCash: 100000, corePosition: 3400, tPosition: 3100, initialAverageCost: 34 };

test("uptrend does not trigger Fixed Reverse T", () => {
  const result = runHistoricalTBenchmark({
    ...account,
    bars: scenarioBars([34, 34.5, 35, 35.5, 36, 36.5, 37]),
    strategies: ["FIXED_REVERSE_T"],
  });
  const report = result.reports.FIXED_REVERSE_T;
  assert.equal(report.tradeLedger.filter(row => row.action.startsWith("REDUCE_T_")).length, 0);
});

test("capital-flow spike and momentum exhaustion remain attributable before action mapping", () => {
  const result = runHistoricalTBenchmark({
    ...account,
    bars: scenarioBars(
      [34, 34.2, 34.5, 35, 35.5, 35.8, 35.9, 35.85, 35.8, 35.75, 35.7],
      [1000, 1000, 1000, 1000, 5000, 5000, 5000, 5000, 400, 400, 400],
    ),
    strategies: ["EXPERT_PRIOR"],
    strategyConfigs: { EXPERT_PRIOR: { expertPriorActionMapper: ({ candidate }) => candidate.detected ? "REDUCE_T_10" : "WAIT" } },
  });
  const report = result.reports.EXPERT_PRIOR;
  const detected = report.candidateEvents.find(event => event.candidate.detected);
  assert.ok(detected);
  assert.equal(detected.candidate.opportunityType, "CAPITAL_FLOW_SPIKE_MOMENTUM_EXHAUSTION");
  assert.equal(detected.action, "REDUCE_T_10");
  assert.equal(report.tradeLedger.some(row => row.momentum_phase === "MOMENTUM_EXHAUSTION"), true);
  assert.equal(report.tradeLedger.some(row => row.state.corePosition !== account.corePosition), false);
  assert.equal(Object.hasOwn(detected.candidate, "macd"), false);
});

test("failed rebuy is unresolved and records missed trend risk", () => {
  const result = runHistoricalTBenchmark({
    ...account,
    bars: scenarioBars([35, 35.7, 36.5, 37.0, 38.0]),
    strategies: {
      MISSED_REBUY: ({ state }) => state.timestamp.endsWith("0930") ? "REDUCE_T_10" : "WAIT",
    },
  });
  const report = result.reports.MISSED_REBUY;
  assert.equal(report.tradeLedger.length, 1);
  assert.equal(report.tradeLedger[0].outcome, "UNRESOLVED");
  assert.equal(report.tradeLedger[0].buyback_price, null);
  assert.ok(report.tradeLedger[0].missed_trend_risk.shortT > 0);
  assert.equal(report.tProfit, 0);
});

test("continuous T risk controls block repeated same-day actions", () => {
  const result = runHistoricalTBenchmark({
    ...account,
    bars: scenarioBars([35, 35.1, 35.2, 35.3, 35.4, 35.5, 35.6]),
    strategies: {
      CONTINUOUS_T: ({ state }) => state.timestamp.endsWith("0930") || state.timestamp.endsWith("0932") || state.timestamp.endsWith("0934") ? "REDUCE_T_10" : "WAIT",
    },
    strategyConfigs: { CONTINUOUS_T: { maxDailyTCount: 1, cooldownBars: 1 } },
  });
  const report = result.reports.CONTINUOUS_T;
  const executed = report.tradeLedger.filter(row => row.execution_timestamp !== null);
  assert.equal(executed.length, 1);
  assert.ok(report.blockedActionCount >= 1);
  assert.equal(report.tradeLedger.some(row => ["max daily T count reached", "cooldown active", "open T cycle"].includes(row.failure_reason)), true);
});
