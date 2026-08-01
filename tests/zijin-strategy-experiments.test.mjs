import test from "node:test";
import assert from "node:assert/strict";

import { resolveReplayPositionSize } from "../lib/smart-t-engine.mjs";
import { resolveBacktestStrategyExperiment, resolveZijinStrategyExperiment, ZIJIN_STRATEGY_EXPERIMENTS } from "../lib/zijin-strategy-experiments.mjs";

test("non-Zijin stocks always remain on formal V4", () => {
  assert.equal(resolveZijinStrategyExperiment("601012", "high-coverage").id, "formal-v4");
  assert.equal(resolveZijinStrategyExperiment("300750", "dynamic-sizing").experimental, false);
});

test("backtests can apply coverage and dynamic sizing to non-Zijin stocks without borrowing Zijin statistics", () => {
  const coverage = resolveBacktestStrategyExperiment("601012", "high-coverage");
  const dynamic = resolveBacktestStrategyExperiment("300750", "dynamic-sizing");
  assert.equal(coverage.id, "high-coverage");
  assert.equal(coverage.scope, "general-a-share");
  assert.equal(coverage.reference, null);
  assert.equal(coverage.volatilityMode, "causal-realized");
  assert.equal(dynamic.positionSizeMode, "liquidity-risk-tiered");
  assert.equal(dynamic.reference, null);
});

test("Zijin experiment profiles preserve hard labels and never claim after-cost graduation", () => {
  const coverage = resolveZijinStrategyExperiment("601899", "high-coverage");
  const dynamic = resolveZijinStrategyExperiment("601899", "dynamic-sizing");
  assert.equal(coverage.profile, "灵敏档");
  assert.equal(coverage.profileOverrides.maxCycles, 2);
  assert.equal(coverage.positionSizeMode, "fixed");
  assert.equal(dynamic.positionSizeMode, "quality-tiered");
  assert.equal(coverage.reference.afterCostPassed, false);
  assert.equal(dynamic.reference.afterCostPassed, false);
  assert.equal(ZIJIN_STRATEGY_EXPERIMENTS["formal-v4"].experimental, false);
});

test("quality-tiered sizing only reduces a causal planned quantity", () => {
  const weak = resolveReplayPositionSize(1600, "quality-tiered", { score: 2, threshold: 2 });
  const medium = resolveReplayPositionSize(1600, "quality-tiered", { score: 3, threshold: 2, structuralConfirmation: true });
  const strong = resolveReplayPositionSize(1600, "quality-tiered", { score: 4, threshold: 2, volumeRatio: 1.2, structuralConfirmation: true, executionMomentumConfirmed: true });
  assert.equal(weak, 100);
  assert.equal(medium, 400);
  assert.equal(strong, 800);
  assert.equal(resolveReplayPositionSize(1600, "fixed", {}), 1600);
  assert.ok(weak <= medium && medium <= strong && strong <= 1600);
});

test("generic dynamic sizing also respects observed liquidity and causal risk", () => {
  const liquid = resolveReplayPositionSize(1600, "liquidity-risk-tiered", {
    score: 4,
    threshold: 2,
    volumeRatio: 1.2,
    minuteVolume: 20000,
    volatilityScale: 0.95,
    structuralConfirmation: true,
    executionMomentumConfirmed: true,
  });
  const thinAndVolatile = resolveReplayPositionSize(1600, "liquidity-risk-tiered", {
    score: 4,
    threshold: 2,
    volumeRatio: 1.2,
    minuteVolume: 3000,
    volatilityScale: 1.25,
    structuralConfirmation: true,
    executionMomentumConfirmed: true,
  });
  assert.equal(liquid, 800);
  assert.equal(thinAndVolatile, 100);
  assert.ok(thinAndVolatile < liquid);
});
