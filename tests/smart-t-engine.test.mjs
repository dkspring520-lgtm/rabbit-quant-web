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

test("an armed profitable buy-first cycle exits after a causal pullback instead of pretending to know the exact high", () => {
  const rows = openingRecoverySession("rise").map((point, index) => {
    if (index < 40) return point;
    return { ...point, price: Number(Math.max(9.95, 10.08 - (index - 39) * 0.025).toFixed(3)) };
  });
  const result = runSmartTReplay(rows, options);
  const exit = result.actions.find((action) => action.side === "卖出");

  assert.ok(exit, "the protected profit should eventually close after the pullback");
  assert.ok(exit.time > rows[39].time, "the exit must occur after the already observed rolling high");
  assert.match(exit.reason, /利润保护止盈/);
  assert.match(exit.reason, /滚动高点回撤/);
});

test("candidate observations are deduplicated and do not relax the execution gate", () => {
  const result = runSmartTReplay(openingRecoverySession("rise"), options);
  const minuteNumber = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(2, 4));

  assert.ok(result.observations.length >= 1);
  assert.ok(result.observations.length <= 3, "one stock-day must not flood the desk with repeated candidates");
  result.observations.slice(1).forEach((observation, index) => {
    assert.ok(minuteNumber(observation.time) - minuteNumber(result.observations[index].time) >= 8);
  });
  assert.equal(result.trades, 1, "formal cycles keep the original V4 execution threshold");
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

test("flat-open reversals become visible candidates without hindsight promotion", () => {
  const rows = [
    ["0930", 29.06], ["0931", 28.83], ["0932", 28.67], ["0933", 28.81], ["0934", 28.90],
    ["0935", 28.93], ["0936", 28.86], ["0937", 28.88], ["0938", 28.95], ["0939", 29.06],
    ["0940", 29.11], ["0941", 29.13], ["0942", 29.23], ["0943", 29.22], ["0944", 29.26],
    ["0945", 29.28], ["0946", 29.23], ["0947", 29.18], ["0948", 29.10], ["0949", 29.01],
    ["0950", 28.94], ["0951", 28.92], ["0952", 28.88], ["0953", 28.86], ["0954", 29.05],
    ["0955", 29.07], ["0956", 29.06], ["0957", 29.06], ["0958", 29.02], ["0959", 29.02],
    ["1000", 29.09], ["1001", 29.07], ["1002", 29.13], ["1003", 29.16], ["1004", 29.07],
    ["1005", 29.02], ["1006", 28.95], ["1007", 28.97], ["1008", 29.01], ["1009", 28.96],
  ].map(([time, price], index) => ({ time, price, volume: 20_000 + index * 100 }));
  const result = runSmartTReplay(rows, { ...options, previousClose: 29.06 });

  const buyCandidate=result.observations.find(item => item.direction === "正T");
  const sellCandidate=result.observations.find(item => item.direction === "反T");
  assert.ok(buyCandidate);
  assert.ok(sellCandidate);
  assert.equal(buyCandidate.stage, "watch", "a low-score rebound must remain a neutral watch point");
  assert.equal(sellCandidate.stage, "watch", "a near-flat opposite turn must not be presented as an economic sell candidate");
  assert.ok(buyCandidate.time <= "0940", "the recovery candidate should not wait until the local peak");
  assert.ok(sellCandidate.time >= "0946" && sellCandidate.time <= "0955", "the fade candidate should appear after the observed reversal");
  assert.ok(sellCandidate.pivotTime <= sellCandidate.time, "a peak reference must only use an already observed minute");
  assert.ok(sellCandidate.pivotPrice >= sellCandidate.price, "a sell-side peak reference must not be below its confirmation minute");
  assert.ok(["strong", "confirmed", "unconfirmed"].includes(sellCandidate.pivotAssessment));
  assert.ok(["强势未破", "转弱确认", "回落观察"].includes(sellCandidate.confirmationLabel));
  assert.equal(result.actions.length, 0, "flat-open swing observations must wait for formal confirmation");
});

test("a local fade above a rising VWAP cannot open a counter-trend sell cycle", () => {
  const rows = sessionTimes.slice(0, 70).map((time, index) => {
    const price = index <= 35 ? 10 + index * 0.0115 : 10.4025 - (index - 35) * 0.012;
    return { time, price: Number(price.toFixed(3)), volume: 10_000 };
  });
  const result = runSmartTReplay(rows, { ...options, previousClose: 10 });

  assert.equal(result.actions.filter(action => action.direction === "反T").length, 0);
  assert.ok(result.diagnostics.strongTrendBlocked > 0);
});

test("full-day replay starts at the earliest causal window and keeps chart markers in time order", () => {
  const result = runSmartTReplay(openingRecoverySession("rise"), { ...options, randomValue: 0 });
  assert.equal(result.startTime, "0935");
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
