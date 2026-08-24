import test from "node:test";
import assert from "node:assert/strict";

import { assertDisjointTimeSplits, buildTimeSplits } from "../lib/factor-research/factor-backtest-engine.mjs";
import {
  buildCausalZijinChipMap,
  evaluateZijinChipOrderFlowShadow,
  evaluateZijinOrderFlowConfirmation,
} from "../lib/zijin-chip-orderflow-shadow.mjs";

const TEST_CONFIG = Object.freeze({ minimumHistoricalSessions: 1, lookbackSessions: 2 });

function minute(price, volume = 1_000, extras = {}) {
  return {
    time: "1000",
    open: price,
    high: price + 0.01,
    low: price - 0.01,
    close: price,
    price,
    averagePrice: price,
    volume,
    l2Available: true,
    ...extras,
  };
}

function session(date, prices = [10]) {
  return { symbol: "601899", date, minutes: prices.map((price, index) => minute(price, 1_000, { time: `100${index}` })) };
}

function flowMinutes(direction, prices = [10, 10, 10]) {
  const buy = direction === "positiveT";
  return prices.map((price, index) => minute(price, 1_000, {
    time: `101${index}`,
    activeBuyVolume: buy ? 70 : 30,
    activeSellVolume: buy ? 30 : 70,
    activeBuyRatio: buy ? 0.70 : 0.30,
    netActiveNotional: buy ? 40 : -40,
    bidPrices: [price - 0.01, price - 0.02, price - 0.03, price - 0.04, price - 0.05],
    askPrices: [price + 0.01, price + 0.02, price + 0.03, price + 0.04, price + 0.05],
    bidVolumes: buy ? [140, 120, 100, 80, 60] : [60, 50, 40, 30, 20],
    askVolumes: buy ? [60, 50, 40, 30, 20] : [140, 120, 100, 80, 60],
    bid1Volume: buy ? 140 : 60,
    ask1Volume: buy ? 60 : 140,
    nearTouchImbalance: buy ? 0.25 : -0.25,
    spreadBps: 5,
    micropriceEdgeBps: buy ? 1 : -1,
    tradeCount: 20,
  }));
}

function baselineDecision(direction, overrides = {}) {
  return {
    date: "20240102",
    time: "1012",
    index: 2,
    price: 10,
    direction,
    formal: true,
    directionGate: true,
    atrRate: 0.005,
    ...overrides,
  };
}

test("future current-day minutes cannot rewrite the decision-time chip map", () => {
  const prior = session("20240101", [9.99, 10, 10.01]);
  const current = session("20240102", [10, 20]);
  const before = buildCausalZijinChipMap({ sessions: [prior, current], currentSession: current, currentIndex: 0, config: TEST_CONFIG });
  current.minutes[1] = minute(100, 9_999_999);
  const after = buildCausalZijinChipMap({ sessions: [prior, current], currentSession: current, currentIndex: 0, config: TEST_CONFIG });
  assert.deepEqual(after, before);
});

test("future sessions cannot affect a causal chip map", () => {
  const prior = session("20240101", [10]);
  const current = session("20240102", [10]);
  const future = session("20240103", [99]);
  assert.deepEqual(
    buildCausalZijinChipMap({ sessions: [prior, current, future], currentSession: current, currentIndex: 0, config: TEST_CONFIG }),
    buildCausalZijinChipMap({ sessions: [prior, current], currentSession: current, currentIndex: 0, config: TEST_CONFIG }),
  );
});

test("missing L2 cannot create confirmation", () => {
  const prior = session("20240101", [10]);
  const current = session("20240102", [10, 10, 10]);
  current.minutes.forEach(row => {
    row.l2Available = false;
  });
  const result = evaluateZijinChipOrderFlowShadow({
    baselineDecision: baselineDecision("positiveT"),
    sessions: [prior, current],
    currentSession: current,
    config: TEST_CONFIG,
  });
  assert.equal(result.retained, false);
  assert.equal(result.orderFlow.available, false);
  assert.equal(result.canCreateSignal, false);
});

test("the four-layer shadow cannot create a signal from a non-formal baseline decision", () => {
  const result = evaluateZijinChipOrderFlowShadow({
    baselineDecision: baselineDecision("positiveT", { formal: false }),
    sessions: [],
    currentSession: session("20240102", [10, 10, 10]),
    config: TEST_CONFIG,
  });
  assert.equal(result.retained, false);
  assert.equal(result.reason, "baseline-not-formal");
  assert.equal(result.chipMap, null);
});

test("positive-T support plus aligned buy flow can retain a baseline signal", () => {
  const prior = session("20240101", [9.99, 10, 10.01]);
  const current = { symbol: "601899", date: "20240102", minutes: flowMinutes("positiveT") };
  const result = evaluateZijinChipOrderFlowShadow({
    baselineDecision: baselineDecision("positiveT"),
    sessions: [prior, current],
    currentSession: current,
    config: TEST_CONFIG,
  });
  assert.equal(result.chipLocation.confirmed, true);
  assert.equal(result.orderFlow.confirmed, true);
  assert.equal(result.retained, true);
});

test("reverse-T resistance plus aligned sell flow can retain a baseline signal", () => {
  const prior = session("20240101", [9.99, 10, 10.01]);
  const current = { symbol: "601899", date: "20240102", minutes: flowMinutes("reverseT") };
  const result = evaluateZijinChipOrderFlowShadow({
    baselineDecision: baselineDecision("reverseT"),
    sessions: [prior, current],
    currentSession: current,
    config: TEST_CONFIG,
  });
  assert.equal(result.chipLocation.confirmed, true);
  assert.equal(result.orderFlow.confirmed, true);
  assert.equal(result.retained, true);
});

test("order-book trap risk vetoes a baseline signal", () => {
  const points = flowMinutes("positiveT");
  for (const point of points) {
    point.activeBuyVolume = 20;
    point.activeSellVolume = 80;
    point.activeBuyRatio = 0.20;
    point.bidVolumes = [500, 400, 300, 200, 100];
    point.askVolumes = [50, 40, 30, 20, 10];
    point.bid1Volume = 500;
    point.ask1Volume = 50;
  }
  const result = evaluateZijinOrderFlowConfirmation({ points, index: 2, direction: "positiveT" });
  assert.equal(result.trapRisk, "BULL_TRAP");
  assert.equal(result.trapVeto, true);
  assert.equal(result.confirmed, false);
});

test("abnormal supporting-depth disappearance can veto", () => {
  const points = flowMinutes("positiveT");
  points[1].bidVolumes = [1_000, 800, 600, 400, 200];
  points[1].bid1Volume = 1_000;
  points[2].bidVolumes = [100, 80, 60, 40, 20];
  points[2].bid1Volume = 100;
  const result = evaluateZijinOrderFlowConfirmation({ points, index: 2, direction: "positiveT" });
  assert.equal(result.abnormalDepthDisappearance, true);
  assert.equal(result.abnormalDepthSide, "BID_CANCEL");
  assert.equal(result.confirmed, false);
});

test("chronological train, validation and locked-test splits remain disjoint", () => {
  const dates = Array.from({ length: 100 }, (_, index) => `2024${String(index + 1).padStart(4, "0")}`);
  const splits = buildTimeSplits(dates, { train: 0.6, validation: 0.2, test: 0.2 });
  assert.doesNotThrow(() => assertDisjointTimeSplits(splits));
  assert.ok(splits.train.at(-1) < splits.validation[0]);
  assert.ok(splits.validation.at(-1) < splits.test[0]);
});
