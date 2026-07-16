import test from "node:test";
import assert from "node:assert/strict";

import { evaluateQmtOrderFlow } from "../lib/qmt-orderflow-confirmation.mjs";

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

test("QMT sell confirmation combines price, active volume, DDX and order book", () => {
  const result = evaluateQmtOrderFlow(rows("sell"), 2, "SELL_FIRST");
  assert.equal(result.available, true);
  assert.equal(result.pass, true);
  assert.ok(result.score >= 3);
});

test("QMT buy confirmation rejects adverse order flow", () => {
  const result = evaluateQmtOrderFlow(rows("sell"), 2, "BUY_FIRST");
  assert.equal(result.available, true);
  assert.equal(result.pass, false);
});

test("missing QMT fields remain unavailable instead of being fabricated", () => {
  const result = evaluateQmtOrderFlow([
    { time: "0930", price: 10, volume: 1000 },
    { time: "0931", price: 10.1, volume: 1200 },
    { time: "0932", price: 10.2, volume: 1500 },
  ], 2, "BUY_FIRST");
  assert.equal(result.available, false);
  assert.equal(result.pass, true);
  assert.match(result.reason, /不使用伪造订单流/);
});

test("future order flow cannot rewrite the current confirmation", () => {
  const prefix = rows("sell");
  const current = evaluateQmtOrderFlow(prefix, 2, "SELL_FIRST");
  const appended = evaluateQmtOrderFlow([...prefix, ...rows("buy")], 2, "SELL_FIRST");
  assert.deepEqual(appended, current);
});
