import assert from "node:assert/strict";
import test from "node:test";

import {
  MULTI_TIMEFRAME_CONTEXT_CONTRACT,
  aggregateWeeklyBars,
  buildMultiTimeframeContext,
} from "../lib/multi-timeframe-context.mjs";

function dailyBars(values, start = "2026-01-02") {
  const first = new Date(`${start}T00:00:00Z`);
  return values.map((close, index) => {
    const date = new Date(first);
    date.setUTCDate(first.getUTCDate() + index);
    const day = date.toISOString().slice(0, 10);
    return { date: day, open: close, close, high: close + 0.2, low: close - 0.2, volume: 100, amount: close * 100 };
  });
}

test("builds a compact bullish daily context without emitting a signal", () => {
  const context = buildMultiTimeframeContext(dailyBars([
    10, 10.1, 10.2, 10.3, 10.4, 10.6, 10.8, 11, 11.2, 11.4,
    11.6, 11.8, 12, 12.2, 12.4, 12.6, 12.8, 13, 13.2, 13.4,
    13.6, 13.8, 14, 14.2, 14.4,
  ]));

  assert.equal(context.available, true);
  assert.equal(context.daily.label, "偏强");
  assert.ok(context.daily.momentumPct > 0);
  assert.ok(context.supportResistance.support.price < context.supportResistance.resistance.price);
  assert.equal(context.invalidation.key, "break-support");
  assert.equal(context.emitsSignals, false);
  assert.equal(context.emitsScores, false);
});

test("classifies a sustained decline as weak and exposes an explicit invalidation reference", () => {
  const context = buildMultiTimeframeContext(dailyBars([
    20, 19.9, 19.8, 19.7, 19.6, 19.4, 19.2, 19, 18.8, 18.6,
    18.4, 18.2, 18, 17.8, 17.6, 17.4, 17.2, 17, 16.8, 16.6,
    16.4, 16.2, 16, 15.8, 15.6,
  ]));

  assert.equal(context.daily.label, "偏弱");
  assert.equal(context.invalidation.key, "recover-resistance");
  assert.equal(context.invalidation.reference, "resistance");
});

test("aggregates Monday-starting exchange weeks and reports observed sessions", () => {
  const bars = [
    { date: "2026-01-02", open: 10, close: 11, high: 11.2, low: 9.8, volume: 100, amount: 1000 },
    { date: "2026-01-05", open: 11, close: 12, high: 12.2, low: 10.8, volume: 200, amount: 2200 },
    { date: "2026-01-06", open: 12, close: 11.5, high: 12.4, low: 11.2, volume: 300, amount: 3300 },
  ];
  const weeks = aggregateWeeklyBars(bars);

  assert.equal(weeks.length, 2);
  assert.equal(weeks[0].weekStart, "2025-12-29");
  assert.equal(weeks[0].open, 10);
  assert.equal(weeks[0].close, 11);
  assert.equal(weeks[1].weekStart, "2026-01-05");
  assert.equal(weeks[1].high, 12.4);
  assert.equal(weeks[1].low, 10.8);
  assert.equal(weeks[1].volume, 500);
  assert.equal(weeks[1].sourceBars, 2);
  assert.equal(weeks[1].observedSessions, 2);
  assert.equal("partialWeek" in weeks[1], false);
});

test("returns safe insufficient states and does not invent support or pressure", () => {
  const context = buildMultiTimeframeContext([{ date: "2026-01-02", close: 10 }]);

  assert.equal(context.daily.label, "数据不足");
  assert.equal(context.weekly.label, "数据不足");
  assert.equal(context.supportResistance.support.price, 10);
  assert.equal(context.supportResistance.resistance.price, 10);
  assert.equal(context.invalidation.key, "insufficient");
});

test("as-of filtering preserves causal output when later bars are appended", () => {
  const prefix = dailyBars([10, 10.2, 10.4, 10.6, 10.8, 11, 11.2], "2026-01-02");
  const future = dailyBars([10, 10.2, 10.4, 10.6, 10.8, 11, 11.2, 8, 7, 6], "2026-01-02");
  const prefixContext = buildMultiTimeframeContext(prefix);
  const causalContext = buildMultiTimeframeContext(future, { asOfDate: prefix.at(-1).date });

  assert.deepEqual(causalContext, prefixContext);
});

test("contract keeps the background layer separate from the formal signal layer", () => {
  assert.deepEqual(MULTI_TIMEFRAME_CONTEXT_CONTRACT, {
    version: "2026.09-multi-timeframe-context-v1",
    displayOnly: true,
    emitsSignals: false,
    emitsScores: false,
    emitsProbabilities: false,
    supportResistanceMethod: "causal-recent-extrema",
  });
});
