import { buildRLState } from "../state/state-builder.mjs";
import { calculateRLReward } from "../reward/reward-function.mjs";
import { normalizeRLAction } from "../action/action-space.mjs";

export function generateStateActionDataset(rows = [], { actionSource = row => row.action ?? "WAIT", rewardWeights = {} } = {}) {
  return (Array.isArray(rows) ? rows : []).map(row => {
    const state = buildRLState(row);
    const action = normalizeRLAction(actionSource(row, state));
    const reward = calculateRLReward({ tradeProfit: row.tradeProfit, fees: row.fees, slippage: row.slippage, drawdown: row.drawdown, overtrade: row.overtrade, invalid: row.invalid, weights: rewardWeights });
    return Object.freeze({ state, action, reward, result: row.result ?? null, shadowOnly: true, executable: false });
  });
}
