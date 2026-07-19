import test from "node:test";
import assert from "node:assert/strict";
import { enforceWatchlistLimit, watchlistLimitForRole } from "../lib/watchlist-limits.mjs";

const rows=Array.from({length:8},(_,index)=>({code:String(600000+index)}));

test("ordinary members can monitor at most five stocks",()=>{
  assert.equal(watchlistLimitForRole("member"),5);
  assert.equal(enforceWatchlistLimit(rows,"member").length,5);
});

test("administrators keep the higher operational limit",()=>{
  assert.equal(watchlistLimitForRole("admin"),30);
  assert.equal(enforceWatchlistLimit(rows,"admin").length,8);
});
