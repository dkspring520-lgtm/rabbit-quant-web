import test from "node:test";
import assert from "node:assert/strict";
import { enforceWatchlistLimit, watchlistLimitForRole } from "../lib/watchlist-limits.mjs";

const rows=Array.from({length:8},(_,index)=>({code:String(600000+index)}));

test("free members can monitor at most two stocks",()=>{
  assert.equal(watchlistLimitForRole("member"),2);
  assert.equal(enforceWatchlistLimit(rows,"member").length,2);
});

test("active members can monitor at most five stocks",()=>{
  assert.equal(watchlistLimitForRole("member",true),5);
  assert.equal(enforceWatchlistLimit(rows,"member",true).length,5);
});

test("yearly members can monitor up to thirty stocks",()=>{
  assert.equal(watchlistLimitForRole("member",true,"yearly"),30);
  assert.equal(enforceWatchlistLimit(rows,"member",true,"yearly").length,8);
});

test("administrators keep the higher operational limit",()=>{
  assert.equal(watchlistLimitForRole("admin"),30);
  assert.equal(enforceWatchlistLimit(rows,"admin").length,8);
});
