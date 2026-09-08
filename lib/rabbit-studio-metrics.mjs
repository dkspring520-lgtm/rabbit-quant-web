/**
 * Display-only, deterministic intraday measurements for Rabbit Studio.
 *
 * This module deliberately describes prices already observed in the supplied
 * chronological minute prefix.  It does not rank opportunities, predict a
 * future move, or emit a buy/sell signal, score, or probability.
 */
export const RABBIT_STUDIO_METRICS_CONTRACT = Object.freeze({
  version: "2026.09-light-metrics-v1",
  displayOnly: true,
  emitsSignals: false,
  emitsScores: false,
  emitsProbabilities: false,
  supportResistanceMethod: "causal-recent-extrema",
});

const DEFAULT_RECENT_WINDOW_BARS = 30;
const VWAP_NEAR_THRESHOLD = 0.001;

function finitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function finiteNonNegative(value) {
  return value !== null && value !== undefined && value !== ""
    && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function percent(numerator, denominator) {
  return finitePositive(denominator) ? (numerator / denominator) * 100 : null;
}

function clamp(value, lower, upper) {
  return Math.min(upper, Math.max(lower, value));
}

function normalizeMinutes(minutes) {
  if (!Array.isArray(minutes)) return [];

  return minutes.reduce((result, point) => {
    const time = typeof point?.time === "string" ? point.time.trim() : "";
    const price = Number(point?.price);
    if (!time || !finitePositive(price)) return result;

    result.push({
      // This is the index in the valid chronological minute sequence, so
      // `ageBars` never counts a malformed source row as a market bar.
      index: result.length,
      time,
      price,
      // `null` means the source did not provide a usable per-minute volume.
      // It must not silently be treated as zero in a VWAP calculation.
      volume: finiteNonNegative(point?.volume) ? Number(point.volume) : null,
    });
    return result;
  }, []);
}

function latestExtremum(points, side) {
  let selected = null;
  for (const point of points) {
    if (!selected
      || (side === "low" && point.price <= selected.price)
      || (side === "high" && point.price >= selected.price)) {
      // On a tie prefer the newer bar: it is the closest observed reference.
      selected = point;
    }
  }
  return selected;
}

function describePosition(value) {
  if (value === null) return { key: "unavailable", label: "位置待计算" };
  if (value <= 15) return { key: "near-low", label: "日内下沿附近" };
  if (value < 40) return { key: "lower", label: "日内下部" };
  if (value <= 60) return { key: "middle", label: "日内中部" };
  if (value < 85) return { key: "upper", label: "日内上部" };
  return { key: "near-high", label: "日内上沿附近" };
}

function recentWindowBars(value, available) {
  const requested = Math.trunc(Number(value));
  const normalized = Number.isFinite(requested) && requested > 0
    ? requested
    : DEFAULT_RECENT_WINDOW_BARS;
  return Math.min(available, Math.max(1, normalized));
}

function calculateVwap(points) {
  const priceAverage = points.reduce((sum, point) => sum + point.price, 0) / points.length;
  const volumeMinutes = points.filter(point => point.volume !== null);
  const totalVolume = volumeMinutes.reduce((sum, point) => sum + point.volume, 0);
  const hasCompleteVolume = volumeMinutes.length === points.length && totalVolume > 0;

  if (hasCompleteVolume) {
    const tradedValue = points.reduce((sum, point) => sum + point.price * point.volume, 0);
    return {
      value: tradedValue / totalVolume,
      method: "volume-weighted",
      label: "成交量加权均价",
      isFallback: false,
      note: "全部有效分钟均提供成交量，按成交量加权计算。",
      priceAverage,
      totalVolume,
      volumeCoverage: {
        usableMinutes: volumeMinutes.length,
        totalMinutes: points.length,
        complete: true,
      },
    };
  }

  const reason = volumeMinutes.length === 0
    ? "成交量未提供"
    : totalVolume === 0 && volumeMinutes.length === points.length
      ? "成交量合计为零"
      : "成交量不完整";
  return {
    value: priceAverage,
    method: "price-average-fallback",
    label: "价格平均（成交量不可用）",
    isFallback: true,
    fallbackReason: reason,
    note: `${reason}；当前显示价格平均，不是成交量加权均价。`,
    priceAverage,
    totalVolume,
    volumeCoverage: {
      usableMinutes: volumeMinutes.length,
      totalMinutes: points.length,
      complete: false,
    },
  };
}

function referenceFrom(point, latestIndex, label, kind) {
  if (!point) return null;
  return {
    price: point.price,
    time: point.time,
    ageBars: latestIndex - point.index,
    kind,
    label,
    causal: true,
    // These are observed extrema, not forecasted or independently confirmed
    // support/resistance levels.
    confirmed: false,
  };
}

function rhythmFor({ amplitudePct, position, latestPrice, vwap }) {
  const amplitudeKey = amplitudePct === null
    ? "unknown-range"
    : amplitudePct < 0.8
      ? "quiet-range"
      : amplitudePct < 2
        ? "normal-range"
        : "wide-range";
  const amplitudeLabel = {
    "unknown-range": "区间待补全",
    "quiet-range": "窄幅整理",
    "normal-range": "区间运行",
    "wide-range": "波动展开",
  }[amplitudeKey];

  const vwapDeviationPct = percent(latestPrice - vwap.value, vwap.value);
  const vwapKey = vwapDeviationPct === null
    ? "unavailable"
    : Math.abs(vwapDeviationPct) <= VWAP_NEAR_THRESHOLD * 100
      ? "near"
      : vwapDeviationPct > 0
        ? "above"
        : "below";
  const vwapLabel = {
    unavailable: "均价待计算",
    near: "贴近均价",
    above: "位于均价上方",
    below: "位于均价下方",
  }[vwapKey];
  const amplitudeText = amplitudePct === null ? "振幅待补全" : `日内振幅 ${amplitudePct.toFixed(2)}%`;

  return {
    status: amplitudeKey,
    key: amplitudeKey,
    label: amplitudeLabel,
    position,
    vwapRelation: { key: vwapKey, label: vwapLabel, deviationPct: vwapDeviationPct },
    explanation: `${amplitudeText}，最新价${position.label}，${vwapLabel}；仅描述已发生的日内节奏。`,
    isSignal: false,
  };
}

/**
 * Calculate light, factual intraday measurements from a chronological minute
 * prefix.  Invalid rows are ignored; the input array and its items are never
 * modified.
 *
 * @param {Array<{time: string, price: number, volume?: number}>} minutes
 * @param {number | null | undefined} previousClose
 * @param {{recentWindowBars?: number}} [options]
 */
export function buildRabbitStudioMetrics(minutes = [], previousClose = null, options = {}) {
  const points = normalizeMinutes(minutes);
  const previousCloseValue = finitePositive(previousClose) ? Number(previousClose) : null;

  if (!points.length) {
    return {
      ...RABBIT_STUDIO_METRICS_CONTRACT,
      available: false,
      reason: "暂无有效日内价格",
      validMinutes: 0,
      latest: null,
      vwap: null,
      dayRange: null,
      supportResistance: null,
      tSpace: null,
      rhythm: {
        status: "unavailable",
        key: "unavailable",
        label: "等待行情",
        explanation: "暂无有效分钟价格，无法描述日内节奏。",
        isSignal: false,
      },
    };
  }

  const latestIndex = points.length - 1;
  const latest = points[latestIndex];
  const vwap = calculateVwap(points);
  const low = latestExtremum(points, "low");
  const high = latestExtremum(points, "high");
  const range = high.price - low.price;
  const amplitudeReference = previousCloseValue ?? points[0].price;
  const amplitudeBasis = previousCloseValue === null
    ? "first-available-price-fallback"
    : "previous-close";
  const amplitudePct = percent(range, amplitudeReference);
  const isFlatRange = range === 0;
  const pricePositionPct = isFlatRange
    ? 50
    : clamp(((latest.price - low.price) / range) * 100, 0, 100);
  const position = isFlatRange
    ? { key: "flat", label: "平价区间" }
    : describePosition(pricePositionPct);

  const lookbackBars = recentWindowBars(options?.recentWindowBars, points.length);
  const recentPoints = points.slice(-lookbackBars);
  const recentLow = latestExtremum(recentPoints, "low");
  const recentHigh = latestExtremum(recentPoints, "high");
  const support = referenceFrom(recentLow, latestIndex, "近期低点参考", "recent-low");
  const resistance = referenceFrom(recentHigh, latestIndex, "近期高点参考", "recent-high");
  const recentGrossSpread = resistance.price - support.price;
  const spreadReference = previousCloseValue ?? latest.price;
  const spreadReferenceBasis = previousCloseValue === null
    ? "latest-price-fallback"
    : "previous-close";

  const dayRange = {
    high: referenceFrom(high, latestIndex, "日内最高", "day-high"),
    low: referenceFrom(low, latestIndex, "日内最低", "day-low"),
    spread: range,
    amplitudePct,
    amplitudeReference,
    amplitudeBasis,
    isFlatRange,
    pricePositionPct,
    position,
    distanceToHigh: high.price - latest.price,
    distanceToLow: latest.price - low.price,
  };
  const rhythm = rhythmFor({ amplitudePct, position, latestPrice: latest.price, vwap });

  return {
    ...RABBIT_STUDIO_METRICS_CONTRACT,
    available: true,
    reason: null,
    validMinutes: points.length,
    latest: {
      time: latest.time,
      price: latest.price,
      changePct: previousCloseValue === null ? null : percent(latest.price - previousCloseValue, previousCloseValue),
      previousClose: previousCloseValue,
    },
    vwap,
    dayRange,
    supportResistance: {
      method: "causal-recent-extrema",
      lookbackBars,
      asOfTime: latest.time,
      support,
      resistance,
      note: "仅取截至当前分钟的最近高低价参考，不使用未来数据，也不代表已确认的交易位。",
    },
    tSpace: {
      sessionGrossSpread: range,
      sessionGrossSpreadPct: percent(range, spreadReference),
      recentGrossSpread,
      recentGrossSpreadPct: percent(recentGrossSpread, spreadReference),
      referencePrice: spreadReference,
      referenceBasis: spreadReferenceBasis,
      currentToSupport: latest.price - support.price,
      currentToResistance: resistance.price - latest.price,
      note: "毛价差仅为已发生区间，不含手续费、滑点、仓位或成交可行性，不代表可获得收益。",
    },
    rhythm,
  };
}

// More explicit alias for callers that prefer a calculation-oriented name.
export const calculateRabbitStudioIntradayMetrics = buildRabbitStudioMetrics;
