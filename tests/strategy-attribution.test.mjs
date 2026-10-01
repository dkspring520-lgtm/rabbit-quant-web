import assert from "node:assert/strict";
import test from "node:test";
import { DecisionFusionEngine, buildStrategyContributions, summarizeStrategyContributions } from "../lib/paper-trading/index.mjs";

const signals = [{ strategyId: "trend", action: "BUY", score: 80, confidence: .8, reason: "趋势" }, { strategyId: "sentiment", action: "SELL_PART", score: 60, confidence: .6, reason: "情绪" }];
test("multiple strategy contributions preserve support and opposition", () => { const result = new DecisionFusionEngine().decide(signals, { decisionId: "d1" }); assert.equal(result.contributions.length, 2); assert.equal(result.contributions[0].decisionId, "d1"); assert.equal(result.supportingReasons[0], "趋势"); assert.equal(result.opposingReasons[0], "情绪"); });
test("contribution weights normalize to one", () => { const rows = buildStrategyContributions(signals); assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.weight, 0) - 1) < 1e-6); });
test("historical contribution summary remains compatible with samples", () => { const rows = buildStrategyContributions([{ strategyId: "trend", action: "BUY", confidence: 1 }]); const report = summarizeStrategyContributions(rows, [{ strategyIds: ["trend"], pnl: .02 }]); assert.equal(report.trend.signalCount, 1); assert.equal(report.trend.winRate, 1); });
