import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMatureZijinL2Labels,
  buildZijinL2Observation,
  buildZijinRepairObservation,
  decideZijinL2Append,
  summarizeZijinL2Audit,
} from "../lib/zijin-l2-event-ledger.mjs";

function evaluation(state, time = "0940") {
  return {
    ready: true,
    asOfTime: time,
    score: 81,
    side: "buy",
    netNotional: 2_000_000,
    activeNetNotional: 1_500_000,
    stateMachine: {
      state,
      side: "buy",
      eventTime: "0938",
      ageMinutes: 2,
      costPrice: 31,
      triggerPrice: state === "positive-t-confirmed" ? 31.1 : null,
      pricePushPct: 0.2,
      pullbackPct: 0.08,
    },
  };
}

test("L2 event ledger suppresses duplicate states and state churn", () => {
  const first = buildZijinL2Observation({
    evaluation: evaluation("waiting-pullback"),
    structure: { directionScore: 20, vwap: 31 },
    exchangeMinute: "20260728-094000000",
  });
  assert.equal(decideZijinL2Append([], first).append, true);
  assert.equal(decideZijinL2Append([first], first).reason, "duplicate-state");
  const sameStage = buildZijinL2Observation({
    evaluation: evaluation("waiting-retest", "0941"),
    structure: {},
    exchangeMinute: "20260728-094100000",
  });
  assert.equal(decideZijinL2Append([first], sameStage).reason, "same-stage-churn");
  const confirmed = buildZijinL2Observation({
    evaluation: evaluation("positive-t-confirmed", "0942"),
    structure: {},
    exchangeMinute: "20260728-094200000",
  });
  assert.equal(decideZijinL2Append([first], confirmed).append, true);
});

test("labels are delayed, horizon-specific, and never use future data early", () => {
  const observation = buildZijinL2Observation({
    evaluation: evaluation("positive-t-confirmed"),
    structure: {},
    exchangeMinute: "20260728-094000000",
  });
  const early = Array.from({ length: 5 }, (_, index) => ({
    exchangeMinute: `20260728-09${String(40 + index).padStart(2, "0")}`,
    price: 31.1 + index * 0.02,
  }));
  assert.equal(buildMatureZijinL2Labels({ observations: [observation], minutes: early }).length, 0);
  const mature = Array.from({ length: 31 }, (_, index) => ({
    exchangeMinute: `20260728-${String(9 + Math.floor((40 + index) / 60)).padStart(2, "0")}${String((40 + index) % 60).padStart(2, "0")}`,
    price: 31.1 + index * 0.02,
  }));
  const labels = buildMatureZijinL2Labels({ observations: [observation], minutes: mature });
  assert.deepEqual(labels.map(item => item.horizonMinutes), [5, 15, 30]);
  assert.ok(labels.every(item => item.causal));
});

test("thresholds stay frozen before evidence gate", () => {
  const summary = summarizeZijinL2Audit({ observations: [], labels: [] });
  assert.equal(summary.readiness.ready, false);
  assert.equal(summary.thresholdRecommendation, "keep-current-thresholds");
  assert.equal(summary.automaticPromotion, false);
});

test("a repair candidate enters the same causal 5/15/30-minute label ledger", () => {
  const observation = buildZijinRepairObservation({
    repair: {
      status: "candidate",
      candidateKey: "601899:1109:repair",
      score: 88,
      asOfTime: "1113",
      metrics: {
        price: 31.34,
        secondLow: { time: "1109", price: 31.19 },
        vwap: 31.35,
        vwapBiasPct: -0.03,
        deepestBiasPct: -0.65,
        momentum3Pct: 0.45,
        pullbackVolumeRatio: 0.65,
        activeBuyRatio: 0.56,
        breakoutPrice: 31.29,
      },
      checks: { secondBottom: true, l2BuyRecovery: true, localBreakout: true },
      hardConditions: { afterStart: true, deepVwapDiscount: true },
    },
    exchangeMinute: "20260728-1113",
  });
  assert.equal(observation.state, "repair-confirmed");
  assert.equal(observation.side, "buy");
  assert.equal(observation.decisionMinute, "202607281113");
  assert.equal(decideZijinL2Append([], observation).append, true);

  const minutes = Array.from({ length: 31 }, (_, index) => ({
    exchangeMinute: `20260728-${String(11 + Math.floor((13 + index) / 60)).padStart(2, "0")}${String((13 + index) % 60).padStart(2, "0")}`,
    price: 31.34 + index * 0.01,
  }));
  const labels = buildMatureZijinL2Labels({ observations: [observation], minutes });
  assert.deepEqual(labels.map(item => item.horizonMinutes), [5, 15, 30]);
});

test("probabilities remain hidden until each horizon has enough forward samples", () => {
  const collecting = summarizeZijinL2Audit({
    observations: [],
    labels: [{ horizonMinutes: 5, marketDate: "20260728", netDirectionalWin: true }],
  });
  assert.equal(collecting.calibrationByHorizon["5m"].calibratedWinProbability, null);
  assert.equal(collecting.calibrationByHorizon["5m"].status, "collecting-forward-samples");
});
