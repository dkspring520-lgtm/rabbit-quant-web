import { buildRLState } from "../state/state-builder.mjs";
import { calculateRLReward } from "../reward/reward-function.mjs";
import { normalizeRLAction } from "../action/action-space.mjs";

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

function defaultExpertAction(row) {
  // Preserve the deterministic strategy outputs as labels only. These values
  // are never sent to PaperExecutionEngine or used to execute an order.
  return row.expertAction
    ?? row.smartT?.action
    ?? row.smartT?.side
    ?? row.smartTAction
    ?? row.tradingDecision?.finalDecision
    ?? row.decision?.finalDecision
    ?? row.action
    ?? row.side
    ?? "WAIT";
}

export function buildOfflineRLDataset(rows = [], { expertAction = defaultExpertAction, rewardWeights = {} } = {}) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const state = buildRLState(row);
    const action = normalizeRLAction(expertAction(row, state));
    const futureReturn = finite(row.futureReturn ?? row.future5mReturn ?? row.sample?.future5mReturn);
    const reward = calculateRLReward({ tradeProfit: row.tradeProfit ?? futureReturn, fees: row.fees, slippage: row.slippage, drawdown: row.drawdown, overtrade: row.overtrade, invalid: row.invalid, weights: rewardWeights });
    return Object.freeze({ sampleId: String(row.sampleId ?? `rl-${index}`), state, expertAction: action, futureReturn, reward, result: row.result ?? null, source: row.source ?? "historical-replay", modelVersion: row.modelVersion ?? "", datasetVersion: row.datasetVersion ?? "", shadowOnly: true, executable: false });
  });
}

export function buildRLDatasetReport(dataset = []) {
  const rows = Array.isArray(dataset) ? dataset : [];
  const distribution = values => { const finiteValues = values.map(Number).filter(Number.isFinite); return { count: finiteValues.length, min: finiteValues.length ? Math.min(...finiteValues) : null, max: finiteValues.length ? Math.max(...finiteValues) : null, average: finiteValues.length ? finiteValues.reduce((a, b) => a + b, 0) / finiteValues.length : null }; };
  const states = {}; const actions = {}; for (const row of rows) { const trend = row.state?.trend ?? "unknown"; states[trend] = (states[trend] ?? 0) + 1; actions[row.expertAction] = (actions[row.expertAction] ?? 0) + 1; }
  return { sampleCount: rows.length, stateDistribution: states, actionDistribution: actions, futureReturnDistribution: distribution(rows.map(row => row.futureReturn)), rewardDistribution: distribution(rows.map(row => row.reward)), trainingPerformed: false, executable: false };
}
