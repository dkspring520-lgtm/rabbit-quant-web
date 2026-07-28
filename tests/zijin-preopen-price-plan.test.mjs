import test from "node:test";
import assert from "node:assert/strict";
import { buildZijinPreopenPricePlan } from "../lib/zijin-preopen-price-plan.mjs";

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
