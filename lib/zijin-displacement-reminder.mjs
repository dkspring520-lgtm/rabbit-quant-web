import { normalizeQmtOrderFlow } from "./qmt-orderflow-confirmation.mjs";
import { isAShareClosingAuctionMinute } from "./intraday-axis.mjs";

const toFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizeMinute = (point) => {
  const price = toFiniteNumber(point?.price ?? point?.close);
  const volume = Math.max(0, toFiniteNumber(point?.volume) ?? 0);
  const time = String(point?.time ?? point?.minute ?? "").slice(0, 5);
  if (!time || price === null || price <= 0) return null;
  return { ...point, time, price, volume };
};

const buildRunningVwap = (points) => {
  let turnover = 0;
  let volume = 0;
  let simple = 0;
  return points.map((point, index) => {
    simple += point.price;
    if (point.volume > 0) {
      turnover += point.price * point.volume;
      volume += point.volume;
    }
    return volume > 0 ? turnover / volume : simple / (index + 1);
  });
};

const buildLatestExcursion = (points, runningVwap, minimumBiasPct, lookbackPoints) => {
  const biases = points.map((point, index) => (
    (point.price - runningVwap[index]) / runningVwap[index] * 100
  ));
  const afternoonStart = points.at(-1)?.time >= "13:00"
    ? points.findIndex((point) => point.time >= "13:00")
    : 0;
  const sessionStart = Math.max(0, afternoonStart);
  const from = Math.max(sessionStart, points.length - lookbackPoints);
  let latestQualifiedIndex = -1;
  for (let index = points.length - 1; index >= from; index -= 1) {
    if (Math.abs(biases[index]) >= minimumBiasPct) {
      latestQualifiedIndex = index;
      break;
    }
  }
  if (latestQualifiedIndex < 0) return null;

  const direction = biases[latestQualifiedIndex] > 0 ? "upper" : "lower";
  const sign = direction === "upper" ? 1 : -1;
  let startIndex = latestQualifiedIndex;
  let neutralStreak = 0;
  // Keep the episode anchor stable even after a long excursion moves beyond
  // the short detection lookback. This prevents one persistent high/low from
  // being announced again on every new minute.
  for (let index = latestQualifiedIndex - 1; index >= sessionStart; index -= 1) {
    const signedBias = biases[index] * sign;
    if (signedBias <= -minimumBiasPct) break;
    if (signedBias >= minimumBiasPct) {
      startIndex = index;
      neutralStreak = 0;
      continue;
    }
    neutralStreak += 1;
    if (neutralStreak > 5) break;
    startIndex = index;
  }

  let extremeIndex = startIndex;
  for (let index = startIndex + 1; index < points.length; index += 1) {
    const isMoreExtreme = direction === "upper"
      ? points[index].price > points[extremeIndex].price
      : points[index].price < points[extremeIndex].price;
    if (isMoreExtreme) extremeIndex = index;
  }
  return { direction, startIndex, extremeIndex, biases };
};

const summarizeAlignedL2 = (points, direction) => {
  const rows = points.slice(-3).map((point) => normalizeQmtOrderFlow(point));
  const samples = rows.filter((row) => {
    const total = (row.activeBuyVolume ?? 0) + (row.activeSellVolume ?? 0);
    return total > 0
      && row.status?.authorized !== false
      && row.status?.stale !== true;
  });
  const aligned = samples.filter((row) => {
    const total = (row.activeBuyVolume ?? 0) + (row.activeSellVolume ?? 0);
    const ratio = row.activeBuyRatio ?? row.activeBuyVolume / total;
    if (direction === "upper") {
      return ratio <= 0.47
        && (row.ddx === null || row.ddx <= 0)
        && (row.bigOrderNet === null || row.bigOrderNet <= 0);
    }
    return ratio >= 0.53
      && (row.ddx === null || row.ddx >= 0)
      && (row.bigOrderNet === null || row.bigOrderNet >= 0);
  });
  const latest = samples.at(-1);
  const latestTotal = (latest?.activeBuyVolume ?? 0) + (latest?.activeSellVolume ?? 0);
  return {
    available: samples.length > 0,
    confirmed: aligned.length >= 2,
    aligned: aligned.length,
    samples: samples.length,
    activeBuyRatio: latest && latestTotal > 0
      ? latest.activeBuyRatio ?? latest.activeBuyVolume / latestTotal
      : null,
  };
};

const buildOpeningSurgeWatch = (points, runningVwap, latest, biasPct, {
  minimumSurgePct,
  openingEndTime,
}) => {
  if (!latest || latest.time < "09:30" || latest.time >= openingEndTime) return null;
  const openingPoints = points.filter((point) => point.time >= "09:30" && point.time < openingEndTime);
  if (openingPoints.length < 5) return null;
  const peakIndex = openingPoints.reduce((best, point, index) => (
    point.price > openingPoints[best].price ? index : best
  ), 0);
  if (peakIndex < 3) return null;
  const baseIndex = openingPoints
    .slice(0, peakIndex)
    .reduce((best, point, index) => point.price < openingPoints[best].price ? index : best, 0);
  const base = openingPoints[baseIndex];
  const peak = openingPoints[peakIndex];
  if (!base || !peak || peak.price <= base.price) return null;
  const surgePct = ((peak.price - base.price) / base.price) * 100;
  if (surgePct < minimumSurgePct) return null;
  const upwardSteps = openingPoints
    .slice(baseIndex + 1, peakIndex + 1)
    .reduce((count, point, offset) => (
      point.price > openingPoints[baseIndex + offset].price ? count + 1 : count
    ), 0);
  if (upwardSteps < 2) return null;
  const pullbackPct = peak.price > latest.price
    ? ((peak.price - latest.price) / peak.price) * 100
    : 0;
  const direction = "反T";
  const label = pullbackPct >= 0.12 ? "冲高回落观察" : "急拉观察";
  return {
    id: `zijin-opening-surge-${peak.time}`,
    stage: "opening-surge-watch",
    direction,
    label,
    time: peak.time,
    price: peak.price,
    vwap: runningVwap.at(-1),
    biasPct,
    fastMovePct: surgePct,
    progressPct: pullbackPct,
    tier: 0,
    l2: summarizeAlignedL2(points, "upper"),
    executable: false,
    reason: pullbackPct >= 0.12
      ? `09:30 后价格从 ${base.price.toFixed(2)} 快速冲至 ${peak.price.toFixed(2)}，已回落 ${pullbackPct.toFixed(2)}%；这是冲高回落观察，不是正式卖点，等待跌回开盘价/VWAP并经确认。`
      : `09:30 后价格从 ${base.price.toFixed(2)} 快速冲至 ${peak.price.toFixed(2)}，区间上涨 ${surgePct.toFixed(2)}%；这是急拉观察，不是追买或卖点，等待回落结构确认。`,
  };
};

/**
 * 紫金矿业专用的“偏离—回落/修复”因果观察。
 * 只读取传入的分钟前缀，不确认买卖点。进入新偏离档位、价格出现反向推进、
 * L2 连续同向时分别生成稳定 event id，调用方可按 id 去重，避免重复播报。
 */
export function evaluateZijinDisplacementWatch(
  rawMinutes = [],
  {
    minimumBiasPct = 0.65,
    tierStepPct = 0.4,
    minimumPoints = 5,
    lookbackPoints = 35,
    minimumProgressPct = 0.18,
    minimumMomentum3Pct = 0.10,
    minimumDwellMinutes = 1,
    maximumContinuationPct = 0.18,
    minimumOpeningSurgePct = 0.55,
    openingEndTime = "09:45",
  } = {},
) {
  const points = rawMinutes
    .map(normalizeMinute)
    .filter(Boolean)
    .sort((left, right) => left.time.localeCompare(right.time));
  if (points.length < minimumPoints) return null;

  const latest = points.at(-1);
  // 14:57-15:00 is the closing call auction. Its final matched price can jump
  // without a continuous-trading path, so it must never be labelled as an
  // ordinary VWAP displacement repair or a buy/sell observation.
  if (isAShareClosingAuctionMinute(latest?.time)) return null;
  const runningVwap = buildRunningVwap(points);
  const vwap = runningVwap.at(-1);
  if (!latest || !Number.isFinite(vwap) || vwap <= 0) return null;

  const biasPct = ((latest.price - vwap) / vwap) * 100;
  const absoluteBiasPct = Math.abs(biasPct);
  const excursion = buildLatestExcursion(points, runningVwap, minimumBiasPct, lookbackPoints);
  if (!excursion) {
    return buildOpeningSurgeWatch(points, runningVwap, latest, biasPct, {
      minimumSurgePct: minimumOpeningSurgePct,
      openingEndTime,
    });
  }

  const { direction } = excursion;
  const extremeBiasPct = Math.abs(excursion.biases[excursion.extremeIndex]);
  const tier = Math.max(
    1,
    Math.floor((extremeBiasPct - minimumBiasPct) / Math.max(0.1, tierStepPct)) + 1,
  );
  const recentStart = points[Math.max(0, points.length - 4)];
  const fastMovePct = recentStart?.price
    ? ((latest.price - recentStart.price) / recentStart.price) * 100
    : 0;
  const previous = points.at(-2);
  const lastMovePct = previous?.price
    ? ((latest.price - previous.price) / previous.price) * 100
    : 0;
  const extreme = points[excursion.extremeIndex];
  const progressPct = direction === "upper"
    ? ((extreme.price - latest.price) / extreme.price) * 100
    : ((latest.price - extreme.price) / extreme.price) * 100;
  const momentumAligned = direction === "upper"
    ? lastMovePct <= -minimumMomentum3Pct / 2
    : lastMovePct >= minimumMomentum3Pct / 2;
  const progressing = excursion.extremeIndex < points.length - 1
    && progressPct >= minimumProgressPct
    && momentumAligned;
  const l2 = summarizeAlignedL2(points, direction);
  const candidateSign = direction === "upper" ? 1 : -1;
  let candidateDwellPoints = 0;
  for (let index = excursion.biases.length - 1; index >= 0; index -= 1) {
    if ((excursion.biases[index] ?? 0) * candidateSign < minimumBiasPct * 0.85) break;
    candidateDwellPoints += 1;
  }
  const excursionAge = Math.max(0, candidateDwellPoints - 1);
  const continuationPct = direction === "upper"
    ? Math.max(0, lastMovePct)
    : Math.max(0, -lastMovePct);
  const l2NotStronglyOpposed = l2.activeBuyRatio === null
    || (direction === "upper" ? l2.activeBuyRatio <= 0.60 : l2.activeBuyRatio >= 0.40);
  const persistentCandidate = absoluteBiasPct >= minimumBiasPct
    && excursionAge >= minimumDwellMinutes
    && continuationPct <= maximumContinuationPct
    && l2NotStronglyOpposed;
  const actionDirection = direction === "upper" ? "反T" : "正T";

  if (progressing) {
    const stage = l2.confirmed
      ? "displacement-l2-confirmation"
      : "displacement-progress";
    const label = direction === "upper"
      ? l2.confirmed ? "卖压确认" : "回落加速"
      : l2.confirmed ? "买压确认" : "修复加速";
    const l2Text = l2.available
      ? `近3分钟L2同向 ${l2.aligned}/${l2.samples}`
        + (l2.activeBuyRatio === null
          ? ""
          : `，最新主动买占比 ${(l2.activeBuyRatio * 100).toFixed(1)}%`)
      : "L2连续性尚未确认";
    return {
      id: `zijin-vwap-displacement-${direction}-${tier}-${stage}-${points[excursion.startIndex].time}`,
      stage,
      direction: actionDirection,
      label,
      time: latest.time,
      price: latest.price,
      vwap,
      biasPct,
      fastMovePct,
      progressPct,
      tier,
      l2,
      executable: false,
      reason: direction === "upper"
        ? `价格自观察高点回落 ${progressPct.toFixed(2)}%，最新一分钟继续回落 ${Math.abs(lastMovePct).toFixed(2)}%；${l2Text}。这是反T确认进度，不是正式卖点，仍需趋势与风控放行。`
        : `价格自观察低点修复 ${progressPct.toFixed(2)}%，最新一分钟继续修复 ${Math.abs(lastMovePct).toFixed(2)}%；${l2Text}。这是正T确认进度，不是正式买点，仍需趋势与风控放行。`,
    };
  }

  if (absoluteBiasPct < minimumBiasPct) return null;
  if (persistentCandidate) {
    const candidateLabel = direction === "upper" ? "候选卖点" : "候选买点";
    return {
      id: `zijin-vwap-displacement-${direction}-candidate-${points[excursion.startIndex].time}`,
      stage: "displacement-candidate",
      direction: actionDirection,
      label: candidateLabel,
      time: latest.time,
      price: latest.price,
      vwap,
      biasPct,
      fastMovePct,
      progressPct: 0,
      tier,
      l2,
      executable: false,
      reason: direction === "upper"
        ? `均价上方状态已持续 ${excursionAge} 分钟，最新一分钟未继续加速冲高；启动候选卖点观察，等待转弱确认。`
        : `均价下方状态已持续 ${excursionAge} 分钟，最新一分钟未继续加速破底；启动候选买点观察，等待承接确认。`,
    };
  }
  const label = direction === "upper" ? "均价上方观察" : "均价下方观察";
  return {
    id: `zijin-vwap-displacement-${direction}-${tier}-${points[excursion.startIndex].time}`,
    stage: "displacement-watch",
    direction: actionDirection,
    label,
    time: latest.time,
    price: latest.price,
    vwap,
    biasPct,
    fastMovePct,
    progressPct: 0,
    tier,
    l2,
    executable: false,
    reason: direction === "upper"
      ? `现价高于分钟均价 ${absoluteBiasPct.toFixed(2)}%，进入第 ${tier} 档均价上方状态；先观察冲高衰竭，趋势未转弱前不是卖点。`
      : `现价低于分钟均价 ${absoluteBiasPct.toFixed(2)}%，进入第 ${tier} 档均价下方状态；先观察承接修复，趋势未转强前不是买点。`,
  };
}
