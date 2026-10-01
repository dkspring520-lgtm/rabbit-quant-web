import assert from "node:assert/strict";
import test from "node:test";
import { fuseSignals } from "../lib/signal-fusion.mjs";
import { adaptFactorResearchSignal, adaptMarketRegimeSignal, adaptSmartTSignal, adaptStrategySignals, adaptZijinOrderFlowSignal, adaptZijinShadowSignal } from "../lib/strategy-adapters.mjs";

const base = { symbol: "601899", timestamp: "2026-10-01T10:00:00+08:00", score: 80, confidence: .8, reason: "确认" };
test("all strategy adapters emit the same StrategySignal protocol", () => { const signals = [adaptSmartTSignal({ ...base, action: "buy" }), adaptFactorResearchSignal({ ...base, action: "BUY" }), adaptZijinOrderFlowSignal({ ...base, direction: "buy" }), adaptZijinShadowSignal({ ...base, signal: "positive" }), adaptMarketRegimeSignal({ ...base, action: "BUY" })]; for (const signal of signals) assert.deepEqual(Object.keys(signal).sort(), ["action", "confidence", "factorSnapshot", "marketRegime", "reason", "score", "sentimentState", "strategyId", "symbol", "timestamp"].sort()); });
test("fusion accepts mixed adapters and preserves conflict", () => { const result = fuseSignals([adaptSmartTSignal({ ...base, action: "BUY", group: "trend" }), adaptZijinShadowSignal({ ...base, action: "SELL", group: "shadow" })]); assert.equal(result.direction, "wait"); assert.equal(result.conflict, "中"); });
test("adapter output and fusion are deterministic", () => { const raw = [{ ...base, action: "BUY" }, { ...base, action: "SELL", score: 60 }]; assert.deepEqual(adaptStrategySignals(raw), adaptStrategySignals(raw)); assert.deepEqual(fuseSignals(adaptStrategySignals(raw)), fuseSignals(adaptStrategySignals(raw))); });
test("score ordering is preserved in normalized signals", () => { const [high, low] = adaptStrategySignals([{ ...base, action: "BUY", score: 90 }, { ...base, action: "SELL", score: 40 }]); assert.equal(high.score, 90); assert.equal(low.score, 40); });
