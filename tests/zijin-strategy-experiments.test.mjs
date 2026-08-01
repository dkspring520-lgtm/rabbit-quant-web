import test from "node:test";
import assert from "node:assert/strict";

import { resolveReplayPositionSize } from "../lib/smart-t-engine.mjs";
import { resolveZijinStrategyExperiment, ZIJIN_STRATEGY_EXPERIMENTS } from "../lib/zijin-strategy-experiments.mjs";

test("non-Zijin stocks always remain on formal V4", () => {
  assert.equal(resolveZijinStrategyExperiment("601012", "high-coverage").id, "formal-v4");
  assert.equal(resolveZijinStrategyExperiment("300750", "dynamic-sizing").experimental, false);
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
