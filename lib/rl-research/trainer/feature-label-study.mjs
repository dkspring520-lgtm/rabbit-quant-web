import { calculateKdjSeries, KDJ_CONTRACT_VERSION } from "../../indicators/causal-kdj.mjs";

// Compatibility exports retain byte-equivalent V0.4 feature/label values; never use them as KDJ.
export { buildV04Features, buildV04Features as buildLegacyV04Features, futureLabelStudy,
  featureAudit, V04_FEATURES } from "./feature-label-study-legacy-v04.mjs";
export const LEGACY_V04_KDJ_CONTRACT = "legacy-v04-rsv14-k-null-dj";
export const KDJ_FEATURE_VERSION = KDJ_CONTRACT_VERSION;
export const KDJ_FEATURES = Object.freeze(["kdjK", "kdjD", "kdjJ"]);

export function buildKdjFeatureSeries(bars = [], options = {}) {
  return calculateKdjSeries(bars, options).map(sample => ({
    timestamp: sample.timestamp, featureVersion: KDJ_FEATURE_VERSION,
    kdjK: sample.value?.k ?? null, kdjD: sample.value?.d ?? null, kdjJ: sample.value?.j ?? null,
    metadata: sample.metadata,
  }));
}

export function buildKdjFeatures(bars = [], index = bars.length - 1, options = {}) {
  if (!Number.isInteger(index) || index < 0 || index >= bars.length) throw new RangeError("KDJ feature index out of range");
  return buildKdjFeatureSeries(bars.slice(0, index + 1), options).at(-1);
}
