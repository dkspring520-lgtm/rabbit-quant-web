import { createHash } from "node:crypto";
import { featureVector, splitOf, MARKET_FEATURES, ACCOUNT_FEATURES } from "./value-q-benchmark-v011.mjs";

export const POLICY_VERSION = "OFFLINE_RL_POLICY_V0.12_OBSERVED_SUPPORT";
export const FEATURE_SCHEMA_VERSION = "ValidatedStatePriceOnlyV0.1_PLUS_ACCOUNT_V0.1";
export const SPLIT_VERSION = "OFFLINE_RL_TEMPORAL_SPLIT_V0.10";
export const SEED = 0;
export const SUPPORTED_ACTIONS = Object.freeze(["WAIT", "BUY_SMALL", "SELL_ALL"]);
export const UNSUPPORTED_ACTIONS = Object.freeze(["BUY", "SELL_PART"]);
export const POLICY_FEATURE_MODES = Object.freeze(["market_only", "market_account"]);
export const MODEL_CONFIG = Object.freeze({ classifier: "multinomial_linear_ridge", ridge: 0.001, oodZThreshold: 3, calibrationBins: 10, valueModel: "existing_v0.11_market_account_ridge", valueTemperature: 0.0001 });

const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);

export { featureVector, splitOf, MARKET_FEATURES, ACCOUNT_FEATURES };

export function createPolicyAccumulator(mode = "market_account") {
  const dimension = featureVector({ state: { marketState: { price: 1, features: {} }, accountState: {} } }, mode).length;
  return { mode, dimension, count: 0, actionCounts: Object.fromEntries(SUPPORTED_ACTIONS.map(action => [action, 0])), xtx: Array.from({ length: dimension }, () => Array(dimension).fill(0)), xty: Object.fromEntries(SUPPORTED_ACTIONS.map(action => [action, Array(dimension).fill(0)])) };
}

export function addPolicySample(accumulator, record, mode = accumulator.mode) {
  if (!SUPPORTED_ACTIONS.includes(record.action)) return false;
  const vector = featureVector(record, mode);
  accumulator.count += 1;
  accumulator.actionCounts[record.action] += 1;
  for (let i = 0; i < vector.length; i++) {
    accumulator.xty[record.action][i] += vector[i];
    for (let j = 0; j < vector.length; j++) accumulator.xtx[i][j] += vector[i] * vector[j];
  }
  return true;
}

function solve(matrix, rhs, ridge) {
  const n = rhs.length;
  const augmented = matrix.map((row, i) => [...row, rhs[i]]);
  for (let i = 0; i < n; i++) {
    augmented[i][i] += ridge;
    let pivot = i;
    for (let row = i + 1; row < n; row++) if (Math.abs(augmented[row][i]) > Math.abs(augmented[pivot][i])) pivot = row;
    [augmented[i], augmented[pivot]] = [augmented[pivot], augmented[i]];
    const divisor = augmented[i][i] || 1e-12;
    for (let column = i; column <= n; column++) augmented[i][column] /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === i) continue;
      const factor = augmented[row][i];
      for (let column = i; column <= n; column++) augmented[row][column] -= factor * augmented[i][column];
    }
  }
  return augmented.map(row => row[n]);
}

export function fitPolicyModel(accumulator, ridge = MODEL_CONFIG.ridge) {
  return { modelType: "multinomial-linear-ridge", mode: accumulator.mode, ridge, actionCounts: { ...accumulator.actionCounts }, count: accumulator.count, weights: Object.fromEntries(SUPPORTED_ACTIONS.map(action => [action, solve(accumulator.xtx, accumulator.xty[action], ridge)])) };
}

export function softmax(scores) {
  const maximum = Math.max(...scores);
  const exponentials = scores.map(score => Math.exp(Math.max(-60, Math.min(60, score - maximum))));
  const total = exponentials.reduce((sum, value) => sum + value, 0) || 1;
  return exponentials.map(value => value / total);
}

export function buildFeasibilityMask(record) {
  const account = record.state?.accountState ?? {};
  return { WAIT: true, BUY_SMALL: finite(account.cash) > 0, SELL_ALL: finite(account.sellablePosition) > 0 };
}

export function maskProbabilities(probabilities, feasibleMask) {
  const masked = probabilities.map((value, index) => feasibleMask[SUPPORTED_ACTIONS[index]] ? value : 0);
  const total = masked.reduce((sum, value) => sum + value, 0);
  if (total > 0) return masked.map(value => value / total);
  return SUPPORTED_ACTIONS.map(action => action === "WAIT" ? 1 : 0);
}

export function predictPolicy(model, record, mode = model.mode) {
  const vector = featureVector(record, mode);
  const scores = SUPPORTED_ACTIONS.map(action => dot(model.weights[action], vector));
  const rawProbabilities = softmax(scores);
  const feasibilityMask = buildFeasibilityMask(record);
  const probabilities = maskProbabilities(rawProbabilities, feasibilityMask);
  let bestIndex = 0;
  for (let index = 1; index < probabilities.length; index++) if (probabilities[index] > probabilities[bestIndex]) bestIndex = index;
  return { action: SUPPORTED_ACTIONS[bestIndex], probabilities: Object.fromEntries(SUPPORTED_ACTIONS.map((action, index) => [action, probabilities[index]])), rawProbabilities: Object.fromEntries(SUPPORTED_ACTIONS.map((action, index) => [action, rawProbabilities[index]])), confidence: probabilities[bestIndex], feasibilityMask, vector };
}

export function createFeatureStats(mode = "market_account") {
  const dimension = featureVector({ state: { marketState: { price: 1, features: {} }, accountState: {} } }, mode).length;
  return { mode, count: 0, sum: Array(dimension).fill(0), sumSq: Array(dimension).fill(0) };
}
export function addFeatureStats(stats, vector) { stats.count += 1; for (let i = 0; i < vector.length; i++) { stats.sum[i] += vector[i]; stats.sumSq[i] += vector[i] * vector[i]; } return stats; }
export function finishFeatureStats(stats) { const mean = stats.sum.map(value => stats.count ? value / stats.count : 0); const std = stats.sumSq.map((value, index) => Math.sqrt(Math.max(0, value / Math.max(1, stats.count) - mean[index] * mean[index]))); return { mode: stats.mode, count: stats.count, mean, std }; }
export function isOod(vector, stats, threshold = MODEL_CONFIG.oodZThreshold) { return vector.some((value, index) => Math.abs(value - stats.mean[index]) > threshold * Math.max(stats.std[index], 1e-9)); }

export function createClassificationAccumulator() { return { count: 0, correct: 0, nonWaitCount: 0, nonWaitCorrect: 0, confusion: Object.fromEntries(SUPPORTED_ACTIONS.map(actual => [actual, Object.fromEntries(SUPPORTED_ACTIONS.map(predicted => [predicted, 0]))])), confidenceSum: 0, brierSum: 0, calibration: Array.from({ length: MODEL_CONFIG.calibrationBins }, () => ({ count: 0, confidence: 0, correct: 0 })), oodCount: 0, lowConfidenceCount: 0, maskedSellAllCount: 0, maskedBuySmallCount: 0, unsupportedActualCount: 0 };
}

export function addClassification(accumulator, actual, prediction) {
  if (!SUPPORTED_ACTIONS.includes(actual)) { accumulator.unsupportedActualCount += 1; return accumulator; }
  const predicted = prediction.action;
  accumulator.count += 1;
  if (predicted === actual) accumulator.correct += 1;
  if (actual !== "WAIT") { accumulator.nonWaitCount += 1; if (predicted === actual) accumulator.nonWaitCorrect += 1; }
  accumulator.confusion[actual][predicted] += 1;
  accumulator.confidenceSum += prediction.confidence;
  const probabilities = SUPPORTED_ACTIONS.map(action => prediction.probabilities[action]);
  accumulator.brierSum += probabilities.reduce((sum, value, index) => sum + (value - (SUPPORTED_ACTIONS[index] === actual ? 1 : 0)) ** 2, 0);
  const bin = Math.min(MODEL_CONFIG.calibrationBins - 1, Math.floor(prediction.confidence * MODEL_CONFIG.calibrationBins));
  accumulator.calibration[bin].count += 1;
  accumulator.calibration[bin].confidence += prediction.confidence;
  accumulator.calibration[bin].correct += predicted === actual ? 1 : 0;
  if (prediction.ood) accumulator.oodCount += 1;
  if (prediction.confidence < 0.5) accumulator.lowConfidenceCount += 1;
  if (!prediction.feasibilityMask.SELL_ALL) accumulator.maskedSellAllCount += 1;
  if (!prediction.feasibilityMask.BUY_SMALL) accumulator.maskedBuySmallCount += 1;
  return accumulator;
}

function perActionMetrics(confusion, action) {
  const tp = confusion[action][action];
  const actual = Object.values(confusion[action]).reduce((sum, value) => sum + value, 0);
  const predicted = Object.values(confusion).reduce((sum, row) => sum + row[action], 0);
  const precision = predicted ? tp / predicted : null;
  const recall = actual ? tp / actual : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? 2 * precision * recall / (precision + recall) : null;
  return { support: actual, precision, recall, f1 };
}

export function finishClassification(accumulator) {
  const perAction = Object.fromEntries(SUPPORTED_ACTIONS.map(action => [action, perActionMetrics(accumulator.confusion, action)]));
  const f1Values = Object.values(perAction).map(value => value.f1).filter(value => value !== null);
  const recallValues = Object.values(perAction).map(value => value.recall).filter(value => value !== null);
  const calibration = accumulator.calibration.map(bin => ({ count: bin.count, confidence: bin.count ? bin.confidence / bin.count : null, accuracy: bin.count ? bin.correct / bin.count : null }));
  const ece = calibration.reduce((sum, bin) => sum + (bin.count / Math.max(1, accumulator.count)) * (bin.confidence === null ? 0 : Math.abs(bin.accuracy - bin.confidence)), 0);
  return { count: accumulator.count, accuracy: accumulator.count ? accumulator.correct / accumulator.count : null, nonWaitCount: accumulator.nonWaitCount, nonWaitAccuracy: accumulator.nonWaitCount ? accumulator.nonWaitCorrect / accumulator.nonWaitCount : null, macroF1: f1Values.length ? f1Values.reduce((sum, value) => sum + value, 0) / f1Values.length : null, balancedAccuracy: recallValues.length ? recallValues.reduce((sum, value) => sum + value, 0) / recallValues.length : null, perAction, brierScore: accumulator.count ? accumulator.brierSum / accumulator.count : null, expectedCalibrationError: ece, meanConfidence: accumulator.count ? accumulator.confidenceSum / accumulator.count : null, confusion: accumulator.confusion, oodCount: accumulator.oodCount, oodRate: accumulator.count ? accumulator.oodCount / accumulator.count : null, lowConfidenceCount: accumulator.lowConfidenceCount, lowConfidenceRate: accumulator.count ? accumulator.lowConfidenceCount / accumulator.count : null, maskedSellAllCount: accumulator.maskedSellAllCount, maskedBuySmallCount: accumulator.maskedBuySmallCount, unsupportedActualCount: accumulator.unsupportedActualCount, calibration };
}

export function updateAgreement(accumulator, leftAction, rightAction) { accumulator.count += 1; if (leftAction === rightAction) accumulator.agree += 1; return accumulator; }
export function finishAgreement(accumulator) { return { count: accumulator.count, agreement: accumulator.count ? accumulator.agree / accumulator.count : null }; }
export function walkForwardWindows() { return [{ id: "WF1", train: ["2022-01-04", "2023-12-31"], validation: ["2024-01-01", "2024-06-30"], future: ["2024-07-01", "2024-12-31"] }, { id: "WF2", train: ["2022-01-04", "2024-06-30"], validation: ["2024-07-01", "2024-12-31"], future: ["2025-01-01", "2025-06-30"] }, { id: "WF3", train: ["2022-01-04", "2024-12-31"], validation: ["2025-01-01", "2025-06-30"], future: ["2025-07-01", "2025-12-31"] }]; }
export function inDateRange(timestamp, range) { const day = String(timestamp).slice(0, 10); return day >= range[0] && day <= range[1]; }
export function hashPolicy(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function policySchema(dataset, modelConfig = MODEL_CONFIG) { return { policyVersion: POLICY_VERSION, featureSchemaVersion: FEATURE_SCHEMA_VERSION, splitVersion: SPLIT_VERSION, seed: SEED, supportedActions: [...SUPPORTED_ACTIONS], unsupportedActions: [...UNSUPPORTED_ACTIONS], datasetHash: dataset.datasetHash, trajectoryHash: dataset.sourceTrajectoryHash, sourceDatasetHash: dataset.sourceDatasetHash, normalizedDatasetHash: dataset.normalizedDatasetHash, expertSignalHash: dataset.expertSignalHash, modelConfig: { ...modelConfig }, futureFeaturesInInput: false, nextStateInInput: false, futureRewardInInput: false, productionIsolation: true, finalPolicyTraining: false }; }
