import assert from "node:assert/strict";
import test from "node:test";
import { runOHLCVTResearchPerformance, compareResolutionSnapshots } from "../lib/oh-lcv-t-performance.mjs";
import { resolveReferenceSamples } from "./reference-sample-resolver.mjs";
const bars=Array.from({length:16},(_,i)=>({timestamp:`2022-01-04T09:${String(30+i).padStart(2,"0")}`,open:10+i*.01,high:10+i*.02,low:10+i*.005,close:10+i*.01,volume:100,amount:(10+i*.01)*100}));
test("independent reference resolver matches optimized golden fixture",()=>{const optimized=runOHLCVTResearchPerformance(bars,{symbol:"601899"}).samples; const reference=resolveReferenceSamples(optimized,bars); const actual=optimized.map(x=>({sampleId:x.sampleId,timestamp:x.timestamp,future1mReturn:x.future1mReturn,future3mReturn:x.future3mReturn,future5mReturn:x.future5mReturn,future10mReturn:x.future10mReturn,mfe:x.mfe,mae:x.mae,actionConditionedReturnRate:x.actionConditionedReturnRate,reward:x.reward})); const result=compareResolutionSnapshots(reference,actual,1e-12); assert.equal(result.mismatches.length,0);});
