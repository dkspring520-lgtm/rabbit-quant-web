import test from "node:test";
import assert from "node:assert/strict";
import {detectAlphaDecay,generateAlphaCandidates,runAlphaLab} from "../lib/alpha-lab-engine.mjs";

test("generates bounded cross-group alpha candidates",()=>{
  const candidates=generateAlphaCandidates([
    {id:"vwap",label:"VWAP偏离",group:"price"},
    {id:"flow",label:"主动买卖",group:"l2"},
    {id:"volume",label:"量比",group:"volume"},
  ],{maxCandidates:20});
  assert.ok(candidates.length>=9);
  assert.ok(candidates.length<=20);
  assert.ok(candidates.some(item=>item.expression.includes("vwap")&&item.expression.includes("flow")));
});

test("promotes a stable causal synthetic factor",()=>{
  const rows=[];
  let price=30;
  for(let index=0;index<360;index+=1){
    const signal=Math.sin(index/8);
    rows.push({timestamp:`2026-01-${String(1+Math.floor(index/60)).padStart(2,"0")}T${String(index%60).padStart(2,"0")}:00:00Z`,price,factorValues:{signal}});
    price*=1+(signal*.0008);
  }
  const result=runAlphaLab({rows,candidates:[{id:"signal",name:"synthetic",expression:"signal",inputs:["signal"],complexity:1}],options:{folds:4,horizon:1,roundTripCostPct:0}});
  assert.equal(result.summary.tested,1);
  assert.ok(result.leaderboard[0].metrics.trades>30);
  assert.ok(["promote","observe"].includes(result.leaderboard[0].status));
});

test("detects decaying alpha score",()=>{
  const history=[];
  for(let index=0;index<20;index+=1)history.push({factorId:"alpha-a",date:`2026-07-${String(index+1).padStart(2,"0")}`,score:index<10?80:20});
  const [result]=detectAlphaDecay(history,{window:10,threshold:.55});
  assert.equal(result.decayed,true);
  assert.equal(result.action,"demote");
});
