import test from "node:test";
import assert from "node:assert/strict";

import { runSmartTReplay } from "../lib/smart-t-engine.mjs";

const morningTimes = [];
for (let hour = 9, minute = 30; hour < 11 || (hour === 11 && minute <= 30);) {
  morningTimes.push(`${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`);
  minute += 1;
  if (minute === 60) { hour += 1; minute = 0; }
}

const afternoonTimes = [];
for (let hour = 13, minute = 0; hour < 15 || (hour === 15 && minute === 0);) {
  afternoonTimes.push(`${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`);
  minute += 1;
  if (minute === 60) { hour += 1; minute = 0; }
}

const sessionTimes = [...morningTimes, ...afternoonTimes];
const options = {
  capital: 200_000,
  baseShares: 6_000,
  sellable: 6_000,
  feeRate: 0.025,
  slippage: 0.02,
  minCommission: true,
  slippageMode: "percent",
  forceCloseTime: "1450",
  profile: "平衡档",
  previousClose: 10,
  randomValue: 0,
};

function openingRecoverySession(future = "rise") {
  return sessionTimes.map((time, index) => {
    let price;
    if (index <= 15) price = 9.70 + index * 0.015;
    else if (future === "rise") price = Math.min(10.08, 9.925 + (index - 15) * 0.012);
    else price = Math.max(9.60, 9.925 - (index - 15) * 0.035);
    return { time, price: Number(price.toFixed(3)), volume: 10_000 };
  });
}

test("partial intraday data is not treated as the closing bell", () => {
  const partial = openingRecoverySession("rise").slice(0, 30).map((point, index) => (
    index > 15 ? { ...point, price: 9.925 } : point
  ));
  const result = runSmartTReplay(partial, options);

  assert.equal(result.trades, 0);
  assert.equal(result.actions.length, 1, "an open leg should remain open on a partial session");
  assert.ok(result.actions[0].time < partial.at(-1).time);
});

test("future prices cannot rewrite an already emitted signal", () => {
  const prefixLength = 16;
  const rising = runSmartTReplay(openingRecoverySession("rise"), options);
  const falling = runSmartTReplay(openingRecoverySession("fall"), options);
  const cutoff = sessionTimes[prefixLength - 1];
  const beforeCutoff = (result) => result.actions.filter((action) => action.time <= cutoff);

  assert.deepEqual(beforeCutoff(rising), beforeCutoff(falling));
  assert.equal(beforeCutoff(rising).length, 1);
});

test("a completed profitable cycle reports net results after all costs", () => {
  const result = runSmartTReplay(openingRecoverySession("rise"), options);

  assert.equal(result.trades, 1);
  assert.equal(result.wins, 1);
  assert.ok(result.gross > 0);
  assert.ok(result.fees > 0);
  assert.ok(result.executionCost > 0);
  assert.ok(result.net < result.gross);
  assert.ok(Math.abs(result.net - (result.gross - result.fees - result.executionCost)) < 0.01);
});

test("a low gap without sustained recovery remains a no-trade sample", () => {
  const noise = sessionTimes.slice(0, 35).map((time, index) => ({
    time,
    price: Number((9.75 + (index % 2 ? 0.004 : -0.004)).toFixed(3)),
    volume: 10_000,
  }));
  const result = runSmartTReplay(noise, options);

  assert.equal(result.trades, 0);
  assert.equal(result.actions.length, 0);
});

test("full-day replay starts at the earliest causal window and keeps chart markers in time order", () => {
  const result = runSmartTReplay(openingRecoverySession("rise"), { ...options, randomValue: 0 });
  assert.equal(result.startTime, "0940");
  assert.equal(result.actions.length, 2);
  assert.ok(result.actions[0].time >= "0945");
  assert.ok(result.actions[0].time < result.actions[1].time);
  assert.equal(result.actions[0].direction, "正T");
  assert.deepEqual(result.actions.map(action => action.side), ["买入", "卖出"]);
});

test("buy-first orders are reduced to the cash available in the simulated account", () => {
  const reduced = runSmartTReplay(openingRecoverySession("rise"), { ...options, capital: 1_500, minCommission: false });
  const blocked = runSmartTReplay(openingRecoverySession("rise"), { ...options, capital: 500, minCommission: false });

  assert.equal(reduced.actions[0]?.side, "买入");
  assert.equal(reduced.actions[0]?.quantity, 100);
  assert.equal(blocked.actions.length, 0);
  assert.ok(blocked.diagnostics.cashBlocked > 0);
});
