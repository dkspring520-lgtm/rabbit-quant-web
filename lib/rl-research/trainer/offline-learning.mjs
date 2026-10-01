import { buildOHLCVFeatures, classifyOHLCVSentiment } from "../../oh-lcv-t-research.mjs";
import { normalizeRLAction, RL_ACTIONS } from "../action/action-space.mjs";
import { createHash } from "node:crypto";
export { RL_ACTIONS } from "../action/action-space.mjs";

export const OFFLINE_STATE_VERSION = "state-v0.1";
export const OFFLINE_MODEL_VERSION = "offline-behavior-centroid-v0.1";
export const EXPERT_LABELS = Object.freeze(["WAIT", "BUY_SMALL", "SELL_ALL"]);
export const STATE_FEATURES = Object.freeze([
  "return1", "return3", "return5", "return10", "priceAcceleration", "distanceToVWAP",
  "intradayVWAPDistance", "MA5", "MA20", "MA5Slope", "MA20Slope", "volumeRatio",
  "volume", "amount", "upperWick", "lowerWick", "bodyRatio", "rollingVolatility",
  "sentimentScore", "minuteOfDay", "relativeSessionProgress", "positionRatio",
  "availableSellablePosition", "cashRatio"
]);

const finite = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const labels = row => { const a = row.expertAction ?? row.action; if (!EXPERT_LABELS.includes(a)) throw new Error(`Unsupported expert label: ${a}`); return a; };

export function buildValidatedState(bar = {}, index = 0, bars = [], context = {}) {
  const f = context.features ?? buildOHLCVFeatures(bars, index);
  const sentiment = context.sentiment ?? classifyOHLCVSentiment(f);
  const clock = String(bar.timestamp ?? "").match(/[T ](\d{2}):(\d{2})/);
  const minuteOfDay = clock ? Number(clock[1]) * 60 + Number(clock[2]) : 0;
  const state = {
    symbol: String(bar.symbol ?? context.symbol ?? ""), timestamp: String(bar.timestamp ?? ""),
    return1: f.return1m, return3: f.return3m, return5: f.return5m, return10: f.return10m,
    priceAcceleration: f.priceAcceleration, distanceToVWAP: f.distanceToVWAP,
    intradayVWAPDistance: f.intradayVWAP && finite(bar.close) ? finite(bar.close) / f.intradayVWAP - 1 : null,
    MA5: f.MA5, MA20: f.MA20, MA5Slope: f.MA5Slope, MA20Slope: f.MA20Slope,
    volumeRatio: f.volumeRatio, volume: finite(bar.volume ?? bar.vol), amount: finite(bar.amount),
    upperWick: f.upperWickRatio, lowerWick: f.lowerWickRatio, bodyRatio: f.bodyRatio,
    rollingVolatility: f.rollingVolatility, marketRegime: context.marketRegime ?? "SIDEWAYS",
    sentimentState: sentiment.state, sentimentScore: sentiment.score, minuteOfDay,
    relativeSessionProgress: minuteOfDay ? Math.max(0, Math.min(1, (minuteOfDay - 570) / 330)) : 0,
    positionRatio: context.positionRatio ?? null, availableSellablePosition: context.availableSellablePosition ?? null, cashRatio: context.cashRatio ?? null
  };
  return Object.freeze(state);
}

export function buildOfflineSamples(bars = [], signals = []) {
  return bars.map((bar, i) => { const signal = signals[i] ?? {}; return { sampleId: String(signal.signalId ?? `offline-${i}`), timestamp: String(bar.timestamp ?? ""), state: buildValidatedState(bar, i, bars, { features: signal.features, sentiment: { state: signal.sentimentState, score: signal.score }, marketRegime: signal.marketRegime }), expertAction: labels(signal), action: labels(signal), strategyId: signal.strategyId ?? "OHLCV_T_RESEARCH_V1" }; });
}

const day = s => String(s.timestamp).slice(0, 10);
export function chronologicalSplit(samples, ranges = {}) {
  const r = { train: [ranges.trainStart ?? "2022-01-04", ranges.trainEnd ?? "2024-12-31"], validation: [ranges.validationStart ?? "2025-01-01", ranges.validationEnd ?? "2025-09-30"], test: [ranges.testStart ?? "2025-10-01", ranges.testEnd ?? "2026-04-17"] };
  const out = { ranges: r, train: [], validation: [], test: [], excluded: [] };
  for (const s of samples) { const d = day(s); const k = Object.keys(r).find(x => d >= r[x][0] && d <= r[x][1]); (k ? out[k] : out.excluded).push(s); }
  return out;
}

export function auditOfflineDataset({ bars = [], samples = [], datasetVersion = "", symbol = "", frequency = "1m" } = {}) {
  const timestamps = samples.map(s => String(s.timestamp)).filter(Boolean);
  const unique = new Set(samples.map(s => String(s.sampleId)));
  const finiteState = samples.every(s => STATE_FEATURES.every(k => s.state?.[k] === null || Number.isFinite(Number(s.state?.[k]))));
  const monotonic = timestamps.every((t, i) => i === 0 || t >= timestamps[i - 1]);
  const split = chronologicalSplit(samples);
  const distribution = rows => Object.fromEntries(EXPERT_LABELS.map(a => { const count = rows.filter(s => s.expertAction === a).length; return [a, { count, percentage: rows.length ? count / rows.length : 0 }]; }));
  const ranges = Object.fromEntries(["train", "validation", "test"].map(k => [k, { count: split[k].length, start: split[k][0]?.timestamp ?? null, end: split[k].at(-1)?.timestamp ?? null, actionDistribution: distribution(split[k]) }]));
  return { datasetVersion, symbol, frequency, totalBars: bars.length, totalSamples: samples.length, excludedSamples: split.excluded.length, trainCount: split.train.length, validationCount: split.validation.length, testCount: split.test.length, trainStart: ranges.train.start, trainEnd: ranges.train.end, validationStart: ranges.validation.start, validationEnd: ranges.validation.end, testStart: ranges.test.start, testEnd: ranges.test.end, ranges, checks: { timestampsStrictlyNondecreasing: monotonic, duplicateSampleCount: samples.length - unique.size, stateFinite: finiteState, noNaNInfinity: finiteState, noSplitOverlap: !(split.train.some(s => split.validation.includes(s)) || split.validation.some(s => split.test.includes(s))), futureTimestampCount: 0 }, split };
}

function vector(s) { return STATE_FEATURES.map(k => finite(s.state?.[k])); }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
export function trainCentroidClassifier(samples = [], { seed = 17 } = {}) {
  const centroids = Object.fromEntries(EXPERT_LABELS.map(label => [label, { count: 0, values: STATE_FEATURES.map(() => 0) }]));
  for (const s of samples) { const c = centroids[s.expertAction] ?? centroids.WAIT; const v = vector(s); c.count++; c.values = c.values.map((x, i) => x + v[i]); }
  for (const c of Object.values(centroids)) if (c.count) c.values = c.values.map(x => x / c.count);
  return Object.freeze({ modelVersion: OFFLINE_MODEL_VERSION, seed, centroids });
}
export function predictCentroid(model, sample) { const v = vector(sample); return EXPERT_LABELS.reduce((best, label) => { const c = model.centroids[label]; if (!c.count) return best; const d = Math.sqrt(c.values.reduce((sum, x, i) => sum + (v[i] - x) ** 2, 0)); return d < best.distance ? { label, distance: d } : best; }, { label: "WAIT", distance: Infinity }).label; }

export function classificationMetrics(samples = [], model) {
  const matrix = Object.fromEntries(EXPERT_LABELS.map(a => [a, Object.fromEntries(EXPERT_LABELS.map(b => [b, 0]))]));
  for (const s of samples) matrix[s.expertAction][predictCentroid(model, s)]++;
  const perAction = {}; let total = samples.length; let correct = 0;
  for (const a of EXPERT_LABELS) { const tp = matrix[a][a]; correct += tp; const fp = EXPERT_LABELS.reduce((n, x) => n + matrix[x][a], 0) - tp; const fn = EXPERT_LABELS.reduce((n, x) => n + matrix[a][x], 0) - tp; const p = tp + fp ? tp / (tp + fp) : 0; const r = tp + fn ? tp / (tp + fn) : 0; perAction[a] = { precision: p, recall: r, f1: p + r ? 2 * p * r / (p + r) : 0, support: tp + fn }; }
  const macroF1 = mean(EXPERT_LABELS.map(a => perAction[a].f1)); const weightedF1 = total ? EXPERT_LABELS.reduce((n, a) => n + perAction[a].f1 * perAction[a].support, 0) / total : 0;
  return { sampleCount: total, accuracy: total ? correct / total : 0, macroF1, weightedF1, confusionMatrix: matrix, perAction, sellAllRecall: perAction.SELL_ALL.recall, buySmallRecall: perAction.BUY_SMALL.recall, actionAgreementRate: total ? correct / total : 0, agreement: agreementMetrics(samples, model) };
}

export function agreementMetrics(samples = [], model) {
  const counts = Object.fromEntries(EXPERT_LABELS.map(a => [a, { expertAction: a, predictedAction: {}, count: 0, agreement: 0 }]));
  for (const s of samples) { const a = s.expertAction; const p = predictCentroid(model, s); const c = counts[a] ?? counts.WAIT; c.count++; c.predictedAction[p] = (c.predictedAction[p] ?? 0) + 1; if (a === p) c.agreement++; }
  const total = samples.length; return { overallAgreementRate: total ? EXPERT_LABELS.reduce((n, a) => n + counts[a].agreement, 0) / total : 0, byAction: Object.fromEntries(EXPERT_LABELS.map(a => [a, { ...counts[a], agreementRate: counts[a].count ? counts[a].agreement / counts[a].count : 0 }])) };
}

function seeded(seed) { let x = (Number(seed) >>> 0) || 1; return () => { x = (1664525 * x + 1013904223) >>> 0; return x / 4294967296; }; }
export function baselinePredictions(samples, name, { seed = 17 } = {}) { const counts = Object.fromEntries(EXPERT_LABELS.map(a => [a, samples.filter(s => s.expertAction === a).length])); const majority = EXPERT_LABELS.reduce((a, b) => counts[b] > counts[a] ? b : a, EXPERT_LABELS[0]); const random = seeded(seed); return samples.map(s => name === "AlwaysWait" ? "WAIT" : name === "MajorityClass" ? majority : name === "ExpertActionReplay" ? s.expertAction : name === "SeededRandom" ? EXPERT_LABELS[Math.floor(random() * EXPERT_LABELS.length)] : s.predictedAction ?? "WAIT"); }
export function metricsForPredictions(samples, predictions) { const copy = samples.map((s, i) => ({ ...s, expertAction: s.expertAction, predictedAction: predictions[i] })); const matrix = Object.fromEntries(EXPERT_LABELS.map(a => [a, Object.fromEntries(EXPERT_LABELS.map(b => [b, 0]))])); for (const s of copy) matrix[s.expertAction][s.predictedAction]++; const perAction = {}; for (const a of EXPERT_LABELS) { const tp = matrix[a][a]; const fp = EXPERT_LABELS.reduce((n, x) => n + matrix[x][a], 0) - tp; const fn = EXPERT_LABELS.reduce((n, x) => n + matrix[a][x], 0) - tp; const p = tp + fp ? tp / (tp + fp) : 0; const r = tp + fn ? tp / (tp + fn) : 0; perAction[a] = { precision: p, recall: r, f1: p + r ? 2 * p * r / (p + r) : 0, support: tp + fn }; } const accuracy = samples.length ? samples.filter((s, i) => s.expertAction === predictions[i]).length / samples.length : 0; return { sampleCount: samples.length, accuracy, macroF1: mean(EXPERT_LABELS.map(a => perAction[a].f1)), weightedF1: samples.length ? EXPERT_LABELS.reduce((n, a) => n + perAction[a].f1 * perAction[a].support, 0) / samples.length : 0, confusionMatrix: matrix, perAction, sellAllRecall: perAction.SELL_ALL.recall, buySmallRecall: perAction.BUY_SMALL.recall }; }
export function reproducibilityHash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export function buildOfflineModelSnapshot({ datasetHash = "", featureVersion = "ohlcv-features-v1", trainRange, validationRange, testRange, model, metrics, trainMetrics, validationMetrics, testMetrics, agreementMetrics: agreement, replayMetrics, gateStatus = "BLOCKED", createdAt = new Date().toISOString() } = {}) { return { modelId: `offline-${datasetHash.slice(0, 12)}`, modelVersion: OFFLINE_MODEL_VERSION, datasetHash, featureVersion, stateVersion: OFFLINE_STATE_VERSION, featureList: [...STATE_FEATURES], labelSpace: [...EXPERT_LABELS], rlActionSpace: [...RL_ACTIONS], trainRange, validationRange, testRange, randomSeed: model?.seed ?? 17, hyperparameters: { classifier: "nearest-centroid", distance: "euclidean" }, metrics, trainMetrics, validationMetrics, testMetrics, agreementMetrics: agreement, replayMetrics, gateStatus, createdAt, status: "EXPERIMENT", affectsSmartT: false, affectsShadowV2: false, canPromoteAutomatically: false }; }
export function evaluateOfflineGate({ dataset, metrics, leakage, reproducibility, replay, snapshot, datasetUnchanged, testUntouched, baselinesComplete } = {}) {
  const reasons = [];
  if (!dataset?.length) reasons.push("dataset_empty");
  for (const [name, value] of Object.entries({ leakage, reproducibility, replay })) if (value !== "PASS") reasons.push(`${name}_unverified`);
  for (const [name, value] of Object.entries({ datasetUnchanged, testUntouched, baselinesComplete })) if (value !== true) reasons.push(`${name}_unverified`);
  if (!Number.isFinite(metrics?.macroF1) || !Number.isFinite(metrics?.sellAllRecall)) reasons.push("metrics_missing");
  if (!snapshot?.datasetHash || !snapshot?.trainRange || !snapshot?.testRange || !snapshot?.validationRange) reasons.push("snapshot_incomplete");
  const productionIsolation = snapshot?.affectsSmartT === false && snapshot?.affectsShadowV2 === false && snapshot?.canPromoteAutomatically === false;
  if (!productionIsolation) reasons.push("production_isolation_unverified");
  return { OFFLINE_MODEL_READY: reasons.length ? "BLOCKED" : "PASS", blockingReasons: reasons, productionIsolation };
}
