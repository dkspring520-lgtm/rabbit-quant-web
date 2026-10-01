import assert from "node:assert/strict";
import test from "node:test";
import { DecisionFusionEngine } from "../lib/paper-trading/index.mjs";

const engine = new DecisionFusionEngine({ modelVersion: "m1" });
test("conflicting strategies preserve support and opposition", () => { const result = engine.decide([{ strategyId: "trend", action: "BUY", confidence: .9, reason: "趋势向上", timestamp: "10:00", dimension: "trend" }, { strategyId: "sentiment", action: "SELL_PART", confidence: .6, reason: "情绪偏弱", timestamp: "10:00", dimension: "sentiment" }]); assert.equal(result.finalDecision, "BUY"); assert.deepEqual(result.supportingReasons, ["趋势向上"]); assert.deepEqual(result.opposingReasons, ["情绪偏弱"]); });
test("confidence is deterministic and bounded", () => { const signals = [{ strategyId: "a", action: "BUY", confidence: .8, reason: "a", timestamp: "1" }, { strategyId: "b", action: "BUY", confidence: .7, reason: "b", timestamp: "1" }]; const first = engine.decide(signals); assert.deepEqual(first, engine.decide(signals)); assert.ok(first.confidence >= 0 && first.confidence <= 1); });
test("position sizing maps partial and full sell", () => { assert.equal(engine.decide([{ strategyId: "x", action: "SELL_PART", confidence: 1, reason: "减仓", timestamp: "1" }]).positionRatio, .25); assert.equal(engine.decide([{ strategyId: "x", action: "SELL_ALL", confidence: 1, reason: "清仓", timestamp: "1" }]).positionRatio, 1); });
test("empty or invalid signals wait without side effects", () => { const result = engine.decide([{ strategyId: "bad", action: "NOPE", confidence: 2, reason: "x" }]); assert.equal(result.finalDecision, "WAIT"); assert.equal(result.canAutoTrade, false); assert.equal(result.affectsPaperExecution, false); });
