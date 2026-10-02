import { createHash } from "node:crypto";
export const LEGAL_ACTIONS = Object.freeze(["WAIT", "BUY_SMALL", "BUY", "SELL_PART", "SELL_ALL"]);
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const finite = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const direction = action => action === "BUY" || action === "BUY_SMALL" ? 1 : action === "SELL_PART" || action === "SELL_ALL" ? -1 : 0;
export function buildActionRankingDataset(samples = [], qualityPredictions = []) {
  return samples.map((sample, i) => { const quality = finite(qualityPredictions[i]?.goodProbability); const probabilities = Object.fromEntries(LEGAL_ACTIONS.map(action => [action, action === sample.expertAction ? Math.min(1, .5 + quality / 2) : (1 - quality) / (LEGAL_ACTIONS.length - 1)])); return { sampleId: sample.sampleId, timestamp: sample.timestamp, state: sample.state, expertAction: sample.expertAction, actionQualityProbability: quality, actionProbabilities: probabilities, actionConditionedReturn: sample.actionConditionedReturn, qualityLabel: sample.qualityLabel }; });
}
export function evaluateCounterfactual(rows = [], bars = [], horizon = 5) {
  return rows.map((row, i) => { const current = finite(bars[i]?.close ?? bars[i]?.price); const future = finite(bars[i + horizon]?.close ?? bars[i + horizon]?.price); const base = current > 0 && future > 0 ? future / current - 1 : 0; const expertValue = base * direction(row.expertAction); const alternatives = Object.fromEntries(LEGAL_ACTIONS.filter(a => a !== row.expertAction).map(action => { const value = base * direction(action); return [action, { actionValueDifference: value - expertValue, regret: Math.max(0, expertValue - value), improvementPotential: Math.max(0, value - expertValue) }]; })); return { sampleId: row.sampleId, timestamp: row.timestamp, expertAction: row.expertAction, expertValue, alternatives }; });
}
export const snapshotHash = hash;
