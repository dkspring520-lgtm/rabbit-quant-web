import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateZijinOrderFlowRadar } from "../lib/zijin-order-flow-engine.mjs";

const times=["0930","0931","0932","0933","0934","0935","0936","0937","0938"];
const row=(index,{price=10,buy=0,sell=0,volume=1_000,footprint=[]}={})=>({
  time:times[index],price,open:price,high:price,low:price,volume,
  activeBuyNotional:buy,activeSellNotional:sell,
  activeBuyVolume:Math.round(buy/10),activeSellVolume:Math.round(sell/10),
  footprint,
});

test("order-flow radar accumulates causal 1/3/5-minute Delta and real footprint",()=>{
  const minutes=[
    row(0,{buy:200,sell:100}),
    row(1,{buy:300,sell:150}),
    row(2,{buy:100,sell:250}),
    row(3,{buy:400,sell:100}),
    row(4,{buy:250,sell:50,footprint:[{price:10,buyVolume:25,sellVolume:5,buyNotional:250,sellNotional:50,trades:3}]}),
  ];
  const result=evaluateZijinOrderFlowRadar({minutes});
  assert.equal(result.delta.oneMinute,200);
  assert.equal(result.delta.threeMinute,350);
  assert.equal(result.delta.fiveMinute,600);
  assert.equal(result.delta.cumulative,600);
  assert.deepEqual(result.footprint,[{price:10,buyVolume:25,sellVolume:5,deltaVolume:20,buyNotional:250,sellNotional:50,trades:3}]);
  assert.equal(result.researchOnly,true);
  assert.equal(result.confirmationOnly,true);
  assert.equal(result.canCreateSignal,false);
  assert.equal(result.affectsProduction,false);
});

test("future and after-hours rows cannot repaint a prior order-flow result",()=>{
  const prefix=times.slice(0,5).map((_,index)=>row(index,{price:10+index*.01,buy:200+index*10,sell:100,volume:1_000+index*100}));
  const expected=evaluateZijinOrderFlowRadar({minutes:prefix});
  const withFuture=evaluateZijinOrderFlowRadar({minutes:[...prefix,{...row(5,{price:30,buy:9_000_000,sell:0}),time:"1501"}],index:5});
  assert.deepEqual(withFuture,expected);
});

test("flat price under dominant active selling is classified as sell absorption",()=>{
  const result=evaluateZijinOrderFlowRadar({minutes:[
    row(0,{price:10,buy:100,sell:900}),
    row(1,{price:10,buy:120,sell:880}),
    row(2,{price:9.995,buy:100,sell:900}),
  ]});
  assert.equal(result.absorption.state,"sell-absorbed");
  assert.equal(result.absorption.label,"卖方被吸收");
});

test("a lower low with improving three-minute Delta creates only a bullish divergence observation",()=>{
  const prices=[10,9.9,9.8,9.7,9.6,9.5,9.4,9.3,9.2];
  const minutes=prices.map((price,index)=>index<5
    ?row(index,{price,buy:100,sell:1_100,volume:1_000})
    :row(index,{price,buy:500,sell:600,volume:1_200}));
  const result=evaluateZijinOrderFlowRadar({minutes});
  assert.equal(result.divergence.state,"bullish");
  assert.equal(result.divergence.label,"底背离");
  assert.ok(result.scores.lowBuy<=100);
  assert.ok(result.scores.takeProfit<=100);
  assert.equal(result.scores.lowBuyChecks.some(check=>check.label==="成交量确认"),true);
});

test("missing active L2 prints stays unavailable and cannot create a formal signal",()=>{
  const result=evaluateZijinOrderFlowRadar({minutes:[row(0),row(1),row(2)]});
  assert.equal(result.available,false);
  assert.equal(result.canCreateSignal,false);
  assert.equal(result.scores.lowBuy,null);
  assert.equal(result.scores.takeProfit,null);
});

test("historical L2 activity cannot fabricate a current score when this minute is missing",()=>{
  const result=evaluateZijinOrderFlowRadar({minutes:[row(0,{buy:1000,sell:100}),row(1)]});
  assert.equal(result.observedMinutes,1);
  assert.equal(result.available,false);
  assert.equal(result.scores.lowBuy,null);
  assert.equal(result.scores.takeProfit,null);
});

test("stale order flow is withheld rather than displayed as a current confirmation",()=>{
  const result=evaluateZijinOrderFlowRadar({minutes:[row(0,{buy:1000,sell:100})],stale:true});
  assert.equal(result.available,false);
  assert.equal(result.scores.lowBuy,null);
  assert.match(result.reason,/过期/);
});

test("order-flow scores never masquerade as a win probability",()=>{
  const result=evaluateZijinOrderFlowRadar({minutes:times.map((_,index)=>row(index,{price:10+index/100,buy:1000,sell:100}))});
  assert.equal(result.available,true);
  assert.equal(typeof result.scores.lowBuy,"number");
  assert.equal(result.winRate,null);
  assert.equal(result.probabilityStatus,"uncalibrated");
  assert.equal(result.probabilities,undefined);
  assert.equal(result.scores.probabilities,undefined);
});

test("collector and cockpit expose price-level footprint without promoting it to execution",async()=>{
  const [collector,page,styles]=await Promise.all([
    readFile(new URL("../scripts/zijin_l2_collector.py",import.meta.url),"utf8"),
    readFile(new URL("../app/authenticated-app.tsx",import.meta.url),"utf8"),
    readFile(new URL("../app/globals.css",import.meta.url),"utf8"),
  ]);
  assert.match(collector,/def update_minute_flow\(self, minute, side, volume, notional, price=None\)/);
  assert.match(collector,/self\.update_minute_flow\(minute, side, volume, notional, price\)/);
  assert.match(collector,/"footprint": footprint/);
  assert.match(collector,/"1300" <= clock <= "1500"/);
  assert.match(page,/evaluateZijinOrderFlowRadar/);
  assert.match(page,/双兔订单流/);
  assert.match(page,/0–100 是订单流确认评分，不是历史胜率/);
  assert.match(page,/calibratedCandidateProbability/);
  assert.match(page,/候卖":"候买".*strength.label/);
  assert.match(page,/正T \{zijinOrderFlowRadar.available\?orderFlowBuyStrength.label/);
  assert.match(page,/反T \{zijinOrderFlowRadar.available\?orderFlowSellStrength.label/);
  assert.match(page,/胜率待校准/);
  assert.match(page,/engineCandidateProbability===null/);
  assert.match(page,/intradayChartType==="candle"/);
  assert.match(page,/真实1分钟开高低收蜡烛图/);
  assert.match(styles,/\.intraday-candle\.up/);
  assert.match(styles,/\.zijin-order-flow-radar/);
});
