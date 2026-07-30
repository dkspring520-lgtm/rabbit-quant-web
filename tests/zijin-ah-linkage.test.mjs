import assert from "node:assert/strict";
import test from "node:test";
import { analyzeZijinAhLinkage } from "../lib/zijin-ah-linkage.mjs";

const points=(values)=>values.map((price,index)=>({time:`09${String(30+index).padStart(2,"0")}`,price}));

test("detects a causal H-share rebound lead",()=>{
  const result=analyzeZijinAhLinkage({
    aPreviousClose:100,
    hkPreviousClose:100,
    aMinutes:points([100,99.9,99.8,99.78,99.8,99.82]),
    hkMinutes:points([100,99.8,99.7,99.78,99.98,100.22]),
  });
  assert.equal(result.state,"hk_leads_rebound");
  assert.equal(result.bias,"buy");
  assert.equal(result.asOfTime,"0935");
  assert.ok(result.weight<=12);
});

test("never reads H-share minutes beyond the latest A-share minute",()=>{
  const result=analyzeZijinAhLinkage({
    aPreviousClose:100,
    hkPreviousClose:100,
    aMinutes:points([100,99.9,99.8,99.8]),
    hkMinutes:points([100,99.9,99.8,99.8,101,102]),
  });
  assert.equal(result.asOfTime,"0933");
  assert.equal(result.points.length,4);
});

test("degrades when baselines or overlapping minutes are missing",()=>{
  const result=analyzeZijinAhLinkage({aMinutes:points([100]),hkMinutes:points([100])});
  assert.equal(result.available,false);
  assert.equal(result.weight,0);
});
