const toFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizeMinute = (point) => {
  const price = toFiniteNumber(point?.price ?? point?.close);
  const volume = Math.max(0, toFiniteNumber(point?.volume) ?? 0);
  const time = String(point?.time ?? point?.minute ?? "").slice(0, 5);
  if (!time || price === null || price <= 0) return null;
  return { time, price, volume };
};

const calculateVwap = (points) => {
  let turnover = 0;
  let volume = 0;
  for (const point of points) {
    if (point.volume <= 0) continue;
    turnover += point.price * point.volume;
    volume += point.volume;
  }
  if (volume > 0) return turnover / volume;
  return points.reduce((sum, point) => sum + point.price, 0) / Math.max(1, points.length);
};

/**
 * 紫金矿业专用的“快速偏离观察”。
 *
 * 它只读取传入的分钟前缀，不确认买卖点。达到新的偏离档位时生成一个
 * 稳定 event id，调用方可按 id 去重，避免价格持续偏离时每分钟重复播报。
 */
export function evaluateZijinDisplacementWatch(
  rawMinutes = [],
  {
    minimumBiasPct = 0.65,
    tierStepPct = 0.4,
    minimumPoints = 5,
  } = {},
) {
  const points = rawMinutes
    .map(normalizeMinute)
    .filter(Boolean)
    .sort((left, right) => left.time.localeCompare(right.time));
  if (points.length < minimumPoints) return null;

  const latest = points.at(-1);
  const vwap = calculateVwap(points);
  if (!latest || !Number.isFinite(vwap) || vwap <= 0) return null;

  const biasPct = ((latest.price - vwap) / vwap) * 100;
  const absoluteBiasPct = Math.abs(biasPct);
  if (absoluteBiasPct < minimumBiasPct) return null;

  const direction = biasPct > 0 ? "upper" : "lower";
  const tier = Math.max(
    1,
    Math.floor((absoluteBiasPct - minimumBiasPct) / Math.max(0.1, tierStepPct)) + 1,
  );
  const recentStart = points[Math.max(0, points.length - 4)];
  const fastMovePct = recentStart?.price
    ? ((latest.price - recentStart.price) / recentStart.price) * 100
    : 0;
  const label = direction === "upper" ? "高位偏离观察" : "低位偏离观察";
  const actionDirection = direction === "upper" ? "反T" : "正T";

  return {
    id: `zijin-vwap-displacement-${direction}-${tier}`,
    stage: "displacement-watch",
    direction: actionDirection,
    label,
    time: latest.time,
    price: latest.price,
    vwap,
    biasPct,
    fastMovePct,
    tier,
    executable: false,
    reason:
      direction === "upper"
        ? `现价高于分钟均价 ${absoluteBiasPct.toFixed(2)}%，进入第 ${tier} 档高位偏离；先观察冲高衰竭，趋势未转弱前不是卖点。`
        : `现价低于分钟均价 ${absoluteBiasPct.toFixed(2)}%，进入第 ${tier} 档低位偏离；先观察承接修复，趋势未转强前不是买点。`,
  };
}
