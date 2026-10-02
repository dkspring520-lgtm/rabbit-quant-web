import test from "node:test";
import assert from "node:assert/strict";
import { buildV04Features, futureLabelStudy, featureAudit, V04_FEATURES } from "../lib/rl-research/trainer/feature-label-study.mjs";
const bars=Array.from({length:70},(_,i)=>({timestamp:`2022-01-01T09:${String(i%60).padStart(2,'0')}:00`,open:10+i*.01,high:10.1+i*.01,low:9.9+i*.01,close:10+i*.01,volume:100+i,amount:1000+i}));
test("v0.4 features are causal and audited",()=>{const f=bars.map((_,i)=>buildV04Features(bars,i)); const a=featureAudit(f); assert.deepEqual(a.futureFieldsUsed,[]); assert.deepEqual(Object.keys(a.fields),[...V04_FEATURES]);});
test("future label study separates buy quality without changing source action",()=>{const labels=futureLabelStudy(bars,bars.map((_,i)=>({action:i%2?'BUY_SMALL':'WAIT'}))); assert.equal(labels.length,bars.length); assert.ok(labels.some(x=>x.label==='HIGH_CONFIDENCE_BUY'||x.label==='LOW_CONFIDENCE_BUY'));});
