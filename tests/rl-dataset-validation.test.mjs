import assert from "node:assert/strict";
import test from "node:test";
import { auditRLDataset, buildRLDatasetQualityReport, evaluateBaseline } from "../lib/rl-research/index.mjs";

const rows = [
  { state: { symbol: "600000", timestamp: "2026-01-01T09:30:00Z", price: 10, volume: 100, vwap: 10, trend: "UP", volatility: .01, sentiment: "neutral", factorFeatures: {}, position: {}, cash: {} }, positionDelta: 1, futureReturnRate: .02, reward: .01 },
  { state: { symbol: "600000", timestamp: "2026-01-01T09:31:00Z", price: 10, volume: 100, vwap: 10, trend: "DOWN", volatility: .01, sentiment: "neutral", factorFeatures: {}, position: {}, cash: {} }, positionDelta: -1, futureReturnRate: -.01, reward: -.02 },
];
test("dataset audit reports coverage and distributions", () => { const report = auditRLDataset(rows); assert.equal(report.sampleCount, 2); assert.equal(report.symbolCount, 1); assert.equal(report.stateMissingRate.volume, 0); assert.equal(report.actionDistribution[1], 1); });
test("baseline evaluator returns comparable metrics", () => { const result = evaluateBaseline(rows, row => row.positionDelta); assert.equal(result.tradeCount, 2); assert.equal(result.winRate, 1); assert.ok(result.maxDrawdown >= 0); });
test("quality report remains research-only", () => { const report = buildRLDatasetQualityReport(rows); assert.equal(report.trainingPerformed, false); assert.equal(report.executable, false); assert.ok(report.baselines.alwaysWait); });
