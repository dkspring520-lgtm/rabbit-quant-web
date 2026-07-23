import test from "node:test";
import assert from "node:assert/strict";

import { evaluateIntradayDivergence } from "../lib/intraday-divergence.mjs";

function pointsFrom(prices, volumes = []) {
  return prices.map((price, index) => ({
    time: String(930 + index).padStart(4, "0"),
    price,
    volume: volumes[index] ?? 100,
  }));
}

test("insufficient history remains neutral", () => {
  const result = evaluateIntradayDivergence(pointsFrom([10, 9.9, 10.1]), 2, "BUY_FIRST");
  assert.equal(result.available, false);
  assert.equal(result.strength, 0);
});

test("causally confirms bearish volume-price divergence after a higher high", () => {
  const prices = Array.from({ length: 50 }, (_, index) => 10 + (index * 0.002));
  const volumes = Array(50).fill(100);
  prices.splice(15, 7, 10.18, 10.28, 10.42, 10.30, 10.20, 10.16, 10.15);
  prices.splice(32, 7, 10.25, 10.38, 10.58, 10.40, 10.30, 10.26, 10.24);
  volumes.splice(14, 9, ...Array(9).fill(180));
  volumes.splice(31, 9, ...Array(9).fill(70));
  const result = evaluateIntradayDivergence(pointsFrom(prices, volumes), 39, "SELL_FIRST");
  assert.equal(result.available, true);
  assert.equal(result.volumePrice.confirmed, true);
  assert.equal(result.signal, "bearish");
});

test("causally confirms bullish MACD divergence after a lower low", () => {
  const prices = Array.from({ length: 60 }, (_, index) => 10.8 - (index * 0.004));
  const volumes = Array(60).fill(100);
  prices.splice(16, 7, 10.55, 10.35, 10.10, 10.28, 10.40, 10.46, 10.50);
  prices.splice(36, 7, 10.32, 10.18, 10.00, 10.16, 10.28, 10.34, 10.38);
  volumes.splice(15, 9, ...Array(9).fill(150));
  volumes.splice(35, 9, ...Array(9).fill(80));
  const result = evaluateIntradayDivergence(pointsFrom(prices, volumes), 43, "BUY_FIRST");
  assert.equal(result.available, true);
  assert.equal(result.signal, "bullish");
  assert.ok(result.strength >= 1);
});

test("future points cannot change a decision already made at a fixed index", () => {
  const prices = Array.from({ length: 55 }, (_, index) => 20 + Math.sin(index / 3) * 0.3);
  const volumes = Array.from({ length: 55 }, (_, index) => 100 + (index % 7) * 10);
  const base = pointsFrom(prices, volumes);
  const before = evaluateIntradayDivergence(base, 44, "SELL_FIRST");
  const after = evaluateIntradayDivergence(
    [...base, ...pointsFrom([99, 1, 88, 2], [9999, 1, 9999, 1])],
    44,
    "SELL_FIRST",
  );
  assert.deepEqual(after, before);
});

test("a monotonic continuation does not fabricate divergence evidence", () => {
  const prices = Array.from({ length: 60 }, (_, index) => 10 - (index * 0.02));
  const result = evaluateIntradayDivergence(pointsFrom(prices), 59, "BUY_FIRST");
  assert.equal(result.available, false);
  assert.equal(result.strength, 0);
});
