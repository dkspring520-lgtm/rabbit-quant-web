import { buildRLState } from "../state/state-builder.mjs";
import { calculateRLReward } from "../reward/reward-function.mjs";
import { normalizePositionDeltaAction } from "../action/action-space.mjs";
import { calculateRateReward } from "../reward/reward-function.mjs";

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
const actionLabel = value => ({ 1: "BUY", 0.5: "BUY_SMALL", 0: "WAIT", "-0.25": "SELL_PART", "-1": "SELL_ALL" })[value] ?? "WAIT";

export function buildOfflineRLDataset(rows = [], { expertAction = defaultExpertAction, rewardWeights = {} } = {}) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const state = buildRLState(row);
    const action = normalizePositionDeltaAction(expertAction(row, state));
    const futureReturn = finite(row.futureReturn ?? row.future5mReturn ?? row.sample?.future5mReturn);
    const reward = calculateRateReward({ futureReturnRate: futureReturn, feeRate: row.feeRate ?? row.fees ?? 0, slippageRate: row.slippageRate ?? row.slippage ?? 0, drawdownRate: row.drawdownRate ?? row.drawdown ?? 0, tradePenalty: row.tradePenalty ?? row.overtrade ?? 0, invalid: row.invalid });
    return Object.freeze({ sampleId: String(row.sampleId ?? `rl-${index}`), state, positionDelta: action, expertAction: actionLabel(action), futureReturnRate: futureReturn, futureReturn, reward, result: row.result ?? null, source: row.source ?? "historical-replay", modelVersion: row.modelVersion ?? "", datasetVersion: row.datasetVersion ?? "", shadowOnly: true, executable: false });
  });
}

export function buildRLDatasetReport(dataset = []) {
  const rows = Array.isArray(dataset) ? dataset : [];
  const distribution = values => { const finiteValues = values.map(Number).filter(Number.isFinite); return { count: finiteValues.length, min: finiteValues.length ? Math.min(...finiteValues) : null, max: finiteValues.length ? Math.max(...finiteValues) : null, average: finiteValues.length ? finiteValues.reduce((a, b) => a + b, 0) / finiteValues.length : null }; };
  const states = {}; const actions = {}; for (const row of rows) { const trend = row.state?.trend ?? "unknown"; states[trend] = (states[trend] ?? 0) + 1; const action = row.positionDelta ?? row.expertAction; actions[action] = (actions[action] ?? 0) + 1; const label = row.expertAction ?? actionLabel(action); actions[label] = (actions[label] ?? 0) + 1; }
  return { sampleCount: rows.length, stateDistribution: states, actionDistribution: actions, futureReturnDistribution: distribution(rows.map(row => row.futureReturn)), rewardDistribution: distribution(rows.map(row => row.reward)), trainingPerformed: false, executable: false };
}
