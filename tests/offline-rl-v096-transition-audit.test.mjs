import assert from "node:assert/strict";
import test from "node:test";
import { materializeScenario } from "../lib/rl-research/trainer/expert-trajectory-v095.mjs";

const scenario = {
  scenarioId: "SYNTHETIC_RESEARCH_PORTFOLIO_C_10000_V0.1",
  accountType: "SYNTHETIC_RESEARCH_PORTFOLIO",
  initialCash: 200_000,
  initialPosition: 2_000,
  initialSellablePosition: 2_000,
  initialAverageCost: 10,
};

const bar = (symbol, timestamp, price = 10) => ({
  symbol, timestamp, price, open: price, high: price, low: price, close: price, volume: 100, amount: price * 100,
});
const signal = (symbol, timestamp, action) => ({ symbol, timestamp, action, strategyId: "OHLCV_T_RESEARCH_V1", strategyVersion: "OHLCV_T_RESEARCH_V1" });
const run = (rows, signals, overrides = {}) => materializeScenario({ rows, signals, scenario: { ...scenario, ...overrides }, sourceDatasetHash: "source", normalizedDatasetHash: "normalized", expertSignalHash: "expert", trajectoryDatasetHash: "trajectory", stateDatasetHash: "state" });

test("WAIT is a no-op and does not fill", () => {
  const result = run([bar("601899.SH", "2025-10-09T10:00:00"), bar("601899.SH", "2025-10-09T10:01:00")], [signal("601899.SH", "2025-10-09T10:00:00", "WAIT"), signal("601899.SH", "2025-10-09T10:01:00", "WAIT")]);
  const row = result.records[0];
  assert.equal(row.executionResult.status, "CANCELLED");
  assert.equal(row.validAction, true);
  assert.equal(row.filledQuantity, 0);
  assert.equal(row.accountState.cash, row.nextState.accountState.cash);
  assert.equal(row.accountState.position, row.nextState.accountState.position);
});

test("BUY_SMALL and BUY use the PaperExecutionEngine and keep new shares unsellable", () => {
  for (const action of ["BUY_SMALL", "BUY"]) {
    const result = run([bar("601899.SH", "2025-10-09T10:00:00"), bar("601899.SH", "2025-10-09T10:01:00", 10.1)], [signal("601899.SH", "2025-10-09T10:00:00", action), signal("601899.SH", "2025-10-09T10:01:00", "WAIT")], { initialPosition: 0, initialSellablePosition: 0, initialAverageCost: null });
    const row = result.records[0];
    assert.equal(row.executionResult.status, "FILLED");
    assert.ok(row.filledQuantity > 0);
    assert.ok(row.nextState.accountState.cash < row.accountState.cash);
    assert.ok(row.nextState.accountState.position > row.accountState.position);
    assert.equal(row.nextState.accountState.sellablePosition, 0);
    assert.ok(row.nextState.accountState.todayBought > 0);
  }
});

test("SELL_PART and SELL_ALL only use sellable inventory", () => {
  for (const action of ["SELL_PART", "SELL_ALL"]) {
    const result = run([bar("601899.SH", "2025-10-09T10:00:00"), bar("601899.SH", "2025-10-09T10:01:00", 10.1)], [signal("601899.SH", "2025-10-09T10:00:00", action), signal("601899.SH", "2025-10-09T10:01:00", "WAIT")]);
    const row = result.records[0];
    assert.equal(row.executionResult.status, "FILLED");
    assert.ok(row.nextState.accountState.position < row.accountState.position);
    assert.ok(row.nextState.accountState.sellablePosition < row.accountState.sellablePosition);
    assert.ok(row.nextState.accountState.cash > row.accountState.cash);
  }
});

test("cross-symbol same timestamp cannot be joined by timestamp only", () => {
  const rows = [bar("A", "2025-10-09T10:00:00"), bar("B", "2025-10-09T10:00:00")];
  assert.throws(() => run(rows, [signal("A", "2025-10-09T10:00:00", "WAIT")]), /EXPERT_SIGNAL_UNMATCHED|symbol/i);
});

test("trading-day boundary terminates the episode without a next-day nextState", () => {
  const rows = [bar("601899.SH", "2025-10-09T15:00:00"), bar("601899.SH", "2025-10-10T09:30:00"), bar("601899.SH", "2025-10-10T09:31:00")];
  const result = run(rows, rows.map(row => signal("601899.SH", row.timestamp, "WAIT")));
  assert.equal(result.records[0].done, true);
  assert.equal(result.records[0].nextState, null);
  assert.equal(result.records[1].done, false);
});

test("deterministic transition replay and reward leakage boundary", () => {
  const rows = [bar("601899.SH", "2025-10-09T10:00:00", 10), bar("601899.SH", "2025-10-09T10:01:00", 10.2)];
  const signals = rows.map(row => signal(row.symbol, row.timestamp, row.timestamp.endsWith("10:00:00") ? "BUY_SMALL" : "WAIT"));
  const a = run(rows, signals, { initialPosition: 0, initialSellablePosition: 0, initialAverageCost: null });
  const b = run(rows, signals, { initialPosition: 0, initialSellablePosition: 0, initialAverageCost: null });
  assert.deepEqual(a.hashes, b.hashes);
  const changed = rows.map((row, index) => index === 1 ? { ...row, price: 20 } : row);
  const c = run(changed, signals, { initialPosition: 0, initialSellablePosition: 0, initialAverageCost: null });
  assert.deepEqual(a.records[0].state, c.records[0].state);
  assert.notEqual(a.records[0].rewardNet, c.records[0].rewardNet);
});

test("impossible sell and insufficient cash are rejected by the existing engine", () => {
  const sell = run([bar("601899.SH", "2025-10-09T10:00:00")], [signal("601899.SH", "2025-10-09T10:00:00", "SELL_ALL")], { initialCash: 100, initialPosition: 0, initialSellablePosition: 0, initialAverageCost: null });
  assert.equal(sell.records[0].validAction, false);
  assert.equal(sell.records[0].executionResult.status, "REJECTED");
  const buy = run([bar("601899.SH", "2025-10-09T10:00:00")], [signal("601899.SH", "2025-10-09T10:00:00", "BUY")], { initialCash: 1, initialPosition: 0, initialSellablePosition: 0, initialAverageCost: null });
  assert.equal(buy.records[0].validAction, false);
});
