import test from "node:test";
import assert from "node:assert/strict";

import { detectFallingKnifeConflict } from "../lib/smart-t-engine.mjs";

test("an afternoon rebound below a still-falling VWAP remains an observation", () => {
  const risk = detectFallingKnifeConflict({
    direction: "BUY_FIRST",
    currentDeviation: -0.995,
    crossedVwap: false,
    vwapMomentum15: -0.025,
    vwapMomentum30: -0.068,
    sessionMove: 0.55,
    prePivotMove10: -0.22,
    pivotAge: 6,
    priceMomentum60: 1.09,
    priceMomentum90: -0.01,
    longPriceMeanBias: 0.16,
    broadPricePoints: 90,
  });

  assert.equal(risk.blocked, true);
  assert.equal(risk.latePersistentDecline, true);
});
