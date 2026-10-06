import assert from "node:assert/strict";
import test from "node:test";
import { PaperExecutionEngine } from "../lib/paper-trading/index.mjs";

const market = (extra = {}) => ({ symbol: "601899", date: "2026-09-30", time: "1000", marketPrice: 10, ...extra });
const base = () => new PaperExecutionEngine({ symbol: "601899", initialCash: 100000, initialPosition: 10000, initialSellablePosition: 10000, config: { commission: 0.025, minimumCommission: 5, stampDuty: 0.05, slippage: 0.02 } });

test("BUY updates cash and keeps today's shares unsellable", () => {
  const e = base(); const order = e.execute(market(), { side: "BUY", quantity: 500, orderPrice: 10, signalId: "s1", candidateId: "c1", modelVersion: "m1", datasetVersion: "d1" });
  assert.equal(order.status, "FILLED"); assert.equal(e.snapshot().position.totalPosition, 10500); assert.equal(e.snapshot().position.availableSellablePosition, 10000); assert.equal(order.candidateId, "c1");
});
test("same-day SELL rejects only when no old sellable inventory exists", () => {
  const e = new PaperExecutionEngine({ symbol: "601899", initialCash: 100000, initialPosition: 0, initialSellablePosition: 0, config: { commission: 0.025, minimumCommission: 5, stampDuty: 0.05, slippage: 0.02 } });
  e.execute(market(), { side: "BUY", quantity: 500, orderPrice: 10 });
  assert.equal(e.execute(market({ time: "1001" }), { side: "SELL", quantity: 500 }).status, "REJECTED");
  const oldInventory = base(); oldInventory.execute(market(), { side: "BUY", quantity: 500, orderPrice: 10 });
  assert.equal(oldInventory.execute(market({ time: "1001" }), { side: "SELL", quantity: 500 }).status, "FILLED");
});
test("T+1 tracks inventory source instead of blocking old sellable shares", () => {
  const e = new PaperExecutionEngine({ symbol: "601899", initialCash: 100000, initialPosition: 1000, initialSellablePosition: 1000, config: { commission: 0.025, minimumCommission: 5, stampDuty: 0.05, slippage: 0.02 } });
  assert.equal(e.execute(market(), { side: "SELL", quantity: 300 }).status, "FILLED");
  assert.equal(e.execute(market({ time: "1001", marketPrice: 9.9 }), { side: "BUY", quantity: 300 }).status, "FILLED");
  assert.equal(e.snapshot().position.availableSellablePosition, 700);
  assert.equal(e.snapshot().todayBought, 300);
  assert.equal(e.execute(market({ time: "1002", marketPrice: 9.8 }), { side: "SELL", quantity: 100 }).status, "FILLED");
});
test("T+1 matrix distinguishes new shares, old shares and quantity limits", () => {
  const buyFirst = new PaperExecutionEngine({ symbol: "601899", initialCash: 100000, initialPosition: 0, initialSellablePosition: 0, config: { commission: 0.025, minimumCommission: 5, stampDuty: 0.05, slippage: 0.02 } }); buyFirst.execute(market(), { side: "BUY", quantity: 300 });
  assert.equal(buyFirst.execute(market({ time: "1001" }), { side: "SELL", quantity: 100 }).status, "REJECTED");

  const mixed = new PaperExecutionEngine({ symbol: "601899", initialCash: 100000, initialPosition: 1000, initialSellablePosition: 1000, config: { commission: 0.025, minimumCommission: 5, stampDuty: 0.05, slippage: 0.02 } }); mixed.execute(market(), { side: "SELL", quantity: 300 }); mixed.execute(market({ time: "1001", marketPrice: 9.9 }), { side: "BUY", quantity: 500 });
  assert.equal(mixed.execute(market({ time: "1002" }), { side: "SELL", quantity: 700 }).status, "FILLED");
  assert.equal(mixed.execute(market({ time: "1003" }), { side: "SELL", quantity: 100 }).status, "REJECTED");

  const emptied = base(); emptied.execute(market(), { side: "SELL", quantity: 10000 }); emptied.execute(market({ time: "1001" }), { side: "BUY", quantity: 300 });
  assert.equal(emptied.execute(market({ time: "1002" }), { side: "SELL", quantity: 100 }).status, "REJECTED");

  const oldInventory = base(); oldInventory.execute(market(), { side: "SELL", quantity: 500 }); oldInventory.execute(market({ time: "1001" }), { side: "BUY", quantity: 300 });
  assert.equal(oldInventory.execute(market({ time: "1002" }), { side: "SELL", quantity: 500 }).status, "FILLED");
  assert.equal(oldInventory.execute(market({ date: "2026-10-01", time: "1000" }), { side: "SELL", quantity: 300 }).status, "FILLED");
});
test("next trading day settles T+1 shares", () => {
  const e = base(); e.execute(market(), { side: "BUY", quantity: 500, orderPrice: 10 });
  assert.equal(e.execute(market({ date: "2026-10-01", time: "1000" }), { side: "SELL", quantity: 500 }).status, "FILLED");
});
test("fees, minimum commission and slippage are deterministic", () => {
  const e = base(); const order = e.execute(market(), { side: "BUY", quantity: 100, orderPrice: 10 });
  assert.equal(order.fillPrice, 10.002); assert.equal(order.fees, 5); assert.ok(order.slippage > 0);
});
test("rejects cash, lot, time, price and suspension constraints", () => {
  assert.equal(new PaperExecutionEngine({ symbol: "x", initialCash: 1 }).execute(market(), { side: "BUY", quantity: 100 }).status, "REJECTED");
  assert.equal(base().execute(market(), { side: "BUY", quantity: 101 }).status, "REJECTED");
  assert.equal(base().execute(market({ time: "1200" }), { side: "BUY", quantity: 100 }).status, "REJECTED");
  assert.equal(base().execute(market({ marketPrice: null }), { side: "BUY", quantity: 100 }).status, "REJECTED");
  assert.equal(base().execute(market({ suspended: true }), { side: "BUY", quantity: 100 }).status, "REJECTED");
});
test("lifecycle supports cancellation and WAIT", () => {
  const e = base(); const submitted = e.submit({ side: "BUY", quantity: 100 }); assert.equal(submitted.status, "SUBMITTED"); assert.equal(e.cancel(submitted.orderId).status, "CANCELLED");
  assert.equal(e.execute(market(), { side: "WAIT", quantity: 0 }).status, "CANCELLED");
});
