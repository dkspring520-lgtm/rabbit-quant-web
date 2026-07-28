import test from "node:test";
import assert from "node:assert/strict";
import { evaluateZijinLargeOrder } from "../lib/zijin-large-order-confirmation.mjs";

function row(time, price, {
  bigBuy=100_000,
  bigSell=0,
  bigBuyVolume=bigBuy/price,
  activeBuy=120_000,
  activeSell=20_000,
  displayedBigBuyNotional,
  cancelledBigBuyNotional,
}={}) {
  return {
    time,
    price,
    volume:10_000,
    l2Bar:{
      time,
      price,
      bigBuyNotional:bigBuy,
      bigSellNotional:bigSell,
      bigBuyVolume,
      activeBuyNotional:activeBuy,
      activeSellNotional:activeSell,
      displayedBigBuyNotional,
      cancelledBigBuyNotional,
    },
  };
}

const baseline=Array.from({length:20},(_,index)=>
  row(`09${String(30+index).padStart(2,"0")}`,31+index*.001));

test("missing cancellation lifecycle is reported instead of fabricated", () => {
  const result=evaluateZijinLargeOrder({
    minutes:[...baseline,row("0950",31.08,{bigBuy:900_000,activeBuy:950_000})],
    structure:{directionScore:20,support:31,vwap:31.03,resistance:31.4},
  });
  assert.equal(result.ready,true);
  assert.equal(result.cancellationRate,null);
  assert.ok(result.unavailable.includes("大额撤单率"));
  assert.equal(result.executable,false);
  assert.equal(result.affectsV4,false);
});

test("large buying without price impact is classified as absorption risk", () => {
  const flat=[...baseline.slice(0,18),
    row("0948",31.05,{bigBuy:100_000,activeBuy:150_000}),
    row("0949",31.05,{bigBuy:100_000,activeBuy:150_000}),
    row("0950",31.05,{bigBuy:900_000,activeBuy:950_000}),
  ];
  const result=evaluateZijinLargeOrder({
    minutes:flat,
    structure:{directionScore:10,support:31,vwap:31.04,resistance:31.3},
  });
  assert.equal(result.absorption,true);
  assert.equal(result.confirmed,false);
  assert.equal(result.stateMachine.state,"absorbed");
  assert.match(result.reason,/吸收/);
});

test("actual big trade waits for pullback and only triggers on causal re-acceleration", () => {
  const event=row("0950",31,{bigBuy:800_000,bigBuyVolume:800_000/31,activeBuy:900_000});
  const pushed=row("0951",31.10,{bigBuy:0,bigBuyVolume:0,activeBuy:180_000,activeSell:20_000});
  const pulled=row("0952",31.04,{bigBuy:0,bigBuyVolume:0,activeBuy:30_000,activeSell:25_000});
  const resumed=row("0953",31.07,{bigBuy:0,bigBuyVolume:0,activeBuy:160_000,activeSell:20_000});
  const structure={directionScore:25,support:30.98,vwap:31.02,resistance:31.4};
  const before=evaluateZijinLargeOrder({minutes:[...baseline,event,pushed],structure});
  const after=evaluateZijinLargeOrder({minutes:[...baseline,event,pushed,pulled,resumed],structure});
  assert.equal(before.stateMachine.state,"confirming");
  assert.equal(after.stateMachine.state,"positive-t-confirmed");
  assert.equal(after.stateMachine.triggerPrice,31.07);
  assert.ok(Math.abs(after.stateMachine.costPrice-31)<1e-8);
});
