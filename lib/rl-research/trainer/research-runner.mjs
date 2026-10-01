import { buildRLState } from "../state/state-builder.mjs";
import { calculateRLReward } from "../reward/reward-function.mjs";
import { RLShadowAgent } from "../agent/rl-agent.mjs";
export function runRLShadowResearch(rows = [], { agent = new RLShadowAgent(), rewardWeights = {} } = {}) { return (Array.isArray(rows) ? rows : []).map(row => { const state = buildRLState(row); const suggestion = agent.suggest(state); return Object.freeze({ state, action: suggestion.action, modelVersion: suggestion.modelVersion, reward: calculateRLReward({ tradeProfit: row.tradeProfit, fees: row.fees, slippage: row.slippage, drawdown: row.drawdown, overtrade: row.overtrade, invalid: row.invalid, weights: rewardWeights }), result: row.result ?? null, shadowOnly: true }); }); }
