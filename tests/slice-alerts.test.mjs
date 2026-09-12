import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceSlice} from '../lib/slice-alerts.mjs';
const update=(state,buy,episodeId='day1:structure1')=>advanceSlice(state,{available:true,buy,sell:0,time:'1000',price:30,episodeId});
test('only whole tens; no repeat after score falls; include 100',()=>{
 let state={};for(const score of [69,70,73,80,74,80,89,92,71,100])state=update(state,score);
 assert.deepEqual(state.events.map(e=>e.score),[70,80,90,100]);
 assert.equal(state.events[2].rawScore,92);
});
test('a leap emits only highest band; explicit new episode rearms',()=>{
 let state=update({},95);state=update(state,70);assert.equal(state.events.length,1);
 state=update(state,80,'day1:structure2');assert.deepEqual(state.events.map(e=>e.score),[90,80]);
});
test('unavailable or invalid scores cannot alert',()=>{
 let state=update({},NaN);state=update(state,101);
 state=advanceSlice(state,{available:false,buy:100});assert.equal(state.events.length,0);
});
