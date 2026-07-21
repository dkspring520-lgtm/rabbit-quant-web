import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWatchlistEntries } from "../lib/watchlist-normalization.mjs";

test("watchlist count only includes unique valid stock codes", () => {
  const result = normalizeWatchlistEntries([
    { code: "601012", name: "隆基绿能", price: "--", change: "--" },
    { code: "601899", name: "旧名称", price: "--", change: "--" },
    { code: "601899", name: "紫金矿业", price: "29.45", change: "+0.34%" },
    { code: "invalid", name: "残留记录", price: "--", change: "--" },
    { code: "603993", name: "洛阳钼业", price: "--", change: "--" },
  ], { "601899": "紫金矿业" });

  assert.deepEqual(result.map((item) => item.code), ["601012", "601899", "603993"]);
  assert.equal(result[1].name, "紫金矿业");
  assert.equal(result.length, 3);
});

test("watchlist normalization tolerates missing input", () => {
  assert.deepEqual(normalizeWatchlistEntries(null), []);
});
