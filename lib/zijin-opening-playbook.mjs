import { aShareMinuteSlot, isAShareRegularTradingMinute } from "./intraday-axis.mjs";

export const ZIJIN_OPENING_PLAYBOOK = Object.freeze({
  code: "601899",
  name: "紫金矿业早盘高波动观察",
  evaluationStart: "09:35",
  evaluationEnd: "10:30",
  minimumPoints: 6,
  rangeThresholdPct: 0.65,
  structureThresholdPct: 0.32,
  momentumThresholdPct: 0.12,
  minimumVolumeRatio: 1.05,
  candidateScore: 75,
  extremeRangePct: 4.5,
  extremeVolumeRatio: 8,
});

const round = (value, digits = 4) => Number(Number(value || 0).toFixed(digits));
const pct = (value, base) => base > 0 ? ((value - base) / base) * 100 : 0;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function sanitizePrefix(minutes) {
  const bySlot = new Map();
  for (const minute of Array.isArray(minutes) ? minutes : []) {
    const price = Number(minute?.price);
    const volume = Math.max(0, Number(minute?.volume) || 0);
    if (!Number.isFinite(price) || price <= 0 || !isAShareRegularTradingMinute(minute?.time)) continue;
    const slot = aShareMinuteSlot(minute.time);
    bySlot.set(slot, { time: String(minute.time), price, volume, slot });
  }
  return [...bySlot.values()].sort((left, right) => left.slot - right.slot);
}

function cumulativeVwap(points) {
  const positiveVolume = points.reduce((sum, point) => sum + point.volume, 0);
  if (positiveVolume > 0) {
    return points.reduce((sum, point) => sum + point.price * point.volume, 0) / positiveVolume;
  }
  return points.reduce((sum, point) => sum + point.price, 0) / Math.max(1, points.length);
}

function recentVolumeRatio(points) {
  if (points.length < 6) return null;
  const recent = points.slice(-3).map((point) => point.volume).filter((value) => value > 0);
  const baseline = points.slice(Math.max(0, points.length - 23), -3)
    .map((point) => point.volume)
    .filter((value) => value > 0);
  if (!recent.length || !baseline.length) return null;
  const recentAverage = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const baselineAverage = baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
  return baselineAverage > 0 ? recentAverage / baselineAverage : null;
}

function emptyMetrics() {
  return {
    latestPrice: null,
    vwap: null,
    openingRangePct: 0,
    distanceToVwapPct: 0,
    recoveryFromLowPct: 0,
    pullbackFromHighPct: 0,
    volumeRatio: null,
  };
}

function baseResult(status, asOfTime, usedPoints, reasons, metrics = emptyMetrics()) {
  return {
    code: ZIJIN_OPENING_PLAYBOOK.code,
    playbook: ZIJIN_OPENING_PLAYBOOK.name,
    layer: "candidate-observation",
    status,
    direction: null,
    score: 0,
    asOfTime,
    usedPoints,
    reasons,
    metrics,
  };
}

function sideScore({ rangePct, structurePct, distanceToVwapPct, momentumPct, volumeRatio }, direction) {
  const positive = direction === "正T";
  const structure = structurePct;
  const vwapConfirmed = positive ? distanceToVwapPct >= -0.10 : distanceToVwapPct <= 0.10;
  const momentumConfirmed = positive
    ? momentumPct >= ZIJIN_OPENING_PLAYBOOK.momentumThresholdPct
    : momentumPct <= -ZIJIN_OPENING_PLAYBOOK.momentumThresholdPct;
  const volumeConfirmed = volumeRatio !== null && volumeRatio >= ZIJIN_OPENING_PLAYBOOK.minimumVolumeRatio;

  let score = clamp(rangePct / ZIJIN_OPENING_PLAYBOOK.rangeThresholdPct, 0, 1) * 25;
  score += clamp(structure / 0.45, 0, 1) * 25;
  score += vwapConfirmed ? 20 : clamp(1 - Math.abs(distanceToVwapPct) / 0.5, 0, 1) * 8;
  score += momentumConfirmed ? 15 : 0;
  if (volumeRatio !== null) {
    score += volumeRatio >= 1.5 ? 15 : volumeRatio >= 1.2 ? 12 : volumeConfirmed ? 8 : 0;
  }

  const notChasing = positive ? distanceToVwapPct <= 1.2 : distanceToVwapPct >= -1.2;
  return {
    score: Math.round(clamp(score, 0, 100)),
    candidate: rangePct >= ZIJIN_OPENING_PLAYBOOK.rangeThresholdPct
      && structure >= ZIJIN_OPENING_PLAYBOOK.structureThresholdPct
      && vwapConfirmed
      && momentumConfirmed
      && volumeConfirmed
      && notChasing,
    vwapConfirmed,
    momentumConfirmed,
    volumeConfirmed,
    notChasing,
  };
}

/**
 * Evaluate Zijin Mining's opening-volatility observation playbook.
 *
 * This function is deliberately causal: it only reads the minute prefix supplied by
 * the caller. It never searches later minutes for a better peak, valley or outcome.
 * A candidate result is research context only and must not create an order by itself.
 *
 * @param {{time:string,price:number,volume:number}[]} minutePrefix minutes observed so far
 * @param {{previousClose?:number|null}} [options]
 */
export function evaluateZijinOpeningPlaybook(minutePrefix, options = {}) {
  const points = sanitizePrefix(minutePrefix);
  if (!points.length) {
    return baseResult("waiting", null, 0, [
      "尚无有效的A股盘中分钟数据，无法评估早盘波动。",
      "该逻辑只是候选观察层，不会直接产生买卖成交。",
    ]);
  }

  const latest = points.at(-1);
  const asOfTime = latest.time;
  if (latest.slot < 5) {
    return baseResult("waiting", asOfTime, points.length, [
      `当前仅观察到 ${asOfTime}；09:35 前只积累开盘样本，不判定候选方向。`,
      "不使用之后出现的高点、低点或收盘结果。",
    ]);
  }

  if (latest.slot > 60) {
    return baseResult("blocked", asOfTime, points.length, [
      `当前数据已到 ${asOfTime}，超过早盘专属评估窗口 10:30。`,
      "禁止把后续走势倒灌成早盘信号；如需研究必须重新按分钟前缀回放。",
    ]);
  }

  const observed = points.filter((point) => point.slot <= latest.slot && point.slot <= 60);
  if (observed.length < ZIJIN_OPENING_PLAYBOOK.minimumPoints) {
    return baseResult("waiting", asOfTime, observed.length, [
      `已到评估窗口，但只有 ${observed.length} 个有效分钟点，至少需要 ${ZIJIN_OPENING_PLAYBOOK.minimumPoints} 个。`,
      "分钟点缺失时保持等待，不用插值补出候选信号。",
    ]);
  }

  const first = observed[0];
  const current = observed.at(-1);
  const high = Math.max(...observed.map((point) => point.price));
  const low = Math.min(...observed.map((point) => point.price));
  const reference = Number(options.previousClose) > 0 ? Number(options.previousClose) : first.price;
  const vwap = cumulativeVwap(observed);
  const rangePct = ((high - low) / reference) * 100;
  const distanceToVwapPct = pct(current.price, vwap);
  const recoveryFromLowPct = pct(current.price, low);
  const pullbackFromHighPct = pct(high, current.price);
  const volumeRatio = recentVolumeRatio(observed);
  const momentumBase = observed[Math.max(0, observed.length - 4)].price;
  const momentumPct = pct(current.price, momentumBase);
  const metrics = {
    latestPrice: round(current.price),
    vwap: round(vwap),
    openingRangePct: round(rangePct),
    distanceToVwapPct: round(distanceToVwapPct),
    recoveryFromLowPct: round(recoveryFromLowPct),
    pullbackFromHighPct: round(pullbackFromHighPct),
    volumeRatio: volumeRatio === null ? null : round(volumeRatio),
  };

  if (rangePct >= ZIJIN_OPENING_PLAYBOOK.extremeRangePct
    || (volumeRatio !== null && volumeRatio >= ZIJIN_OPENING_PLAYBOOK.extremeVolumeRatio)) {
    const triggers = [];
    if (rangePct >= ZIJIN_OPENING_PLAYBOOK.extremeRangePct) triggers.push(`早盘振幅 ${rangePct.toFixed(2)}%`);
    if (volumeRatio !== null && volumeRatio >= ZIJIN_OPENING_PLAYBOOK.extremeVolumeRatio) triggers.push(`量比 ${volumeRatio.toFixed(2)}×`);
    return {
      ...baseResult("blocked", asOfTime, observed.length, [], metrics),
      reasons: [
        `${triggers.join("、")} 达到异常波动阈值，候选观察暂停。`,
        "极端波动中优先等待价格与成交量收敛，不把瞬时尖峰当成可执行信号。",
      ],
    };
  }

  const positive = sideScore({
    rangePct,
    structurePct: recoveryFromLowPct,
    distanceToVwapPct,
    momentumPct,
    volumeRatio,
  }, "正T");
  const reverse = sideScore({
    rangePct,
    structurePct: pullbackFromHighPct,
    distanceToVwapPct,
    momentumPct,
    volumeRatio,
  }, "反T");
  const direction = positive.score >= reverse.score ? "正T" : "反T";
  const selected = direction === "正T" ? positive : reverse;
  const competing = direction === "正T" ? reverse : positive;
  const unambiguous = selected.score - competing.score >= 8;
  const candidate = selected.candidate
    && selected.score >= ZIJIN_OPENING_PLAYBOOK.candidateScore
    && unambiguous;

  if (candidate) {
    const movement = direction === "正T" ? recoveryFromLowPct : pullbackFromHighPct;
    const structureText = direction === "正T"
      ? `从已出现低点修复 ${movement.toFixed(2)}%`
      : `从已出现高点回撤 ${movement.toFixed(2)}%`;
    return {
      ...baseResult("candidate", asOfTime, observed.length, [], metrics),
      direction,
      score: selected.score,
      reasons: [
        `早盘振幅 ${rangePct.toFixed(2)}%，达到紫金早盘高波动门槛 ${ZIJIN_OPENING_PLAYBOOK.rangeThresholdPct.toFixed(2)}%。`,
        `${structureText}，当前距 VWAP ${distanceToVwapPct >= 0 ? "+" : ""}${distanceToVwapPct.toFixed(2)}%。`,
        `最近3分钟动量 ${momentumPct >= 0 ? "+" : ""}${momentumPct.toFixed(2)}%，量比 ${volumeRatio?.toFixed(2)}×，${direction}候选确认 ${selected.score} 分。`,
        "仅进入候选观察层；不生成正式成交，仍需 V4 成本、仓位与风控过滤。",
      ],
    };
  }

  const reasons = [];
  if (rangePct < ZIJIN_OPENING_PLAYBOOK.rangeThresholdPct) {
    reasons.push(`早盘振幅 ${rangePct.toFixed(2)}%，未到 ${ZIJIN_OPENING_PLAYBOOK.rangeThresholdPct.toFixed(2)}% 高波动门槛。`);
  }
  const structure = direction === "正T" ? recoveryFromLowPct : pullbackFromHighPct;
  if (structure < ZIJIN_OPENING_PLAYBOOK.structureThresholdPct) {
    reasons.push(`${direction === "正T" ? "低点修复" : "高点回撤"} ${structure.toFixed(2)}%，未到 ${ZIJIN_OPENING_PLAYBOOK.structureThresholdPct.toFixed(2)}% 结构确认。`);
  }
  if (!selected.vwapConfirmed) reasons.push(`当前距 VWAP ${distanceToVwapPct >= 0 ? "+" : ""}${distanceToVwapPct.toFixed(2)}%，尚未确认${direction === "正T" ? "站回" : "失守"} VWAP。`);
  if (!selected.momentumConfirmed) reasons.push(`最近3分钟动量 ${momentumPct >= 0 ? "+" : ""}${momentumPct.toFixed(2)}%，方向连续性不足。`);
  if (!selected.volumeConfirmed) reasons.push(volumeRatio === null
    ? "有效分钟成交量不足，不用伪造量比补齐候选。"
    : `量比 ${volumeRatio.toFixed(2)}×，未到 ${ZIJIN_OPENING_PLAYBOOK.minimumVolumeRatio.toFixed(2)}× 确认门槛。`);
  if (!selected.notChasing) reasons.push(`${direction}方向离 VWAP 过远，拦截追涨或杀跌。`);
  if (!unambiguous) reasons.push(`正T ${positive.score} 分、反T ${reverse.score} 分，方向分歧未拉开。`);
  reasons.push(`当前${direction}仅 ${selected.score} 分，保持观察，不生成正式买卖。`);

  return {
    ...baseResult("watch", asOfTime, observed.length, reasons, metrics),
    direction,
    score: selected.score,
  };
}

