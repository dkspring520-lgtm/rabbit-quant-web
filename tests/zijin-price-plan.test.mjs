import test from "node:test";
import assert from "node:assert/strict";
import { buildZijinPricePlan } from "../lib/zijin-price-plan.mjs";

const points = [
  ["0930",31.40],["0931",31.32],["0932",31.28],["0933",31.34],
  ["0934",31.30],["0935",31.38],["0936",31.44],["0937",31.41],
].map(([time,price])=>({time,price}));

test("Zijin price plan exposes ordered buy and sell ranges", () => {
  const plan=buildZijinPricePlan({minutes:points,previousClose:31.77,open:31.40,vwap:31.36,l2Coverage:6});
  assert.equal(plan.ready,true);
  assert.ok(plan.buyRange[0]<=plan.buyRange[1]);
  assert.ok(plan.buyRange[1]<plan.sellRange[0]);
  assert.ok(plan.sellRange[0]<=plan.sellRange[1]);
  assert.equal(plan.asOfTime,"0937");
  assert.match(plan.source,/L2 主源/);
  assert.ok(plan.riskPlan.positiveT.hardStop<plan.buyRange[0]);
  assert.ok(plan.riskPlan.positiveT.takeProfit1>plan.buyRange[1]);
  assert.ok(plan.riskPlan.positiveT.takeProfit2>=plan.riskPlan.positiveT.takeProfit1);
  assert.ok(plan.riskPlan.reverseT.hardStop>plan.sellRange[1]);
  assert.ok(plan.riskPlan.reverseT.takeProfit1<plan.sellRange[0]);
});

test("Zijin price plan waits for enough causal points", () => {
  const plan=buildZijinPricePlan({minutes:points.slice(0,4),previousClose:31.77});
  assert.equal(plan.ready,false);
  assert.match(plan.reason,/至少需要 5 个/);
});

test("future points cannot change an earlier as-of plan", () => {
  const early=buildZijinPricePlan({minutes:points.slice(0,6),previousClose:31.77,open:31.40,vwap:31.34});
  const sameEarly=buildZijinPricePlan({minutes:[...points.slice(0,6)],previousClose:31.77,open:31.40,vwap:31.34});
  const later=buildZijinPricePlan({minutes:[...points,{time:"1000",price:32.20}],previousClose:31.77,open:31.40,vwap:31.34});
  assert.deepEqual(early,sameEarly);
  assert.equal(early.asOfTime,"0935");
  assert.equal(later.asOfTime,"1000");
});
