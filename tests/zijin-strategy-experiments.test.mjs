import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  resolveBacktestStrategyExperiment,
  resolveZijinStrategyExperiment,
  MEMBER_STRATEGY_EXPERIMENT_IDS,
  ZIJIN_STRATEGY_EXPERIMENTS,
  ZIJIN_STRATEGY_EXPERIMENT_IDS,
} from "../lib/zijin-strategy-experiments.mjs";

test("member paths expose the closure engine only", () => {
  assert.deepEqual(MEMBER_STRATEGY_EXPERIMENT_IDS, ["closure-first"]);
  assert.deepEqual(ZIJIN_STRATEGY_EXPERIMENT_IDS, ["closure-first"]);
  assert.deepEqual(Object.keys(ZIJIN_STRATEGY_EXPERIMENTS), ["formal-v4", "closure-first"]);
  assert.equal(resolveZijinStrategyExperiment("601899", "formal-v4").id, "closure-first");
  assert.equal(resolveBacktestStrategyExperiment("601899", "formal-v4").id, "closure-first");
});

test("non-Zijin monitoring also resolves to the member closure engine", () => {
  assert.equal(resolveZijinStrategyExperiment("601012", "formal-v4").id, "closure-first");
  assert.equal(resolveBacktestStrategyExperiment("601012", "formal-v4").id, "closure-first");
});

test("closure mode audits obvious errors instead of optimizing win rate", () => {
  const zijin = resolveZijinStrategyExperiment("601899", "closure-first");
  const generic = resolveBacktestStrategyExperiment("300750", "closure-first");

  assert.equal(zijin.errorAuditPriority, true);
  assert.equal(zijin.reference, null);
  assert.equal(zijin.positionSizeMode, "fixed");
  assert.equal(zijin.profileOverrides.hardTrendContinuationGate, 0);
  assert.equal(zijin.profileOverrides.obviousDirectionalErrorGate, 1);
  assert.equal(zijin.profileOverrides.causalTrendCorrectionRequireAlignedTurn, 1);
  assert.equal(zijin.profileOverrides.minBuyPriceMomentum30, 0.4);
  assert.equal(zijin.profileOverrides.maxBuyTrendRiskVotes, 0);
  assert.equal(zijin.profileOverrides.maxSellTrendRiskVotes, 3);
  assert.equal(zijin.profileOverrides.adaptiveTimeExit, 1);
  assert.equal(zijin.profileOverrides.timeExitMinutes, 45);
  assert.equal(zijin.profileOverrides.adaptiveMaxHoldMinutes, 90);
  assert.equal(zijin.profileOverrides.adaptiveProtectIntactLoss, 0);
  assert.equal(zijin.profileOverrides.minBuyFormalPivotAge, 0);
  assert.equal(zijin.profileOverrides.minBuyVolumeRatio, 0.35);
  assert.equal(generic.scope, "general-a-share");
  assert.equal(generic.reference, null);
  assert.equal(generic.volatilityMode, "causal-realized");
});

test("general closure replay requires a completed causal confirmation set", () => {
  const zijin = resolveBacktestStrategyExperiment("601899", "closure-first");
  const generic = resolveBacktestStrategyExperiment("000001", "closure-first");

  assert.equal(zijin.profileOverrides.minBuyExecutionConfirmationVotes, 1);
  assert.equal(zijin.profileOverrides.minSellExecutionConfirmationVotes, 1);
  assert.equal(generic.profileOverrides.minBuyExecutionConfirmationVotes, 4);
  assert.equal(generic.profileOverrides.minSellExecutionConfirmationVotes, 4);
  assert.notEqual(generic.profileOverrides, zijin.profileOverrides);
});

test("production replay, live desk, and background scanner stay on closure-first", () => {
  const page = readFileSync(new URL("../app/authenticated-app.tsx", import.meta.url), "utf8");
  const controlPlane = readFileSync(new URL("../server/control-plane.mjs", import.meta.url), "utf8");

  assert.match(page, /resolveBacktestStrategyExperiment\(stock\?\.code,"closure-first"\)/);
  assert.match(page, /resolveBacktestStrategyExperiment\(code,"closure-first"\)/);
  assert.match(page, /resolveBacktestStrategyExperiment\(item\.code,"closure-first"\)/);
  assert.match(page, /strategyVersion:"closure-first"/);
  assert.match(page, /内置闭环 · 已固定/);
  assert.match(controlPlane, /resolveBacktestStrategyExperiment\(monitor\.code, "closure-first"\)/);
  assert.match(controlPlane, /profileOverrides: experiment\.profileOverrides/);
});
