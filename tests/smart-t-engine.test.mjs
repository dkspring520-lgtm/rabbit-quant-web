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
    if (index <= 15) price = 9.80 + index * 0.01;
    else if (future === "rise") price = Math.min(10.08, 9.95 + (index - 15) * 0.012);
    else price = Math.max(9.60, 9.95 - (index - 15) * 0.035);
    return { time, price: Number(price.toFixed(3)), volume: 10_000 };
  });
}

test("partial intraday data is not treated as the closing bell", () => {
  const partial = openingRecoverySession("rise").slice(0, 30).map((point, index) => (
    index > 10 ? { ...point, price: 9.90 } : point
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
