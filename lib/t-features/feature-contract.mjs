export const FEATURE_ENGINE_VERSION = "1.0.0";
export const FEATURE_VALIDITY = Object.freeze(["VALID", "WARMUP", "INVALID"]);
export const CORE_SAFE_DEPENDENCIES = Object.freeze([
  "price", "open", "high", "low", "close", "volume", "VWAP", "EMA", "VWMA", "RSI", "ATR", "MFI", "HISTORICAL_VOLATILITY",
]);

export function emptyFeatureSnapshot({ timestamp = null, symbol = "", timeframe = "1m", validity = "INVALID", reason = "missing data" } = {}) {
  return { timestamp, symbol, timeframe, valid: validity === "VALID", validity, reason, trend: {}, position: {}, momentum: {}, volume: {}, volatility: {}, structure: {}, exhaustion: {}, dependencies: {}, dataQuality: { reasons: [reason] }, researchOnly: true, rlEligible: false };
}

export function isFeatureSnapshot(value) {
  return Boolean(value && typeof value === "object" && typeof value.timestamp !== "undefined" && FEATURE_VALIDITY.includes(value.validity) && value.researchOnly === true && value.rlEligible === false);
}
