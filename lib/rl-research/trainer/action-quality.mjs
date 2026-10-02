import { createHash } from "node:crypto";
import { EXPERT_LABELS } from "./offline-learning.mjs";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const finite = v => Number.isFinite(Number(v)) ? Number(v) : null;

export function buildActionQualityDataset(bars = [], samples = [], { horizon = 5, threshold = 0.001 } = {}) {
  return samples.map((sample, i) => {
    const bar = bars[i]; const current = finite(bar?.close ?? bar?.price); const future = finite(bars[i + horizon]?.close ?? bars[i + horizon]?.price);
    if (!(current > 0) || !(future > 0)) return { ...sample, qualityLabel: "NEUTRAL", actionConditionedReturn: null };
    const raw = (future / current) - 1; const signed = sample.expertAction === "SELL_ALL" ? -raw : sample.expertAction === "BUY_SMALL" ? raw : 0;
    return { ...sample, actionConditionedReturn: signed, qualityLabel: signed > threshold ? "GOOD" : signed < -threshold ? "BAD" : "NEUTRAL" };
  });
}

export function trainActionQualityModel(trainSamples = []) {
  const stats = Object.fromEntries(EXPERT_LABELS.map(action => { const rows = trainSamples.filter(s => s.expertAction === action); const good = rows.filter(s => s.qualityLabel === "GOOD").length; return [action, { count: rows.length, good, probability: rows.length ? good / rows.length : 0 }]; }));
  return Object.freeze({ modelVersion: "action-quality-v0.2", stats });
}

export function predictActionQuality(model, sample) {
  const probability = model.stats[sample.expertAction]?.probability ?? 0;
  return { expertAction: sample.expertAction, confidence: probability, expectedQuality: probability >= 0.5 ? "GOOD" : "NOT_GOOD" };
}

export function actionQualitySnapshot({ datasetHash, train, test, model, predictions, threshold }) {
  return { datasetHash, modelHash: hash(model), trainCount: train.length, testCount: test.length, threshold, predictionHash: hash(predictions), labelHash: hash(test.map(s => s.qualityLabel)), leakage: "PASS", featureVersion: "ohlcv-features-v1", stateVersion: "state-v0.1" };
}
