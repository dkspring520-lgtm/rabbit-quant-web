import test from "node:test";
import assert from "node:assert/strict";

import {
  PROFILES,
  buildCandidateObservationCycles,
  causalCyclePreference,
  causalRangeEvidence,
  confirmCandidateDirectionFlip,
  crossedVwapCausally,
  detectFallingKnifeConflict,
  detectRisingKnifeConflict,
  describeVwapConfirmation,
  evaluateStructuralStop,
  minutesFromOpen,
  runSmartTReplay,
} from "../lib/smart-t-engine.mjs";

test("VWAP confirmation wording separates the earlier pivot from the current side", () => {
  assert.equal(
    describeVwapConfirmation({ direction: "BUY_FIRST", pivotDeviation: -0.69, currentDeviation: 0.26, volumeRatio: 0.53 }),
    "此前低点位于 VWAP 下方 0.69%，当前已站回 VWAP 上方 0.26%；量比 0.53×",
  );
  assert.equal(
    describeVwapConfirmation({ direction: "SELL_FIRST", pivotDeviation: 0.82, currentDeviation: -0.18, volumeRatio: 2.1 }),
    "此前高点位于 VWAP 上方 0.82%，当前已跌回 VWAP 下方 0.18%；倍量 2.10×",
  );
});

test("VWAP crossing compares each minute against its own causal VWAP", () => {
  assert.equal(crossedVwapCausally({ direction: "BUY_FIRST", pivotDeviation: -0.69, currentDeviation: 0.26 }), true);
  assert.equal(crossedVwapCausally({ direction: "BUY_FIRST", pivotDeviation: 0.05, currentDeviation: 0.26 }), false);
  assert.equal(crossedVwapCausally({ direction: "SELL_FIRST", pivotDeviation: 0.82, currentDeviation: -0.18 }), true);
  assert.equal(crossedVwapCausally({ direction: "SELL_FIRST", pivotDeviation: -0.05, currentDeviation: -0.18 }), false);
});

test("falling-knife guard blocks a buy during a still-declining structure", () => {
  const broadDecline = detectFallingKnifeConflict({
    direction: "BUY_FIRST",
    currentDeviation: -0.92,
    crossedVwap: false,
    vwapMomentum15: -0.16,
    vwapMomentum30: -0.95,
    sessionMove: -0.05,
    prePivotMove10: -0.80,
    pivotAge: 3,
  });
  const weakSession = detectFallingKnifeConflict({
    direction: "BUY_FIRST",
    currentDeviation: -0.78,
    crossedVwap: false,
    vwapMomentum15: -0.08,
    vwapMomentum30: -0.12,
    sessionMove: -1.19,
    prePivotMove10: -0.55,
    pivotAge: 2,
  });
  const earlyBounce = detectFallingKnifeConflict({
    direction: "BUY_FIRST",
    currentDeviation: -0.80,
    crossedVwap: false,
    vwapMomentum15: -0.03,
    vwapMomentum30: -0.07,
    sessionMove: 0.16,
    prePivotMove10: -1.28,
    pivotAge: 2,
  });

  assert.equal(broadDecline.blocked, true);
  assert.equal(broadDecline.broadVwapDecline, true);
  assert.equal(weakSession.blocked, true);
  assert.equal(weakSession.weakSessionDecline, true);
  assert.equal(earlyBounce.blocked, true);
  assert.equal(earlyBounce.rapidDeclineUnconfirmed, true);
});

test("falling-knife guard releases after causal stabilisation or VWAP recovery", () => {
  const confirmedBounce = detectFallingKnifeConflict({
    direction: "BUY_FIRST",
    currentDeviation: -0.55,
    crossedVwap: false,
    vwapMomentum15: -0.03,
    vwapMomentum30: -0.11,
    sessionMove: -0.10,
    prePivotMove10: -0.58,
    pivotAge: 3,
  });
  const reclaimedVwap = detectFallingKnifeConflict({
    direction: "BUY_FIRST",
    currentDeviation: 0.05,
    crossedVwap: true,
    vwapMomentum15: -0.16,
    vwapMomentum30: -0.95,
    sessionMove: -1.20,
    prePivotMove10: -1.10,
    pivotAge: 1,
  });
  const neutralReverseT = detectFallingKnifeConflict({
    direction: "SELL_FIRST",
    currentDeviation: 0.80,
    crossedVwap: false,
    vwapMomentum15: 0.15,
    vwapMomentum30: 0.45,
    sessionMove: 1.50,
    prePivotMove10: 1.10,
    pivotAge: 1,
  });

  assert.equal(confirmedBounce.blocked, false);
  assert.equal(reclaimedVwap.blocked, false);
  assert.equal(neutralReverseT.blocked, false, "the buy-side guard must not alter sell-first / buy-back cycles");
});

test("rising-knife guard blocks selling into an unfinished rise", () => {
  const strongRise = detectRisingKnifeConflict({
    direction: "SELL_FIRST",
    currentDeviation: 0.82,
    crossedVwap: false,
    vwapMomentum15: 0.16,
    vwapMomentum30: 0.48,
    sessionMove: 1.80,
    prePivotMove10: 1.10,
    pivotAge: 2,
  });
  const confirmedTurn = detectRisingKnifeConflict({
    direction: "SELL_FIRST",
    currentDeviation: 0.55,
    crossedVwap: false,
    vwapMomentum15: 0.03,
    vwapMomentum30: 0.11,
    sessionMove: 0.40,
    prePivotMove10: 0.58,
    pivotAge: 3,
  });

  assert.equal(strongRise.blocked, true);
  assert.equal(confirmedTurn.blocked, false);
});

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

test("causal cycle preference aligns positive T with up-cycles and reverse T with down-cycles", () => {
  const makeSeries = (sign) => sessionTimes.slice(0, 50).map((time, index) => ({
    time,
    price: Number((10 + sign * index * 0.01).toFixed(3)),
    volume: 10_000,
  }));
  const makeVwaps = (rows) => {
    let amount = 0;
    let volume = 0;
    return rows.map((point) => {
      amount += point.price * point.volume;
      volume += point.volume;
      return amount / volume;
    });
  };
  const rising = makeSeries(1);
  const falling = makeSeries(-1);
  const flat = makeSeries(0);

  assert.equal(causalCyclePreference(rising, 40, makeVwaps(rising), 10), "uptrend");
  assert.equal(causalCyclePreference(falling, 40, makeVwaps(falling), 10), "downtrend");
  assert.equal(causalCyclePreference(flat, 40, makeVwaps(flat), 10), "range");
});

test("V4.1 range evidence requires an already-observed two-sided VWAP history", () => {
  const rows = sessionTimes.slice(0, 60).map((time, index) => ({
    time,
    price: index % 12 < 6 ? 9.94 : 10.06,
    volume: 10_000,
  }));
  const vwaps = rows.map(() => 10);
  const confirmed = causalRangeEvidence(rows, 59, vwaps);

  assert.equal(confirmed.confirmed, true);
  assert.ok(confirmed.crossings >= 2);
  assert.ok(confirmed.amplitude >= 1);

  const flatRows = rows.map((point) => ({ ...point, price: 10 }));
  assert.equal(causalRangeEvidence(flatRows, 59, vwaps).confirmed, false);
});

test("candidate observations form a separate causal pair without fabricating a missing exit", () => {
  const buy = { time: "0948", price: 10, direction: "正T", stage: "candidate" };
  const laterBuy = { time: "0956", price: 9.96, direction: "正T", stage: "candidate" };
  const sell = { time: "1012", price: 10.08, direction: "反T", stage: "candidate" };
  const closed = buildCandidateObservationCycles([buy, laterBuy, sell]);

  assert.equal(closed.cycles.length, 1);
  assert.equal(closed.cycles[0].entryTime, "0948");
  assert.equal(closed.cycles[0].exitTime, "1012");
  assert.equal(closed.cycles[0].entryLabel, "候补买入");
  assert.equal(closed.cycles[0].exitLabel, "候补卖出");
  assert.ok(closed.cycles[0].grossPct > 0);
  assert.equal(closed.open, null);

  const stillOpen = buildCandidateObservationCycles([buy, laterBuy]);
  assert.equal(stillOpen.cycles.length, 0);
  assert.equal(stillOpen.open?.status, "候补未闭环");
  assert.equal(stillOpen.open?.time, "0948");
});

test("an opposite candidate cannot silently flip into a formal entry", () => {
  const oppositeCandidate = { minute: 20 };
  const base = {
    oppositeCandidate,
    pairEconomicallyDistinct: true,
    nowMinute: 50,
    cooldown: 8,
    minimumFlipMinutes: 30,
    structuralConfirmation: true,
    executionMomentumConfirmed: true,
  };

  assert.equal(confirmCandidateDirectionFlip({ ...base, pairEconomicallyDistinct: false }), false);
  assert.equal(confirmCandidateDirectionFlip({ ...base, nowMinute: 49 }), false);
  assert.equal(confirmCandidateDirectionFlip({ ...base, structuralConfirmation: false }), false);
  assert.equal(confirmCandidateDirectionFlip(base), true);
  assert.equal(confirmCandidateDirectionFlip({ ...base, oppositeCandidate: null }), true);
});

test("a normal stop waits for a confirmed pivot break instead of one noisy minute", () => {
  const base = {
    direction: "BUY_FIRST",
    entryPivotPrice: 10,
    movePct: -0.82,
    holdMinutes: 18,
    hardStopPct: 0.75,
    catastrophicStopPct: 1.35,
    stopBreakBufferPct: 0.10,
    softStopPct: 0.40,
    softStopMinutes: 16,
  };

  const oneMinutePoke = evaluateStructuralStop({
    ...base,
    beforePrice: 10.02,
    previousPrice: 10.01,
    currentPrice: 9.88,
  });
  assert.equal(oneMinutePoke.structuralStopConfirmed, false);
  assert.equal(oneMinutePoke.stop, false);

  const confirmedBreak = evaluateStructuralStop({
    ...base,
    beforePrice: 9.91,
    previousPrice: 9.88,
    currentPrice: 9.84,
  });
  assert.equal(confirmedBreak.structuralStopConfirmed, true);
  assert.equal(confirmedBreak.stop, true);
});

test("the catastrophic risk line still exits immediately without waiting for confirmation", () => {
  const result = evaluateStructuralStop({
    direction: "BUY_FIRST",
    currentPrice: 9.95,
    previousPrice: 10.00,
    beforePrice: 10.01,
    entryPivotPrice: 9.80,
    movePct: -1.42,
    holdMinutes: 2,
    hardStopPct: 0.75,
    catastrophicStopPct: 1.35,
    stopBreakBufferPct: 0.10,
    softStopPct: 0.40,
    softStopMinutes: 16,
  });

  assert.equal(result.structuralStopConfirmed, false);
  assert.equal(result.catastrophicStop, true);
  assert.equal(result.stop, true);
});

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

test("V4 profile gates stay monotonic from steady to balanced to sensitive", () => {
  const steady = PROFILES["稳健档"];
  const balanced = PROFILES["平衡档"];
  const sensitive = PROFILES["灵敏档"];

  assert.ok(steady.score >= balanced.score && balanced.score >= sensitive.score);
  assert.ok(steady.deviation >= balanced.deviation && balanced.deviation >= sensitive.deviation);
  assert.ok(steady.candidateNetPct >= balanced.candidateNetPct && balanced.candidateNetPct >= sensitive.candidateNetPct);
  assert.ok(steady.cooldown >= balanced.cooldown && balanced.cooldown >= sensitive.cooldown);
  assert.ok(steady.maxCycles <= balanced.maxCycles && balanced.maxCycles <= sensitive.maxCycles);
  assert.ok(steady.maxSellPullback <= balanced.maxSellPullback && balanced.maxSellPullback <= sensitive.maxSellPullback);
  assert.ok(steady.maxOpeningChasePct <= balanced.maxOpeningChasePct && balanced.maxOpeningChasePct <= sensitive.maxOpeningChasePct);
  assert.ok(steady.strongBuySessionMove <= balanced.strongBuySessionMove && balanced.strongBuySessionMove <= sensitive.strongBuySessionMove);
  assert.ok(steady.strongSellSessionMove <= balanced.strongSellSessionMove && balanced.strongSellSessionMove <= sensitive.strongSellSessionMove);
  assert.ok(steady.counterTrendVwap30 <= balanced.counterTrendVwap30 && balanced.counterTrendVwap30 <= sensitive.counterTrendVwap30);
  assert.ok(steady.counterTrendSessionMove <= balanced.counterTrendSessionMove && balanced.counterTrendSessionMove <= sensitive.counterTrendSessionMove);
  assert.ok(steady.counterTrendMinVolumeRatio >= balanced.counterTrendMinVolumeRatio && balanced.counterTrendMinVolumeRatio >= sensitive.counterTrendMinVolumeRatio);
});

test("sensitive profile exposes wider observations without repeating formal cycles", () => {
  const sensitive = PROFILES["灵敏档"];

  assert.equal(sensitive.maxCycles, 1);
});

test("every V4 profile owns the complete risk, exit and trend gate set", () => {
  const required = [
    "hardStopPct", "softStopPct", "softStopMinutes", "timeExitMinutes",
    "trailActivationPct", "trailRetracePct", "trailMinNetPct",
    "maxOpeningChasePct", "strongBuySessionMove", "strongBuyVwap30",
    "strongSellSessionMove", "strongSellVwap30", "counterTrendVwap30",
    "counterTrendSessionMove", "counterTrendMinVolumeRatio",
  ];

  Object.entries(PROFILES).forEach(([name, profile]) => {
    required.forEach((key) => {
      assert.ok(Number.isFinite(profile[key]), `${name} is missing ${key}`);
    });
  });
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
  assert.ok(result.observations.length <= 6, "one stock-day must not flood the desk with repeated candidates");
  result.observations.slice(1).forEach((observation, index) => {
    assert.ok(minuteNumber(observation.time) - minuteNumber(result.observations[index].time) >= 8);
  });
  assert.equal(result.trades, 1, "formal cycles keep the original V4 execution threshold");
});

test("a distinct afternoon VWAP displacement is not hidden by the morning observation budget", () => {
  const rows = sessionTimes.map((time, index) => ({
    time,
    price: index < 10 ? 10 : index < morningTimes.length ? 10.55 : 11.20,
    volume: 10_000,
  }));
  const result = runSmartTReplay(rows, {
    ...options,
    baseShares: 0,
    sellable: 0,
  });
  const displacementWatches = result.observations.filter((item) => item.stage === "watch" && item.reason.includes("VWAP"));

  assert.ok(displacementWatches.some((item) => item.time < "1130"), "the morning displacement should remain visible");
  assert.ok(displacementWatches.some((item) => item.time >= "1300"), "a new afternoon displacement should also surface");
  assert.ok(result.observations.length <= 6, "the second session must not turn the chart into an alert flood");
});

test("the afternoon candidate scanner remains active after 13:30", () => {
  const rows = sessionTimes.map((time, index) => {
    let price = 10;
    if (index < morningTimes.length) {
      const phase = index % 18;
      price = phase < 5 ? 10.8 : phase < 10 ? 9.3 : 10;
    } else {
      const afternoonIndex = index - morningTimes.length;
      if (afternoonIndex < 36) price = 10;
      else if (afternoonIndex < 45) price = 10 + (afternoonIndex - 35) * 0.12;
      else price = 11.2 - (afternoonIndex - 44) * 0.05;
    }
    return { time, price: Number(price.toFixed(3)), volume: 10_000 };
  });
  const result = runSmartTReplay(rows, options);
  const morning = result.observations.filter((item) => item.time < "1300");
  const afternoon = result.observations.filter((item) => item.time >= "1300");

  assert.equal(morning.length, 3, "the morning may not consume the entire chart budget");
  assert.equal(afternoon.length, 3, "three readable afternoon slots should remain available");
  assert.ok(afternoon.some((item) => item.time > "1330"), "a post-13:30 displacement must be evaluated");
  assert.ok(afternoon.some((item) => item.stage === "candidate"), "the late move should progress beyond a raw watch marker");
  assert.equal(result.diagnostics.morningObservations, 3);
  assert.equal(result.diagnostics.afternoonObservations, 3);
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
  assert.ok(result.observations.length <= 6, "candidate markers must remain visually limited");
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
  assert.ok(result.diagnostics.cycleConflicts > 0, "an up-cycle reverse-T setup must be recorded as a cycle conflict");
  assert.ok(
    result.observations.some(observation => observation.blockers.some(blocker => blocker.includes("上行周期只观察反T"))),
    "the candidate layer must explain that reverse-T is observation-only during an up cycle",
  );
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

test("a gap-up day uses yesterday's close to block a shallow afternoon reverse-T fade", () => {
  const rows = sessionTimes.slice(0, 82).map((time, index) => {
    let price;
    if (index <= 64) price = 10.20 + index * 0.0025;
    else if (index <= 70) price = 10.36 + (index - 64) * 0.012;
    else price = 10.432 - (index - 70) * 0.010;
    return { time, price: Number(price.toFixed(3)), volume: 12_000 };
  });
  const result = runSmartTReplay(rows, {
    ...options,
    previousClose: 10,
    profileOverrides: {
      ...options.profileOverrides,
      score: 1,
      candidateNetPct: 0,
      minRewardRisk: 0,
      deviation: 0.1,
      reversal: 0.05,
      maxSellPullback: 1,
      minSellVolumeRatio: 0,
      minMomentum3: 0,
    },
  });

  assert.equal(result.actions.filter(action => action.direction === "反T").length, 0);
  assert.ok(result.diagnostics.strongSellTrendBlocked > 0);
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
