import { isAShareRegularTradingMinute } from "./intraday-axis.mjs";

export const ZIJIN_EXPERIMENTAL_REMINDER = Object.freeze({
  code: "601899",
  id: "zijin-volume-vwap-turn-v1",
  minimumVolumeRatio: 2,
  maximumVolumeRatio: 3,
  armedMinutes: 10,
  volumeLookback: 20,
  minimumVwapDeviationPct: 0.35,
  minimumRegimeSlopePct: 0.10,
  signalStart: "0930",
  signalEnd: "1430",
  minimumProtectedNetPct: 0.20,
  maximumProtectedNetPct: 0.30,
  protectedGivebackPct: 0.05,
  estimatedRoundTripCostPct: 0.12,
  failureReviewMinutes: 7,
  invalidationGraceMinutes: 99,
  invalidationBufferPct: 99,
  maximumHoldMinutes: 15,
  maximumRemindersPerDay: 1,
});

const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));
const mean = (values) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : 0;
const pct = (from, to) => from > 0 ? ((to - from) / from) * 100 : 0;

function sanitizeMinutes(minutes) {
  const seen = new Map();
  for (const minute of Array.isArray(minutes) ? minutes : []) {
    const time = String(minute?.time ?? "").replace(/\D/g, "").slice(0, 4);
    const price = Number(minute?.price);
    const volume = Math.max(0, Number(minute?.volume) || 0);
    if (!isAShareRegularTradingMinute(time) || !Number.isFinite(price) || price <= 0) continue;
    seen.set(time, { time, price, volume });
  }
  return [...seen.values()].sort((left, right) => left.time.localeCompare(right.time));
}

function cumulativeVwaps(points) {
  let amount = 0;
  let volume = 0;
  return points.map((point) => {
    amount += point.price * point.volume;
    volume += point.volume;
    return volume > 0 ? amount / volume : point.price;
  });
}

function volumeRatioAt(points, index, lookback) {
  const history = points
    .slice(Math.max(0, index - lookback), index)
    .map((point) => point.volume)
    .filter((value) => value > 0);
  const baseline = mean(history);
  return baseline > 0 ? points[index].volume / baseline : 1;
}

function armedPeakVolumeRatio(points, index, config) {
  let peak = 1;
  for (let cursor = Math.max(1, index - config.armedMinutes); cursor <= index; cursor += 1) {
    peak = Math.max(peak, volumeRatioAt(points, cursor, config.volumeLookback));
  }
  return peak;
}

function regimeAt(vwaps, index, config) {
  const regimeEnd = Math.max(1, index - 3);
  const regimeStart = Math.max(0, regimeEnd - 8);
  const slopePct = pct(vwaps[regimeStart], vwaps[regimeEnd]);
  const direction = slopePct >= config.minimumRegimeSlopePct
    ? "UP"
    : slopePct <= -config.minimumRegimeSlopePct
      ? "DOWN"
      : "FLAT";
  return { direction, slopePct };
}

function favorableMovePct(direction, entryPrice, currentPrice) {
  return direction === "正T"
    ? pct(entryPrice, currentPrice)
    : pct(currentPrice, entryPrice);
}

function invalidationBreakPct(direction, invalidationPrice, currentPrice) {
  return direction === "正T"
    ? pct(currentPrice, invalidationPrice)
    : pct(invalidationPrice, currentPrice);
}

function detectAt(points, vwaps, index, config) {
  if (index < 6) return null;
  const currentPoint = points[index];
  if (currentPoint.time < config.signalStart || currentPoint.time > config.signalEnd) return null;

  const peakVolumeRatio = armedPeakVolumeRatio(points, index, config);
  if (peakVolumeRatio < config.minimumVolumeRatio || peakVolumeRatio > config.maximumVolumeRatio) return null;

  const current = currentPoint.price;
  const previous = points[index - 1].price;
  const vwap = vwaps[index];
  const vwapBiasPct = pct(vwap, current);
  const local = points.slice(Math.max(0, index - 10), index + 1).map((point) => point.price);
  const localLow = Math.min(...local);
  const localHigh = Math.max(...local);
  const lowAge = local.length - 1 - local.lastIndexOf(localLow);
  const highAge = local.length - 1 - local.lastIndexOf(localHigh);
  const regime = regimeAt(vwaps, index, config);
  const regimeSlopePct = regime.slopePct;

  const positive = vwapBiasPct <= -config.minimumVwapDeviationPct
    && regime.direction === "UP"
    && lowAge >= 1
    && current > previous;
  const reverse = vwapBiasPct >= config.minimumVwapDeviationPct
    && regime.direction === "DOWN"
    && highAge >= 1
    && current < previous;
  if (!positive && !reverse) return null;

  const direction = positive ? "正T" : "反T";
  return {
    id: config.id,
    stage: "experimental-candidate",
    direction,
    asOfTime: currentPoint.time,
    price: round(current),
    vwap: round(vwap),
    vwapBiasPct: round(vwapBiasPct),
    volumeRatio: round(peakVolumeRatio),
    regime: regime.direction,
    regimeSlopePct: round(regimeSlopePct),
    signalIndex: index,
    invalidationPrice: round(positive ? localLow : localHigh),
    executable: false,
    affectsV4: false,
    title: `实验观察 · ${direction}${positive ? "止跌拐头" : "冲高拐头"}`,
    reason: `${peakVolumeRatio.toFixed(2)}倍量，距VWAP ${Math.abs(vwapBiasPct).toFixed(2)}%，此前${positive ? "上行" : "下行"}结构中出现实时拐头。`,
    plan: `仅进入前向观察；下一分钟模拟成交，${config.failureReviewMinutes} 分钟仍未覆盖成本则退出，扣费后保护区间 ${config.minimumProtectedNetPct.toFixed(2)}%–${config.maximumProtectedNetPct.toFixed(2)}%，最长观察 ${config.maximumHoldMinutes} 分钟。`,
  };
}

function lifecycleExitAt(points, signal, config) {
  const entryIndex = signal.signalIndex + 1;
  if (entryIndex >= points.length) return null;
  const entry = points[entryIndex];
  let bestNetProgressPct = Number.NEGATIVE_INFINITY;

  for (let index = entryIndex + 1; index < points.length; index += 1) {
    const current = points[index];
    const elapsedMinutes = index - entryIndex;
    const rawProgressPct = favorableMovePct(signal.direction, entry.price, current.price);
    const netProgressPct = rawProgressPct - config.estimatedRoundTripCostPct;
    bestNetProgressPct = Math.max(bestNetProgressPct, netProgressPct);
    const invalidated = elapsedMinutes >= config.invalidationGraceMinutes
      && invalidationBreakPct(signal.direction, signal.invalidationPrice, current.price) >= config.invalidationBufferPct;
    const maximumReached = netProgressPct >= config.maximumProtectedNetPct;
    const protectedProfitLost = bestNetProgressPct >= config.minimumProtectedNetPct
      && bestNetProgressPct - netProgressPct >= config.protectedGivebackPct;
    const noProgress = elapsedMinutes >= config.failureReviewMinutes
      && bestNetProgressPct < 0;
    const timedOut = elapsedMinutes >= config.maximumHoldMinutes;
    const exitReason = invalidated
      ? "TURN_INVALIDATED"
      : maximumReached
        ? "MAX_PROFIT"
        : protectedProfitLost
          ? "PROFIT_TRAIL"
          : noProgress
            ? "NO_PROGRESS"
            : timedOut
              ? "MAX_HOLD"
              : null;
    if (!exitReason) continue;
    if (index !== points.length - 1) return null;

    const reasonText = exitReason === "TURN_INVALIDATED"
      ? `${signal.direction === "正T" ? "止跌后又创新低" : "冲高回落后又创新高"}，原拐头失效`
      : exitReason === "MAX_PROFIT"
        ? `扣除估算成本后已达到 ${netProgressPct.toFixed(2)}% 保护上限`
        : exitReason === "PROFIT_TRAIL"
          ? `曾达到 ${bestNetProgressPct.toFixed(2)}% 净进展，随后回吐`
          : exitReason === "NO_PROGRESS"
            ? `${elapsedMinutes} 分钟内最好净进展仍为 ${bestNetProgressPct.toFixed(2)}%，未覆盖成本`
            : `已观察 ${elapsedMinutes} 分钟，达到最长持有时间`;
    return {
      id: config.id,
      stage: "experimental-exit",
      direction: signal.direction,
      regime: signal.regime,
      asOfTime: current.time,
      price: round(current.price),
      vwap: signal.vwap,
      vwapBiasPct: signal.vwapBiasPct,
      volumeRatio: signal.volumeRatio,
      regimeSlopePct: signal.regimeSlopePct,
      entryTime: entry.time,
      entryPrice: round(entry.price),
      elapsedMinutes,
      netProgressPct: round(netProgressPct),
      bestNetProgressPct: round(bestNetProgressPct),
      exitReason,
      executable: false,
      affectsV4: false,
      title: `实验退出 · ${signal.direction}${exitReason === "MAX_PROFIT" || exitReason === "PROFIT_TRAIL" ? "保护利润" : "观察失效"}`,
      reason: `${reasonText}。`,
      plan: "仅结束本次实验观察；按下一分钟价格模拟退出，不影响 V4，也不是买卖指令。",
    };
  }
  return null;
}

/**
 * Causal, observation-only Zijin reminder.
 * It reads only the supplied prefix and only emits the first qualified event
 * of the day, so refreshing or appending later minutes cannot manufacture a
 * second reminder from hindsight.
 */
export function evaluateZijinExperimentalReminder(minutes, options = {}) {
  const config = { ...ZIJIN_EXPERIMENTAL_REMINDER, ...options };
  const points = sanitizeMinutes(minutes);
  if (points.length < 7) return null;
  const vwaps = cumulativeVwaps(points);
  let first = null;
  for (let index = 6; index < points.length; index += 1) {
    first = detectAt(points, vwaps, index, config);
    if (first) break;
  }
  if (!first) return null;
  if (first.asOfTime === points.at(-1).time) return first;
  return lifecycleExitAt(points, first, config);
}
