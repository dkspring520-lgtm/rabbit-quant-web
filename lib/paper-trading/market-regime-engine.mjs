const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

export class MarketRegimeEngine {
  classify({ price, factors = {}, volume, averageVolume } = {}) {
    const current = finite(price); const ma5 = finite(factors.ma5 ?? factors["trend.ma_5"] ?? factors["price.ma_5"]); const ma20 = finite(factors.ma20 ?? factors["trend.ma_20"] ?? factors["price.ma_20"]);
    const trend = current !== null && ma5 !== null && ma20 !== null && current > ma20 && ma5 > ma20 ? "UP" : current !== null && ma5 !== null && ma20 !== null && current < ma20 && ma5 < ma20 ? "DOWN" : "SIDEWAYS";
    const volatilityValue = finite(factors.volatility ?? factors["volatility.stddev"] ?? factors["volatility.atr"]);
    const volumeValue = finite(volume); const baseline = finite(averageVolume); const volumeState = volumeValue === null || baseline === null ? "UNKNOWN" : volumeValue > baseline * 1.2 ? "HIGH" : volumeValue < baseline * 0.8 ? "LOW" : "NORMAL";
    return Object.freeze({ trend, trendConfidence: current !== null && ma5 !== null && ma20 !== null ? (trend === "SIDEWAYS" ? 0.5 : 1) : 0, volatility: volatilityValue, volumeState, tradingMode: trend === "UP" ? "POSITIVE_T" : trend === "DOWN" ? "REVERSE_T" : "RANGE_T", marketRegime: trend });
  }
}
