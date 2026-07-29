import { normalizeQmtOrderFlow } from "./qmt-orderflow-confirmation.mjs";

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
  const from = Math.max(0, points.length - lookbackPoints);
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
  for (let index = latestQualifiedIndex - 1; index >= from; index -= 1) {
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
  } = {},
) {
  const points = rawMinutes
    .map(normalizeMinute)
    .filter(Boolean)
    .sort((left, right) => left.time.localeCompare(right.time));
  if (points.length < minimumPoints) return null;

  const latest = points.at(-1);
  const runningVwap = buildRunningVwap(points);
  const vwap = runningVwap.at(-1);
  if (!latest || !Number.isFinite(vwap) || vwap <= 0) return null;

  const biasPct = ((latest.price - vwap) / vwap) * 100;
  const absoluteBiasPct = Math.abs(biasPct);
  const excursion = buildLatestExcursion(points, runningVwap, minimumBiasPct, lookbackPoints);
  if (!excursion) return null;

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
  const actionDirection = direction === "upper" ? "反T" : "正T";

  if (progressing) {
    const stage = l2.confirmed
      ? "displacement-l2-confirmation"
      : "displacement-progress";
    const label = direction === "upper"
      ? l2.confirmed ? "冲高回落·卖压确认" : "冲高回落加速"
      : l2.confirmed ? "低位修复·买压确认" : "低位修复加速";
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
  const label = direction === "upper" ? "高位偏离观察" : "低位偏离观察";
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
      ? `现价高于分钟均价 ${absoluteBiasPct.toFixed(2)}%，进入第 ${tier} 档高位偏离；先观察冲高衰竭，趋势未转弱前不是卖点。`
      : `现价低于分钟均价 ${absoluteBiasPct.toFixed(2)}%，进入第 ${tier} 档低位偏离；先观察承接修复，趋势未转强前不是买点。`,
  };
}
