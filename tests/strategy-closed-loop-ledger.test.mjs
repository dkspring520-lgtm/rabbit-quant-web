import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStrategyClosedLoopLedger,
  pairStrategyClosedLoops,
} from "../lib/strategy-closed-loop-ledger.mjs";

const trade = (overrides = {}) => ({
  id: "trade-1",
  time: "09:45:00",
  side: "买入",
  price: 10,
  quantity: 1_000,
  status: "未配对",
  ...overrides,
});

test("no trades produces an empty factual review", () => {
  const review = buildStrategyClosedLoopLedger();
  assert.equal(review.summary.completedLoops, 0);
  assert.equal(review.summary.netPnl, 0);
  assert.equal(review.summary.profitFactor, null);
  assert.equal(review.cycles.length, 0);
  assert.equal(review.openTrades.length, 0);
  assert.equal(review.verdict.title, "今日尚无可复盘数据");
});

test("pairs equal-size positive and reverse T trades in time order", () => {
  const result = pairStrategyClosedLoops([
    trade({ id: "positive-entry", time: "09:45", side: "买入", price: 10 }),
    trade({ id: "positive-exit", time: "10:15", side: "卖出", price: 10.2 }),
    trade({ id: "reverse-entry", time: "10:30", side: "卖出", price: 10.4 }),
    trade({ id: "reverse-exit", time: "11:00", side: "买入", price: 10.1 }),
  ]);

  assert.equal(result.cycles.length, 2);
  assert.equal(result.cycles[0].direction, "正T");
  assert.equal(result.cycles[0].grossPnl, 200);
  assert.equal(result.cycles[1].direction, "反T");
  assert.equal(result.cycles[1].grossPnl, 300);
  assert.equal(result.openTrades.length, 0);
});

test("unmatched trades remain open and are never force-closed", () => {
  const result = pairStrategyClosedLoops([
    trade({ id: "buy-1000", quantity: 1_000 }),
    trade({ id: "sell-500", time: "10:00", side: "卖出", quantity: 500 }),
  ]);
  assert.equal(result.cycles.length, 0);
  assert.deepEqual(result.openTrades.map(item => item.id), ["buy-1000", "sell-500"]);
});

test("fees are deducted from gross PnL", () => {
  const result = pairStrategyClosedLoops([
    trade({ id: "entry", price: 10, quantity: 1_000 }),
    trade({ id: "exit", time: "10:00", side: "卖出", price: 10.2, quantity: 1_000 }),
  ]);
  const cycle = result.cycles[0];
  assert.equal(cycle.grossPnl, 200);
  assert.equal(cycle.fees, 15.3);
  assert.equal(cycle.netPnl, 184.7);
});

test("rejected observations are counted separately from candidates", () => {
  const review = buildStrategyClosedLoopLedger({
    observations: [
      { time: "0945", direction: "正T", stage: "candidate", blockers: [] },
      { time: "1000", direction: "反T", stage: "watch", blockers: ["量能不足"] },
      { time: "1010", direction: "正T", stage: "watch", blockers: ["量能不足", "方向冲突"] },
    ],
  });
  assert.equal(review.summary.observations, 3);
  assert.equal(review.summary.candidates, 1);
  assert.equal(review.summary.rejected, 2);
  assert.deepEqual(review.rejectionReasons[0], { reason: "量能不足", count: 2 });
});

test("profit factor handles no-loss and no-win days", () => {
  const winning = buildStrategyClosedLoopLedger({
    trades: [
      trade({ id: "win-entry", price: 10 }),
      trade({ id: "win-exit", time: "10:00", side: "卖出", price: 10.2 }),
    ],
  });
  assert.equal(winning.summary.profitFactor, null);

  const losing = buildStrategyClosedLoopLedger({
    trades: [
      trade({ id: "loss-entry", price: 10 }),
      trade({ id: "loss-exit", time: "10:00", side: "卖出", price: 9.9 }),
    ],
  });
  assert.equal(losing.summary.profitFactor, 0);
});

test("daily chart includes price path and factual event markers", () => {
  const review = buildStrategyClosedLoopLedger({
    minutes: [
      { time: "0930", price: 10 },
      { time: "0931", price: 10.2 },
      { time: "0932", price: 10.1 },
    ],
    trades: [trade({ id: "chart-buy", time: "0931", price: 10.2 })],
    observations: [{ time: "0932", price: 10.1, direction: "正T", stage: "candidate", blockers: [] }],
  });
  assert.equal(review.chart.ready, true);
  assert.match(review.chart.path, /^M /);
  assert.equal(review.chart.markers.length, 2);
  assert.equal(review.chart.high.price, 10.2);
  assert.equal(review.chart.low.price, 10);
});
