import test from "node:test";
import assert from "node:assert/strict";

import {
  assertZuoTExperimentFactorIsolation,
  buildZuoTCandidateEvents,
  evaluateZuoTShadowRow,
  runZijinV29ShadowReplay,
  runZuoTV1ReconstructedReplay,
  selectSpacedZuoTSignals,
  simulateZuoTShadowCycle,
  ZUOT_V2_CORE_FACTOR_IDS,
  ZUOT_V2_SHADOW_SAFETY,
} from "../lib/factor-research/zuot-v2-shadow.mjs";
import { resolveZuoTShadowBacktestConfig } from "../scripts/backtest-zuot-v2-shadow.mjs";

function row(overrides = {}) {
  return {
    date: "20260814",
    time: "1000",
    index: 30,
    price: 35,
    factors: {
      "vwap.bias": -0.001,
      "vwap.mean_reversion": 0.001,
      "volume.ratio_5_20": 1,
      "volume.price_alignment_5m": 0.1,
      "technical.macd_histogram": -0.0001,
      "technical.macd_histogram_delta": 0.0001,
      "orderflow.active_buy_imbalance": 0.2,
      "orderflow.ofi_change_3m": 0.1,
      "price.return_5m": -0.001,
      "volatility.atr14": 0.002,
      "technical.rsi14": -0.3,
      "technical.kdj_j9": -0.3,
      "technical.bollinger_position_20": -0.3,
      ...overrides,
    },
  };
}

test("positive-T applies the five-minute direction gate", () => {
  const accepted = evaluateZuoTShadowRow({ row: row(), direction: "positiveT" });
  const rejected = evaluateZuoTShadowRow({
    row: row({ "price.return_5m": -0.006 }),
    direction: "positiveT",
  });
  assert.equal(accepted.formal, true);
  assert.equal(rejected.formal, false);
  assert.ok(rejected.rejectionReasons.includes("five-minute-direction"));
});

test("reverse-T applies the five-minute direction gate", () => {
  const accepted = evaluateZuoTShadowRow({
    row: row({
      "vwap.bias": 0.001,
      "technical.macd_histogram": 0.0001,
      "technical.macd_histogram_delta": -0.0001,
      "orderflow.active_buy_imbalance": -0.2,
      "orderflow.ofi_change_3m": -0.1,
      "price.return_5m": 0.001,
      "volume.price_alignment_5m": -0.1,
    }),
    direction: "reverseT",
  });
  const rejected = evaluateZuoTShadowRow({
    row: row({
      "vwap.bias": 0.001,
      "technical.macd_histogram_delta": -0.0001,
      "orderflow.active_buy_imbalance": -0.2,
      "orderflow.ofi_change_3m": -0.1,
      "price.return_5m": 0.006,
    }),
    direction: "reverseT",
  });
  assert.equal(accepted.formal, true);
  assert.equal(rejected.formal, false);
  assert.ok(rejected.rejectionReasons.includes("five-minute-direction"));
});

test("bearish continuation veto blocks positive-T", () => {
  const decision = evaluateZuoTShadowRow({
    row: row({
      "price.return_5m": -0.003,
      "volume.ratio_5_20": 1.3,
      "technical.macd_histogram_delta": -0.0001,
      "orderflow.active_buy_imbalance": -0.2,
    }),
    direction: "positiveT",
  });
  assert.equal(decision.continuationVeto, true);
  assert.equal(decision.formal, false);
  assert.ok(decision.rejectionReasons.includes("bearish-continuation"));
});

test("bullish continuation veto blocks reverse-T", () => {
  const decision = evaluateZuoTShadowRow({
    row: row({
      "vwap.bias": 0.001,
      "price.return_5m": 0.003,
      "volume.ratio_5_20": 1.3,
      "technical.macd_histogram_delta": 0.0001,
      "orderflow.active_buy_imbalance": 0.2,
      "technical.rsi14": 0.3,
    }),
    direction: "reverseT",
    experimentId: "v2-confirm-only",
  });
  assert.equal(decision.continuationVeto, true);
  assert.equal(decision.formal, false);
  assert.ok(decision.rejectionReasons.includes("bullish-continuation"));
});

test("missing OFI can remain a candidate but never becomes formal", () => {
  const decision = evaluateZuoTShadowRow({
    row: row({
      "orderflow.active_buy_imbalance": null,
      "orderflow.ofi_change_3m": null,
    }),
    direction: "positiveT",
    experimentId: "v2-confirm-only",
  });
  assert.equal(decision.candidate, true);
  assert.equal(decision.formal, false);
  assert.ok(decision.rejectionReasons.includes("missing-ofi"));
});

test("V2 factor set excludes RSI, KDJ and Bollinger duplicate voters", () => {
  assert.equal(assertZuoTExperimentFactorIsolation("v2-standalone", ZUOT_V2_CORE_FACTOR_IDS), true);
  assert.throws(
    () => assertZuoTExperimentFactorIsolation("v2-standalone", [...ZUOT_V2_CORE_FACTOR_IDS, "technical.rsi14"]),
    /must not include duplicate voter/,
  );
});

test("future-only mutations cannot alter an earlier row decision", () => {
  const input = row();
  const first = evaluateZuoTShadowRow({ row: input, direction: "positiveT" });
  const session = { minutes: [input, row({ "price.return_5m": 99 })] };
  session.minutes[1].price = 999;
  const second = evaluateZuoTShadowRow({ row: session.minutes[0], direction: "positiveT" });
  assert.deepEqual(second, first);
});

test("research safety flags prohibit automatic production promotion", () => {
  assert.equal(ZUOT_V2_SHADOW_SAFETY.researchOnly, true);
  assert.equal(ZUOT_V2_SHADOW_SAFETY.affectsSmartT, false);
  assert.equal(ZUOT_V2_SHADOW_SAFETY.affectsTradingAdapter, false);
  assert.equal(ZUOT_V2_SHADOW_SAFETY.affectsProductionStrategy, false);
  assert.equal(ZUOT_V2_SHADOW_SAFETY.canPromoteAutomatically, false);
  assert.equal(ZUOT_V2_SHADOW_SAFETY.requiresHumanApproval, true);
});

test("V1 and V2 comparisons share exactly the same cost and exit configuration", () => {
  const baseline = resolveZuoTShadowBacktestConfig("v1-reconstructed-baseline");
  const confirmOnly = resolveZuoTShadowBacktestConfig("v2-confirm-only");
  const standalone = resolveZuoTShadowBacktestConfig("v2-standalone");
  assert.strictEqual(confirmOnly, baseline);
  assert.strictEqual(standalone, baseline);
  assert.equal(baseline.quantity, 1600);
  assert.equal(baseline.feeRate, 0.025);
  assert.deepEqual(baseline.maximumHoldMinutes, { positiveT: 45, reverseT: 50 });
});

test("signal spacing applies the same cooldown and daily cap", () => {
  const decisions = [0, 5, 25, 50].map((offset, index) => ({
    ...evaluateZuoTShadowRow({ row: { ...row(), time: `${10 + Math.floor(offset / 60)}${String(offset % 60).padStart(2, "0")}`, index }, direction: "positiveT" }),
    formal: true,
  }));
  const selected = selectSpacedZuoTSignals(decisions);
  assert.equal(selected.length, 2);
  assert.equal(selectSpacedZuoTSignals(decisions, { includeFormal: null }).length, 2);
});

test("candidate promotion is measured inside the same deduplicated event", () => {
  const base = evaluateZuoTShadowRow({ row: row(), direction: "positiveT" });
  const decisions = [
    { ...base, time: "1000", index: 30, formal: false },
    { ...base, time: "1005", index: 35, formal: true },
    { ...base, time: "1025", index: 55, formal: false },
  ];
  const events = buildZuoTCandidateEvents(decisions);
  assert.equal(events.length, 2);
  assert.equal(events[0].formalDecision?.time, "1005");
  assert.equal(events[1].formalDecision, null);
});

function replaySession(prices, code) {
  return {
    code,
    date: "20260814",
    previousClose: 35,
    minutes: prices.map((point, index) => ({
      time: point.time ?? `10${String(index).padStart(2, "0")}`,
      price: point.price,
      high: point.high ?? point.price,
      low: point.low ?? point.price,
      volume: point.volume ?? 1000,
    })),
  };
}

test("positive-T and reverse-T close at their dynamic targets", () => {
  const positiveSession = replaySession([
    { time: "1000", price: 35 },
    { time: "1001", price: 35.1, high: 35.12 },
  ]);
  const positive = simulateZuoTShadowCycle({
    session: positiveSession,
    signal: { index: 0, direction: "positiveT", atrRate: null },
    options: { feeRate: 0, slippage: 0, minCommission: false, baseShares: 1600, sellable: 1600 },
  });
  assert.equal(positive.exitReason, "takeProfit");
  assert.equal(positive.exitMarketPrice, 35.08);
  assert.ok(positive.netPnl > 0);

  const reverseSession = replaySession([
    { time: "1000", price: 35 },
    { time: "1001", price: 34.9, low: 34.88 },
  ]);
  const reverse = simulateZuoTShadowCycle({
    session: reverseSession,
    signal: { index: 0, direction: "reverseT", atrRate: null },
    options: { feeRate: 0, slippage: 0, minCommission: false, baseShares: 1600, sellable: 1600 },
  });
  assert.equal(reverse.exitReason, "takeProfit");
  assert.equal(reverse.exitMarketPrice, 34.92);
  assert.ok(reverse.netPnl > 0);
});

test("reconstructed replay uses stop-first and deducts fees plus slippage", () => {
  const session = replaySession([
    { time: "1000", price: 35 },
    { time: "1001", price: 35, high: 35.2, low: 34.8 },
  ]);
  const trade = simulateZuoTShadowCycle({
    session,
    signal: { index: 0, direction: "positiveT", atrRate: null },
    options: { feeRate: 0.025, slippage: 0.02, minCommission: true, baseShares: 1600, sellable: 1600 },
  });
  assert.equal(trade.exitReason, "stopLoss");
  assert.equal(trade.sameMinuteConflict, true);
  assert.ok(trade.fees > 0);
  assert.ok(trade.executionCost > 0);
  assert.ok(trade.netPnl < trade.grossPnl);
});

test("reconstructed runner returns the shared BacktestResult shape", () => {
  const session = replaySession([
    { time: "0945", price: 35 },
    { time: "0946", price: 35 },
    { time: "0947", price: 35.12, high: 35.15 },
  ]);
  const factors = row().factors;
  const factorEngine = {
    computeSession(input) {
      return {
        session: input,
        rows: [{ date: input.date, time: "0946", index: 1, price: 35, factors }],
      };
    },
  };
  const result = runZuoTV1ReconstructedReplay(session, {
    factorEngine,
    feeRate: 0,
    slippage: 0,
    minCommission: false,
    baseShares: 1600,
    sellable: 1600,
  });
  assert.equal(result.trades, 1);
  assert.equal(result.actions.length, 2);
  assert.equal(result.actions[0].direction, "正T");
  assert.equal(result.cycleNets.length, 1);
  assert.equal(result.curve.length, session.minutes.length);
  assert.equal(result.observations[0].stage, "candidate");
  assert.ok(Number.isFinite(result.maxDrawdown));
});

function replayFactorEngine(rows) {
  return {
    computeSession(input) {
      return { session: input, rows };
    },
  };
}

test("V2.9 is isolated to Zijin Mining", () => {
  assert.throws(
    () => runZijinV29ShadowReplay(replaySession([], "601012")),
    /only supports 601899/,
  );
});

test("V2.9 keeps candidates visible but cannot trade without historical L2", () => {
  const session = replaySession([
    { time: "0945", price: 35 },
    { time: "0946", price: 35 },
    { time: "0947", price: 35.12, high: 35.15 },
  ], "601899");
  const factors = {
    ...row().factors,
    "orderflow.active_buy_imbalance": null,
    "orderflow.ofi_change_3m": null,
    "orderflow.book_depth_imbalance": null,
  };
  const result = runZijinV29ShadowReplay(session, {
    factorEngine: replayFactorEngine([{ date: session.date, time: "0946", index: 1, price: 35, factors }]),
    feeRate: 0,
    slippage: 0,
    minCommission: false,
    baseShares: 1600,
    sellable: 1600,
  });
  assert.equal(result.trades, 0);
  assert.equal(result.observations.length, 1);
  assert.ok(result.observations[0].blockers.includes("缺少历史L2"));
});

test("V2.9 can close a causal trade when its L2 confirmation is available", () => {
  const session = replaySession([
    { time: "0945", price: 35 },
    { time: "0946", price: 35 },
    { time: "0947", price: 35.12, high: 35.15 },
  ], "601899");
  const factors = { ...row().factors, "orderflow.book_depth_imbalance": 0.2 };
  const result = runZijinV29ShadowReplay(session, {
    factorEngine: replayFactorEngine([{ date: session.date, time: "0946", index: 1, price: 35, factors }]),
    feeRate: 0,
    slippage: 0,
    minCommission: false,
    baseShares: 1600,
    sellable: 1600,
  });
  assert.equal(result.trades, 1);
  assert.equal(result.actions[0].direction, "正T");
  assert.equal(result.actions[1].side, "卖出");
});

test("V2.9 entry decisions do not change when only future prices change", () => {
  const factors = { ...row().factors, "orderflow.book_depth_imbalance": 0.2 };
  const factorEngine = replayFactorEngine([{ date: "20260814", time: "0946", index: 1, price: 35, factors }]);
  const base = replaySession([
    { time: "0945", price: 35 },
    { time: "0946", price: 35 },
    { time: "0947", price: 35.12, high: 35.15 },
  ], "601899");
  const changed = replaySession([
    { time: "0945", price: 35 },
    { time: "0946", price: 35 },
    { time: "0947", price: 99, high: 99 },
  ], "601899");
  const options = { factorEngine, feeRate: 0, slippage: 0, minCommission: false, baseShares: 1600, sellable: 1600 };
  const first = runZijinV29ShadowReplay(base, options);
  const second = runZijinV29ShadowReplay(changed, options);
  assert.deepEqual(second.actions[0], first.actions[0]);
});

test("reconstructed runners honor a one-cycle daily cap", () => {
  const session = replaySession([
    { time: "0945", price: 35 },
    { time: "0946", price: 35 },
    { time: "0947", price: 35.12, high: 35.15 },
    { time: "1010", price: 35 },
    { time: "1011", price: 35.12, high: 35.15 },
  ], "601899");
  const factors = { ...row().factors, "orderflow.book_depth_imbalance": 0.2 };
  const factorEngine = replayFactorEngine([
    { date: session.date, time: "0946", index: 1, price: 35, factors },
    { date: session.date, time: "1010", index: 3, price: 35, factors },
  ]);
  const options = { factorEngine, maximumCycles: 1, feeRate: 0, slippage: 0, minCommission: false, baseShares: 1600, sellable: 1600 };
  assert.equal(runZuoTV1ReconstructedReplay(session, options).trades, 1);
  assert.equal(runZijinV29ShadowReplay(session, options).trades, 1);
});

test("fixed after-cost target widens the exit move and includes modeled costs", () => {
  const session = replaySession([
    { time: "1000", price: 35 },
    { time: "1001", price: 35.2, high: 35.2 },
    { time: "1002", price: 35.6, high: 35.6 },
  ]);
  const stampOnly = simulateZuoTShadowCycle({
    session,
    signal: { index: 0, direction: "positiveT", atrRate: null },
    options: { targetNetPct: 1, feeRate: 0, slippage: 0, minCommission: false, baseShares: 1600, sellable: 1600 },
  });
  const withCost = simulateZuoTShadowCycle({
    session,
    signal: { index: 0, direction: "positiveT", atrRate: null },
    options: { targetNetPct: 1, feeRate: 0.025, slippage: 0.02, minCommission: true, baseShares: 1600, sellable: 1600 },
  });
  assert.ok(Math.abs(stampOnly.targetMove - (0.35 + stampOnly.modeledRoundTripCostMove)) < 1e-9);
  assert.equal(stampOnly.exitIndex, 2);
  assert.ok(withCost.targetMove > stampOnly.targetMove);
  assert.ok(withCost.modeledRoundTripCostMove > 0);
});
