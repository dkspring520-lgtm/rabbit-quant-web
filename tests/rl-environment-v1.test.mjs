import assert from "node:assert/strict";
import test from "node:test";
import { TTradingEnvironment } from "../lib/rl-research/index.mjs";
import { generateStateActionDataset } from "../lib/rl-research/index.mjs";

const session = { date: "20260930", minutes: [{ time: "1000", price: 10, volume: 100 }, { time: "1001", price: 10.1, volume: 120 }] };
test("environment reset step and getState are research-only", () => { const env = new TTradingEnvironment({ symbol: "601899", session, initialCash: 10000 }); const state = env.reset(); assert.equal(state.symbol, "601899"); assert.deepEqual(env.getState(), state); const result = env.step({ action: "WAIT", quantity: 0 }); assert.equal(result.done, false); assert.equal(env.step({ action: "WAIT", quantity: 0 }).done, true); assert.ok(env.getState()); });
test("environment calculateReward applies costs and drawdown penalty", () => { const env = new TTradingEnvironment({ symbol: "601899", session, initialCash: 10000 }); env.reset(); assert.equal(env.calculateReward({ status: "filled", fee: 1, slippage: 1 }, { drawdownPenalty: 2 }), -4); });
test("dataset generator emits serializable state action result rows", () => { const rows = generateStateActionDataset([{ symbol: "601899", timestamp: "10:00", price: 10, action: "BUY", tradeProfit: 2, fees: 1, result: { filled: false } }]); assert.equal(rows[0].action, "BUY"); assert.equal(rows[0].reward, 1); assert.equal(rows[0].shadowOnly, true); assert.doesNotThrow(() => JSON.stringify(rows)); });
