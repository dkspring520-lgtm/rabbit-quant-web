import test from "node:test";
import assert from "node:assert/strict";
import {
  buildZijinL2CausalReplayObservations,
  mergeZijinL2ReplayMinutes,
  normalizeZijinL2ReplayPayload,
} from "../lib/zijin-l2-causal-replay.mjs";

function l2Minute(time, ratio) {
  return {
    time,
    exchangeMinute:`20260728-${time}`,
    activeBuyRatio:ratio,
    activeBuyNotional:1_000_000 * ratio,
    activeSellNotional:1_000_000 * (1 - ratio),
    netActiveNotional:ratio >= .52 ? 200_000 : -150_000,
    bigOrderNetNotional:ratio >= .52 ? 100_000 : -80_000,
  };
}

function marketSequence() {
  const prices = [
    ["1015",31.36],["1016",31.31],["1017",31.24],["1018",31.20],
    ["1019",31.24],["1020",31.29],["1021",31.28],["1022",31.25],
    ["1023",31.23],["1024",31.19],["1025",31.20],["1026",31.25],["1027",31.30],
  ];
  return prices.map(([time,price],index)=>({
    time,
    price,
    volume:index >= 8 && index <= 9 ? 65 : 100,
    averagePrice:31.40,
  }));
}

test("normalizes only the requested historical L2 trading day", () => {
  const payload={recentMinutes:[l2Minute("1025",.58),{...l2Minute("1026",.59),exchangeMinute:"20260727-1026"}]};
  const result=normalizeZijinL2ReplayPayload(payload,"20260728");
  assert.equal(result.available,true);
  assert.equal(result.minutes.length,1);
  assert.equal(result.minutes[0].time,"1025");
});

test("strict causal replay promotes one repair only after three aligned L2 minutes", () => {
  const l2=marketSequence().map((row,index)=>l2Minute(row.time,index >= 10 ? .58 : .43));
  const merged=mergeZijinL2ReplayMinutes(marketSequence(),l2,"20260728");
  const observations=buildZijinL2CausalReplayObservations(merged);
  assert.equal(observations.length,1);
  assert.equal(observations[0].time,"1027");
  assert.equal(observations[0].confirmationLabel,"L2修复");
  assert.equal(observations[0].l2Strict,true);
});

test("missing historical L2 cannot fabricate a strict repair marker", () => {
  const merged=mergeZijinL2ReplayMinutes(marketSequence(),[],"20260728");
  assert.deepEqual(buildZijinL2CausalReplayObservations(merged),[]);
});
