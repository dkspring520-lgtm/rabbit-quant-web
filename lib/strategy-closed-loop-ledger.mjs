const DEFAULT_FEE_CONFIG = Object.freeze({
  commissionRate: 0.00025,
  minimumCommission: 5,
  stampDutyRate: 0.0005,
  transferFeeRate: 0.00001,
});

const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

const finitePositive = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeTime = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "";
  return digits.slice(0, 6).padEnd(6, "0");
};

const displayTime = (value) => {
  const time = normalizeTime(value);
  if (!time) return "--:--";
  return time.length >= 6
    ? `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`
    : `${time.slice(0, 2)}:${time.slice(2, 4)}`;
};

const timeInSeconds = (value) => {
  const time = normalizeTime(value);
  if (!time) return null;
  return Number(time.slice(0, 2)) * 3600
    + Number(time.slice(2, 4)) * 60
    + Number(time.slice(4, 6));
};

const isInvalidTrade = (row) => /已失效|invalid|deleted/i.test(String(row?.status ?? ""));

function normalizeTrade(row, index) {
  const price = finitePositive(row?.price);
  const quantity = finitePositive(row?.quantity);
  const side = String(row?.side ?? "").toLowerCase();
  const normalizedSide = side === "卖出" || side === "sell" ? "卖出" : side === "买入" || side === "buy" ? "买入" : null;
  if (!price || !quantity || !normalizedSide || isInvalidTrade(row)) return null;
  return {
    id: String(row?.id ?? `trade-${index}`),
    time: normalizeTime(row?.time),
    displayTime: displayTime(row?.time),
    side: normalizedSide,
    price,
    quantity,
    status: String(row?.status ?? "未配对"),
    sourceIndex: index,
  };
}

function estimateCycleFees(first, second, feeConfig) {
  const firstTurnover = first.price * first.quantity;
  const secondTurnover = second.price * second.quantity;
  const turnover = firstTurnover + secondTurnover;
  const commission = Math.max(feeConfig.minimumCommission, firstTurnover * feeConfig.commissionRate)
    + Math.max(feeConfig.minimumCommission, secondTurnover * feeConfig.commissionRate);
  const sellTurnover = first.side === "卖出" ? firstTurnover : secondTurnover;
  const stampDuty = sellTurnover * feeConfig.stampDutyRate;
  const transferFee = turnover * feeConfig.transferFeeRate;
  return round(commission + stampDuty + transferFee);
}

/**
 * Pair equal-size, opposite-side manual trades in chronological order. This is
 * an audit view only; it never manufactures an exit for an unmatched trade.
 */
export function pairStrategyClosedLoops(rawTrades = [], options = {}) {
  const feeConfig = { ...DEFAULT_FEE_CONFIG, ...(options.feeConfig ?? {}) };
  const trades = rawTrades
    .map(normalizeTrade)
    .filter(trade => trade !== null)
    .sort((left, right) => left.time.localeCompare(right.time) || left.sourceIndex - right.sourceIndex);
  const used = new Set();
  const cycles = [];

  for (let index = 0; index < trades.length; index += 1) {
    if (used.has(index)) continue;
    const first = trades[index];
    const matchIndex = trades.findIndex((candidate, candidateIndex) => (
      candidateIndex > index
      && !used.has(candidateIndex)
      && candidate.side !== first.side
      && candidate.quantity === first.quantity
    ));
    if (matchIndex < 0) continue;

    const second = trades[matchIndex];
    used.add(index);
    used.add(matchIndex);
    const direction = first.side === "买入" ? "正T" : "反T";
    const grossPnl = round((first.side === "买入" ? second.price - first.price : first.price - second.price) * first.quantity);
    const fees = estimateCycleFees(first, second, feeConfig);
    const netPnl = round(grossPnl - fees);
    const entryValue = first.price * first.quantity;
    const startedAt = timeInSeconds(first.time);
    const endedAt = timeInSeconds(second.time);
    cycles.push({
      id: `${first.id}:${second.id}`,
      direction,
      entry: first,
      exit: second,
      quantity: first.quantity,
      grossPnl,
      fees,
      netPnl,
      grossReturnPct: round(grossPnl / entryValue * 100, 3),
      netReturnPct: round(netPnl / entryValue * 100, 3),
      holdingMinutes: startedAt === null || endedAt === null ? null : Math.max(0, round((endedAt - startedAt) / 60, 1)),
      status: netPnl > 0 ? "扣费盈利" : netPnl < 0 ? "扣费亏损" : "扣费持平",
    });
  }

  return {
    cycles,
    openTrades: trades.filter((_, index) => !used.has(index)),
    validTrades: trades,
  };
}

function observationStatus(observation) {
  if (observation?.stage === "candidate") return "候选";
  return Array.isArray(observation?.blockers) && observation.blockers.length ? "观察" : "观察";
}

function summarizeRejections(observations) {
  const reasonCounts = new Map();
  let rejected = 0;
  observations.forEach((observation) => {
    const blockers = Array.isArray(observation?.blockers)
      ? observation.blockers.map(item => String(item).trim()).filter(Boolean)
      : [];
    if (observation?.stage !== "candidate" && blockers.length) rejected += 1;
    blockers.forEach((reason) => reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1));
  });
  const reasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason, "zh-CN"))
    .slice(0, 5);
  return { rejected, reasons };
}

function nearestPoint(points, time) {
  const target = timeInSeconds(time);
  if (target === null || !points.length) return null;
  let best = points[0];
  let distance = Math.abs(best.seconds - target);
  for (const point of points.slice(1)) {
    const nextDistance = Math.abs(point.seconds - target);
    if (nextDistance < distance) {
      best = point;
      distance = nextDistance;
    }
  }
  return best;
}

/**
 * @param {{
 *   minutes?: any[];
 *   observations?: any[];
 *   trades?: any[];
 *   simulatedActions?: any[];
 * }} input
 */
export function buildDailyReviewChart({ minutes = [], observations = [], trades = [], simulatedActions = [] } = {}) {
  const sourcePoints = minutes
    .map((point, index) => ({
      time: normalizeTime(point?.time),
      price: finitePositive(point?.price),
      seconds: timeInSeconds(point?.time),
      sourceIndex: index,
    }))
    .filter(point => point.time && point.price && point.seconds !== null)
    .sort((left, right) => left.seconds - right.seconds || left.sourceIndex - right.sourceIndex);
  if (!sourcePoints.length) return {
    ready: false,
    points: [],
    path: "",
    markers: [],
    high: null,
    low: null,
    firstTime: "",
    lastTime: "",
    min: null,
    max: null,
  };

  const prices = sourcePoints.map(point => point.price);
  const highPrice = Math.max(...prices);
  const lowPrice = Math.min(...prices);
  const pricePadding = Math.max((highPrice - lowPrice) * 0.08, highPrice * 0.0005, 0.01);
  const min = lowPrice - pricePadding;
  const max = highPrice + pricePadding;
  const range = Math.max(max - min, 0.01);
  const xFor = (index) => sourcePoints.length === 1 ? 50 : 3 + index / (sourcePoints.length - 1) * 94;
  const yFor = (price) => 4 + (max - price) / range * 32;
  const points = sourcePoints.map((point, index) => ({
    time: point.time,
    price: point.price,
    seconds: point.seconds,
    x: round(xFor(index), 3),
    y: round(yFor(point.price), 3),
  }));
  const indexedPoints = sourcePoints.map((point, index) => ({ ...point, ...points[index] }));
  const markerInputs = [
    ...observations.map((item, index) => ({
      id: `observation-${index}-${normalizeTime(item?.time)}`,
      time: item?.time,
      price: finitePositive(item?.price),
      kind: item?.stage === "candidate" ? "candidate" : "observation",
      label: item?.stage === "candidate" ? `${item?.direction ?? ""}候选` : `${item?.direction ?? ""}观察`,
      direction: item?.direction ?? null,
    })),
    ...simulatedActions.map((item, index) => ({
      id: `simulation-${index}-${normalizeTime(item?.time)}`,
      time: item?.time,
      price: finitePositive(item?.price),
      kind: "simulation",
      label: `${item?.direction ?? "T"}${item?.side ?? "模拟"}`,
      direction: item?.direction ?? null,
    })),
    ...trades.map((item, index) => ({
      id: `trade-${String(item?.id ?? index)}`,
      time: item?.time,
      price: finitePositive(item?.price),
      kind: String(item?.side ?? "").includes("卖") ? "actual-sell" : "actual-buy",
      label: String(item?.side ?? "").includes("卖") ? "实卖" : "实买",
      direction: null,
    })),
  ];
  const markers = markerInputs.map((marker) => {
    const nearest = nearestPoint(indexedPoints, marker.time);
    if (!nearest) return null;
    const markerPrice = marker.price ?? nearest.price;
    return {
      ...marker,
      time: normalizeTime(marker.time),
      displayTime: displayTime(marker.time),
      price: markerPrice,
      x: nearest.x,
      y: round(yFor(markerPrice), 3),
    };
  }).filter(marker => marker !== null);
  const highIndex = prices.indexOf(highPrice);
  const lowIndex = prices.indexOf(lowPrice);

  return {
    ready: true,
    points,
    path: `M ${points.map(point => `${point.x} ${point.y}`).join(" L ")}`,
    markers,
    high: { ...points[highIndex], label: `高 ${highPrice.toFixed(2)}` },
    low: { ...points[lowIndex], label: `低 ${lowPrice.toFixed(2)}` },
    firstTime: displayTime(points[0].time),
    lastTime: displayTime(points.at(-1).time),
    min,
    max,
  };
}

function buildVerdict(summary, rejectionReasons) {
  if (!summary.observations && !summary.simulatedActions && !summary.actualTrades) {
    return {
      tone: "empty",
      title: "今日尚无可复盘数据",
      detail: "盘中观察、模拟动作或人工成交出现后，这里会自动形成图形复盘。",
    };
  }
  if (!summary.completedLoops) {
    const mainReason = rejectionReasons[0];
    return {
      tone: summary.openTrades ? "watch" : "neutral",
      title: summary.openTrades ? "有成交尚未闭环" : "今日没有完成闭环",
      detail: mainReason
        ? `主要卡点：${mainReason.reason}（${mainReason.count}次）。没有为凑结果而补造离场。`
        : `出现 ${summary.candidates} 个候选、${summary.simulatedActions} 个模拟动作，尚无等量真实成交闭环。`,
    };
  }
  const result = summary.netPnl > 0 ? "扣费后盈利" : summary.netPnl < 0 ? "扣费后亏损" : "扣费后持平";
  const mainReason = rejectionReasons[0];
  return {
    tone: summary.netPnl > 0 ? "positive" : summary.netPnl < 0 ? "negative" : "neutral",
    title: `${summary.completedLoops} 个闭环，${result}`,
    detail: `${summary.wins}胜 ${summary.losses}负，净盈亏 ${summary.netPnl >= 0 ? "+" : ""}${summary.netPnl.toFixed(2)} 元${mainReason ? `；最多否决原因是“${mainReason.reason}”` : ""}。`,
  };
}

/**
 * @param {{
 *   trades?: any[];
 *   observations?: any[];
 *   simulatedActions?: any[];
 *   minutes?: any[];
 *   feeConfig?: Partial<typeof DEFAULT_FEE_CONFIG>;
 * }} input
 */
export function buildStrategyClosedLoopLedger({
  trades = [],
  observations = [],
  simulatedActions = [],
  minutes = [],
  feeConfig,
} = {}) {
  const paired = pairStrategyClosedLoops(trades, { feeConfig });
  const candidates = observations.filter(item => item?.stage === "candidate").length;
  const watches = observations.filter(item => observationStatus(item) === "观察").length;
  const rejection = summarizeRejections(observations);
  const wins = paired.cycles.filter(cycle => cycle.netPnl > 0).length;
  const losses = paired.cycles.filter(cycle => cycle.netPnl < 0).length;
  const grossProfit = paired.cycles.reduce((sum, cycle) => sum + Math.max(0, cycle.netPnl), 0);
  const grossLoss = paired.cycles.reduce((sum, cycle) => sum + Math.abs(Math.min(0, cycle.netPnl)), 0);
  const netPnl = round(paired.cycles.reduce((sum, cycle) => sum + cycle.netPnl, 0));
  const summary = {
    observations: observations.length,
    watches,
    candidates,
    rejected: rejection.rejected,
    simulatedActions: simulatedActions.length,
    actualTrades: paired.validTrades.length,
    completedLoops: paired.cycles.length,
    openTrades: paired.openTrades.length,
    wins,
    losses,
    grossPnl: round(paired.cycles.reduce((sum, cycle) => sum + cycle.grossPnl, 0)),
    fees: round(paired.cycles.reduce((sum, cycle) => sum + cycle.fees, 0)),
    netPnl,
    winRate: paired.cycles.length ? round(wins / paired.cycles.length * 100, 1) : null,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 2) : grossProfit > 0 ? null : paired.cycles.length ? 0 : null,
  };

  return {
    ...paired,
    summary,
    rejectionReasons: rejection.reasons,
    verdict: buildVerdict(summary, rejection.reasons),
    chart: buildDailyReviewChart({ minutes, observations, trades: paired.validTrades, simulatedActions }),
  };
}

export { DEFAULT_FEE_CONFIG };
