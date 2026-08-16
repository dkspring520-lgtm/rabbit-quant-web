import test from "node:test";
import assert from "node:assert/strict";
import { buildZijinPreopenPricePlan, evaluateZijinPreopenGate, resolveZijinPreopenDirectionPermission } from "../lib/zijin-preopen-price-plan.mjs";

test("Zijin pre-open card stays forming before the 09:25 result", () => {
  const result=buildZijinPreopenPricePlan({
    phase:"auction",
    asOfTime:"0923",
    previousClose:31.77,
    indicativePrice:31.40,
    l2Connected:true,
    l2Stale:false,
  });
  assert.equal(result.active,true);
  assert.equal(result.ready,false);
  assert.equal(result.status,"forming");
  assert.match(result.reason,/09:25/);
});

test("09:25 result creates ordered observation ranges from causal auction inputs", () => {
  const result=buildZijinPreopenPricePlan({
    phase:"auction-result",
    asOfTime:"0925",
    previousClose:31.77,
    indicativePrice:31.40,
    bookImbalance:0.28,
    activeBuyRatio:0.61,
    atrPct:0.42,
    spreadBps:3.2,
    l2Connected:true,
    l2Stale:false,
  });
  assert.equal(result.ready,true);
  assert.equal(result.anchorPrice,31.40);
  assert.ok(result.buyRange[0] <= result.buyRange[1]);
  assert.ok(result.buyRange[1] < result.sellRange[0]);
  assert.ok(result.sellRange[0] <= result.sellRange[1]);
  assert.match(result.source,/09:25竞价结果/);
  assert.ok(result.confidence <= 75);
});

test("pre-open helper switches itself off at continuous auction", () => {
  const result=buildZijinPreopenPricePlan({
    phase:"morning",
    asOfTime:"0930",
    previousClose:31.77,
    indicativePrice:31.40,
  });
  assert.equal(result.active,false);
  assert.equal(result.ready,false);
  assert.match(result.reason,/实时分时/);
});

test("missing 09:25 price cannot be replaced with a fabricated range", () => {
  const result=buildZijinPreopenPricePlan({
    phase:"auction-result",
    asOfTime:"0925",
    previousClose:31.77,
    indicativePrice:null,
  });
  assert.equal(result.ready,false);
  assert.equal(result.status,"degraded");
  assert.match(result.reason,/不生成精确区间/);
});

test("pre-open direction needs real 09:35 tape confirmation before its shadow permission opens", () => {
  const plan=buildZijinPreopenPricePlan({
    phase:"auction-result",asOfTime:"0925",previousClose:31.77,indicativePrice:31.40,
    bookImbalance:.28,activeBuyRatio:.61,atrPct:.42,spreadBps:3,l2Connected:true,l2Stale:false,
  });
  assert.equal(plan.shadowDirection,"正T");
  const forming=evaluateZijinPreopenGate({plan,minutes:[
    {time:"0930",price:31.38,volume:100},{time:"0931",price:31.40,volume:110},{time:"0932",price:31.42,volume:120},
  ]});
  assert.equal(forming.status,"forming");
  const confirmed=evaluateZijinPreopenGate({plan,minutes:[
    {time:"0930",price:31.38,volume:100},{time:"0931",price:31.40,volume:110},{time:"0932",price:31.42,volume:120},
    {time:"0933",price:31.44,volume:130},{time:"0934",price:31.46,volume:145},{time:"0935",price:31.48,volume:160},
  ]});
  assert.equal(confirmed.status,"confirmed");
  assert.deepEqual(confirmed.allowedDirections,["正T"]);
  assert.equal(confirmed.executable,false);
  assert.equal(confirmed.affectsV4,false);
});

test("an unconfirmed pre-open direction stays neutral instead of blocking both directions", () => {
  const plan=buildZijinPreopenPricePlan({
    phase:"auction-result",asOfTime:"0925",previousClose:31.77,indicativePrice:31.40,
    bookImbalance:.28,activeBuyRatio:.61,atrPct:.42,spreadBps:3,l2Connected:true,l2Stale:false,
  });
  const blocked=evaluateZijinPreopenGate({plan,minutes:[
    {time:"0930",price:31.38,volume:150},{time:"0931",price:31.30,volume:145},{time:"0932",price:31.24,volume:130},
    {time:"0933",price:31.18,volume:120},{time:"0934",price:31.10,volume:115},{time:"0935",price:31.04,volume:110},
  ]});
  assert.equal(blocked.status,"blocked");
  assert.deepEqual(blocked.allowedDirections,[]);
  for (const direction of ["正T","反T"]) {
    const permission=resolveZijinPreopenDirectionPermission({gate:blocked,direction,time:"0936"});
    assert.equal(permission.active,false);
    assert.equal(permission.wouldBlock,false);
    assert.equal(permission.allowed,false);
    assert.match(permission.reason,/中性观察/);
  }
});

test("direction permission reports a mismatch for A/B shadow evidence but does not execute", () => {
  const permission=resolveZijinPreopenDirectionPermission({
    gate:{mode:"shadow-only",status:"confirmed",allowedDirections:["正T"],predictedDirection:"正T",confirmationCount:4,expiresAt:"1501"},
    direction:"反T",
    time:"0936",
  });
  assert.equal(permission.active,true);
  assert.equal(permission.wouldBlock,true);
  assert.equal(permission.allowed,false);
  assert.equal(permission.mode,"shadow-only");
  assert.equal(resolveZijinPreopenDirectionPermission({
    gate:{mode:"shadow-only",status:"confirmed",allowedDirections:["正T"],expiresAt:"1501"},
    direction:"正T",
    time:"0936",
  }).wouldBlock,false);
  assert.equal(resolveZijinPreopenDirectionPermission({gate:{status:"expired"},direction:"反T",time:"1501"}).wouldBlock,false);
});

test("confirmed opening direction stays active all day and ignores an unconfirmed opposite move", () => {
  const plan=buildZijinPreopenPricePlan({
    phase:"auction-result",asOfTime:"0925",previousClose:31.77,indicativePrice:31.40,
    bookImbalance:.28,activeBuyRatio:.61,atrPct:.42,spreadBps:3,l2Connected:true,l2Stale:false,
  });
  const gate=evaluateZijinPreopenGate({plan,minutes:[
    {time:"0930",price:31.38,volume:100},{time:"0931",price:31.40,volume:110},{time:"0932",price:31.42,volume:120},
    {time:"0933",price:31.44,volume:130},{time:"0934",price:31.46,volume:145},{time:"0935",price:31.48,volume:160},
    {time:"1438",price:31.30,volume:200},{time:"1439",price:31.28,volume:210},{time:"1440",price:31.26,volume:220},
  ]});
  assert.equal(gate.status,"confirmed");
  assert.deepEqual(gate.allowedDirections,["正T"]);
  assert.equal(gate.expiresAt,"1501");
  assert.equal(resolveZijinPreopenDirectionPermission({gate,direction:"反T",time:"1440"}).wouldBlock,true);
});

test("all-day direction changes only after strict causal reversal confirmation", () => {
  const plan=buildZijinPreopenPricePlan({
    phase:"auction-result",asOfTime:"0925",previousClose:31.77,indicativePrice:31.40,
    bookImbalance:.28,activeBuyRatio:.61,atrPct:.42,spreadBps:3,l2Connected:true,l2Stale:false,
  });
  const opening=[
    {time:"0930",price:31.38,volume:100},{time:"0931",price:31.40,volume:100},{time:"0932",price:31.42,volume:100},
    {time:"0933",price:31.44,volume:100},{time:"0934",price:31.46,volume:100},{time:"0935",price:31.48,volume:100},
  ];
  const reversal=[31.34,31.30,31.26,31.22,31.18].map((price,index)=>({
    time:`10${String(index).padStart(2,"0")}`,price,volume:160,activeBuyVolume:20,activeSellVolume:80,
    marketPrice:3000-index*2,sectorPrice:100-index*.1,
  }));
  const gate=evaluateZijinPreopenGate({plan,minutes:[...opening,...reversal]});
  assert.equal(gate.status,"reversed");
  assert.deepEqual(gate.allowedDirections,["反T"]);
  assert.equal(gate.reversal.confirmedAt,"1004");
  assert.equal(resolveZijinPreopenDirectionPermission({gate,direction:"反T",time:"1004"}).wouldBlock,false);
  assert.equal(resolveZijinPreopenDirectionPermission({gate,direction:"正T",time:"1004"}).wouldBlock,true);
});
