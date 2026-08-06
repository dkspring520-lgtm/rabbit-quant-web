const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const roundPrice = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Builds an intraday research range using only the minute points already
 * present at asOfTime. It deliberately does not read later highs/lows.
 */
export function buildZijinPricePlan({
  minutes = [],
  previousClose = null,
  open = null,
  vwap = null,
  l2Coverage = 0,
  atrPct = null,
} = {}) {
  const causalMinutes = minutes
    .map(point => ({
      time: String(point?.time ?? "").replace(/\D/g, "").slice(0, 4),
      price: Number(point?.price),
    }))
    .filter(point => point.time.length === 4 && Number.isFinite(point.price) && point.price > 0)
    .sort((left, right) => left.time.localeCompare(right.time));
  const asOfTime = causalMinutes.at(-1)?.time ?? null;
  if (causalMinutes.length < 5) {
    return {
      ready: false,
      status: "warming",
      asOfTime,
      reason: `至少需要 5 个已出现分钟点，当前 ${causalMinutes.length} 个`,
    };
  }

  const prices = causalMinutes.map(point => point.price);
  const last = prices.at(-1);
  const recent = prices.slice(-20);
  const observedLow = Math.min(...prices);
  const observedHigh = Math.max(...prices);
  const recentLow = Math.min(...recent);
  const recentHigh = Math.max(...recent);
  const changes = prices.slice(1).map((price, index) => Math.abs(price - prices[index]));
  const medianMove = median(changes.slice(-30));
  const reference = Number(previousClose) > 0 ? Number(previousClose) : last;
  const intradayRange = Math.max(0, observedHigh - observedLow);
  const projectedMove = clamp(
    Math.max(last * 0.0015, medianMove * 2.4, intradayRange * 0.12),
    Math.max(0.03, last * 0.001),
    last * 0.012,
  );
  const suppliedAtrPct = Number(atrPct);
  const realizedVolatilityPct = reference > 0
    ? Math.max((medianMove / reference) * 100 * 5, (intradayRange / reference) * 20)
    : 0;
  // Stops need room beyond an order zone. Prefer observed volatility / ATR,
  // but keep the intraday buffer within a predictable 0.5%–1.0% range.
  const riskBufferPct = clamp(Math.max(
    0.5,
    Number.isFinite(suppliedAtrPct) && suppliedAtrPct > 0 ? suppliedAtrPct : 0,
    realizedVolatilityPct,
  ), 0.5, 1);
  const riskBuffer = roundPrice(Math.max(0.03, reference * riskBufferPct / 100));
  const validVwap = Number(vwap) > 0 ? Number(vwap) : null;
  const validOpen = Number(open) > 0 ? Number(open) : null;

  const supportReferences = [recentLow, observedLow, validVwap, validOpen]
    .filter(value => Number.isFinite(value) && value > 0 && value <= last + projectedMove);
  const resistanceReferences = [recentHigh, observedHigh, validVwap, validOpen]
    .filter(value => Number.isFinite(value) && value > 0 && value >= last - projectedMove);
  const support = Math.max(observedLow - projectedMove * 0.35, Math.min(last, ...supportReferences));
  const resistance = Math.min(observedHigh + projectedMove * 0.35, Math.max(last, ...resistanceReferences));

  let buyLow = roundPrice(support - projectedMove * 0.22);
  let buyHigh = roundPrice(support + projectedMove * 0.18);
  let sellLow = roundPrice(resistance - projectedMove * 0.18);
  let sellHigh = roundPrice(resistance + projectedMove * 0.25);
  const minimumGrossSpread = Math.max(0.1, reference * 0.0032);
  const grossSpread = sellLow - buyHigh;
  const roomReady = grossSpread >= minimumGrossSpread;

  if (!roomReady) {
    const midpoint = (buyHigh + sellLow) / 2;
    buyLow = roundPrice(Math.min(buyLow, midpoint - minimumGrossSpread * 0.62));
    buyHigh = roundPrice(midpoint - minimumGrossSpread * 0.5);
    sellLow = roundPrice(midpoint + minimumGrossSpread * 0.5);
    sellHigh = roundPrice(Math.max(sellHigh, midpoint + minimumGrossSpread * 0.62));
  }

  const coverage = Math.max(0, Math.min(causalMinutes.length, Number(l2Coverage) || 0));
  const minuteContribution = Math.min(22, causalMinutes.length * 0.7);
  const l2Contribution = Math.min(18, coverage * 1.2);
  const spreadPenalty = roomReady ? 0 : -12;
  const confidence = Math.round(clamp(
    42 + minuteContribution + l2Contribution + spreadPenalty,
    35,
    82,
  ));
  const position = validVwap == null ? "等待均价线" : last < validVwap ? "均价线下方" : last > validVwap ? "均价线上方" : "贴近均价线";
  const positiveStop = roundPrice(Math.max(0.01, buyLow - riskBuffer));
  const positiveTake1 = roundPrice(Math.max(buyHigh + 0.02, buyHigh + minimumGrossSpread * 0.45));
  const positiveTake2 = roundPrice(Math.max(positiveTake1 + 0.02, sellLow));
  const reverseStop = roundPrice(sellHigh + riskBuffer);
  const reverseTake1 = roundPrice(Math.min(sellLow - 0.02, sellLow - minimumGrossSpread * 0.45));
  const reverseTake2 = roundPrice(Math.min(reverseTake1 - 0.02, buyHigh));

  return {
    ready: true,
    status: roomReady ? "ready" : "waiting",
    asOfTime,
    buyRange: [buyLow, buyHigh],
    sellRange: [sellLow, sellHigh],
    expectedGrossSpread: roundPrice(sellLow - buyHigh),
    minimumGrossSpread: roundPrice(minimumGrossSpread),
    confidence,
    confidenceBreakdown: [
      { label: "基础因果校验", value: 42 },
      { label: "分钟样本覆盖", value: roundPrice(minuteContribution) },
      { label: "L2分钟覆盖", value: roundPrice(l2Contribution) },
      ...(spreadPenalty ? [{ label: "价差不足惩罚", value: spreadPenalty }] : []),
    ],
    position,
    riskPlan: {
      buffer: riskBuffer,
      bufferPct: riskBufferPct,
      positiveT: {
        hardStop: positiveStop,
        takeProfit1: positiveTake1,
        takeProfit2: positiveTake2,
        invalidation: `跌破 ¥${positiveStop.toFixed(2)} 且主动卖出继续增强`,
      },
      reverseT: {
        hardStop: reverseStop,
        takeProfit1: reverseTake1,
        takeProfit2: reverseTake2,
        invalidation: `突破 ¥${reverseStop.toFixed(2)} 且主动买入继续增强`,
      },
    },
    source: coverage > 0 ? `L2 主源 ${coverage}/${causalMinutes.length} 点` : "公开分钟线兜底",
    reason: roomReady
      ? "当前已出现波动可覆盖预设毛价差，仍需到区间后观察拐头与订单流确认"
      : "当前已出现波动空间不足，区间仅作预警边界，不应直接挂单",
  };
}
