import test from "node:test";
import assert from "node:assert/strict";

import { evaluateMarketContext } from "../lib/market-context.mjs";

const item = (label, group, changePercent, inverse = false) => ({ label, group, changePercent, inverse });

test("healthy market and sector context allows a normal-size T cycle", () => {
  const result = evaluateMarketContext([
    item("上证指数", "market", 1.2),
    item("有色金属ETF", "sector", 2.5),
    item("伦铜", "related", 0.8),
  ], 1.9);
  assert.equal(result.level, "normal");
  assert.equal(result.hardLock, false);
  assert.equal(result.positionFraction, 1 / 3);
});

test("multiple adverse external moves lock new T cycles", () => {
  const result = evaluateMarketContext([
    item("上证指数", "market", -3.1),
    item("有色金属ETF", "sector", -4.2),
    item("港股紫金矿业", "cross", -4.6),
    item("伦铜", "related", -3.3),
  ], -5.1);
  assert.equal(result.level, "locked");
  assert.equal(result.hardLock, true);
  assert.equal(result.positionFraction, 0);
});

test("missing external data degrades conservatively instead of fabricating a green light", () => {
  const result = evaluateMarketContext([], -1);
  assert.equal(result.level, "degraded");
  assert.equal(result.positionFraction, 1 / 6);
  assert.match(result.action, /暂停激进档/);
});
