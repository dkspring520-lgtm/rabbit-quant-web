import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CLOSURE_V2_SHADOW_OBSERVATION_POLICY,
  evaluateClosureV2ShadowObservation,
  resolveBacktestStrategyExperiment,
  resolveZijinStrategyExperiment,
  MEMBER_STRATEGY_EXPERIMENT_IDS,
  resolveResearchStrategyExperiment,
  ZIJIN_RESEARCH_STRATEGY_EXPERIMENT_IDS,
  ZIJIN_RESEARCH_STRATEGY_EXPERIMENTS,
  ZIJIN_601899_PRODUCTION_STRATEGY,
  ZIJIN_STRATEGY_EXPERIMENTS,
  ZIJIN_STRATEGY_EXPERIMENT_IDS,
} from "../lib/zijin-strategy-experiments.mjs";

test("member paths expose the closure engine only", () => {
  assert.deepEqual(MEMBER_STRATEGY_EXPERIMENT_IDS, ["closure-first"]);
  assert.deepEqual(ZIJIN_STRATEGY_EXPERIMENT_IDS, ["closure-first"]);
  assert.deepEqual(Object.keys(ZIJIN_STRATEGY_EXPERIMENTS), ["formal-v4", "closure-first"]);
  assert.equal(resolveZijinStrategyExperiment("601899", "formal-v4").id, "closure-first");
  assert.equal(resolveBacktestStrategyExperiment("601899", "formal-v4").id, "closure-first");
  assert.equal(resolveZijinStrategyExperiment("601899", "closure-v2-shadow").id, "closure-first");
  assert.equal(resolveBacktestStrategyExperiment("601899", "closure-v2-shadow").id, "closure-first");
});

test("closure V2 is available only through the explicit Zijin research resolver", () => {
  assert.deepEqual(ZIJIN_RESEARCH_STRATEGY_EXPERIMENT_IDS, ["closure-v2-shadow"]);
  assert.deepEqual(Object.keys(ZIJIN_RESEARCH_STRATEGY_EXPERIMENTS), ["closure-v2-shadow"]);

  const shadow = resolveResearchStrategyExperiment("601899", "closure-v2-shadow");
  assert.equal(shadow.id, "closure-v2-shadow");
  assert.equal(shadow.researchOnly, true);
  assert.equal(shadow.shadowOnly, true);
  assert.equal(shadow.promotionEligible, false);
  assert.equal(shadow.profileOverrides.precisionEntryWindows, 1);
  assert.equal(shadow.profileOverrides.maxSellEntryTime, "1110");
  assert.equal(shadow.profileOverrides.minBuyExecutionConfirmationVotes, 3);
  assert.equal(shadow.profileOverrides.minSellExecutionConfirmationVotes, 3);
  assert.equal(shadow.profileOverrides.minSellFormalPivotAge, 2);
  assert.equal(shadow.profileOverrides.maxSellTrendRiskVotes, 1);
  assert.equal(shadow.profileOverrides.hardSellEntryTimingGate, 1);
  assert.equal(shadow.profileOverrides.requireRapidRiseSellConfirmation, 1);
  assert.equal(shadow.profileOverrides.requireEarlyOpeningRiskL2, 1);
  assert.equal(shadow.profileOverrides.softStopPct, 0.4);
  assert.equal(shadow.profileOverrides.softStopMinutes, 14);
  assert.equal(shadow.profileOverrides.trailActivationPct, 1.2);
  assert.equal(shadow.profileOverrides.trailMinNetPct, 0.4);
  assert.equal(shadow.profileOverrides.trailRetracePct, 0.3);
  assert.equal(shadow.executionPolicy.minimumCostCoverageMultiple, 2);
  assert.equal(shadow.executionPolicy.weakSignalMode, "observation-only");
  assert.equal(shadow.executionPolicy.positionSizeMode, "fixed");
  assert.deepEqual(shadow.executionPolicy.primaryObjectives, ["after-cost-net", "profit-factor", "max-drawdown"]);
  assert.deepEqual(shadow.executionPolicy.secondaryObjectives, ["win-rate"]);
  assert.equal(shadow.observationPolicy, CLOSURE_V2_SHADOW_OBSERVATION_POLICY);
  assert.equal(resolveResearchStrategyExperiment("601012", "closure-v2-shadow").id, "closure-first");
});

test("closure V2 shadow observation targets 35 percent without forcing a quota", () => {
  const policy = CLOSURE_V2_SHADOW_OBSERVATION_POLICY;
  assert.equal(policy.targetCandidatePromotionRate, 0.35);
  assert.deepEqual(policy.acceptablePromotionRate, {minimum: 0.30, maximum: 0.40});
  assert.equal(policy.minimumTradingDays, 60);
  assert.equal(policy.minimumResolvedTrades, 100);
  assert.equal(policy.minimumAfterCostWinRate, 0.55);
  assert.equal(policy.minimumStress5BpsWinRate, 0.55);
  assert.equal(policy.stressSlippageBpsPerSide, 5);
  assert.equal(policy.minimumProfitFactor, 1.2);
  assert.equal(policy.requiresDailyTrade, false);
  assert.equal(policy.forcePromotionQuota, false);
  assert.equal(policy.automaticPromotion, false);
  assert.equal(policy.affectsProduction, false);
  assert.equal(policy.sendsAlerts, false);
  assert.ok(policy.directionEvidence.positiveT.includes("sell-pressure-decelerating"));
  assert.ok(policy.directionEvidence.positiveT.includes("bid-support-improving"));

  const qualified = evaluateClosureV2ShadowObservation({
    candidates: 200,
    promotedCandidates: 70,
    tradingDays: 60,
    resolvedTrades: 100,
    afterCostWinRate: 0.58,
    stress5BpsWinRate: 0.56,
    profitFactor: 1.24,
  });
  assert.equal(qualified.promotionRate, 0.35);
  assert.equal(qualified.sampleReady, true);
  assert.equal(qualified.readyForManualReview, true);
  assert.equal(qualified.status, "manual-review");
  assert.equal(qualified.forcedPromotions, 0);

  const sparseButProfitable = evaluateClosureV2ShadowObservation({
    candidates: 200,
    promotedCandidates: 40,
    tradingDays: 60,
    resolvedTrades: 100,
    afterCostWinRate: 0.62,
    stress5BpsWinRate: 0.57,
    profitFactor: 1.35,
  });
  assert.equal(sparseButProfitable.qualityReady, true);
  assert.equal(sparseButProfitable.gates.promotionRate, false);
  assert.equal(sparseButProfitable.status, "observe-promotion-rate");
  assert.equal(sparseButProfitable.forcedPromotions, 0);
  assert.equal(sparseButProfitable.affectsProduction, false);
  assert.equal(sparseButProfitable.sendsAlerts, false);

  const tooFewDays = evaluateClosureV2ShadowObservation({
    candidates: 200,
    promotedCandidates: 70,
    tradingDays: 59,
    resolvedTrades: 120,
    afterCostWinRate: 0.62,
    stress5BpsWinRate: 0.57,
    profitFactor: 1.35,
  });
  assert.equal(tooFewDays.gates.tradingDays, false);
  assert.equal(tooFewDays.gates.resolvedTrades, true);
  assert.equal(tooFewDays.sampleReady, false);
  assert.equal(tooFewDays.readyForManualReview, false);
});

test("non-Zijin monitoring also resolves to the member closure engine", () => {
  assert.equal(resolveZijinStrategyExperiment("601012", "formal-v4").id, "closure-first");
  assert.equal(resolveBacktestStrategyExperiment("601012", "formal-v4").id, "closure-first");
});

test("Zijin production uses the dedicated causal study mapping", () => {
  const zijin = resolveZijinStrategyExperiment("601899", "closure-first");
  const generic = resolveBacktestStrategyExperiment("300750", "closure-first");

  assert.equal(zijin, ZIJIN_601899_PRODUCTION_STRATEGY);
  assert.equal(zijin.scope, "zijin-601899");
  assert.equal(zijin.errorAuditPriority, true);
  assert.equal(zijin.reference, null);
  assert.equal(zijin.positionSizeMode, "fixed");
  assert.equal(zijin.profileOverrides.hardTrendContinuationGate, 0);
  assert.equal(zijin.profileOverrides.obviousDirectionalErrorGate, 1);
  assert.equal(zijin.profileOverrides.causalTrendCorrectionRequireAlignedTurn, 1);
  assert.equal(zijin.profileOverrides.minBuyPriceMomentum30, 0.4);
  assert.equal(zijin.profileOverrides.deviation, 0.55);
  assert.equal(zijin.profileOverrides.reversal, 0.07);
  assert.equal(zijin.profileOverrides.precisionEntryWindows, 1);
  assert.equal(zijin.profileOverrides.maxSellEntryTime, "1100");
  assert.equal(zijin.profileOverrides.minBuyExecutionConfirmationVotes, 3);
  assert.equal(zijin.profileOverrides.minSellExecutionConfirmationVotes, 3);
  assert.equal(zijin.profileOverrides.maxBuyTrendRiskVotes, 0);
  assert.equal(zijin.profileOverrides.maxSellTrendRiskVotes, 1);
  assert.equal(zijin.profileOverrides.hardSellEntryTimingGate, 1);
  assert.equal(zijin.profileOverrides.requireRapidRiseSellConfirmation, 1);
  assert.equal(zijin.profileOverrides.requireEarlyOpeningRiskL2, 1);
  assert.equal(zijin.profileOverrides.adaptiveTimeExit, 0);
  assert.equal(zijin.profileOverrides.timeExitMinutes, 60);
  assert.equal(zijin.profileOverrides.adaptiveMaxHoldMinutes, 60);
  assert.equal(zijin.profileOverrides.adaptiveProtectIntactLoss, 0);
  assert.equal(zijin.profileOverrides.minBuyFormalPivotAge, 2);
  assert.equal(zijin.profileOverrides.minSellFormalPivotAge, 2);
  assert.equal(zijin.profileOverrides.minBuyVolumeRatio, 0.35);
  assert.equal(zijin.researchReference.source, "zijin-special-strategy-study-20260809");
  assert.equal(generic.scope, "general-a-share");
  assert.equal(generic.reference, null);
  assert.equal(generic.volatilityMode, "causal-realized");
});

test("general closure replay stays separate from the Zijin production mapping", () => {
  const zijin = resolveBacktestStrategyExperiment("601899", "closure-first");
  const generic = resolveBacktestStrategyExperiment("000001", "closure-first");

  assert.equal(zijin.profileOverrides.minBuyExecutionConfirmationVotes, 3);
  assert.equal(zijin.profileOverrides.minSellExecutionConfirmationVotes, 3);
  assert.equal(generic.profileOverrides.minBuyExecutionConfirmationVotes, 4);
  assert.equal(generic.profileOverrides.minSellExecutionConfirmationVotes, 4);
  assert.equal(generic.profileOverrides.deviation, 0.42);
  assert.equal(generic.profileOverrides.reversal, 0.06);
  assert.equal(generic.scope, "general-a-share");
  assert.notEqual(generic.profileOverrides, zijin.profileOverrides);
});

test("production replay, live desk, and background scanner stay on closure-first", () => {
  const page = readFileSync(new URL("../app/authenticated-app.tsx", import.meta.url), "utf8");
  const controlPlane = readFileSync(new URL("../server/control-plane.mjs", import.meta.url), "utf8");

  assert.match(page, /resolveBacktestStrategyExperiment\(stock\?\.code,"closure-first"\)/);
  assert.match(page, /resolveBacktestStrategyExperiment\(code,"closure-first"\)/);
  assert.match(page, /resolveBacktestStrategyExperiment\(item\.code,"closure-first"\)/);
  assert.match(page, /strategyVersion:"closure-first"/);
  assert.match(page, /闭环已固定/);
  assert.match(controlPlane, /resolveBacktestStrategyExperiment\(monitor\.code, "closure-first"\)/);
  assert.match(controlPlane, /profileOverrides: experiment\.profileOverrides/);
});
