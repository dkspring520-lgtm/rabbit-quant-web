import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeTradeLedgerRows,
  summarizeTradeLedger,
  tradeLedgerDate,
  tradeLedgerKey,
} from "../lib/trade-ledger.mjs";

const tradingDate = "2026-07-16";

function trade(overrides = {}) {
  return {
    id: "trade-1",
    tradingDate,
    side: "买入",
    price: 10.25,
    quantity: 100,
    status: "未配对",
    time: "09:45:03",
    cycle: "手动待配对",
    fee: "待计算",
    result: "—",
    ...overrides,
  };
}

test("tradeLedgerDate uses the Shanghai calendar day", () => {
  assert.equal(tradeLedgerDate(new Date("2026-07-15T15:59:59.000Z")), "2026-07-15");
  assert.equal(tradeLedgerDate(new Date("2026-07-15T16:00:00.000Z")), "2026-07-16");
  assert.equal(tradeLedgerDate("2026-07-16"), "2026-07-16");
  assert.throws(() => tradeLedgerDate("2026-02-30"), /Invalid date/);
});

test("ledger keys isolate Shanghai date, account and stock", () => {
  assert.equal(
    tradeLedgerKey(" Trader@Example.COM ", " 601899 ", tradingDate),
    "rabbit-trade-ledger:2026-07-16:trader@example.com:601899",
  );
  assert.notEqual(
    tradeLedgerKey("alice", "601899", "2026-07-16"),
    tradeLedgerKey("alice", "601899", "2026-07-17"),
  );
  assert.notEqual(
    tradeLedgerKey("alice", "601899", tradingDate),
    tradeLedgerKey("bob", "601899", tradingDate),
  );
  assert.notEqual(
    tradeLedgerKey("alice", "601899", tradingDate),
    tradeLedgerKey("alice", "603993", tradingDate),
  );
});

test("normalization keeps display fields and rejects malformed, stale or duplicate rows", () => {
  const normalized = normalizeTradeLedgerRows([
    trade({ price: "10.250", quantity: "1,000" }),
    trade({ id: "trade-2", side: "SELL", price: 10.5, quantity: 200 }),
    trade({ id: "trade-2", side: "买入", quantity: 300 }),
    trade({ id: "stale", tradingDate: "2026-07-15" }),
    trade({ id: "bad-price", price: 0 }),
    trade({ id: "bad-quantity", quantity: 10.5 }),
    trade({ id: "bad-side", side: "hold" }),
    trade({ id: "bad-status", status: "" }),
    trade({ id: "", quantity: 500 }),
    null,
  ], tradingDate);

  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized[0], {
    ...trade(),
    price: 10.25,
    quantity: 1000,
  });
  assert.equal(normalized[1].side, "卖出");
  assert.equal(normalized[1].time, "09:45:03");
  assert.equal(normalized[1].cycle, "手动待配对");
  assert.equal(normalized[1].fee, "待计算");
  assert.equal(normalized[1].result, "—");
});

test("invalidated rows stay auditable but never affect the summary", () => {
  const summary = summarizeTradeLedger([
    trade({ id: "buy", quantity: 300 }),
    trade({ id: "sell", side: "卖出", quantity: 500 }),
    trade({ id: "invalid-buy", quantity: 9_999, status: "已失效" }),
    trade({ id: "invalid-sell", side: "sell", quantity: 9_999, status: "invalid" }),
  ], {
    openingShares: 1_000,
    plannedBase: 1_100,
    sellable: 800,
  }, tradingDate);

  assert.equal(summary.rows.length, 4);
  assert.deepEqual(summary, {
    rows: summary.rows,
    validCount: 2,
    bought: 300,
    sold: 500,
    rawCurrentShares: 800,
    currentShares: 800,
    remainingSellable: 300,
    targetGap: -300,
    oversold: false,
  });
});

test("negative inventory is preserved and reported as oversold", () => {
  const summary = summarizeTradeLedger([
    trade({ id: "oversell", side: "卖出", quantity: 150 }),
  ], {
    openingShares: 100,
    plannedBase: 100,
    sellable: 100,
  }, tradingDate);

  assert.equal(summary.sold, 150);
  assert.equal(summary.rawCurrentShares, -50);
  assert.equal(summary.currentShares, -50);
  assert.equal(summary.targetGap, -150);
  assert.equal(summary.remainingSellable, 0);
  assert.equal(summary.oversold, true);
});

test("selling more than yesterday's sellable shares is oversold even with positive inventory", () => {
  const summary = summarizeTradeLedger([
    trade({ id: "buy", quantity: 1_000 }),
    trade({ id: "sell", side: "卖出", quantity: 600 }),
  ], {
    openingShares: 1_000,
    plannedBase: 1_000,
    sellable: 500,
  }, tradingDate);

  assert.equal(summary.currentShares, 1_400);
  assert.equal(summary.remainingSellable, 0);
  assert.equal(summary.oversold, true);
});
