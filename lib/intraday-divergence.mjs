const DEFAULTS = Object.freeze({
  pivotRadius: 3,
  confirmationBars: 3,
  minimumPivotGap: 5,
  maximumPivotGap: 80,
  maximumSignalAge: 12,
  minimumHistory: 35,
  minimumPriceExtensionPct: 0.12,
  maximumVolumeRatio: 0.88,
  minimumMacdImprovementPct: 0.015,
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pct(current, reference) {
  if (!Number.isFinite(current) || !Number.isFinite(reference) || reference === 0) return 0;
  return ((current - reference) / reference) * 100;
}

function ema(values, period) {
  if (!values.length) return [];
  const alpha = 2 / (period + 1);
  const result = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    result.push((values[index] * alpha) + (result[index - 1] * (1 - alpha)));
  }
  return result;
}

function macdDif(prices) {
  const fast = ema(prices, 12);
  const slow = ema(prices, 26);
  return prices.map((_, index) => fast[index] - slow[index]);
}

function localVolume(points, index, radius = 1) {
  const start = Math.max(0, index - radius);
  const end = Math.min(points.length - 1, index + radius);
  let total = 0;
  let count = 0;
  for (let cursor = start; cursor <= end; cursor += 1) {
    total += Math.max(0, finite(points[cursor]?.volume));
    count += 1;
  }
  return count ? total / count : 0;
}

function isPivot(prices, index, radius, kind) {
  const value = prices[index];
  if (!Number.isFinite(value) || index < radius || index + radius >= prices.length) return false;
  let hasStrictNeighbour = false;
  for (let cursor = index - radius; cursor <= index + radius; cursor += 1) {
    if (cursor === index) continue;
    const neighbour = prices[cursor];
    if (kind === "high" && neighbour > value) return false;
    if (kind === "low" && neighbour < value) return false;
    if (neighbour !== value) hasStrictNeighbour = true;
  }
  return hasStrictNeighbour;
}

function confirmedPivots(points, limit, kind, settings, dif) {
  const prices = points.map((point) => finite(point?.price, Number.NaN));
  const latestConfirmable = limit - settings.confirmationBars;
  const result = [];
  for (let index = settings.pivotRadius; index <= latestConfirmable; index += 1) {
    if (!isPivot(prices, index, settings.pivotRadius, kind)) continue;
    result.push({
      index,
      time: points[index]?.time ?? null,
      price: prices[index],
      volume: localVolume(points, index),
      dif: dif[index],
    });
  }
  return result;
}

function lastComparablePair(pivots, settings) {
  for (let latestIndex = pivots.length - 1; latestIndex > 0; latestIndex -= 1) {
    const latest = pivots[latestIndex];
    for (let previousIndex = latestIndex - 1; previousIndex >= 0; previousIndex -= 1) {
      const previous = pivots[previousIndex];
      const gap = latest.index - previous.index;
      if (gap < settings.minimumPivotGap) continue;
      if (gap > settings.maximumPivotGap) break;
      return { previous, latest, gap };
    }
  }
  return null;
}

function neutral(direction, reason) {
  return {
    available: false,
    direction,
    aligned: false,
    conflict: false,
    combined: false,
    strength: 0,
    signal: "none",
    volumePrice: { confirmed: false, priceExtensionPct: 0, volumeRatio: 0 },
    macd: { confirmed: false, improvementPct: 0 },
    pivot: null,
    reason,
  };
}

/**
 * Causal intraday divergence evidence.
 *
 * The detector never reads an item after `index`. A pivot at P becomes visible
 * only after `confirmationBars` later points have already arrived. It is an
 * evidence module, not an execution rule: callers decide whether the evidence
 * confirms or conflicts with their existing trend/VWAP gates.
 */
export function evaluateIntradayDivergence(points, index, direction, overrides = {}) {
  const settings = { ...DEFAULTS, ...overrides };
  const limit = Math.min(Math.max(0, Math.trunc(finite(index))), points.length - 1);
  if (!["BUY_FIRST", "SELL_FIRST"].includes(direction)) {
    return neutral(direction, "缺少有效方向");
  }
  if (limit + 1 < settings.minimumHistory) {
    return neutral(direction, "历史分钟不足");
  }

  const causalPoints = points.slice(0, limit + 1);
  const prices = causalPoints.map((point) => finite(point?.price, Number.NaN));
  if (prices.some((price) => !Number.isFinite(price) || price <= 0)) {
    return neutral(direction, "价格数据无效");
  }
  const dif = macdDif(prices);
  const kind = direction === "BUY_FIRST" ? "low" : "high";
  const pair = lastComparablePair(
    confirmedPivots(causalPoints, limit, kind, settings, dif),
    settings,
  );
  if (!pair || limit - pair.latest.index > settings.maximumSignalAge) {
    return neutral(direction, "近期没有完成确认的同类枢轴");
  }

  const priceExtensionPct = direction === "BUY_FIRST"
    ? pct(pair.previous.price, pair.latest.price)
    : pct(pair.latest.price, pair.previous.price);
  const volumeRatio = pair.previous.volume > 0
    ? pair.latest.volume / pair.previous.volume
    : 0;
  const volumePriceConfirmed = priceExtensionPct >= settings.minimumPriceExtensionPct
    && volumeRatio > 0
    && volumeRatio <= settings.maximumVolumeRatio;

  // Normalize DIF change by price so high- and low-priced shares are
  // comparable. Bullish divergence requires a higher DIF at a lower low;
  // bearish divergence requires a lower DIF at a higher high.
  const rawDifImprovement = direction === "BUY_FIRST"
    ? pair.latest.dif - pair.previous.dif
    : pair.previous.dif - pair.latest.dif;
  const improvementPct = (rawDifImprovement / Math.max(0.01, pair.latest.price)) * 100;
  const macdConfirmed = priceExtensionPct >= settings.minimumPriceExtensionPct
    && improvementPct >= settings.minimumMacdImprovementPct;

  const strength = Number(volumePriceConfirmed) + Number(macdConfirmed);
  const signal = direction === "BUY_FIRST" ? "bullish" : "bearish";
  return {
    available: true,
    direction,
    aligned: strength > 0,
    conflict: false,
    combined: strength === 2,
    strength,
    signal: strength > 0 ? signal : "none",
    volumePrice: {
      confirmed: volumePriceConfirmed,
      priceExtensionPct,
      volumeRatio,
    },
    macd: {
      confirmed: macdConfirmed,
      improvementPct,
    },
    pivot: {
      previousIndex: pair.previous.index,
      previousTime: pair.previous.time,
      previousPrice: pair.previous.price,
      latestIndex: pair.latest.index,
      latestTime: pair.latest.time,
      latestPrice: pair.latest.price,
      confirmationIndex: pair.latest.index + settings.confirmationBars,
      age: limit - pair.latest.index,
    },
    reason: strength === 2
      ? `${signal === "bullish" ? "底" : "顶"}部量价与MACD背离同时确认`
      : volumePriceConfirmed
        ? `${signal === "bullish" ? "底" : "顶"}部量价背离确认`
        : macdConfirmed
          ? `${signal === "bullish" ? "底" : "顶"}部MACD背离确认`
          : "枢轴已确认，但背离强度不足",
  };
}

export { DEFAULTS as INTRADAY_DIVERGENCE_DEFAULTS };
