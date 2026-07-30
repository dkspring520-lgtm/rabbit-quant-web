import assert from "node:assert/strict";
import test from "node:test";
import { evaluateWeb4Microstructure } from "../lib/web4-microstructure.mjs";

const session = (date, multiplier = 1) => ({
  date,
  minutes:[
    {time:"0930", price:10, volume:100 * multiplier},
    {time:"0931", price:10, volume:120 * multiplier},
    {time:"0932", price:10, volume:140 * multiplier},
  ],
});

test("RVOL-Time compares only the same causal minute prefix and past sessions", () => {
  const historicalSessions = Array.from({length:12}, (_, index) => session(`202607${String(index + 1).padStart(2, "0")}`));
  const result = evaluateWeb4Microstructure({
    points:[
      {time:"0930",price:10,volume:200},
      {time:"0931",price:10.01,volume:240},
    ],
    historicalSessions,
    asOfDate:"20260730",
  });
  assert.equal(result.rvol.available, true);
  assert.equal(result.rvol.value, 2);
  assert.equal(result.rvol.currentVolume, 440);
  assert.equal(result.rvol.baseline, 220);
});

test("genuine active notional plus book pressure forms buy-side confirmation", () => {
  const historicalSessions = Array.from({length:12}, (_, index) => session(`202607${String(index + 1).padStart(2, "0")}`));
  const points = [
    ["0930",10.00,80,20],
    ["0931",10.01,85,15],
    ["0932",10.03,90,10],
    ["0933",10.04,82,18],
    ["0934",10.06,88,12],
  ].map(([time,price,buy,sell])=>({
    time,price,volume:240,
    l2:{flow:{activeBuyNotional60s:buy,activeSellNotional60s:sell}},
  }));
  const result = evaluateWeb4Microstructure({
    points,
    historicalSessions,
    asOfDate:"20260730",
    liveL2:{book:{nearTouchImbalance:.22,micropriceEdgeBps:1.4}},
  });
  assert.equal(result.state, "confirmed_buy");
  assert.ok(result.buyScore > result.sellScore);
  assert.match(result.evidence.join("；"), /主动净额/);
});

test("active selling without further price decline is classified as buy absorption", () => {
  const points = [
    ["1000",10.00,20,80],
    ["1001",9.99,18,82],
    ["1002",9.98,20,80],
    ["1003",9.99,22,78],
    ["1004",10.00,25,75],
  ].map(([time,price,buy,sell])=>({
    time,price,volume:100,
    l2:{flow:{activeBuyNotional60s:buy,activeSellNotional60s:sell}},
  }));
  const result = evaluateWeb4Microstructure({points});
  assert.equal(result.absorption.side, "buy");
  assert.equal(result.state, "absorption_buy");
  assert.equal(result.label, "卖压被承接");
});

test("stale order flow is never promoted to confirmation", () => {
  const result = evaluateWeb4Microstructure({
    stale:true,
    points:[
      {time:"0930",price:10,volume:100,l2:{flow:{activeBuyNotional60s:90,activeSellNotional60s:10}}},
      {time:"0931",price:10.1,volume:100,l2:{flow:{activeBuyNotional60s:90,activeSellNotional60s:10}}},
      {time:"0932",price:10.2,volume:100,l2:{flow:{activeBuyNotional60s:90,activeSellNotional60s:10}}},
    ],
  });
  assert.equal(result.state, "waiting");
  assert.equal(result.score, 0);
  assert.match(result.evidence[0], /拒绝/);
});
