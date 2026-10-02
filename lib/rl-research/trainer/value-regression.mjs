import { createHash } from "node:crypto";

export const VALUE_MODEL_FEATURES = Object.freeze(["return_1m", "return_5m", "price_vs_session_vwap", "rolling_return_std_20", "volume_ratio_20", "minutesSinceOpen", "cashRatio", "positionRatio", "sellableRatio", "averageCostRatio"]);
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const vector = sample => [1, ...VALUE_MODEL_FEATURES.map(name => number(sample.features?.[name] ?? sample.context?.[name]))];
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function valueFeatureVector({ state, portfolio } = {}) {
  const snapshot = portfolio?.snapshot ? portfolio.snapshot(state?.price) : portfolio;
  const price = number(state?.price) || 1;
  return vector({ features: state?.features, context: { cashRatio: number(snapshot?.cash) / 10000, positionRatio: number(snapshot?.position) * price / 10000, sellableRatio: number(snapshot?.sellablePosition) * price / 10000, averageCostRatio: number(snapshot?.averageCost) / price } });
}

export function createValueAccumulator(dimension = VALUE_MODEL_FEATURES.length + 1) { return { count: 0, sum: 0, sumSq: 0, xtx: Array.from({ length: dimension }, () => Array(dimension).fill(0)), xty: Array(dimension).fill(0), stump: { leftCount: 0, leftSum: 0, rightCount: 0, rightSum: 0 } }; }
export function addValueSample(accumulator, features, target) { accumulator.count++; accumulator.sum += target; accumulator.sumSq += target * target; const side = Number(features[1]) < 0 ? "left" : "right"; accumulator.stump[`${side}Count`]++; accumulator.stump[`${side}Sum`] += target; for (let i = 0; i < features.length; i++) { accumulator.xty[i] += features[i] * target; for (let j = 0; j < features.length; j++) accumulator.xtx[i][j] += features[i] * features[j]; } }
function solve(matrix, rhs, ridge) { const n = rhs.length; const a = matrix.map((row, i) => [...row, rhs[i]]); for (let i = 0; i < n; i++) { a[i][i] += ridge; let pivot = i; for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[pivot][i])) pivot = r; [a[i], a[pivot]] = [a[pivot], a[i]]; const divisor = a[i][i] || 1e-12; for (let c = i; c <= n; c++) a[i][c] /= divisor; for (let r = 0; r < n; r++) { if (r === i) continue; const factor = a[r][i]; for (let c = i; c <= n; c++) a[r][c] -= factor * a[i][c]; } } return a.map(row => row[n]); }
export function fitRidge(accumulator, ridge = 1e-3) { return { modelType: "ridge-regression", ridge, weights: solve(accumulator.xtx, accumulator.xty, ridge), count: accumulator.count }; }
export function fitMean(accumulator) { return { modelType: "action-mean", mean: accumulator.count ? accumulator.sum / accumulator.count : 0, count: accumulator.count }; }
export function fitTreeBaseline(accumulator) { const { leftCount, leftSum, rightCount, rightSum } = accumulator.stump; return { modelType: "deterministic-decision-stump", splitFeature: "return_1m", splitThreshold: 0, leftMean: leftCount ? leftSum / leftCount : 0, rightMean: rightCount ? rightSum / rightCount : 0, count: accumulator.count }; }
export function predictValue(model, features) { if (model.modelType === "ridge-regression") return dot(model.weights, features); if (model.modelType === "deterministic-decision-stump") return Number(features[1]) < model.splitThreshold ? model.leftMean : model.rightMean; return model.mean; }
export function regressionMetrics(rows, model) { const values = rows.filter(row => row.target !== null).map(row => ({ actual: row.target, predicted: predictValue(model, row.features) })); if (!values.length) return { count: 0, mae: null, rmse: null, r2: null }; const meanActual = values.reduce((sum, row) => sum + row.actual, 0) / values.length; const mae = values.reduce((sum, row) => sum + Math.abs(row.predicted - row.actual), 0) / values.length; const mse = values.reduce((sum, row) => sum + (row.predicted - row.actual) ** 2, 0) / values.length; const total = values.reduce((sum, row) => sum + (row.actual - meanActual) ** 2, 0); return { count: values.length, mae, rmse: Math.sqrt(mse), r2: total ? 1 - mse * values.length / total : null }; }
export const valueModelHash = hash;
