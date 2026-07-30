import { normalizeQmtOrderFlow } from "./qmt-orderflow-confirmation.mjs";

export const ZIJIN_REPAIR_RULES = Object.freeze({
  startTime: "1015",
  minimumVwapDiscountPct: 0.40,
  pivotConfirmationMinutes: 2,
  earlyPivotConfirmationMinutes: 1,
  minimumPivotGap: 5,
  maximumPivotGap: 55,
  minimumEarlyPivotGap: 1,
  maximumEarlyPivotGap: 4,
  maximumNewLowPct: 0.12,
  maximumHigherSecondLowPct: 0.45,
  minimumMomentum3Pct: 0.08,
  maximumPullbackVolumeRatio: 1.15,
  minimumActiveBuyRatio: 0.52,
  minimumL2ConsecutiveMinutes: 3,
  minimumSoftScore: 70,
  maximumCandidateAgeMinutes: 15,
  maximumExtensionFromSecondLowPct: 0.75,
  maximumWatchExtensionFromSecondLowPct: 0.35,
  maximumWatchVwapBiasPct: -0.10,
  minimumActiveBuyRatioImprovement: 0.04,
  maximumRelativeSellPressure: 0.80,
});

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value, digits = 3) => Number(Number(value ?? 0).toFixed(digits));
const pct = (value, base) => base > 0 ? (value - base) / base * 100 : 0;

function normalizeTime(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function normalizeMinutes(minutes) {
  const seen = new Map();
  for (const row of Array.isArray(minutes) ? minutes : []) {
    const time = normalizeTime(row?.time ?? row?.exchangeMinute);
    const price = finite(row?.price ?? row?.close);
    if (!time || !(price > 0)) continue;
    if (!((time >= "0930" && time <= "1130") || (time >= "1300" && time <= "1500"))) continue;
    seen.set(time, {
      ...row,
      time,
      price,
      volume: Math.max(0, finite(row?.volume) ?? 0),
      amount: Math.max(0, finite(row?.amount) ?? 0),
      averagePrice: finite(row?.averagePrice),
    });
  }
  return [...seen.values()].sort((left, right) => left.time.localeCompare(right.time));
}

function currentTradingSegment(points) {
  const latestTime = points.at(-1)?.time;
  if (!latestTime) return [];
  return latestTime >= "1300"
    ? points.filter(point => point.time >= "1300")
    : points.filter(point => point.time <= "1130");
}

function mean(values) {
  const clean = values.filter(value => Number.isFinite(value));
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function buildVwapSeries(points) {
  let amount = 0;
  let volume = 0;
  let simple = 0;
  return points.map((point, index) => {
    amount += point.amount;
    volume += point.volume;
    simple += point.price;
    if (point.averagePrice > 0) return point.averagePrice;
    if (amount > 0 && volume > 0) return amount / volume;
    if (volume > 0) {
      const weighted = points.slice(0, index + 1)
        .reduce((sum, item) => sum + item.price * item.volume, 0);
      return weighted / volume;
    }
    return simple / (index + 1);
  });
}

function confirmedPivotLows(points, confirmation) {
  const pivots = [];
  for (let index = confirmation; index < points.length - confirmation; index += 1) {
    const left = points.slice(index - confirmation, index);
    const right = points.slice(index + 1, index + 1 + confirmation);
    const price = points[index].price;
    if (left.every(point => price <= point.price) && right.every(point => price <= point.price)) {
      pivots.push({ index, time: points[index].time, price });
    }
  }
  return pivots;
}

function bottomPair(points, rules, minimumGap, maximumGap, confirmation = rules.pivotConfirmationMinutes) {
  const pivots = confirmedPivotLows(points, confirmation);
  for (let secondIndex = pivots.length - 1; secondIndex >= 1; secondIndex -= 1) {
    const second = pivots[secondIndex];
    for (let firstIndex = secondIndex - 1; firstIndex >= 0; firstIndex -= 1) {
      const first = pivots[firstIndex];
      const gap = second.index - first.index;
      if (gap > maximumGap) break;
      if (gap < minimumGap) continue;
      const changePct = pct(second.price, first.price);
      if (changePct >= -rules.maximumNewLowPct && changePct <= rules.maximumHigherSecondLowPct) {
        return { first, second, changePct };
      }
    }
  }
  return null;
}

function secondBottomPair(points, rules) {
  return bottomPair(points, rules, rules.minimumPivotGap, rules.maximumPivotGap);
}

function earlyBottomPair(points, rules) {
  return bottomPair(
    points,
    rules,
    rules.minimumEarlyPivotGap,
    rules.maximumEarlyPivotGap,
    rules.earlyPivotConfirmationMinutes,
  );
}

function volumeContraction(points, secondIndex, rules) {
  const pullback = points.slice(Math.max(0, secondIndex - 2), secondIndex + 1)
    .map(point => point.volume)
    .filter(value => value > 0);
  const baseline = points.slice(Math.max(0, secondIndex - 12), Math.max(0, secondIndex - 2))
    .map(point => point.volume)
    .filter(value => value > 0);
  const pullbackMean = mean(pullback);
  const baselineMean = mean(baseline);
  if (!(pullbackMean > 0) || !(baselineMean > 0)) {
    return { available: false, pass: false, ratio: null };
  }
  const ratio = pullbackMean / baselineMean;
  return { available: true, pass: ratio <= rules.maximumPullbackVolumeRatio, ratio };
}

function l2BuyRecovery(points, index, rules) {
  const required = Math.max(2, rules.minimumL2ConsecutiveMinutes);
  const recent = points.slice(Math.max(0, index - required + 1), index + 1)
    .map(point => normalizeQmtOrderFlow(point));
  const samples = recent.map(flow => {
    const buy = flow.activeBuyVolume ?? 0;
    const sell = flow.activeSellVolume ?? 0;
    const total = buy + sell;
    const ratio = flow.activeBuyRatio ?? (total > 0 ? buy / total : null);
    const available = ratio !== null
      && flow.status?.authorized !== false
      && flow.status?.stale !== true;
    const aligned = available
      && ratio >= rules.minimumActiveBuyRatio
      && (flow.ddx === null || flow.ddx >= 0)
      && (flow.bigOrderNet === null || flow.bigOrderNet >= 0);
    return {
      available,
      aligned,
      ratio,
      buy,
      sell,
      net: flow.ddx,
      bigOrderNet: flow.bigOrderNet,
    };
  });
  const available = samples.filter(sample => sample.available);
  const aligned = samples.filter(sample => sample.aligned);
  const first = available[0] ?? null;
  const latest = available.at(-1) ?? null;
  const ratioImproving = Boolean(
    first
    && latest
    && latest !== first
    && latest.ratio >= first.ratio + rules.minimumActiveBuyRatioImprovement,
  );
  const sellPressureEasing = Boolean(
    first
    && latest
    && latest !== first
    && first.sell > 0
    && latest.sell <= first.sell * rules.maximumRelativeSellPressure
    && latest.ratio >= 0.45,
  );
  const netFlowTurning = Boolean(
    first
    && latest
    && latest !== first
    && Number.isFinite(first.net)
    && Number.isFinite(latest.net)
    && first.net < 0
    && latest.net >= 0,
  );
  return {
    available: available.length > 0,
    pass: samples.length === required && aligned.length === required,
    aligned: aligned.length,
    samples: available.length,
    required,
    activeBuyRatio: available.at(-1)?.ratio ?? null,
    netActiveNotional: available.at(-1)?.net ?? null,
    bigOrderNet: available.at(-1)?.bigOrderNet ?? null,
    improving: ratioImproving || sellPressureEasing || netFlowTurning,
    ratioImproving,
    sellPressureEasing,
    netFlowTurning,
  };
}

function emptyResult(asOfTime = null, status = "waiting", title = "等待修复结构") {
  return {
    ready: false,
    phase: "repair",
    status,
    direction: "正T",
    score: 0,
    asOfTime,
    title,
    reasons: [],
    hardConditions: { afterStart: false, deepVwapDiscount: false },
    checks: {},
    metrics: {
      price: 0,
      rangePct: 0,
      vwap: null,
      vwapBiasPct: 0,
      deepestBiasPct: 0,
      momentum3Pct: 0,
      pullbackVolumeRatio: null,
      firstLow: null,
      secondLow: null,
      secondLowChangePct: null,
      breakoutPrice: null,
      activeBuyRatio: null,
    },
    candidateKey: null,
    watchKey: null,
    executable: false,
    affectsV4: false,
  };
}

/**
 * Causal, Zijin-only repair candidate.
 *
 * Hard gates are intentionally limited to time and a historical VWAP discount.
 * The remaining evidence advances a watch into a candidate. Missing L2 never
 * fabricates confirmation: it keeps the setup at the observation stage.
 */
export function evaluateZijinRepairCandidate(minutes, options = {}) {
  const rules = {...ZIJIN_REPAIR_RULES, ...options};
  const points = normalizeMinutes(minutes);
  if (!points.length) return emptyResult();
  const latest = points.at(-1);
  const afterStart = latest.time >= rules.startTime;
  if (!afterStart) {
    const result = emptyResult(latest.time, "waiting", `${rules.startTime.slice(0, 2)}:${rules.startTime.slice(2)}后启用`);
    result.hardConditions.afterStart = false;
    return result;
  }

  const vwaps = buildVwapSeries(points);
  const biases = points.map((point, index) => pct(point.price, vwaps[index]));
  // The 11:30-13:00 lunch break is not a continuous three-minute structure.
  // Keep the full-day VWAP, but rebuild pivots, volume, momentum and L2
  // confirmation from the active morning/afternoon segment only.
  const structurePoints = currentTradingSegment(points);
  const structureOffset = Math.max(0, points.length - structurePoints.length);
  const pair = secondBottomPair(structurePoints, rules);
  const earlyPair = pair ? null : earlyBottomPair(structurePoints, rules);
  const analysisPair = pair ?? earlyPair;
  const secondBias = analysisPair ? biases[structureOffset + analysisPair.second.index] : null;
  const deepVwapDiscount = secondBias !== null && secondBias <= -rules.minimumVwapDiscountPct;
  const result = emptyResult(latest.time, "watch", "修复观察");
  result.ready = true;
  result.hardConditions = { afterStart, deepVwapDiscount };

  if (!analysisPair) {
    result.title = "等待二次探底";
    result.reasons = ["10:15后继续观察低位结构，尚未形成两个已确认的局部低点。"];
    result.metrics.vwap = round(vwaps.at(-1));
    result.metrics.vwapBiasPct = round(biases.at(-1));
    result.metrics.deepestBiasPct = round(Math.min(...biases));
    return result;
  }

  const latestIndex = structurePoints.length - 1;
  const age = latestIndex - analysisPair.second.index;
  const momentumBaseIndex = Math.max(analysisPair.second.index, latestIndex - 3);
  const momentum3Pct = pct(latest.price, structurePoints[momentumBaseIndex].price);
  const momentumPositive = age >= 2 && momentum3Pct >= rules.minimumMomentum3Pct;
  const volume = volumeContraction(structurePoints, analysisPair.second.index, rules);
  const localWindow = structurePoints.slice(Math.max(analysisPair.second.index + 1, latestIndex - 3), latestIndex);
  const breakoutPrice = localWindow.length ? Math.max(...localWindow.map(point => point.price)) : analysisPair.second.price;
  const localBreakout = age >= 2 && latest.price > breakoutPrice;
  const l2 = l2BuyRecovery(structurePoints, latestIndex, rules);
  const freshPair = age <= rules.maximumCandidateAgeMinutes;
  const extensionFromSecondLowPct = pct(latest.price, analysisPair.second.price);
  const notExtended = extensionFromSecondLowPct <= rules.maximumExtensionFromSecondLowPct;
  // A "grinding bottom" watch is valid only while price is still in the low
  // value area. Once price has materially rebounded or returned to VWAP, the
  // old pivot remains audit evidence but must not keep producing a live marker.
  const lowZoneWatch = extensionFromSecondLowPct <= rules.maximumWatchExtensionFromSecondLowPct
    && biases.at(-1) <= rules.maximumWatchVwapBiasPct;
  const earlyWatch = deepVwapDiscount
    && freshPair
    && lowZoneWatch
    && l2.available
    && l2.improving;

  const score = Math.round(
    20
    + (deepVwapDiscount ? 20 : 0)
    + (momentumPositive ? 15 : 0)
    + (volume.pass ? 10 : 0)
    + (l2.pass ? 20 : 0)
    + (localBreakout ? 15 : 0),
  );
  const candidate = Boolean(pair)
    && deepVwapDiscount
    && freshPair
    && momentumPositive
    && localBreakout
    && l2.pass
    && notExtended
    && score >= rules.minimumSoftScore;

  result.status = candidate ? "candidate" : "watch";
  result.score = score;
  result.asOfTime = latest.time;
  result.title = candidate
    ? "修复候选"
    : earlyWatch
      ? "磨底预警"
    : !deepVwapDiscount
      ? "偏离不足·继续观察"
      : !freshPair
        ? "修复结构已过期"
        : !momentumPositive
          ? "二次探底·等待转强"
          : !localBreakout
            ? "动量恢复·等待突破"
            : !l2.available
              ? "价格修复·等待L2"
              : "L2尚未持续恢复";
  result.checks = {
    secondBottom: true,
    momentumPositive,
    volumeContraction: volume.pass,
    volumeAvailable: volume.available,
    l2BuyRecovery: l2.pass,
    l2Available: l2.available,
    localBreakout,
    freshPair,
    notExtended,
    lowZoneWatch,
    earlyBottom: Boolean(earlyPair),
    earlyWatch,
    l2PressureEasing: l2.improving,
  };
  result.reasons = [
    `${earlyPair ? "短间隔磨底" : "二次低点"} ${analysisPair.second.time.slice(0, 2)}:${analysisPair.second.time.slice(2)} ¥${analysisPair.second.price.toFixed(2)}，较前低 ${analysisPair.changePct >= 0 ? "+" : ""}${analysisPair.changePct.toFixed(2)}%。`,
    `低点距VWAP ${secondBias >= 0 ? "+" : ""}${secondBias.toFixed(2)}%；3分钟修复动量 ${momentum3Pct >= 0 ? "+" : ""}${momentum3Pct.toFixed(2)}%。`,
    volume.available
      ? `回踩量比 ${volume.ratio.toFixed(2)}×，${volume.pass ? "缩量条件通过" : "缩量尚不明显"}。`
      : "回踩成交量基线不足，不把缺失数据作为否决项。",
    l2.available
      ? `L2主动买恢复 ${l2.aligned}/${l2.samples} 分钟，最新主动买占比 ${(l2.activeBuyRatio * 100).toFixed(1)}%；${l2.improving ? "卖压正在减弱" : "卖压尚未持续减弱"}。`
      : "L2逐笔证据缺失，仅保留修复观察，不升级为候选。",
    localBreakout
      ? `已突破局部小高点 ¥${breakoutPrice.toFixed(2)}。`
      : `等待突破局部小高点 ¥${breakoutPrice.toFixed(2)}。`,
  ];
  result.metrics = {
    price: round(latest.price),
    rangePct: round(
      (Math.max(...points.map(point => point.price)) - Math.min(...points.map(point => point.price)))
      / Math.max(points[0].price, 0.01) * 100,
    ),
    vwap: round(vwaps.at(-1)),
    vwapBiasPct: round(biases.at(-1)),
    deepestBiasPct: round(Math.min(...biases)),
    momentum3Pct: round(momentum3Pct),
    pullbackVolumeRatio: volume.ratio === null ? null : round(volume.ratio),
    firstLow: {...analysisPair.first},
    secondLow: {...analysisPair.second},
    secondLowChangePct: round(analysisPair.changePct),
    breakoutPrice: round(breakoutPrice),
    activeBuyRatio: l2.activeBuyRatio === null ? null : round(l2.activeBuyRatio, 4),
    netActiveNotional: l2.netActiveNotional,
    bigOrderNet: l2.bigOrderNet,
    ageMinutes: age,
    extensionFromSecondLowPct: round(extensionFromSecondLowPct),
  };
  result.candidateKey = candidate ? `601899:${pair.second.time}:repair` : null;
  result.watchKey = earlyWatch ? `601899:${analysisPair.second.time}:bottom-watch` : null;
  return result;
}
