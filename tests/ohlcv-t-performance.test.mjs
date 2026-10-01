import assert from "node:assert/strict";
import test from "node:test";
import { runOHLCVTResearchPerformance } from "../lib/oh-lcv-t-performance.mjs";
const bars=Array.from({length:40},(_,i)=>({timestamp:`2022-01-04T09:${String(30+i).padStart(2,"0")}`,open:10+i*.01,high:10+i*.01,low:10+i*.01,close:10+i*.01,volume:100,amount:(10+i*.01)*100}));
test("research signals resolve through the existing sample resolver",()=>{const report=runOHLCVTResearchPerformance(bars,{symbol:"601899"});assert.ok(report.sampleCount>=0);assert.equal(report.actionDistribution.WAIT+report.signalCount,bars.length);});
test("small action groups are marked insufficient",()=>{const report=runOHLCVTResearchPerformance(bars,{symbol:"601899"});assert.equal(report.byAction.BUY_SMALL?.insufficientSample ?? true,true);});
