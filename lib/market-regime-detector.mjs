/**
 * Causal Intraday Market Regime Detector for Smart-T Systems.
 *
 * Classifies the intraday market condition using strictly causal metrics
 * at or before the current minute. Never peeks at future bars or full-day stats.
 */

const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
};

/**
 * @param {Array<{ time?: string; price: number; high?: number; low?: number; volume?: number }>} points
 * @param {number} currentIndex
 * @param {number[]} [vwaps]
 * @param {number | { previousClose?: number; avgAtr5d?: number }} [previousClose]
 * @param {{ avgAtr5d?: number }} [options]
 * @returns {import("./market-regime-detector.d.mts").RegimeEvaluation}
 */
export function detectCausalMarketRegime(points, currentIndex, vwaps, previousClose, options) {
  if (!Array.isArray(points) || points.length === 0 || currentIndex < 0 || currentIndex >= points.length) {
    return {
      regime: "NEUTRAL",
      vwapSlope15: 0,
      vwapAboveRatio30: 0.5,
      sessionRangePct: 0,
      sessionMovePct: 0,
      vwapCrossings: 0,
      atrRatio: 1.0,
      volumeRatio: 1.0,
      sessionVolumeRatio: null,
      regimeMultiplier: {
        targetNetPctMultiplier: 1.0,
        hardStopPctMultiplier: 1.0,
        allowPositiveT: true,
        allowReverseT: true,
        counterTrendStrictness: 1.0,
      },
    };
  }

  const prevCloseValue = typeof previousClose === "object" && previousClose !== null
    ? previousClose.previousClose
    : previousClose;
  const avgAtr5d = typeof previousClose === "object" && previousClose !== null
    ? previousClose.avgAtr5d
    : options?.avgAtr5d;
  // A genuine 量比 needs a cross-day baseline. It is optional: without it the
  // detector must not pretend to know whether the session is 缩量.
  const avgVolume5d = typeof previousClose === "object" && previousClose !== null
    ? previousClose.avgVolume5d
    : options?.avgVolume5d;

  const basePrice = finite(prevCloseValue) && Number(prevCloseValue) > 0
    ? Number(prevCloseValue)
    : Number(points[0].price);

  const currentPrice = Number(points[currentIndex].price);
  const sessionMovePct = basePrice > 0 ? (currentPrice - basePrice) / basePrice : 0;

  // Calculate high/low causally up to currentIndex
  let high = -Infinity;
  let low = Infinity;
  for (let i = 0; i <= currentIndex; i++) {
    const p = Number(points[i].price);
    const h = finite(points[i].high) ?? p;
    const l = finite(points[i].low) ?? p;
    if (h > high) high = h;
    if (l < low) low = l;
  }
  const sessionRangePct = basePrice > 0 ? (high - low) / basePrice : 0;

  // Causal VWAP slope
  let vwapSlope15 = 0;
  if (Array.isArray(vwaps) && vwaps.length > currentIndex) {
    const currentVwap = Number(vwaps[currentIndex]);
    const pastIndex = Math.max(0, currentIndex - 15);
    const pastVwap = Number(vwaps[pastIndex]);
    if (pastVwap > 0) {
      vwapSlope15 = (currentVwap - pastVwap) / pastVwap;
    }
  }

  // Causal VWAP above ratio and crossing count over the last 30 bars.
  // Both metrics are windowed: a whole-session crossing tally only ever grows,
  // so a choppy morning would lock the afternoon into WIDE_RANGE forever even
  // after a clean trend has established itself.
  const lookback30 = Math.min(30, currentIndex + 1);
  const windowStart = currentIndex - lookback30 + 1;
  let aboveCount = 0;
  let crossings = 0;
  let prevSign = null;

  for (let i = windowStart; i <= currentIndex; i++) {
    const p = Number(points[i].price);
    const v = Array.isArray(vwaps) && vwaps.length > i ? Number(vwaps[i]) : p;
    const diff = p - v;
    const currentSign = diff >= 0 ? 1 : -1;
    if (prevSign !== null && currentSign !== prevSign) {
      crossings++;
    }
    prevSign = currentSign;

    if (diff >= 0) aboveCount++;
  }

  const vwapAboveRatio30 = lookback30 > 0 ? aboveCount / lookback30 : 0.5;

  // Causal ATR14 and ATR Ratio
  let trSum14 = 0;
  let trCount14 = 0;
  let trSumAll = 0;
  let prevP = basePrice;
  for (let i = 0; i <= currentIndex; i++) {
    const p = Number(points[i].price);
    const h = finite(points[i].high) ?? p;
    const l = finite(points[i].low) ?? p;
    const tr = Math.max(h - l, Math.abs(h - prevP), Math.abs(l - prevP));
    prevP = p;
    trSumAll += tr;
    if (i >= currentIndex - 13) {
      trSum14 += tr;
      trCount14++;
    }
  }
  const atr14 = trCount14 > 0 ? trSum14 / trCount14 : 0;
  const sessionAvgTr = currentIndex >= 0 ? trSumAll / (currentIndex + 1) : atr14;
  const baseAtr = finite(avgAtr5d) && Number(avgAtr5d) > 0 ? Number(avgAtr5d) : (sessionAvgTr > 0 ? sessionAvgTr : 1.0);
  const atrRatio = baseAtr > 0 ? atr14 / baseAtr : 1.0;

  // Two distinct volume measures, previously conflated into one field:
  //
  //  * volumeRatio      — intra-session acceleration (5-min SMA / 20-min SMA).
  //                       Says whether volume is picking up *right now*.
  //  * sessionVolumeRatio (量比) — causal mean volume per elapsed minute against
  //                       a cross-day baseline. Says whether the whole session
  //                       is 缩量. Requires avgVolume5d; null without it.
  //
  // The old code used the intra-session ratio as 量比. That measure is ~1.0 by
  // construction in a uniformly quiet session, which is exactly the 死水 case
  // NARROW_RANGE exists to catch, so 死水 could never be detected.
  let volRatio = null;
  let sessionVolumeRatio = null;
  const hasVolume = points.some((p, i) => i <= currentIndex && Number(p?.volume) > 0);
  if (hasVolume) {
    const start20 = Math.max(0, currentIndex - 19);
    const start5 = Math.max(0, currentIndex - 4);
    let sum20 = 0;
    let count20 = 0;
    let sum5 = 0;
    let count5 = 0;
    for (let i = start20; i <= currentIndex; i++) {
      const v = Number(points[i]?.volume) || 0;
      sum20 += v;
      count20++;
      if (i >= start5) {
        sum5 += v;
        count5++;
      }
    }
    const sma20 = count20 > 0 ? sum20 / count20 : 0;
    const sma5 = count5 > 0 ? sum5 / count5 : 0;
    volRatio = sma20 > 0 ? sma5 / sma20 : (points[currentIndex]?.volume ? 1.0 : 0.0);

    if (finite(avgVolume5d) && Number(avgVolume5d) > 0) {
      let sessionSum = 0;
      for (let i = 0; i <= currentIndex; i++) sessionSum += Number(points[i]?.volume) || 0;
      sessionVolumeRatio = (sessionSum / (currentIndex + 1)) / Number(avgVolume5d);
    }
  }

  // 缩量 is asserted only when a real baseline says so. With no baseline the
  // amplitude gate alone decides, rather than a measure that cannot express it.
  const quietVolume = sessionVolumeRatio === null ? null : sessionVolumeRatio < 0.8;

  // Classification Logic:
  // BULL_TREND: price strictly above VWAP > 75%, vwapSlope15 > +0.15%, sessionMovePct > +1.2%
  // BEAR_TREND: price strictly below VWAP > 75% (aboveRatio < 25%), vwapSlope15 < -0.15%, sessionMovePct < -1.2%
  // WIDE_RANGE: amplitude >= 1.8%, crossings >= 3
  // NARROW_RANGE: amplitude <= 1.0% and volumeRatio < 0.8
  let regime = "NEUTRAL";

  if (vwapAboveRatio30 > 0.75 && vwapSlope15 > 0.0015 && sessionMovePct > 0.012) {
    regime = "BULL_TREND";
  } else if (vwapAboveRatio30 < 0.25 && vwapSlope15 < -0.0015 && sessionMovePct < -0.012) {
    regime = "BEAR_TREND";
  } else if (sessionRangePct >= 0.018 && crossings >= 3) {
    regime = "WIDE_RANGE";
  } else if (sessionRangePct <= 0.010 && currentIndex >= 30 && quietVolume !== false) {
    regime = "NARROW_RANGE";
  }

  // Multiplier mapping
  let targetNetPctMultiplier = 1.0;
  let hardStopPctMultiplier = 1.0;
  let allowPositiveT = true;
  let allowReverseT = true;
  let counterTrendStrictness = 1.0;

  if (regime === "BULL_TREND") {
    targetNetPctMultiplier = 1.25;
    allowReverseT = false; // Discourage selling short during strong bull trend
    counterTrendStrictness = 2.0;
  } else if (regime === "BEAR_TREND") {
    targetNetPctMultiplier = 1.25;
    allowPositiveT = false; // Discourage buying dip during strong bear cascade
    counterTrendStrictness = 2.0;
  } else if (regime === "WIDE_RANGE") {
    targetNetPctMultiplier = 1.1;
    hardStopPctMultiplier = 1.15;
    counterTrendStrictness = 0.9;
  } else if (regime === "NARROW_RANGE") {
    targetNetPctMultiplier = 0.85;
    hardStopPctMultiplier = 0.9;
    counterTrendStrictness = 1.2;
  }

  return {
    regime,
    vwapSlope15,
    vwapAboveRatio30,
    sessionRangePct,
    sessionMovePct,
    vwapCrossings: crossings,
    atrRatio,
    volumeRatio: volRatio,
    sessionVolumeRatio,
    regimeMultiplier: {
      targetNetPctMultiplier,
      hardStopPctMultiplier,
      allowPositiveT,
      allowReverseT,
      counterTrendStrictness,
    },
  };
}
