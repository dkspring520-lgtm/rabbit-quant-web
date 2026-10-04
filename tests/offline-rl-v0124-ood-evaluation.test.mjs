import assert from "node:assert/strict";import test from "node:test";import {oodReasons,rank,summary,hash} from "../lib/rl-research/dataset/ood-evaluation-v0124.mjs";
test("OOD reasons use fixed train reference",()=>{assert.deepEqual(oodReasons([1,10,0],{mean:[0,1],std:[1,1]},["cash","position"]),{cash:true});});
test("Q ranking and margin summaries are deterministic",()=>{assert.deepEqual(rank({WAIT:1,BUY_SMALL:3,SELL_ALL:2}),["BUY_SMALL","SELL_ALL","WAIT"]);assert.equal(summary([1,2,3]).median,2);assert.equal(hash({a:1}),hash({a:1}));});
