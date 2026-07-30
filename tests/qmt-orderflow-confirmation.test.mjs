import test from "node:test";
import assert from "node:assert/strict";
import { evaluateQmtOrderFlow, summarizeZijinOrderFlow } from "../lib/qmt-orderflow-confirmation.mjs";

function rows(kind) {
  return [0, 1, 2].map((index) => ({
    time: `093${index}`,
    price: kind === "sell" ? 10.10 - index * 0.01 : 9.90 + index * 0.03,
    activeBuyVolume: kind === "sell" ? 30 : 70,
    activeSellVolume: kind === "sell" ? 70 : 30,
    ddx: kind === "sell" ? 3 - index : 1 + index,
    bid1Volume: kind === "sell" ? 70 : 140,
    ask1Volume: kind === "sell" ? 130 : 80,
  }));
}

test("sell confirmation combines price, active volume, net flow and book", () => {
  const result = evaluateQmtOrderFlow(rows("sell"), 2, "SELL_FIRST");
  assert.equal(result.available, true);
  assert.equal(result.pass, true);
});

test("buy confirmation rejects adverse order flow", () => {
  assert.equal(evaluateQmtOrderFlow(rows("sell"), 2, "BUY_FIRST").pass, false);
});

test("missing fields remain neutral instead of being fabricated", () => {
  const result = evaluateQmtOrderFlow([{ price: 10 }, { price: 10.1 }, { price: 10.2 }], 2, "BUY_FIRST");
  assert.equal(result.available, false);
  assert.equal(result.pass, true);
  assert.match(result.reason, /不使用伪造订单流/);
});

test("future order flow cannot rewrite current confirmation", () => {
  const prefix = rows("sell");
  assert.deepEqual(
    evaluateQmtOrderFlow([...prefix, ...rows("buy")], 2, "SELL_FIRST"),
    evaluateQmtOrderFlow(prefix, 2, "SELL_FIRST"),
  );
});

test("stale connected L2 feed vetoes a trigger", () => {
  const points = rows("buy");
  points[2].l2Status = { connected: true, authorized: true, stale: true };
  const result = evaluateQmtOrderFlow(points, 2, "BUY_FIRST");
  assert.equal(result.pass, false);
  assert.equal(result.integrityBlocked, true);
});

test("native nested L2 fields are normalized", () => {
  const points = rows("buy").map((point, index) => ({
    price: point.price,
    l2: {
      status: { connected: true, authorized: true, stale: false },
      flow: { activeBuyVolume60s: 70, activeSellVolume60s: 30, netActiveNotional60s: index + 1 },
      book: { bid1Volume: 140, ask1Volume: 80 },
    },
  }));
  const result = evaluateQmtOrderFlow(points, 2, "BUY_FIRST");
  assert.equal(result.available, true);
  assert.equal(result.pass, true);
});

test("historical trade-flow-only L2 remains available without fabricating a book", () => {
  const points = [0, 1, 2].map((index) => ({
    time: `102${index}`,
    price: 10 + index * 0.02,
    activeBuyNotional: 700_000,
    activeSellNotional: 300_000,
    netActiveNotional: 400_000,
    bigOrderNetNotional: 180_000,
    l2Status: { connected: true, authorized: true, stale: false },
  }));
  const result = evaluateQmtOrderFlow(points, 2, "BUY_FIRST");
  assert.equal(result.available, true);
  assert.equal(result.bookAvailable, false);
  assert.equal(result.required, 2);
  assert.equal(result.score, 2);
  assert.equal(result.pass, true);
});

test("trade-flow-only L2 still vetoes an opposing direction", () => {
  const points = rows("sell").map(({ bid1Volume, ask1Volume, ...point }) => point);
  const result = evaluateQmtOrderFlow(points, 2, "BUY_FIRST");
  assert.equal(result.available, true);
  assert.equal(result.bookAvailable, false);
  assert.equal(result.pass, false);
});

test("abnormal spread vetoes otherwise supportive flow", () => {
  const points = rows("buy").map((point) => ({ ...point, spreadBps: 25, transactionCount60s: 20 }));
  const result = evaluateQmtOrderFlow(points, 2, "BUY_FIRST");
  assert.equal(result.pass, false);
  assert.equal(result.marketQualityBlocked, true);
});

test("current real snapshot can confirm without waiting for three chart points", () => {
  const result = evaluateQmtOrderFlow([{
    price: 10,
    activeBuyVolume: 68,
    activeSellVolume: 32,
    bigOrderNet: 10,
    bid1Volume: 140,
    ask1Volume: 80,
    transactionCount: 20,
  }], 0, "BUY_FIRST");
  assert.equal(result.available, true);
  assert.equal(result.pass, true);
  assert.equal(result.required, 2);
});

test("two of three aligned scans count as persistent despite one noisy minute", () => {
  const points = rows("buy");
  points[1] = { ...points[1], activeBuyVolume: 45, activeSellVolume: 55, ddx: -1 };
  const result = evaluateQmtOrderFlow(points, 2, "BUY_FIRST");
  assert.equal(result.persistence.aligned, 2);
  assert.equal(result.persistence.pass, true);
  assert.equal(result.pass, true);
});

test("real trailing large-order sweep can provide persistence confirmation", () => {
  const point = {
    price: 10,
    activeBuyVolume: 55,
    activeSellVolume: 45,
    bigOrderNet: 20,
    buySweepStreak: 3,
    bid1Volume: 90,
    ask1Volume: 110,
    transactionCount: 20,
  };
  const result = evaluateQmtOrderFlow([point], 0, "BUY_FIRST");
  assert.equal(result.persistence.sweepStreak, 3);
  assert.equal(result.persistence.pass, true);
  assert.equal(result.pass, true);
});

test("Zijin research summary consumes five L2 features without creating an order", () => {
  const result = summarizeZijinOrderFlow({
    l2: {
      status: { authorized: true, stale: false },
      flow: {
        activeBuyNotional60s: 70, activeSellNotional60s: 30, activeBuyRatio60s: 0.7,
        netActiveNotional60s: 100, bigOrderNetNotional60s: 50,
      },
      book: {
        bid1Volume: 140, ask1Volume: 80, nearTouchImbalance: 0.2, micropriceEdgeBps: 1.2,
      },
    },
  });
  assert.equal(result.available, true);
  assert.equal(result.stance, "buy");
  assert.equal("executable" in result, false);
});

test("Zijin research summary classifies retained transaction flow without book snapshots", () => {
  const result = summarizeZijinOrderFlow({
    activeBuyNotional: 760_000,
    activeSellNotional: 240_000,
    netActiveNotional: 520_000,
    bigOrderNetNotional: 210_000,
    l2Status: { connected: true, authorized: true, stale: false },
  });
  assert.equal(result.available, true);
  assert.equal(result.bookAvailable, false);
  assert.equal(result.required, 2);
  assert.equal(result.stance, "buy");
});
