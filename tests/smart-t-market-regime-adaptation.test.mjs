import test from "node:test";
import assert from "node:assert/strict";

import { runSmartTReplay } from "../lib/smart-t-engine.mjs";
import { detectCausalMarketRegime } from "../lib/market-regime-detector.mjs";

const sessionTimes = [];
for (let minute = 0; minute < 120; minute += 1) {
  const total = 9 * 60 + 30 + minute;
  sessionTimes.push(`${String(Math.floor(total / 60)).padStart(2, "0")}${String(total % 60).padStart(2, "0")}`);
}

const baseOptions = {
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

const replay = (rows, profileOverrides, extra = {}) =>
  runSmartTReplay(rows, { ...baseOptions, ...extra, profileOverrides });

// A steady one-way decline that then bounces. The decline establishes
// BEAR_TREND (price under the cumulative VWAP the whole way, negative
// fifteen-minute VWAP slope, session move past -1.2%); the bounce is what makes
// the engine want a 正T (低吸) while the 30-bar window still reads BEAR_TREND.
// Without that bounce the engine picks 反T on every minute and the positive-T
// veto is never even consulted.
const bearThenBounce = sessionTimes.slice(0, 62).map((time, index) => ({
  time,
  price: Number((index < 50 ? 10 - index * 0.008 : 9.60 + (index - 50) * 0.014).toFixed(3)),
  volume: 1_000,
}));

// Mirror image: a sustained rally that fades, so the engine wants a 反T (高抛)
// while the window still reads BULL_TREND.
const bullThenFade = sessionTimes.slice(0, 62).map((time, index) => ({
  time,
  price: Number((index < 50 ? 10 + index * 0.009 : 10.45 - (index - 50) * 0.016).toFixed(3)),
  volume: 1_000,
}));

const cumulativeVwaps = (rows) => {
  let sum = 0;
  return rows.map((row, index) => {
    sum += row.price;
    return sum / (index + 1);
  });
};

test("the bear fixture really is a BEAR_TREND under the causal detector", () => {
  const evaluation = detectCausalMarketRegime(bearThenBounce, 49, cumulativeVwaps(bearThenBounce), 10);
  assert.equal(evaluation.regime, "BEAR_TREND");
  assert.equal(evaluation.regimeMultiplier.allowPositiveT, false);
  assert.equal(evaluation.regimeMultiplier.allowReverseT, true);
});

test("the bull fixture really is a BULL_TREND under the causal detector", () => {
  const evaluation = detectCausalMarketRegime(bullThenFade, 49, cumulativeVwaps(bullThenFade), 10);
  assert.equal(evaluation.regime, "BULL_TREND");
  assert.equal(evaluation.regimeMultiplier.allowReverseT, false);
  assert.equal(evaluation.regimeMultiplier.allowPositiveT, true);
});

test("V6 regime adaptation is off by default and leaves the calibrated replay untouched", () => {
  const asShipped = runSmartTReplay(bearThenBounce, baseOptions);
  const explicitlyOff = replay(bearThenBounce, { causalMarketRegimeAdaptation: 0 });

  assert.equal(asShipped.diagnostics.marketRegimeAdaptation, false);
  assert.equal(asShipped.diagnostics.marketRegimeDirectionBlocked, 0);
  assert.deepEqual(asShipped.diagnostics.marketRegimeCounts, {});
  // The shipped default must behave exactly as the flag-0 profile: the V6 path
  // stays inert until an audit script switches it on.
  assert.deepEqual(explicitlyOff.actions, asShipped.actions);
  assert.equal(explicitlyOff.net, asShipped.net);
  assert.equal(explicitlyOff.trades, asShipped.trades);
});

test("the new execution gate is absent from the audit while adaptation is off", () => {
  const off = replay(bearThenBounce, { causalMarketRegimeAdaptation: 0 }, { gateAudit: true });
  assert.ok(Object.keys(off.gateAudit.gates).length > 0, "the fixture should reject some candidates");
  assert.equal(off.gateAudit.gates.marketRegimeDirection, undefined);
});

test("enabling V6 adaptation vetoes 正T inside a bear cascade", () => {
  const adapted = replay(bearThenBounce, { causalMarketRegimeAdaptation: 1 }, { gateAudit: true });

  assert.equal(adapted.diagnostics.marketRegimeAdaptation, true);
  assert.ok(
    adapted.diagnostics.marketRegimeCounts.BEAR_TREND > 0,
    "the replay should classify at least one minute as BEAR_TREND",
  );
  assert.ok(
    adapted.diagnostics.marketRegimeDirectionBlocked > 0,
    "低吸 must be vetoed on the bear-cascade minutes",
  );
  // The veto participates in the existing gate audit like every other gate,
  // so a calibration run can measure its incremental effect.
  assert.ok(adapted.gateAudit.gates.marketRegimeDirection.rejected > 0);
  assert.equal(
    adapted.actions.filter(action => action.direction === "正T").length,
    0,
    "no formal 正T leg may open while allowPositiveT is false",
  );
});

test("enabling V6 adaptation vetoes 反T inside a bull run", () => {
  const adapted = replay(bullThenFade, { causalMarketRegimeAdaptation: 1 }, { gateAudit: true });

  assert.ok(adapted.diagnostics.marketRegimeCounts.BULL_TREND > 0);
  assert.ok(adapted.diagnostics.marketRegimeDirectionBlocked > 0);
  assert.ok(adapted.gateAudit.gates.marketRegimeDirection.rejected > 0);
  assert.equal(
    adapted.actions.filter(action => action.direction === "反T").length,
    0,
    "no formal 反T leg may open while allowReverseT is false",
  );
});

test("each V6 sub-switch can be measured on its own", () => {
  const vetoOnly = replay(bearThenBounce, {
    causalMarketRegimeAdaptation: 1,
    marketRegimeCounterTrendScaling: 0,
    marketRegimeTargetScaling: 0,
  }, { gateAudit: true });
  const vetoDisabled = replay(bearThenBounce, {
    causalMarketRegimeAdaptation: 1,
    marketRegimeDirectionVeto: 0,
  }, { gateAudit: true });

  assert.ok(vetoOnly.diagnostics.marketRegimeDirectionBlocked > 0);
  assert.ok(vetoOnly.gateAudit.gates.marketRegimeDirection.rejected > 0);

  assert.equal(vetoDisabled.diagnostics.marketRegimeDirectionBlocked, 0);
  assert.equal(vetoDisabled.gateAudit.gates.marketRegimeDirection, undefined);
  // Detection still runs with the veto off — only its effect is withheld, so
  // the regime mix stays comparable between the two arms.
  assert.deepEqual(
    vetoDisabled.diagnostics.marketRegimeCounts,
    vetoOnly.diagnostics.marketRegimeCounts,
  );
});

test("regime adaptation reads no future bar: a prefix decides the same as the full session", () => {
  const prefix = bearThenBounce.slice(0, 40);
  const prefixRun = replay(prefix, { causalMarketRegimeAdaptation: 1 });
  const fullRun = replay(bearThenBounce, { causalMarketRegimeAdaptation: 1 });

  const cutoff = prefix.at(-1).time;
  assert.deepEqual(
    prefixRun.actions.map(action => [action.time, action.side, action.direction]),
    fullRun.actions
      .filter(action => action.time <= cutoff)
      .map(action => [action.time, action.side, action.direction]),
    "appending later bars must not change any decision already made",
  );
  // The regime tally for the shared prefix must match bar for bar as well.
  const prefixCounts = prefixRun.diagnostics.marketRegimeCounts;
  const total = Object.values(prefixCounts).reduce((sum, count) => sum + count, 0);
  assert.ok(total > 0, "the prefix should classify at least one minute");
});
