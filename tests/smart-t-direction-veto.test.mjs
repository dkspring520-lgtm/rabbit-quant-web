import test from "node:test";
import assert from "node:assert/strict";

import {
  causalAfternoonTrendConflict,
  causalBroadDowntrendBuyConflict,
  causalFormalEntryWindowConflict,
  causalHighGapCollapseConflict,
  causalOpeningDisplacementConflict,
  causalOpeningQualityConflict,
  causalOpeningRepairAgeConflict,
  causalPersistentDirection,
  causalThirtyMinuteTrendShieldConflict,
  causalTrendImpulseConflict,
  causalWeakRecoveryConflict,
  causalVwapDirectionConflict,
} from "../lib/smart-t-engine.mjs";

test("broad downtrend gate blocks a slow falling-knife buy missed by range classification", () => {
  const fallingBuy = {
    opening: false,
    direction: "BUY_FIRST",
    crossedVwap: false,
    priceMomentum30: -0.448,
    vwapMomentum15: -0.070,
    vwapMomentum30: -0.096,
    longPriceMeanBias: -0.540,
  };
  assert.equal(causalBroadDowntrendBuyConflict(fallingBuy), true);
  assert.equal(causalBroadDowntrendBuyConflict({ ...fallingBuy, direction: "SELL_FIRST" }), false);
  assert.equal(causalBroadDowntrendBuyConflict({ ...fallingBuy, opening: true }), false);
  assert.equal(causalBroadDowntrendBuyConflict({ ...fallingBuy, crossedVwap: true }), false);
  assert.equal(causalBroadDowntrendBuyConflict({ ...fallingBuy, priceMomentum30: -0.35 }), false);
  assert.equal(causalBroadDowntrendBuyConflict({ ...fallingBuy, vwapMomentum15: 0.01 }), false);
});

test("weak recovery gate blocks a slow falling-knife buy", () => {
  assert.equal(causalWeakRecoveryConflict({
    opening: false,
    direction: "BUY_FIRST",
    crossedVwap: false,
    deviation: -0.729,
    vwapMomentum30: -0.181,
    priceMomentum30: 0.254,
    prePivotMove10: -0.127,
    pivotReversal: 0.254,
  }), true);
});

test("weak recovery gate keeps a sufficiently confirmed buy", () => {
  assert.equal(causalWeakRecoveryConflict({
    opening: false,
    direction: "BUY_FIRST",
    crossedVwap: false,
    deviation: -0.742,
    vwapMomentum30: -0.258,
    priceMomentum30: 0.676,
    prePivotMove10: 0.338,
    pivotReversal: 0.337,
  }), false);
});

test("weak recovery gate is symmetric for an unconfirmed rising-knife sell", () => {
  assert.equal(causalWeakRecoveryConflict({
    opening: false,
    direction: "SELL_FIRST",
    crossedVwap: false,
    deviation: 0.78,
    vwapMomentum30: 0.22,
    priceMomentum30: -0.18,
    prePivotMove10: 0.14,
    pivotReversal: 0.25,
  }), true);
});

test("weak recovery gate blocks a buy while the slower VWAP path is still falling", () => {
  assert.equal(causalWeakRecoveryConflict({
    opening: false,
    direction: "BUY_FIRST",
    crossedVwap: false,
    deviation: -0.82,
    vwapMomentum30: -0.101,
    priceMomentum30: 0.41,
    prePivotMove10: 0,
    pivotReversal: 0.275,
    longPriceMeanBias: 0.01,
    broadPricePoints: 85,
  }), true);
  assert.equal(causalWeakRecoveryConflict({
    opening: false,
    direction: "BUY_FIRST",
    crossedVwap: false,
    deviation: -0.79,
    vwapMomentum30: -0.059,
    priceMomentum30: -0.31,
    prePivotMove10: -0.73,
    pivotReversal: 0.37,
    longPriceMeanBias: -0.33,
    broadPricePoints: 57,
  }), true);
});

test("weak recovery gate blocks selling into a strong unfinished 30-minute rise", () => {
  const risingSell = {
    opening: false,
    direction: "SELL_FIRST",
    crossedVwap: false,
    deviation: 1.05,
    vwapMomentum30: -0.16,
    priceMomentum30: 2.05,
    prePivotMove10: 0.51,
    pivotReversal: 0.35,
    longPriceMeanBias: 0.87,
    broadPricePoints: 55,
  };
  assert.equal(causalWeakRecoveryConflict(risingSell), true);
  assert.equal(causalWeakRecoveryConflict({ ...risingSell, pivotReversal: 0.42 }), false);
  assert.equal(causalWeakRecoveryConflict({ ...risingSell, opening: true }), false);
  assert.equal(causalWeakRecoveryConflict({ ...risingSell, crossedVwap: true }), false);
});

test("30-minute trend shield rejects local turns still inside the broader move", () => {
  const fallingBuy = {
    opening: false,
    direction: "BUY_FIRST",
    crossedVwap: false,
    deviation: -0.82,
    priceMomentum30: -0.01,
    longPriceMeanBias: 0.12,
    broadPricePoints: 70,
  };
  assert.equal(causalThirtyMinuteTrendShieldConflict(fallingBuy), true);
  assert.equal(causalThirtyMinuteTrendShieldConflict({
    ...fallingBuy,
    priceMomentum30: 0.12,
    longPriceMeanBias: -0.01,
  }), true);
  assert.equal(causalThirtyMinuteTrendShieldConflict({
    ...fallingBuy,
    priceMomentum30: 0.12,
    longPriceMeanBias: 0.08,
  }), false);

  const risingSell = {
    opening: false,
    direction: "SELL_FIRST",
    crossedVwap: false,
    deviation: 0.74,
    priceMomentum30: 1.01,
    longPriceMeanBias: 0.60,
    broadPricePoints: 70,
  };
  assert.equal(causalThirtyMinuteTrendShieldConflict(risingSell), true);
  assert.equal(causalThirtyMinuteTrendShieldConflict({
    ...risingSell,
    priceMomentum30: 0.99,
  }), false);
});

test("30-minute trend shield enforces an economic opening displacement", () => {
  const opening = {
    opening: true,
    direction: "SELL_FIRST",
    crossedVwap: false,
    deviation: 0.27,
    priceMomentum30: 0,
    longPriceMeanBias: 0,
    broadPricePoints: 14,
  };
  assert.equal(causalThirtyMinuteTrendShieldConflict(opening), true);
  assert.equal(causalThirtyMinuteTrendShieldConflict({ ...opening, deviation: 0.46 }), false);
  assert.equal(causalThirtyMinuteTrendShieldConflict({ ...opening, crossedVwap: true }), false);
});

test("persistent direction survives a small local counter move", () => {
  const rising = Array.from({ length: 91 }, (_, index) => ({
    time: String(930 + index),
    price: 10 + index * 0.012 - (index >= 83 ? (index - 82) * 0.018 : 0),
    volume: 1_000,
  }));
  const falling = Array.from({ length: 91 }, (_, index) => ({
    time: String(930 + index),
    price: 12 - index * 0.012 + (index >= 83 ? (index - 82) * 0.018 : 0),
    volume: 1_000,
  }));

  assert.equal(causalPersistentDirection(rising, 90), "uptrend");
  assert.equal(causalPersistentDirection(falling, 90), "downtrend");
  assert.equal(
    causalPersistentDirection(rising.slice(0, 90), 89),
    causalPersistentDirection(rising, 89),
    "future minutes must not change the classification",
  );
});

test("afternoon one-way trend blocks only the counter-trend order", () => {
  assert.equal(causalAfternoonTrendConflict({
    session: "afternoon",
    time: "1410",
    direction: "BUY_FIRST",
    vwapMomentum30: -0.08,
    priceMomentum30: -0.18,
  }), true);
  assert.equal(causalAfternoonTrendConflict({
    session: "afternoon",
    time: "1410",
    direction: "SELL_FIRST",
    vwapMomentum30: 0.08,
    priceMomentum30: 0.18,
  }), true);
  assert.equal(causalAfternoonTrendConflict({
    session: "morning",
    time: "1010",
    direction: "BUY_FIRST",
    vwapMomentum30: -0.08,
    priceMomentum30: -0.18,
  }), false);
  assert.equal(causalAfternoonTrendConflict({
    session: "afternoon",
    time: "1410",
    direction: "BUY_FIRST",
    vwapMomentum30: -0.08,
    priceMomentum30: 0.11,
  }), false);
  assert.equal(causalAfternoonTrendConflict({
    session: "afternoon",
    time: "1359",
    direction: "BUY_FIRST",
    vwapMomentum30: -0.08,
    priceMomentum30: -0.18,
  }), false);
});

test("formal entries preserve the morning window and keep afternoon in observation mode", () => {
  assert.equal(causalFormalEntryWindowConflict("0936"), false);
  assert.equal(causalFormalEntryWindowConflict("0937"), false);
  assert.equal(causalFormalEntryWindowConflict("1129"), false);
  assert.equal(causalFormalEntryWindowConflict("1300"), true);
  assert.equal(causalFormalEntryWindowConflict("1359"), true);
  assert.equal(causalFormalEntryWindowConflict("1400"), true);
  assert.equal(causalFormalEntryWindowConflict("1450"), true);
});

test("opening execution requires a material displacement from yesterday's close", () => {
  assert.equal(causalOpeningDisplacementConflict(true, 0.99), true);
  assert.equal(causalOpeningDisplacementConflict(true, -0.99), true);
  assert.equal(causalOpeningDisplacementConflict(true, 1), false);
  assert.equal(causalOpeningDisplacementConflict(true, -1.25), false);
  assert.equal(causalOpeningDisplacementConflict(false, 0.2), false);
});

test("opening repair rejects a chased buy and permits only a fresh strong VWAP recovery", () => {
  assert.equal(causalOpeningQualityConflict({
    opening: true,
    direction: "BUY_FIRST",
    deviation: 0.16,
    sessionMove: 0.8,
    pivotAge: 1,
  }), true);
  assert.equal(causalOpeningQualityConflict({
    opening: true,
    direction: "BUY_FIRST",
    deviation: 0.05,
    sessionMove: 0.35,
    pivotAge: 1,
  }), true);
  assert.equal(causalOpeningQualityConflict({
    opening: true,
    direction: "BUY_FIRST",
    deviation: 0.09,
    sessionMove: 0.8,
    pivotAge: 2,
  }), true);
  assert.equal(causalOpeningQualityConflict({
    opening: true,
    direction: "BUY_FIRST",
    deviation: 0.09,
    sessionMove: 0.8,
    pivotAge: 1,
  }), false);
  assert.equal(causalOpeningQualityConflict({
    opening: true,
    direction: "BUY_FIRST",
    deviation: -0.09,
    sessionMove: 0.2,
    pivotAge: 3,
  }), false);
  assert.equal(causalOpeningQualityConflict({
    opening: true,
    direction: "SELL_FIRST",
    deviation: -0.28,
    crossedVwap: false,
  }), true);
  assert.equal(causalOpeningQualityConflict({
    opening: true,
    direction: "SELL_FIRST",
    deviation: -0.18,
    crossedVwap: true,
  }), true);
  assert.equal(causalOpeningQualityConflict({
    opening: true,
    direction: "SELL_FIRST",
    deviation: 0.18,
    crossedVwap: false,
  }), false);
  assert.equal(causalOpeningQualityConflict({
    opening: false,
    direction: "BUY_FIRST",
    deviation: 0.8,
    crossedVwap: false,
  }), false);
});

test("opening repair expires after four causal minutes", () => {
  assert.equal(causalOpeningRepairAgeConflict({
    opening: true,
    direction: "BUY_FIRST",
    pivotAge: 8,
    deviation: 0.11,
  }), true);
  assert.equal(causalOpeningRepairAgeConflict({
    opening: true,
    direction: "BUY_FIRST",
    pivotAge: 4,
    deviation: 0.11,
  }), false);
  assert.equal(causalOpeningRepairAgeConflict({
    opening: true,
    direction: "BUY_FIRST",
    pivotAge: 8,
    deviation: -0.11,
  }), false);
  assert.equal(causalOpeningRepairAgeConflict({
    opening: true,
    direction: "SELL_FIRST",
    pivotAge: 8,
    deviation: 0.11,
  }), false);
  assert.equal(causalOpeningRepairAgeConflict({
    opening: false,
    direction: "BUY_FIRST",
    pivotAge: 8,
    deviation: 0.11,
  }), false);
});

test("high-gap collapse remains observation-only until the tape stabilises", () => {
  const lossCase = {
    direction: "BUY_FIRST",
    sessionMove: 4.538,
    referenceMove: 3.065,
    deviation: -0.836,
    vwapMomentum15: -0.192,
  };
  assert.equal(causalHighGapCollapseConflict(lossCase), true);
  assert.equal(causalHighGapCollapseConflict({
    ...lossCase,
    direction: "SELL_FIRST",
  }), false);
  assert.equal(causalHighGapCollapseConflict({
    ...lossCase,
    referenceMove: 1.8,
  }), false);
  assert.equal(causalHighGapCollapseConflict({
    ...lossCase,
    vwapMomentum15: -0.05,
  }), false);
});

test("VWAP side remains a hard execution constraint during the opening session", () => {
  assert.equal(causalVwapDirectionConflict("BUY_FIRST", 0.35), true);
  assert.equal(causalVwapDirectionConflict("SELL_FIRST", -0.35), true);
  assert.equal(causalVwapDirectionConflict("BUY_FIRST", -0.25), false);
  assert.equal(causalVwapDirectionConflict("SELL_FIRST", 0.25), false);
  assert.equal(causalVwapDirectionConflict("BUY_FIRST", 0.05), false);
  assert.equal(causalVwapDirectionConflict("SELL_FIRST", -0.05), false);
});

test("a causal 30-minute impulse blocks only counter-trend entries", () => {
  assert.equal(causalTrendImpulseConflict({
    opening: false,
    direction: "BUY_FIRST",
    crossedVwap: false,
    vwapMomentum15: -0.08,
    priceMomentum30: -0.75,
    prePivotMove10: -0.20,
    pivotReversal: 0.35,
  }), true);
  assert.equal(causalTrendImpulseConflict({
    opening: false,
    direction: "BUY_FIRST",
    crossedVwap: false,
    vwapMomentum15: -0.12,
    priceMomentum30: -0.75,
    prePivotMove10: -0.20,
    pivotReversal: 0.35,
  }), true);
  assert.equal(causalTrendImpulseConflict({
    opening: false,
    direction: "SELL_FIRST",
    crossedVwap: false,
    vwapMomentum15: 0.12,
    priceMomentum30: 0.75,
    prePivotMove10: 0.20,
    pivotReversal: 0.20,
  }), true);
  assert.equal(causalTrendImpulseConflict({
    opening: false,
    direction: "SELL_FIRST",
    crossedVwap: false,
    vwapMomentum15: 0.12,
    priceMomentum30: 0.75,
    prePivotMove10: 0.20,
    pivotReversal: 0.32,
  }), false);
  assert.equal(causalTrendImpulseConflict({
    opening: false,
    direction: "BUY_FIRST",
    crossedVwap: false,
    vwapMomentum15: 0.02,
    priceMomentum30: -0.75,
    prePivotMove10: -0.20,
    pivotReversal: 0.35,
  }), false);
  assert.equal(causalTrendImpulseConflict({
    opening: true,
    direction: "BUY_FIRST",
    crossedVwap: false,
    vwapMomentum15: -0.12,
    priceMomentum30: -0.75,
    prePivotMove10: -0.20,
    pivotReversal: 0.35,
  }), false);
  assert.equal(causalTrendImpulseConflict({
    opening: false,
    direction: "BUY_FIRST",
    crossedVwap: false,
    vwapMomentum15: -0.12,
    priceMomentum30: 0.40,
    prePivotMove10: -1.30,
    pivotReversal: 0.35,
  }), true);
  assert.equal(causalTrendImpulseConflict({
    opening: false,
    direction: "BUY_FIRST",
    crossedVwap: true,
    vwapMomentum15: -0.12,
    priceMomentum30: -0.75,
    prePivotMove10: -1.30,
    pivotReversal: 0.35,
  }), false);
});
