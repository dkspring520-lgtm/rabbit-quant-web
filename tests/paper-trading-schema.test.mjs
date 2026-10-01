import assert from "node:assert/strict";
import test from "node:test";
import { createPaperAccount, createPaperOrder, createPaperPosition, normalizePaperCostConfig } from "../lib/paper-trading/index.mjs";

test("paper schema keeps T+1 total and sellable position separate", () => {
  const position = createPaperPosition({ symbol: "601899", totalPosition: 15_000, availableSellablePosition: 10_000 });
  assert.equal(position.totalPosition, 15_000);
  assert.equal(position.availableSellablePosition, 10_000);
});

test("paper schema normalizes shared cost configuration without hardcoding", () => {
  assert.deepEqual(normalizePaperCostConfig({ commission: 0.025, minimumCommission: 5, stampDuty: 0.0005, slippage: 0.02 }), {
    commission: 0.025, minimumCommission: 5, stampDuty: 0.0005, slippage: 0.02, slippageUnit: "percent",
  });
});

test("paper order records required traceability and lifecycle fields", () => {
  const order = createPaperOrder({ orderId: "o1", symbol: "601899", timestamp: "2026-09-30T02:00:00Z", side: "BUY", status: "SUBMITTED", quantity: 500, orderPrice: 10, signalId: "s1", candidateId: "c1", modelVersion: "m1", datasetVersion: "d1" });
  assert.equal(order.status, "SUBMITTED");
  assert.equal(order.candidateId, "c1");
  assert.throws(() => createPaperOrder({ side: "NOPE" }), /Unsupported paper order side/);
});

test("paper account is cash and position scoped", () => {
  const account = createPaperAccount({ accountId: "paper-1", cash: 100000, positions: { "601899": { totalPosition: 10000 } } });
  assert.equal(account.accountId, "paper-1");
  assert.equal(account.currency, "CNY");
  assert.equal(account.positions["601899"].totalPosition, 10000);
});
