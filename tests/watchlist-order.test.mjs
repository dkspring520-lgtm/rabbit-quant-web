import test from "node:test";
import assert from "node:assert/strict";
import { moveWatchlistItem, moveWatchlistItemByCode } from "../lib/watchlist-order.mjs";

const stocks = [
  { code: "601012", name: "隆基绿能" },
  { code: "601899", name: "紫金矿业" },
  { code: "603993", name: "洛阳钼业" },
];

test("moves a watchlist item by index without mutating the source", () => {
  const result = moveWatchlistItem(stocks, 2, 0);
  assert.deepEqual(result.map((item) => item.code), ["603993", "601012", "601899"]);
  assert.deepEqual(stocks.map((item) => item.code), ["601012", "601899", "603993"]);
});

test("moves a dragged stock to the dropped stock position", () => {
  const result = moveWatchlistItemByCode(stocks, "601899", "603993");
  assert.deepEqual(result.map((item) => item.code), ["601012", "603993", "601899"]);
});

test("keeps the order unchanged for invalid and boundary moves", () => {
  assert.deepEqual(moveWatchlistItem(stocks, 0, -1), stocks);
  assert.deepEqual(moveWatchlistItem(stocks, 2, 3), stocks);
  assert.deepEqual(moveWatchlistItemByCode(stocks, "missing", "601899"), stocks);
});
