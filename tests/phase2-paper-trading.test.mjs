import assert from "node:assert/strict";
import test from "node:test";
import { PaperExecutionEngine, createSignalSample, resolveSignalSample, executePaperAction } from "../lib/rl-research/index.mjs";

const observation = (extra = {}) => ({ symbol: "601899", date: "20260930", time: "1000", asOf: "2026-09-30T02:00:00Z", price: 10, position: 1000, availableSellablePosition: 1000, cash: 20_000, factors: { vwap: 9.98, orderFlow: null }, dataQuality: {}, ...extra });

test("paper order lifecycle supports submit, cancel and fill without live side effects", () => {
  const engine = new PaperExecutionEngine({ initialCash: 20_000, initialPosition: 1_000, initialSellablePosition: 1_000 });
  const cancelled = engine.cancel(engine.submit({ action: "BUY", quantity: 100 }).orderId);
  assert.equal(cancelled.status, "cancelled");
  const filled = engine.execute(observation(), { action: "BUY", quantity: 100, orderId: "buy-1" });
  assert.equal(filled.status, "filled");
  assert.equal(engine.snapshot().position, 1_100);
  assert.equal(engine.snapshot().sellablePosition, 1_000);
});

test("paper engine enforces A-share T+1 and configurable fee/slippage", () => {
  const engine = new PaperExecutionEngine({ initialCash: 20_000, initialPosition: 1_000, initialSellablePosition: 1_000, config: { feeRate: 0.1, minimumCommission: 1, stampDutyRate: 0.001, slippagePct: 1 } });
  const buy = engine.execute(observation(), { action: "BUY", quantity: 100, orderId: "buy-1" });
  assert.equal(buy.status, "filled");
  assert.equal(buy.record.fillPrice, 10.1);
  assert.ok(buy.record.fee > 1);
  const sell = engine.execute({ ...observation(), time: "1001", price: 10.2 }, { action: "SELL", quantity: 1_100, orderId: "sell-1" });
  assert.equal(sell.status, "rejected");
  assert.match(sell.record.rejectionReason, /T\+1|可卖/);
});

test("signal sample stays unresolved until an explicit future resolution", () => {
  const sample = createSignalSample({ sampleId: "s1", candidateId: "c1", symbol: "601899", date: "20260930", time: "1000", price: 10, signal: "BUY", datasetVersion: "d1", factorSnapshot: { vwap: 9.9, orderFlow: null } });
  assert.equal(sample.lifecycle, "CREATED");
  assert.equal(sample.future5mReturn, null);
  assert.equal(sample.factorSnapshot.orderFlow, null);
  const resolved = resolveSignalSample(sample, { futureReturns: { "5m": 0.01 }, holdingMinutes: 5, entryPrice: 10, exitPrice: 10.1, fees: 1, slippage: 0.1, pnl: 0.008 });
  assert.equal(resolved.lifecycle, "RESOLVED");
  assert.equal(resolved.future5mReturn, 0.01);
  assert.equal(resolved.isWin, true);
  assert.equal(resolved.candidateId, "c1");
});

test("paper execution keeps WAIT non-trading and preserves missing L2 as null", () => {
  const record = executePaperAction(observation({ factors: { orderFlow: null } }), { action: "WAIT", quantity: 0 });
  assert.equal(record.status, "skipped");
  assert.equal(record.factorSnapshot.orderFlow, null);
});
