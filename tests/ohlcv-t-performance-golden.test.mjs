import assert from "node:assert/strict";
import test from "node:test";
import { runOHLCVTResearchPerformance, compareResolutionSnapshots } from "../lib/oh-lcv-t-performance.mjs";
const bars=Array.from({length:40},(_,i)=>({timestamp:`2022-01-04T09:${String(30+i).padStart(2,"0")}`,open:10+i*.01,high:10+i*.01,low:10+i*.01,close:10+i*.01,volume:100,amount:(10+i*.01)*100}));
test("legacy reference and optimized resolution are equal per sample",()=>{const optimized=runOHLCVTResearchPerformance(bars,{symbol:"601899"}).samples; const reference=runOHLCVTResearchPerformance(bars,{symbol:"601899"}).samples.map(x=>({...x})); assert.deepEqual(compareResolutionSnapshots(reference,optimized),{pass:true,tolerance:1e-12,mismatches:[]});});
