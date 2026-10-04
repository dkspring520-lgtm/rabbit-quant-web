import assert from "node:assert/strict";import test from "node:test";import {featureValues,summarize,deterministicSample,ranking,hash} from "../lib/rl-research/dataset/evidence-complete-v0122.mjs";
const row={symbol:"A",timestamp:"2025-01-01T09:30:00",scenarioId:"S",state:{marketState:{features:{return_1m:1}},accountState:{cash:10,position:2,sellablePosition:1,averageCost:5,todayBought:1}}};
test("feature distribution summary is deterministic",()=>{const s=summarize([1,2,3,null]);assert.equal(s.count,3);assert.equal(s.p50,2);assert.deepEqual(s,summarize([1,2,3,null]));});
test("train-only feature values and OOD inputs are explicit",()=>{const v=featureValues(row);assert.equal(v.cash,10);assert.equal(v.todayBought,1);});
test("deterministic ranking sampling and hash",()=>{assert.equal(deterministicSample(row),deterministicSample(row));assert.deepEqual(ranking({WAIT:1,BUY_SMALL:2,SELL_ALL:0}),["BUY_SMALL","WAIT","SELL_ALL"]);assert.equal(hash({a:1}),hash({a:1}));});
