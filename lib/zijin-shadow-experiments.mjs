import { normalizeQmtOrderFlow } from "./qmt-orderflow-confirmation.mjs";

// Research-only, causal experiments for the Zijin intraday desk.  Every
// evaluator only reads rows up to `index`; none of these results can create a
// formal signal or an order.
export const ZIJIN_SHADOW_EXPERIMENTS_VERSION = "2026.09.04-shadow-v1";

export const ZIJIN_SHADOW_EXPERIMENTS = Object.freeze([
  Object.freeze({
    id: "five-minute-exhaustion",
    label: "5分钟顶背离",
    shortLabel: "顶背离 + 上影 + 缩量",
    description: "5分钟价格创新高，但 MACD 没有同步创新高，并且出现上影线、缩量。",
  }),
  Object.freeze({
    id: "l2-order-lifecycle",
    label: "L2挂单确认",
    shortLabel: "挂单存活 + 撤单失衡 + 成交",
    description: "观察五档挂单是否持续、撤单偏向哪一边，再用真实主动成交确认。",
  }),
  Object.freeze({
    id: "first-probe-response",
    label: "首次探底承接",
    shortLabel: "先做一半 / 等二次探底",
    description: "首次下探后按承接强弱决定先做一半，或等待第二次探底。",
  }),
]);

const DEFAULT_CONFIG = Object.freeze({
  fiveMinuteWindow: 5,
  fiveMinuteLookback: 3,
  minimumMacdBars: 12,
  higherHighPct: 0.08,
  upperShadowRatio: 0.38,
  volumeContractionRatio: 0.88,
  l2Lookback: 5,
  minimumDepthSurvival: 0.55,
  withdrawalEpsilon: 0.05,
  tradeBuyRatio: 0.53,
  tradeSellRatio: 0.47,
  firstProbeLookback: 5,
  firstProbeTolerancePct: 0.12,
  minimumReboundPct: 0.15,
  secondProbeTolerancePct: 0.20,
});

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value, digits = 4) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

function mergeConfig(options = {}) {
  return { ...DEFAULT_CONFIG, ...options };
}

function priceOf(row) {
  return finite(row?.price ?? row?.close);
}

function volumeOf(row) {
  return Math.max(0, finite(row?.volume) ?? 0);
}

function aggregateFiveMinuteBars(minutes, index, config) {
  const rows = Array.isArray(minutes) ? minutes : [];
  const end = Math.min(Math.max(0, Number(index) || 0), rows.length - 1);
  const window = Math.max(3, Number(config.fiveMinuteWindow) || 5);
  const bars = [];
  // Fixed causal buckets keep the result stable while the live minute is
  // updated. A bucket is used only after all of its five source minutes exist.
  for (let bucketEnd = window - 1; bucketEnd <= end; bucketEnd += window) {
    const bucket = rows.slice(bucketEnd - window + 1, bucketEnd + 1);
    if (bucket.length !== window || bucket.some(row => priceOf(row) === null)) continue;
    const first = priceOf(bucket[0]);
    const close = priceOf(bucket.at(-1));
    const high = Math.max(...bucket.map(row => finite(row?.high) ?? priceOf(row) ?? 0));
    const low = Math.min(...bucket.map(row => finite(row?.low) ?? priceOf(row) ?? 0));
    bars.push({
      index: bucketEnd,
      time: String(bucket.at(-1)?.time ?? ""),
      open: first,
      close,
      high,
      low,
      volume: bucket.reduce((sum, row) => sum + volumeOf(row), 0),
    });
  }
  return bars;
}

function ema(values, period) {
  if (!values.length) return [];
  const alpha = 2 / (period + 1);
  let current = values[0];
  return values.map((value, index) => {
    if (index > 0) current = current + alpha * (value - current);
    return current;
  });
}

function macdSeries(closes) {
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const line = fast.map((value, index) => value - slow[index]);
  const signal = ema(line, 9);
  return line.map((value, index) => ({ line: value, signal: signal[index], histogram: value - signal[index] }));
}

function waitingResult(id, asOfTime, reason = "等待足够的因果数据") {
  return Object.freeze({
    id,
    status: "waiting",
    confirmed: false,
    score: 0,
    maxScore: 3,
    asOfTime: asOfTime ?? null,
    reason,
    checks: Object.freeze([]),
  });
}

/**
 * 5分钟顶背离 + 上影线 + 缩量。
 * The latest complete five-minute bucket is compared with the prior buckets;
 * the current bucket is never read before it closes.
 */
export function evaluateFiveMinuteExhaustion({ minutes, index, config: options = {} } = {}) {
  const config = mergeConfig(options);
  const bars = aggregateFiveMinuteBars(minutes, index, config);
  if (bars.length < Math.max(config.minimumMacdBars, config.fiveMinuteLookback + 2)) {
    return waitingResult("five-minute-exhaustion", bars.at(-1)?.time, "等待至少12根5分钟线与MACD基线");
  }
  const indicators = macdSeries(bars.map(bar => bar.close));
  const current = bars.at(-1);
  const currentIndicator = indicators.at(-1);
  const previousBars = bars.slice(-config.fiveMinuteLookback - 1, -1);
  const previousIndicators = indicators.slice(-config.fiveMinuteLookback - 1, -1);
  const previousHigh = Math.max(...previousBars.map(bar => bar.high));
  const previousMacdHigh = Math.max(...previousIndicators.map(item => item.line));
  const previousHistogramHigh = Math.max(...previousIndicators.map(item => item.histogram));
  const range = Math.max(0.000001, current.high - current.low);
  const upperShadow = (current.high - Math.max(current.open, current.close)) / range;
  const priorVolume = previousBars.reduce((sum, bar) => sum + bar.volume, 0) / Math.max(1, previousBars.length);
  const volumeRatio = priorVolume > 0 ? current.volume / priorVolume : null;
  const checks = [
    { key: "higher-high", label: "价格创新高", passed: current.high >= previousHigh * (1 + config.higherHighPct / 100) },
    { key: "macd-divergence", label: "MACD未同步创新高", passed: currentIndicator.line <= previousMacdHigh && currentIndicator.histogram <= previousHistogramHigh },
    { key: "upper-shadow", label: "上影线明显", passed: upperShadow >= config.upperShadowRatio },
    { key: "volume-contraction", label: "成交量收缩", passed: volumeRatio !== null && volumeRatio <= config.volumeContractionRatio },
  ];
  const score = checks.filter(item => item.passed).length;
  const confirmed = score === checks.length;
  return Object.freeze({
    id: "five-minute-exhaustion",
    status: confirmed ? "candidate" : score > 0 ? "watch" : "waiting",
    confirmed,
    score,
    maxScore: checks.length,
    direction: "反T",
    asOfTime: current.time,
    price: round(current.close, 4),
    metrics: Object.freeze({
      high: round(current.high, 4),
      previousHigh: round(previousHigh, 4),
      macd: round(currentIndicator.line, 6),
      previousMacdHigh: round(previousMacdHigh, 6),
      histogram: round(currentIndicator.histogram, 6),
      upperShadowPct: round(upperShadow * 100, 2),
      volumeRatio: round(volumeRatio, 3),
    }),
    checks: Object.freeze(checks),
    reason: confirmed
      ? "价格创新高但MACD背离，且上影线、缩量同时出现；仅作反T观察。"
      : `${checks.filter(item => !item.passed).map(item => item.label).join("、") || "条件未齐"}，继续观察。`,
  });
}

function depthOf(row, side) {
  const source = normalizeQmtOrderFlow(row);
  const values = side === "bid" ? source.bidVolumes : source.askVolumes;
  if (Array.isArray(values) && values.length) {
    const total = values.slice(0, 5).reduce((sum, value) => sum + Math.max(0, finite(value) ?? 0), 0);
    if (total > 0) return total;
  }
  return side === "bid" ? Math.max(0, source.bid1Volume ?? 0) : Math.max(0, source.ask1Volume ?? 0);
}

function activeTrade(row) {
  const flow = normalizeQmtOrderFlow(row);
  const buy = Math.max(0, flow.activeBuyVolume ?? flow.activeBuyNotional ?? 0);
  const sell = Math.max(0, flow.activeSellVolume ?? flow.activeSellNotional ?? 0);
  const total = buy + sell;
  const ratio = flow.activeBuyRatio ?? (total > 0 ? buy / total : null);
  const net = flow.ddx ?? (total > 0 ? buy - sell : null);
  return { flow, buy, sell, total, ratio, net };
}

/**
 * L2挂单存活率 + 撤单失衡 + 真实成交确认。
 * Direction is explicit so the same engine can audit a positive-T or
 * reverse-T candidate without silently choosing a side.
 */
export function evaluateL2OrderLifecycle({ points, index, direction = "正T", config: options = {} } = {}) {
  const config = mergeConfig(options);
  const rows = Array.isArray(points) ? points.slice(0, Math.min(points.length, (Number(index) || 0) + 1)) : [];
  const snapshots = rows
    .map((row, rowIndex) => ({ row, rowIndex, bid: depthOf(row, "bid"), ask: depthOf(row, "ask") }))
    .filter(item => item.bid > 0 && item.ask > 0 && normalizeQmtOrderFlow(item.row).status?.stale !== true && normalizeQmtOrderFlow(item.row).status?.authorized !== false)
    .slice(-Math.max(2, config.l2Lookback));
  const asOfTime = rows.at(-1)?.time ?? null;
  if (snapshots.length < 2) return waitingResult("l2-order-lifecycle", asOfTime, "等待至少2个有效L2盘口快照");
  const transitions = snapshots.slice(1).map((current, position) => {
    const previous = snapshots[position];
    const bidDrop = Math.max(0, previous.bid - current.bid);
    const askDrop = Math.max(0, previous.ask - current.ask);
    return {
      bidSurvival: clamp(Math.min(current.bid / previous.bid, 1)),
      askSurvival: clamp(Math.min(current.ask / previous.ask, 1)),
      bidWithdrawal: bidDrop,
      askWithdrawal: askDrop,
    };
  });
  const bidSurvival = transitions.reduce((sum, item) => sum + item.bidSurvival, 0) / transitions.length;
  const askSurvival = transitions.reduce((sum, item) => sum + item.askSurvival, 0) / transitions.length;
  const bidWithdrawal = transitions.reduce((sum, item) => sum + item.bidWithdrawal, 0);
  const askWithdrawal = transitions.reduce((sum, item) => sum + item.askWithdrawal, 0);
  const withdrawalTotal = bidWithdrawal + askWithdrawal;
  const withdrawalImbalance = withdrawalTotal > 0 ? (askWithdrawal - bidWithdrawal) / withdrawalTotal : 0;
  const trade = activeTrade(rows.at(-1));
  const wantsBuy = direction === "正T" || direction === "positiveT" || direction === "buy";
  const survival = wantsBuy ? bidSurvival : askSurvival;
  const withdrawalAligned = wantsBuy
    ? withdrawalImbalance >= -config.withdrawalEpsilon
    : withdrawalImbalance <= config.withdrawalEpsilon;
  const tradeConfirmed = trade.total > 0 && trade.ratio !== null && (wantsBuy
    ? trade.ratio >= config.tradeBuyRatio && (trade.net === null || trade.net >= 0)
    : trade.ratio <= config.tradeSellRatio && (trade.net === null || trade.net <= 0));
  const checks = [
    { key: "order-survival", label: "挂单还在", passed: survival >= config.minimumDepthSurvival },
    { key: "withdrawal-imbalance", label: "撤单方向一致", passed: withdrawalAligned },
    { key: "real-trades", label: "真实成交确认", passed: tradeConfirmed },
  ];
  const score = checks.filter(item => item.passed).length;
  const confirmed = score === checks.length;
  return Object.freeze({
    id: "l2-order-lifecycle",
    status: confirmed ? "candidate" : score > 0 ? "watch" : "waiting",
    confirmed,
    score,
    maxScore: checks.length,
    direction: wantsBuy ? "正T" : "反T",
    asOfTime,
    metrics: Object.freeze({
      bidSurvival: round(bidSurvival),
      askSurvival: round(askSurvival),
      withdrawalImbalance: round(withdrawalImbalance),
      activeBuyRatio: round(trade.ratio),
      activeVolume: round(trade.total, 2),
    }),
    checks: Object.freeze(checks),
    reason: confirmed
      ? `${wantsBuy ? "买方" : "卖方"}挂单存活、撤单方向和真实成交三项一致；仅作L2确认。`
      : `${checks.filter(item => !item.passed).map(item => item.label).join("、") || "条件未齐"}，不升级正式信号。`,
  });
}

function firstProbeCandidate(rows, index, config) {
  const end = Math.min(index, rows.length - 1);
  for (let probe = config.firstProbeLookback; probe <= end - 2; probe += 1) {
    const price = priceOf(rows[probe]);
    if (price === null) continue;
    const prior = rows.slice(Math.max(0, probe - config.firstProbeLookback), probe).map(priceOf).filter(value => value !== null);
    const following = rows.slice(probe + 1, Math.min(end + 1, probe + 3)).map(priceOf).filter(value => value !== null);
    if (prior.length < 3 || following.length < 2) continue;
    const priorLow = Math.min(...prior);
    const rebound = Math.min(...following) >= price * (1 + config.minimumReboundPct / 100);
    if (price <= priorLow * (1 + config.firstProbeTolerancePct / 100) && rebound) return { index: probe, price };
  }
  return null;
}

/**
 * After the first causal probe, distinguish a partial entry from waiting for
 * a second probe. This is an observation, never an order recommendation.
 */
export function evaluateFirstProbeResponse({ minutes, index, config: options = {} } = {}) {
  const config = mergeConfig(options);
  const rows = Array.isArray(minutes) ? minutes : [];
  const end = Math.min(Math.max(0, Number(index) || 0), rows.length - 1);
  const asOfTime = rows[end]?.time ?? null;
  const probe = firstProbeCandidate(rows, end, config);
  if (!probe) return waitingResult("first-probe-response", asOfTime, "尚未确认首次探底后的有效反弹");
  const currentPrice = priceOf(rows[end]);
  if (currentPrice === null) return waitingResult("first-probe-response", asOfTime, "当前价格缺失");
  const afterProbe = rows.slice(probe.index + 1, end + 1);
  const lowestAfter = Math.min(...afterProbe.map(priceOf).filter(value => value !== null), currentPrice);
  const secondProbe = lowestAfter <= probe.price * (1 - config.secondProbeTolerancePct / 100);
  const reboundPct = (Math.max(...afterProbe.map(priceOf).filter(value => value !== null), currentPrice) / probe.price - 1) * 100;
  const preProbeVolumes = rows.slice(Math.max(0, probe.index - config.firstProbeLookback), probe.index).map(volumeOf).filter(value => value > 0);
  const reboundVolumes = afterProbe.map(volumeOf).filter(value => value > 0);
  const volumeRatio = preProbeVolumes.length && reboundVolumes.length
    ? (reboundVolumes.reduce((sum, value) => sum + value, 0) / reboundVolumes.length) / (preProbeVolumes.reduce((sum, value) => sum + value, 0) / preProbeVolumes.length)
    : null;
  const recentTrades = afterProbe.map(activeTrade).filter(item => item.total > 0 && item.ratio !== null);
  const activeBuyRatio = recentTrades.length ? recentTrades.reduce((sum, item) => sum + item.ratio, 0) / recentTrades.length : null;
  const supportChecks = [
    { key: "price-response", label: "反弹幅度", passed: reboundPct >= config.minimumReboundPct },
    { key: "volume-support", label: "反弹有量", passed: volumeRatio === null || volumeRatio >= 0.80 },
    { key: "active-buy", label: "买盘承接", passed: activeBuyRatio === null || activeBuyRatio >= config.tradeBuyRatio },
  ];
  const availableChecks = supportChecks.filter(item => item.key === "price-response" || (item.key === "volume-support" ? volumeRatio !== null : activeBuyRatio !== null));
  const supportScore = supportChecks.filter(item => item.passed && (item.key === "price-response" || (item.key === "volume-support" ? volumeRatio !== null : activeBuyRatio !== null))).length;
  const strongSupport = !secondProbe && supportScore >= Math.min(2, Math.max(1, availableChecks.length));
  const decision = secondProbe ? "等待第二次探底" : strongSupport ? "先做一半" : "等待承接确认";
  const status = secondProbe ? "watch" : strongSupport ? "candidate" : "watch";
  return Object.freeze({
    id: "first-probe-response",
    status,
    confirmed: strongSupport && !secondProbe,
    score: supportScore,
    maxScore: availableChecks.length || supportChecks.length,
    direction: "正T",
    asOfTime,
    price: round(currentPrice, 4),
    decision,
    firstProbe: Object.freeze({ time: rows[probe.index]?.time ?? null, price: round(probe.price, 4), index: probe.index }),
    metrics: Object.freeze({ reboundPct: round(reboundPct, 2), volumeRatio: round(volumeRatio, 3), activeBuyRatio: round(activeBuyRatio), lowestAfter: round(lowestAfter, 4) }),
    checks: Object.freeze(supportChecks),
    reason: secondProbe
      ? "首次探底后又回到低点下方，先等第二次探底确认。"
      : strongSupport
        ? "首次探底后的反弹有价格、量能或买盘承接，影子建议只做一半。"
        : "首次探底后的承接还不够，暂不提前做T。",
  });
}

function uniqueConfirmed(events) {
  const seen = new Set();
  return events.filter(event => {
    if (!event?.confirmed || !event.asOfTime || seen.has(event.asOfTime)) return false;
    seen.add(event.asOfTime);
    return true;
  });
}

/** Evaluate all three experiments using only rows visible at `index`. */
export function evaluateZijinShadowExperiments({ minutes, index, config: options = {} } = {}) {
  const rows = Array.isArray(minutes) ? minutes : [];
  const safeIndex = Math.min(Math.max(0, Number(index) || 0), Math.max(0, rows.length - 1));
  const five = evaluateFiveMinuteExhaustion({ minutes: rows, index: safeIndex, config: options });
  const flowBuy = evaluateL2OrderLifecycle({ points: rows, index: safeIndex, direction: "正T", config: options });
  const flowSell = evaluateL2OrderLifecycle({ points: rows, index: safeIndex, direction: "反T", config: options });
  const probe = evaluateFirstProbeResponse({ minutes: rows, index: safeIndex, config: options });
  const events = {
    fiveMinuteExhaustion: uniqueConfirmed(Array.from({ length: safeIndex + 1 }, (_, cursor) => evaluateFiveMinuteExhaustion({ minutes: rows, index: cursor, config: options }))),
    l2OrderLifecycleBuy: uniqueConfirmed(Array.from({ length: safeIndex + 1 }, (_, cursor) => evaluateL2OrderLifecycle({ points: rows, index: cursor, direction: "正T", config: options }))),
    l2OrderLifecycleSell: uniqueConfirmed(Array.from({ length: safeIndex + 1 }, (_, cursor) => evaluateL2OrderLifecycle({ points: rows, index: cursor, direction: "反T", config: options }))),
    firstProbeResponse: uniqueConfirmed(Array.from({ length: safeIndex + 1 }, (_, cursor) => evaluateFirstProbeResponse({ minutes: rows, index: cursor, config: options }))),
  };
  return Object.freeze({
    schemaVersion: 1,
    version: ZIJIN_SHADOW_EXPERIMENTS_VERSION,
    asOfTime: rows[safeIndex]?.time ?? null,
    index: safeIndex,
    experiments: Object.freeze({ fiveMinuteExhaustion: five, l2OrderLifecycle: Object.freeze({ buy: flowBuy, sell: flowSell }), firstProbeResponse: probe }),
    events: Object.freeze({
      fiveMinuteExhaustion: Object.freeze(events.fiveMinuteExhaustion),
      l2OrderLifecycle: Object.freeze([...events.l2OrderLifecycleBuy, ...events.l2OrderLifecycleSell]),
      firstProbeResponse: Object.freeze(events.firstProbeResponse),
    }),
    counts: Object.freeze({
      fiveMinuteExhaustion: events.fiveMinuteExhaustion.length,
      l2OrderLifecycle: events.l2OrderLifecycleBuy.length + events.l2OrderLifecycleSell.length,
      firstProbeResponse: events.firstProbeResponse.length,
    }),
    researchOnly: true,
    shadowOnly: true,
    canCreateSignal: false,
    affectsProduction: false,
  });
}
