import test from "node:test";
import assert from "node:assert/strict";

import { PROFILES, minutesFromOpen, runSmartTReplay } from "../lib/smart-t-engine.mjs";

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
  // Generic engine tests isolate ordering, costs and causality. Production-only
  // quality gates are covered separately so they do not invalidate fixtures.
  profileOverrides: {
    maxOpeningChasePct: Number.POSITIVE_INFINITY,
    trailActivationPct: Number.POSITIVE_INFINITY,
  },
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
    index > 6 ? { ...point, price: 9.79 } : point
  ));
  const result = runSmartTReplay(partial, options);

  assert.equal(result.trades, 0);
  assert.equal(result.actions.length, 1, "an open leg should remain open on a partial session");
  assert.ok(result.actions[0].time < partial.at(-1).time);
});

test("future prices cannot rewrite an already emitted signal", () => {
  const prefixLength = 8;
  const rising = runSmartTReplay(openingRecoverySession("rise"), options);
  const falling = runSmartTReplay(openingRecoverySession("fall"), options);
  const cutoff = sessionTimes[prefixLength - 1];
  const beforeCutoff = (result) => result.actions.filter((action) => action.time <= cutoff);

  assert.deepEqual(beforeCutoff(rising), beforeCutoff(falling));
  assert.equal(beforeCutoff(rising).length, 1);
});

test("every replay prefix matches the same moment inside a full-day replay", () => {
  const rows = openingRecoverySession("rise");
  const full = runSmartTReplay(rows, options);

  for (const prefixLength of [21, 31, 46, 71, 101]) {
    const partial = runSmartTReplay(rows.slice(0, prefixLength), options);
    const cutoff = rows[prefixLength - 1].time;
    assert.deepEqual(
      partial.actions,
      full.actions.filter((action) => action.time <= cutoff),
      `actions changed after appending data beyond ${cutoff}`,
    );
    assert.deepEqual(
      partial.observations,
      full.observations.filter((observation) => observation.time <= cutoff),
      `observations changed after appending data beyond ${cutoff}`,
    );
  }
});

test("a live reminder first appears at its confirmation minute and is never rewritten", () => {
  const rows = openingRecoverySession("rise");
  const full = runSmartTReplay(rows, options);
  const observation = full.observations[0];
  assert.ok(observation, "the fixture must emit a causal observation");
  const confirmationIndex = rows.findIndex((point) => point.time === observation.time);
  assert.ok(confirmationIndex > 0);

  const before = runSmartTReplay(rows.slice(0, confirmationIndex), options);
  const atConfirmation = runSmartTReplay(rows.slice(0, confirmationIndex + 1), options);
  assert.equal(
    before.observations.some((item) => item.time === observation.time),
    false,
    "the reminder must not exist before its confirmation minute",
  );
  assert.deepEqual(
    atConfirmation.observations.find((item) => item.time === observation.time),
    observation,
    "the reminder payload must be complete at the minute it first appears",
  );
  assert.ok(
    !observation.pivotTime || observation.pivotTime <= observation.time,
    "an audit pivot may only reference an already observed minute",
  );
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

test("a profitable buy-first cycle exits at the first causal minute that clears the after-cost target", () => {
  const rows = openingRecoverySession("rise").map((point, index) => {
    if (index < 40) return point;
    return { ...point, price: Number(Math.max(9.95, 10.08 - (index - 39) * 0.025).toFixed(3)) };
  });
  const result = runSmartTReplay(rows, options);
  const entry = result.actions.find((action) => action.side === "买入");
  const exit = result.actions.find((action) => action.side === "卖出");

  assert.ok(entry);
  assert.ok(exit, "the cycle should close as soon as its after-cost target is visible");
  assert.match(exit.reason, /扣费净止盈/);
  assert.match(exit.reason, /按本分钟已出现价格执行/);
  assert.ok(
    result.cycleNets[0] / (entry.price * entry.quantity) * 100 >= PROFILES[options.profile].targetNetPct,
    "the completed cycle must clear the selected profile's after-cost target",
  );

  const exitIndex = rows.findIndex((point) => point.time === exit.time);
  const prefix = runSmartTReplay(rows.slice(0, exitIndex + 1), options);
  assert.deepEqual(
    prefix.actions,
    result.actions.filter((action) => action.time <= exit.time),
    "later prices must not create or relocate the target exit",
  );
});

test("all V4 profiles arm profit protection at 0.64% and cap after-cost profit at 1.00%", () => {
  const targets = Object.values(PROFILES).map((profile) => profile.targetNetPct);

  assert.ok(targets.length > 0);
  targets.forEach((target) => {
    assert.equal(target, 0.64);
  });
  assert.deepEqual(
    Object.fromEntries(Object.entries(PROFILES).map(([name, profile]) => [name, profile.targetNetPct])),
    { "稳健档": 0.64, "平衡档": 0.64, "灵敏档": 0.64, "量化学习": 0.64 },
  );
  Object.values(PROFILES).forEach((profile) => assert.equal(profile.maxTargetNetPct, 1.00));
});

test("the lunch break is excluded from causal holding minutes", () => {
  assert.equal(minutesFromOpen("1130"), 120);
  assert.equal(minutesFromOpen("1300"), 120);
  assert.equal(minutesFromOpen("1301") - minutesFromOpen("1129"), 2);
  assert.equal(minutesFromOpen("1400") - minutesFromOpen("1100"), 90);
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

test("zero simulated inventory still exposes a few candidates without creating orders", () => {
  const result = runSmartTReplay(openingRecoverySession("rise"), {
    ...options,
    baseShares: 0,
    sellable: 0,
  });

  assert.equal(result.actions.length, 0);
  assert.equal(result.trades, 0);
  assert.ok(result.diagnostics.candidates > 0);
  assert.ok(result.observations.length >= 1);
  assert.ok(result.observations.length <= 3, "candidate markers must remain visually limited");
  assert.ok(
    result.observations.some((observation) => observation.blockers.includes("可用资金或股数不足")),
    "the UI should explain that the setup exists but the simulated account cannot execute it",
  );
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

test("the production opening-chase gate keeps an overextended repair visible without executing it", () => {
  const result = runSmartTReplay(openingRecoverySession("rise"), {
    ...options,
    profileOverrides: { trailActivationPct: Number.POSITIVE_INFINITY },
  });

  assert.equal(result.actions.length, 0);
  assert.equal(result.trades, 0);
  assert.ok(result.diagnostics.candidates > 0, "the setup must remain available for review");
  assert.ok(result.diagnostics.openingChaseBlocked > 0, "the audit trail must name the opening chase veto");
  assert.ok(result.observations.length > 0, "the execution veto must not hide the candidate layer");
});

test("the production profit trail exits only after an observed pullback and stays causal", () => {
  const prices = [9.70, 9.715, 9.73, 9.745, 9.76, 9.775, 9.79, 9.82, 9.84, 9.83, 9.82, 9.81, 9.81, 9.81];
  const rows = prices.map((price, index) => ({
    time: sessionTimes[index],
    price,
    volume: index === 8 ? 25_000 : 12_000,
  }));
  const replayOptions = {
    ...options,
    profileOverrides: {
      maxOpeningChasePct: Number.POSITIVE_INFINITY,
      targetNetPct: 0.15,
      maxTargetNetPct: 0.80,
      trailActivationPct: 0.15,
      trailRetracePct: 0.05,
      trailMinNetPct: 0.02,
      minHoldMinutes: 3,
    },
  };
  const full = runSmartTReplay(rows, replayOptions);
  const exit = full.actions[1];
  const exitIndex = rows.findIndex((point) => point.time === exit?.time);
  const beforeExit = runSmartTReplay(rows.slice(0, exitIndex), replayOptions);
  const atExit = runSmartTReplay(rows.slice(0, exitIndex + 1), replayOptions);

  assert.equal(full.trades, 1);
  assert.equal(full.wins, 1);
  assert.equal(exit?.meta?.trailingProfit, true);
  assert.match(exit.reason, /回撤保护/);
  assert.ok(exit.meta.projectedNetPct < replayOptions.profileOverrides.maxTargetNetPct, "a pullback exit must happen before the hard profit ceiling");
  assert.ok(exit.meta.bestMove > exit.meta.move, "the exit requires a pullback from an already observed best move");
  assert.equal(beforeExit.actions.length, 1, "the later pullback must not be known one minute early");
  assert.deepEqual(atExit.actions, full.actions, "the exit must be reproducible at its confirmation minute");
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
  assert.ok(buyCandidate.pivotTime <= buyCandidate.time, "a valley reference must only use an already observed minute");
  assert.ok(buyCandidate.pivotPrice <= buyCandidate.price, "a buy-side valley reference must not be above its confirmation minute");
  assert.ok(["低位偏离", "低位候选", "转强确认", "反弹观察"].includes(buyCandidate.confirmationLabel));
  if (sellCandidate.confirmationLabel === "高位偏离") {
    assert.ok(sellCandidate.time >= "0939" && sellCandidate.time <= "0945", "a live VWAP displacement warning may precede reversal confirmation");
    assert.equal(sellCandidate.executable, false, "a displacement warning is never a hindsight sell signal");
  } else {
    assert.ok(sellCandidate.time >= "0946" && sellCandidate.time <= "0955", "the fade candidate should appear after the observed reversal");
  }
  assert.ok(sellCandidate.pivotTime <= sellCandidate.time, "a peak reference must only use an already observed minute");
  assert.ok(sellCandidate.pivotPrice >= sellCandidate.price, "a sell-side peak reference must not be below its confirmation minute");
  assert.ok(["strong", "confirmed", "unconfirmed"].includes(sellCandidate.pivotAssessment));
  assert.ok(["高位偏离", "高位候选", "转弱确认", "回落观察"].includes(sellCandidate.confirmationLabel));
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

test("insufficient participation keeps a counter-trend turn visible but non-executable", () => {
  const rows = sessionTimes.slice(0, 70).map((time, index) => {
    const price = index <= 35 ? 10 + index * 0.0115 : 10.4025 - (index - 35) * 0.012;
    return { time, price: Number(price.toFixed(3)), volume: 10_000 };
  });
  const result = runSmartTReplay(rows, {
    ...options,
    previousClose: 10,
    profileOverrides: {
      ...options.profileOverrides,
      counterTrendVwap30: 0.01,
      counterTrendSessionMove: 0.01,
      counterTrendMinVolumeRatio: 1.10,
    },
  });

  assert.equal(result.actions.length, 0);
  assert.ok(result.diagnostics.counterTrendQualityBlocked > 0);
  assert.ok(
    result.observations.some((observation) => observation.blockers.some((blocker) => blocker.includes("30分钟均价线趋势尚未反转"))),
    "the rejected setup must remain visible with its causal volume-and-VWAP reason",
  );
});

test("a shallow fade after a long rising VWAP stays an observation instead of a reverse-T sale", () => {
  const rows = sessionTimes.slice(0, 85).map((time, index) => {
    let price;
    if (index <= 20) price = 10 + index * 0.006;
    else if (index <= 35) price = 10.12 + (index - 20) * 0.035;
    else price = 10.645 - (index - 35) * 0.006;
    return { time, price: Number(price.toFixed(3)), volume: 12_000 };
  });
  const result = runSmartTReplay(rows, { ...options, previousClose: 10 });

  assert.equal(result.actions.filter(action => action.direction === "反T").length, 0);
  assert.ok(result.diagnostics.strongTrendBlocked > 0, "the longer observed VWAP trend must veto the shallow local fade");
  assert.ok(
    result.observations.some(observation => observation.direction === "反T" && observation.pivotAssessment === "strong" && observation.stage === "candidate"),
    "an economic peak blocked only by the prevailing trend remains visible in the candidate layer",
  );
});

test("a fast session expansion above a lagging VWAP blocks a shallow reverse-T fade", () => {
  const rows = sessionTimes.slice(0, 144).map((time, index) => {
    let price;
    let volume;
    if (index < 121) {
      price = 10 + index * 0.00065;
      volume = 100_000;
    } else {
      const afternoonIndex = index - 121;
      if (afternoonIndex <= 19) price = 10.08 + afternoonIndex * (0.19 / 19);
      else if (afternoonIndex === 20) price = 10.255;
      else if (afternoonIndex === 21) price = 10.245;
      else price = 10.235;
      volume = 10_000;
    }
    return { time, price: Number(price.toFixed(3)), volume };
  });
  const result = runSmartTReplay(rows, { ...options, previousClose: 10 });

  assert.equal(result.actions.length, 0, "a +2% session still above VWAP must not sell a shallow local fade");
  assert.ok(result.diagnostics.strongTrendBlocked > 0);
  assert.ok(result.diagnostics.strongSellTrendBlocked > 0, "the audit trail must identify the blocked reverse-T direction");
  assert.equal(result.diagnostics.strongBuyTrendBlocked, 0);
  assert.ok(
    result.observations.some(observation => observation.direction === "反T" && observation.pivotAssessment === "strong" && observation.stage === "candidate"),
    "the peak remains visible as a blocked candidate instead of disappearing",
  );
});

test("an already-confirmed local valley can clear a short regime label without reading future prices", () => {
  const rows = sessionTimes.slice(0, 90).map((time, index) => {
    let price;
    if (index <= 49) price = 10;
    else if (index <= 55) price = 10 - (index - 49) * 0.023333;
    else if (index <= 60) price = 9.86 + (index - 55) * 0.01;
    else if (index <= 75) price = 9.91 + (index - 60) * 0.012;
    else price = 10.09 - (index - 75) * 0.012;
    return { time, price: Number(price.toFixed(3)), volume: 10_000 };
  });
  const full = runSmartTReplay(rows, { ...options, previousClose: 10 });
  const entry = full.actions[0];
  const entryIndex = rows.findIndex((point) => point.time === entry?.time);
  const prefix = runSmartTReplay(rows.slice(0, entryIndex + 1), { ...options, previousClose: 10 });

  assert.equal(entry?.side, "买入");
  assert.equal(entry?.direction, "正T");
  assert.ok(entryIndex > 0);
  assert.deepEqual(prefix.actions, [entry], "the entry must exist at the same minute before later prices are appended");
  assert.equal(full.trades, 1);
  assert.equal(full.wins, 1);
  assert.match(full.actions[1].reason, /扣费净止盈/);
});

test("a 1.0%-1.35% one-way move keeps a small counter move observational in both directions", () => {
  const makeRows = (direction) => sessionTimes.slice(0, 90).map((time, index) => {
    let price = 10;
    if (index > 49 && index <= 56) price = direction * (index - 49) * 0.02 + 10;
    if (index > 56 && index <= 60) price = 10 + direction * (0.14 - (index - 56) * 0.0075);
    if (index > 60) price = 10 + direction * 0.11;
    return { time, price: Number(price.toFixed(3)), volume: 10_000 };
  });
  const rising = runSmartTReplay(makeRows(1), { ...options, previousClose: 10 });
  const falling = runSmartTReplay(makeRows(-1), { ...options, previousClose: 10 });

  assert.equal(rising.actions.length, 0, "a small fade in a medium uptrend must not become a low reverse-T sale");
  assert.equal(falling.actions.length, 0, "a small rebound in a medium downtrend must not become a premature buy");
  assert.ok(rising.observations.some((item) => item.direction === "反T"));
  assert.ok(falling.observations.some((item) => item.direction === "正T"));
  assert.ok(rising.diagnostics.regimeBlocked > 0);
  assert.ok(falling.diagnostics.regimeBlocked > 0);
});

test("an already-confirmed local peak can clear a long regime label within the sell pullback boundary", () => {
  const rows = sessionTimes.slice(0, 90).map((time, index) => {
    let price;
    if (index <= 49) price = 10;
    else if (index <= 55) price = 10 + (index - 49) * (0.125 / 6);
    else if (index <= 60) price = 10.125 - (index - 55) * 0.0066;
    else if (index <= 75) price = 10.092 - (index - 60) * 0.012;
    else price = 9.912 + (index - 75) * 0.012;
    return { time, price: Number(price.toFixed(3)), volume: 10_000 };
  });
  const full = runSmartTReplay(rows, { ...options, previousClose: 10 });
  const entry = full.actions[0];
  const entryIndex = rows.findIndex((point) => point.time === entry?.time);
  const prefix = runSmartTReplay(rows.slice(0, entryIndex + 1), { ...options, previousClose: 10 });
  const observedPeak = Math.max(...rows.slice(Math.max(0, entryIndex - 8), entryIndex + 1).map((point) => point.price));
  const pullback = (observedPeak - rows[entryIndex].price) / rows[entryIndex].price * 100;

  assert.equal(entry?.side, "卖出");
  assert.equal(entry?.direction, "反T");
  assert.ok(entryIndex > 0);
  assert.ok(pullback <= 0.36, "reverse-T must not chase a sell after the observed peak is already too far away");
  assert.deepEqual(prefix.actions, [entry], "the peak confirmation must exist before later prices are appended");
  assert.equal(full.trades, 1);
  assert.equal(full.wins, 1);
});

test("full-day replay starts at the earliest causal window and keeps chart markers in time order", () => {
  const result = runSmartTReplay(openingRecoverySession("rise"), { ...options, randomValue: 0 });
  assert.equal(result.startTime, "0933");
  assert.equal(result.actions.length, 2);
  assert.ok(result.actions[0].time >= "0936");
  assert.ok(result.actions[0].time < "0945", "a confirmed early opening repair should not be forced to wait until 09:45");
  assert.ok(result.actions[0].time < result.actions[1].time);
  assert.equal(result.actions[0].direction, "正T");
  assert.deepEqual(result.actions.map(action => action.side), ["买入", "卖出"]);
});

test("an early opening order appears only after its own causal confirmation minute", () => {
  const rows = openingRecoverySession("rise");
  const full = runSmartTReplay(rows, options);
  const entry = full.actions[0];
  const entryIndex = rows.findIndex((point) => point.time === entry?.time);
  const before = runSmartTReplay(rows.slice(0, entryIndex), options);
  const atConfirmation = runSmartTReplay(rows.slice(0, entryIndex + 1), options);

  assert.ok(entry?.time >= "0936" && entry.time < "0945");
  assert.equal(before.actions.length, 0, "no order may exist before the confirmation minute");
  assert.deepEqual(atConfirmation.actions, [entry], "the order must be reproducible from the exact live prefix");
});

test("buy-first orders are reduced to the cash available in the simulated account", () => {
  const reduced = runSmartTReplay(openingRecoverySession("rise"), { ...options, capital: 1_500, minCommission: false });
  const blocked = runSmartTReplay(openingRecoverySession("rise"), { ...options, capital: 500, minCommission: false });

  assert.equal(reduced.actions[0]?.side, "买入");
  assert.equal(reduced.actions[0]?.quantity, 100);
  assert.equal(blocked.actions.length, 0);
  assert.ok(blocked.diagnostics.cashBlocked > 0);
});

test("missing QMT fields preserve the public-minute V4 baseline", () => {
  const rows = openingRecoverySession("rise");
  const baseline = runSmartTReplay(rows, options);
  const explicitMissing = runSmartTReplay(rows.map((point) => ({
    ...point,
    activeBuyVolume: null,
    activeSellVolume: null,
    ddx: null,
    bid1Volume: null,
    ask1Volume: null,
  })), options);

  assert.deepEqual(explicitMissing.actions, baseline.actions);
  assert.deepEqual(explicitMissing.cycleNets, baseline.cycleNets);
  assert.equal(explicitMissing.diagnostics.orderFlowAvailablePoints, 0);
  assert.equal(explicitMissing.diagnostics.orderFlowBlocked, 0);
});

test("supportive QMT order flow confirms rather than invents a V4 entry", () => {
  const rows = openingRecoverySession("rise").map((point, index) => ({
    ...point,
    activeBuyVolume: 70,
    activeSellVolume: 30,
    ddx: index,
    bid1Volume: 140,
    ask1Volume: 80,
  }));
  const result = runSmartTReplay(rows, options);

  assert.equal(result.trades, 1);
  assert.ok(result.diagnostics.orderFlowAvailablePoints > 0);
  assert.equal(result.diagnostics.orderFlowBlocked, 0);
  assert.match(result.actions[0].reason, /QMT/);
});

test("adverse QMT order flow blocks a formal buy without hiding the candidate", () => {
  const rows = openingRecoverySession("rise").map((point, index) => ({
    ...point,
    activeBuyVolume: 20,
    activeSellVolume: 80,
    ddx: -index,
    bid1Volume: 50,
    ask1Volume: 150,
  }));
  const result = runSmartTReplay(rows, options);

  assert.equal(result.actions.length, 0);
  assert.equal(result.trades, 0);
  assert.ok(result.observations.length > 0, "the setup must remain auditable");
  assert.ok(result.observations.some((item) => item.blockers.some((blocker) => blocker.includes("QMT order flow"))));
  assert.ok(result.diagnostics.orderFlowBlocked > 0);
});
