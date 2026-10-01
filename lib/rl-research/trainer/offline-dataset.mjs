import { buildRLState } from "../state/state-builder.mjs";
import { normalizePositionDeltaAction, positionDeltaLabel } from "../action/action-space.mjs";
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

export function buildOfflineRLDataset(rows = [], { expertAction = defaultExpertAction } = {}) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const state = buildRLState(row);
    const action = normalizePositionDeltaAction(expertAction(row, state));
    const rawFutureReturnRate = finite(row.rawFutureReturnRate ?? row.futureReturn ?? row.future5mReturn ?? row.sample?.future5mReturn);
    const actionConditionedReturnRate = action === 0 || rawFutureReturnRate === null ? (action === 0 ? 0 : null) : rawFutureReturnRate * action;
    const reward = calculateRateReward({ futureReturnRate: actionConditionedReturnRate ?? 0, feeRate: row.feeRate, slippageRate: row.slippageRate, drawdownRate: row.drawdownRate, tradePenalty: row.tradePenalty, invalid: row.invalid });
    return Object.freeze({ sampleId: String(row.sampleId ?? `rl-${index}`), state, positionDelta: action, actionLabel: positionDeltaLabel(action), expertAction: positionDeltaLabel(action), rawFutureReturnRate, actionConditionedReturnRate, futureReturnRate: rawFutureReturnRate, futureReturn: rawFutureReturnRate, reward, rewardVersion: "rate-v2", feeRate: finite(row.feeRate), slippageRate: finite(row.slippageRate), result: row.result ?? null, source: row.source ?? "historical-replay", modelVersion: row.modelVersion ?? "", datasetVersion: row.datasetVersion ?? "", shadowOnly: true, executable: false });
  });
}

export function buildRLDatasetReport(dataset = []) {
  const rows = Array.isArray(dataset) ? dataset : [];
  const distribution = values => { const finiteValues = values.map(Number).filter(Number.isFinite); return { count: finiteValues.length, min: finiteValues.length ? Math.min(...finiteValues) : null, max: finiteValues.length ? Math.max(...finiteValues) : null, average: finiteValues.length ? finiteValues.reduce((a, b) => a + b, 0) / finiteValues.length : null }; };
  const states = {}; const actions = {}; for (const row of rows) { const trend = row.state?.trend ?? "unknown"; states[trend] = (states[trend] ?? 0) + 1; const action = row.positionDelta ?? row.expertAction; actions[action] = (actions[action] ?? 0) + 1; const label = row.expertAction ?? actionLabel(action); actions[label] = (actions[label] ?? 0) + 1; }
  return { sampleCount: rows.length, stateDistribution: states, actionDistribution: actions, rawFutureReturnDistribution: distribution(rows.map(row => row.rawFutureReturnRate ?? row.futureReturn)), actionConditionedReturnDistribution: distribution(rows.map(row => row.actionConditionedReturnRate)), futureReturnDistribution: distribution(rows.map(row => row.futureReturn)), rewardDistribution: distribution(rows.map(row => row.reward)), feeRateDistribution: distribution(rows.map(row => row.feeRate)), slippageRateDistribution: distribution(rows.map(row => row.slippageRate)), actionCoverage: Object.fromEntries([1, .5, 0, -.25, -1].map(action => [action, rows.filter(row => row.positionDelta === action).length])), invalidRowCount: rows.filter(row => row.rawFutureReturnRate === null || row.actionConditionedReturnRate === null || row.reward === null).length, trainingPerformed: false, executable: false };
}
