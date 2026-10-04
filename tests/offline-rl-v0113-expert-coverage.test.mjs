import assert from "node:assert/strict";
import test from "node:test";
import { emptyActionCounts, classifyRegime, incrementAction, deterministicHash, actionSpaceResearch, coverageConclusion } from "../lib/rl-research/dataset/expert-coverage-analysis-v0113.mjs";
test("action support and zero-action classification are explicit", () => { const counts = emptyActionCounts(); incrementAction(counts, "WAIT"); assert.equal(coverageConclusion(counts).buy, "SIGNAL_NEVER_GENERATED_IN_COVERAGE"); assert.throws(() => incrementAction(counts, "UNKNOWN"), /INVALID_ACTION/); });
test("regime labels use causal market-state fields", () => { const regime = classifyRegime({ features: { return_5m: 0.01, rolling_return_std_20: 0.004, price_vs_session_vwap: 0.02 } }); assert.deepEqual(regime, { trend: "UPTREND", volatility: "HIGH_VOLATILITY", range: "BREAKOUT_OR_DISLOCATION" }); });
test("alternative action schemas preserve T+1 constraints", () => { const schemas = actionSpaceResearch(); assert.match(schemas.targetPosition.tPlusOne, /sellablePosition/); assert.match(schemas.positionDelta.tPlusOne, /sellablePosition/); });
test("analysis hash is deterministic", () => { const value = { WAIT: 10, BUY_SMALL: 2, BUY: 0, SELL_PART: 0, SELL_ALL: 1 }; assert.equal(deterministicHash(value), deterministicHash(value)); });
