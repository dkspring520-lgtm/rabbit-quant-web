import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMarketBars } from "../lib/paper-trading/index.mjs";

test("derived bar and intraday VWAP use amount and volume", () => {
  const { bars } = normalizeMarketBars([
    { code: "601899", timestamp: "2022-01-04 09:30", open: 10, high: 10, low: 10, close: 10, vol: 2, amount: 20 },
    { code: "601899", timestamp: "2022-01-04 09:31", open: 11, high: 11, low: 11, close: 11, vol: 3, amount: 33 },
  ]);
  assert.equal(bars[0].barVWAP, 10);
  assert.equal(bars[1].barVWAP, 11);
  assert.equal(bars[1].intradayVWAP, 10.6);
  assert.equal(bars[0].rawVWAP, null);
  assert.equal(bars[0].derivedVWAP, true);
});
