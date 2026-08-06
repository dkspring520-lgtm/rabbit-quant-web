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

test("pre-open shadow permission rejects a tape that invalidates its direction", () => {
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
});

test("direction permission reports a mismatch for A/B shadow evidence but does not execute", () => {
  const permission=resolveZijinPreopenDirectionPermission({
    gate:{mode:"shadow-only",status:"confirmed",allowedDirections:["正T"],predictedDirection:"正T",confirmationCount:4,expiresAt:"1000"},
    direction:"反T",
    time:"0936",
  });
  assert.equal(permission.active,true);
  assert.equal(permission.wouldBlock,true);
  assert.equal(permission.allowed,false);
  assert.equal(permission.mode,"shadow-only");
  assert.equal(resolveZijinPreopenDirectionPermission({gate:{status:"expired"},direction:"反T",time:"1000"}).wouldBlock,false);
});
