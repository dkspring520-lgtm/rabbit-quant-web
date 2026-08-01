import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveBacktestStrategyExperiment,
  resolveZijinStrategyExperiment,
  ZIJIN_STRATEGY_EXPERIMENTS,
  ZIJIN_STRATEGY_EXPERIMENT_IDS,
} from "../lib/zijin-strategy-experiments.mjs";

test("only formal and closure error-audit modes remain available", () => {
  assert.deepEqual(ZIJIN_STRATEGY_EXPERIMENT_IDS, ["formal-v4", "closure-first"]);
  assert.deepEqual(Object.keys(ZIJIN_STRATEGY_EXPERIMENTS), ["formal-v4", "closure-first"]);
  assert.equal(resolveZijinStrategyExperiment("601899", "high-coverage").id, "formal-v4");
  assert.equal(resolveBacktestStrategyExperiment("601899", "dynamic-sizing").id, "formal-v4");
});

test("non-Zijin live monitoring always remains on formal V4", () => {
  assert.equal(resolveZijinStrategyExperiment("601012", "closure-first").id, "formal-v4");
});

test("closure mode audits obvious errors instead of optimizing win rate", () => {
  const zijin = resolveZijinStrategyExperiment("601899", "closure-first");
  const generic = resolveBacktestStrategyExperiment("300750", "closure-first");

  assert.equal(zijin.errorAuditPriority, true);
  assert.equal(zijin.reference, null);
  assert.equal(zijin.positionSizeMode, "fixed");
  assert.equal(zijin.profileOverrides.hardTrendContinuationGate, 0);
  assert.equal(zijin.profileOverrides.obviousDirectionalErrorGate, 1);
  assert.equal(zijin.profileOverrides.adaptiveTimeExit, 1);
  assert.equal(zijin.profileOverrides.timeExitMinutes, 18);
  assert.equal(zijin.profileOverrides.adaptiveMaxHoldMinutes, 48);
  assert.equal(generic.scope, "general-a-share");
  assert.equal(generic.reference, null);
  assert.equal(generic.volatilityMode, "causal-realized");
});
