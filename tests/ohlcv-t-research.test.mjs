import assert from "node:assert/strict";
import test from "node:test";
import { buildOHLCVFeatures, classifyOHLCVSentiment, generateOHLCVResearchSignal, runOHLCVTResearch } from "../lib/oh-lcv-t-research.mjs";
const bars = Array.from({length:25},(_,i)=>({timestamp:`2022-01-04T09:${String(30+i).padStart(2,"0")}`,open:10+i*.01,high:10+i*.01,low:10+i*.01,close:10+i*.01,volume:100,amount:(10+i*.01)*100}));
test("OHLCV features use causal VWAP and windows",()=>{const f=buildOHLCVFeatures(bars,10);assert.equal(f.barVWAP,10.1);assert.ok(f.intradayVWAP);assert.equal(f.return10m,10.1/10-1);});
test("sentiment and signal schema are explicit",()=>{const s=classifyOHLCVSentiment({return5m:.02,priceAcceleration:-.001,volumeRatio:1.2,distanceToVWAP:.01});assert.equal(s.state,"OVERHEATED");const signal=generateOHLCVResearchSignal({symbol:"x",timestamp:"t",features:{distanceFromHigh:0},sentiment:s,trend:"UP"});assert.equal(signal.strategyId,"OHLCV_T_RESEARCH_V1");});
test("research replay is deterministic and WAIT is valid",()=>{const a=runOHLCVTResearch(bars,{symbol:"x"});const b=runOHLCVTResearch(bars,{symbol:"x"});assert.deepEqual(a,b);assert.ok(a.signals.every(x=>["BUY","BUY_SMALL","WAIT","SELL_PART","SELL_ALL"].includes(x.action)));});
