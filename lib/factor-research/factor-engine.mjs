import { normalizeQmtOrderFlow } from "../qmt-orderflow-confirmation.mjs";
import { DEFAULT_FACTOR_REGISTRY, FACTOR_REGISTRY_VERSION } from "./factor-registry.mjs";

export const FACTOR_ENGINE_VERSION = "1.0.0";
export const FORBIDDEN_FACTOR_INPUTS = Object.freeze([
  "futurePrice", "futureReturn", "futureHigh", "futureLow", "label", "target", "outcome", "pnl",
]);

export class FutureLeakageError extends Error {
  constructor(message) {
    super(message);
    this.name = "FutureLeakageError";
  }
}

const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
  ? Number(value)
  : null;
const safeRatio = (numerator, denominator) => Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
  ? numerator / denominator
  : null;
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const stddev = values => {
  const mean = average(values);
  if (mean === null || values.length < 2) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
};
const normalizeTime = value => String(value ?? "").replace(/:/g, "").slice(0, 4);

function tradingMinuteOrdinal(time) {
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  const total = hour * 60 + minute;
  if (total >= 570 && total <= 690) return total - 570;
  if (total >= 780 && total <= 900) return 120 + total - 780;
  return null;
}

function normalizePoint(raw, previous = null) {
  const price = finite(raw?.price ?? raw?.close);
  if (price === null || price <= 0) return null;
  const open = finite(raw?.open) ?? previous?.price ?? price;
  const high = Math.max(price, open, finite(raw?.high) ?? price);
  const low = Math.min(price, open, finite(raw?.low) ?? price);
  const volume = Math.max(0, finite(raw?.volume) ?? 0);
  const amount = Math.max(0, finite(raw?.amount ?? raw?.turnover ?? raw?.notional) ?? 0);
  const flow = normalizeQmtOrderFlow(raw);
  return {
    ...raw,
    time: normalizeTime(raw?.time),
    price,
    open,
    high,
    low,
    close: price,
    volume,
    amount,
    marketPrice: finite(raw?.marketPrice ?? raw?.benchmarkPrice ?? raw?.indexPrice),
    sectorPrice: finite(raw?.sectorPrice ?? raw?.industryPrice),
    activeBuyVolume: flow.activeBuyVolume,
    activeSellVolume: flow.activeSellVolume,
    activeBuyNotional: flow.activeBuyNotional,
    activeSellNotional: flow.activeSellNotional,
    bigOrderNet: flow.bigOrderNet,
    bid1Volume: flow.bid1Volume,
    ask1Volume: flow.ask1Volume,
    nearTouchImbalance: flow.nearTouchImbalance,
  };
}

export function normalizeFactorSession(session) {
  const byTime = new Map();
  let previous = null;
  for (const raw of Array.isArray(session?.minutes) ? session.minutes : []) {
    const point = normalizePoint(raw, previous);
    if (!point || !/^\d{4}$/.test(point.time) || tradingMinuteOrdinal(point.time) === null) continue;
    byTime.set(point.time, point);
    previous = point;
  }
  return {
    date: String(session?.date ?? ""),
    previousClose: finite(session?.previousClose),
    marketRegime: session?.marketRegime ?? null,
    minutes: [...byTime.values()].sort((left, right) => left.time.localeCompare(right.time)),
  };
}

function windowValues(points, field, index, length, endOffset = 0) {
  const end = index + endOffset;
  if (end < 0) return [];
  const start = Math.max(0, end - length + 1);
  return points.slice(start, end + 1).map(point => finite(point?.[field])).filter(value => value !== null);
}

function returnAt(points, index, lookback, field = "price") {
  const current = finite(points[index]?.[field]);
  const base = finite(points[index - lookback]?.[field]);
  const ratio = safeRatio(current, base);
  return ratio === null ? null : ratio - 1;
}

function range(points, index, length, endOffset = 0) {
  const end = index + endOffset;
  if (end < 0) return null;
  const slice = points.slice(Math.max(0, end - length + 1), end + 1);
  if (!slice.length) return null;
  return { high: Math.max(...slice.map(point => point.high)), low: Math.min(...slice.map(point => point.low)) };
}

function correlation(left, right) {
  if (left.length !== right.length || left.length < 3) return null;
  const leftMean = average(left);
  const rightMean = average(right);
  const numerator = left.reduce((sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean), 0);
  const denominator = Math.sqrt(
    left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0)
    * right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0),
  );
  return denominator > 0 ? numerator / denominator : null;
}

function emaSeries(values, period) {
  const alpha = 2 / (period + 1);
  const output = [];
  let current = null;
  for (const value of values) {
    current = current === null ? value : alpha * value + (1 - alpha) * current;
    output.push(current);
  }
  return output;
}

function computeDerived(points) {
  let cumulativeVolume = 0;
  let cumulativeNotional = 0;
  let fallbackPriceSum = 0;
  const vwaps = [];
  const trueRanges = [];
  const returns1m = [];
  const ofi = [];
  const prices = points.map(point => point.price);

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const notional = point.amount > 0 ? point.amount : point.price * point.volume;
    cumulativeVolume += point.volume;
    cumulativeNotional += notional;
    fallbackPriceSum += point.price;
    vwaps.push(cumulativeVolume > 0 ? cumulativeNotional / cumulativeVolume : fallbackPriceSum / (index + 1));
    const previousClose = points[index - 1]?.price ?? point.open;
    trueRanges.push(Math.max(point.high - point.low, Math.abs(point.high - previousClose), Math.abs(point.low - previousClose)));
    returns1m.push(index > 0 ? point.price / points[index - 1].price - 1 : 0);
    const flowTotal = (point.activeBuyVolume ?? 0) + (point.activeSellVolume ?? 0);
    ofi.push(flowTotal > 0 ? ((point.activeBuyVolume ?? 0) - (point.activeSellVolume ?? 0)) / flowTotal : null);
  }

  const ema12 = emaSeries(prices, 12);
  const ema26 = emaSeries(prices, 26);
  const dif = prices.map((_, index) => ema12[index] - ema26[index]);
  const dea = emaSeries(dif, 9);
  const macdHistogram = dif.map((value, index) => value - dea[index]);
  return { vwaps, trueRanges, returns1m, ofi, macdHistogram };
}

export class CausalFactorContext {
  constructor(session, asOfIndex, derived = null) {
    this.session = session;
    this.asOfIndex = asOfIndex;
    this.derived = derived ?? computeDerived(session.minutes);
  }

  point(absoluteIndex = this.asOfIndex) {
    if (absoluteIndex > this.asOfIndex) {
      throw new FutureLeakageError(`Attempted to read minute ${absoluteIndex} after as-of index ${this.asOfIndex}`);
    }
    return this.session.minutes[absoluteIndex] ?? null;
  }

  values(field, length, endOffset = 0) {
    if (endOffset > 0) throw new FutureLeakageError(`Positive endOffset ${endOffset} is not causal`);
    return windowValues(this.session.minutes, field, this.asOfIndex, length, endOffset);
  }
}

function factorValue(factorId, context) {
  const points = context.session.minutes;
  const index = context.asOfIndex;
  const point = context.point();
  const derived = context.derived;
  const vwapBias = safeRatio(point.price, derived.vwaps[index]);
  const recentRange = length => range(points, index, length);
  const valueMap = {
    "price.return_1m": () => returnAt(points, index, 1),
    "price.return_3m": () => returnAt(points, index, 3),
    "price.return_5m": () => returnAt(points, index, 5),
    "price.return_10m": () => returnAt(points, index, 10),
    "price.return_15m": () => returnAt(points, index, 15),
    "price.return_30m": () => returnAt(points, index, 30),
    "price.gap_previous_close": () => {
      const ratio = safeRatio(points[0]?.open, context.session.previousClose);
      return ratio === null ? null : ratio - 1;
    },
    "price.session_return": () => point.price / points[0].open - 1,
    "price.intraday_position": () => {
      const currentRange = range(points, index, index + 1);
      return currentRange && currentRange.high > currentRange.low
        ? (point.price - currentRange.low) / (currentRange.high - currentRange.low) * 2 - 1
        : null;
    },
    "vwap.bias": () => vwapBias === null ? null : vwapBias - 1,
    "vwap.slope_3m": () => index >= 3 ? derived.vwaps[index] / derived.vwaps[index - 3] - 1 : null,
    "vwap.slope_5m": () => index >= 5 ? derived.vwaps[index] / derived.vwaps[index - 5] - 1 : null,
    "vwap.slope_15m": () => index >= 15 ? derived.vwaps[index] / derived.vwaps[index - 15] - 1 : null,
    "vwap.cross": () => index > 0 ? Math.sign(point.price / derived.vwaps[index] - 1) - Math.sign(points[index - 1].price / derived.vwaps[index - 1] - 1) : null,
    "vwap.persistence_5m": () => index >= 4 ? average(points.slice(index - 4, index + 1).map((row, offset) => row.price >= derived.vwaps[index - 4 + offset] ? 1 : 0)) * 2 - 1 : null,
    "vwap.mean_reversion": () => vwapBias === null ? null : 1 - vwapBias,
    "volume.ratio_5_20": () => safeRatio(average(context.values("volume", 5)), average(context.values("volume", 20))),
    "volume.momentum_3_15": () => {
      const ratio = safeRatio(average(context.values("volume", 3)), average(context.values("volume", 15)));
      return ratio === null ? null : ratio - 1;
    },
    "volume.zscore_20": () => {
      const values = context.values("volume", 20);
      const deviation = stddev(values);
      return values.length >= 5 && deviation > 0 ? (point.volume - average(values)) / deviation : null;
    },
    "volume.price_alignment_5m": () => {
      if (index < 5) return null;
      const returns = derived.returns1m.slice(index - 4, index + 1);
      const volumeChanges = points.slice(index - 4, index + 1).map((row, offset) => {
        const absolute = index - 4 + offset;
        const prior = points[absolute - 1]?.volume;
        return prior > 0 ? row.volume / prior - 1 : 0;
      });
      return correlation(returns, volumeChanges);
    },
    "volume.dry_up_5_20": () => {
      const ratio = safeRatio(average(context.values("volume", 5)), average(context.values("volume", 20)));
      return ratio === null ? null : 1 - ratio;
    },
    "volatility.true_range": () => safeRatio(derived.trueRanges[index], points[index - 1]?.price ?? point.price),
    "volatility.atr14": () => safeRatio(average(derived.trueRanges.slice(Math.max(0, index - 13), index + 1)), point.price),
    "volatility.realized_10m": () => index >= 2 ? Math.sqrt(derived.returns1m.slice(Math.max(1, index - 9), index + 1).reduce((sum, value) => sum + value ** 2, 0)) : null,
    "volatility.range_expansion_5m": () => {
      if (index < 9) return null;
      const current = range(points, index, 5);
      const previous = range(points, index, 5, -5);
      const currentWidth = current.high - current.low;
      const previousWidth = previous.high - previous.low;
      return previousWidth > 0 ? currentWidth / previousWidth - 1 : null;
    },
    "volatility.bollinger_bandwidth_20": () => {
      const values = context.values("price", 20);
      const mean = average(values);
      const deviation = stddev(values);
      return values.length >= 5 && mean > 0 && deviation !== null ? 4 * deviation / mean : null;
    },
    "technical.rsi14": () => {
      if (index < 2) return null;
      const changes = derived.returns1m.slice(Math.max(1, index - 13), index + 1);
      const gains = average(changes.map(value => Math.max(0, value)));
      const losses = average(changes.map(value => Math.max(0, -value)));
      if (losses === 0) return gains > 0 ? 1 : 0;
      const rsi = 100 - 100 / (1 + gains / losses);
      return rsi / 50 - 1;
    },
    "technical.macd_histogram": () => safeRatio(derived.macdHistogram[index], point.price),
    "technical.macd_histogram_delta": () => index > 0 ? (derived.macdHistogram[index] - derived.macdHistogram[index - 1]) / point.price : null,
    "technical.kdj_j9": () => {
      const currentRange = recentRange(9);
      if (!currentRange || currentRange.high === currentRange.low) return null;
      let k = 50;
      let d = 50;
      const start = Math.max(0, index - 8);
      for (let cursor = start; cursor <= index; cursor += 1) {
        const cursorRange = range(points, cursor, Math.min(9, cursor + 1));
        const cursorRsv = cursorRange.high === cursorRange.low ? 50 : (points[cursor].price - cursorRange.low) / (cursorRange.high - cursorRange.low) * 100;
        k = k * 2 / 3 + cursorRsv / 3;
        d = d * 2 / 3 + k / 3;
      }
      return (3 * k - 2 * d) / 50 - 1;
    },
    "technical.bollinger_position_20": () => {
      const values = context.values("price", 20);
      const mean = average(values);
      const deviation = stddev(values);
      return values.length >= 5 && deviation > 0 ? (point.price - (mean - 2 * deviation)) / (4 * deviation) * 2 - 1 : null;
    },
    "intraday.reversal_3m": () => index >= 3 ? derived.returns1m[index] - (points[index - 1].price / points[index - 3].price - 1) : null,
    "intraday.upper_shadow": () => {
      const width = point.high - point.low;
      return width > 0 ? (point.high - Math.max(point.open, point.price)) / width : null;
    },
    "intraday.lower_shadow": () => {
      const width = point.high - point.low;
      return width > 0 ? (Math.min(point.open, point.price) - point.low) / width : null;
    },
    "intraday.breakout_20m": () => {
      if (index < 2) return null;
      const prior = range(points, index, 20, -1);
      return prior?.high > 0 ? point.price / prior.high - 1 : null;
    },
    "intraday.pullback_10m_high": () => {
      const currentRange = recentRange(10);
      return currentRange?.high > 0 ? point.price / currentRange.high - 1 : null;
    },
    "market.return_5m": () => returnAt(points, index, 5, "marketPrice"),
    "market.sector_return_5m": () => returnAt(points, index, 5, "sectorPrice"),
    "market.relative_strength_5m": () => {
      const stock = returnAt(points, index, 5);
      const market = returnAt(points, index, 5, "marketPrice");
      return stock === null || market === null ? null : stock - market;
    },
    "market.regime": () => {
      const marketReturn = returnAt(points, index, 15, "marketPrice");
      if (marketReturn === null) return null;
      const marketReturns = [];
      for (let cursor = Math.max(1, index - 14); cursor <= index; cursor += 1) {
        const value = returnAt(points, cursor, 1, "marketPrice");
        if (value === null) return null;
        marketReturns.push(value);
      }
      return Math.sign(marketReturn) * Math.abs(marketReturn) / (1 + (stddev(marketReturns) ?? 0));
    },
    "orderflow.active_buy_imbalance": () => derived.ofi[index],
    "orderflow.ofi_change_3m": () => index >= 3 && derived.ofi[index] !== null && derived.ofi[index - 3] !== null ? derived.ofi[index] - derived.ofi[index - 3] : null,
    "orderflow.large_order_net_ratio": () => {
      const total = (point.activeBuyNotional ?? 0) + (point.activeSellNotional ?? 0);
      return point.bigOrderNet !== null && total > 0 ? point.bigOrderNet / total : null;
    },
    "orderflow.book_depth_imbalance": () => {
      if (point.nearTouchImbalance !== null) return point.nearTouchImbalance;
      const total = (point.bid1Volume ?? 0) + (point.ask1Volume ?? 0);
      return point.bid1Volume !== null && point.ask1Volume !== null && total > 0 ? (point.bid1Volume - point.ask1Volume) / total : null;
    },
    "time.minutes_from_open": () => tradingMinuteOrdinal(point.time) / 239,
    "time.opening_window": () => tradingMinuteOrdinal(point.time) < 30 ? 1 : 0,
    "time.afternoon_window": () => point.time >= "1300" && point.time < "1430" ? 1 : 0,
    "time.closing_window": () => point.time >= "1430" ? 1 : 0,
  };
  const calculate = valueMap[factorId];
  if (!calculate) throw new Error(`No calculator registered for ${factorId}`);
  const value = calculate();
  return Number.isFinite(value) ? value : null;
}

function assertLeakageSafeDefinition(definition) {
  const forbidden = definition.inputFields.find(field => FORBIDDEN_FACTOR_INPUTS.includes(field));
  if (forbidden) throw new FutureLeakageError(`${definition.factorId} declares forbidden input ${forbidden}`);
}

export class FactorEngine {
  constructor({ registry = DEFAULT_FACTOR_REGISTRY } = {}) {
    this.registry = registry;
    this.engineVersion = FACTOR_ENGINE_VERSION;
  }

  computeSession(rawSession, { factorIds = null, startIndex = 0 } = {}) {
    const session = normalizeFactorSession(rawSession);
    const definitions = this.registry.list().filter(definition => !factorIds || factorIds.includes(definition.factorId));
    for (const definition of definitions) assertLeakageSafeDefinition(definition);
    const derived = computeDerived(session.minutes);
    const rows = [];
    for (let index = Math.max(0, startIndex); index < session.minutes.length; index += 1) {
      const context = new CausalFactorContext(session, index, derived);
      rows.push({
        date: session.date,
        time: session.minutes[index].time,
        index,
        price: session.minutes[index].price,
        marketRegime: session.marketRegime,
        factors: Object.fromEntries(definitions.map(definition => [definition.factorId, factorValue(definition.factorId, context)])),
      });
    }
    return { engineVersion: this.engineVersion, factorVersion: FACTOR_REGISTRY_VERSION, session, rows };
  }

  computeSessions(sessions, options = {}) {
    return (Array.isArray(sessions) ? sessions : []).map(session => this.computeSession(session, options));
  }
}

export function auditFutureInvariance(rawSession, { factorIds = null, checkpoints = null } = {}) {
  const engine = new FactorEngine();
  const full = engine.computeSession(rawSession, { factorIds });
  const defaultCheckpoints = [
    Math.floor(full.rows.length * 0.25),
    Math.floor(full.rows.length * 0.50),
    Math.floor(full.rows.length * 0.75),
  ].filter(index => index >= 0 && index < full.rows.length);
  const selected = [...new Set(checkpoints ?? defaultCheckpoints)];
  const mismatches = [];
  for (const index of selected) {
    const prefixSession = {
      ...rawSession,
      minutes: full.session.minutes.slice(0, index + 1),
    };
    const prefix = engine.computeSession(prefixSession, { factorIds });
    const fullFactors = full.rows[index]?.factors ?? {};
    const prefixFactors = prefix.rows[index]?.factors ?? {};
    for (const factorId of Object.keys(fullFactors)) {
      if (!Object.is(fullFactors[factorId], prefixFactors[factorId])) {
        mismatches.push({ index, factorId, full: fullFactors[factorId], prefix: prefixFactors[factorId] });
      }
    }
  }
  return {
    pass: mismatches.length === 0,
    checkpoints: selected,
    factors: Object.keys(full.rows[0]?.factors ?? {}).length,
    mismatches,
  };
}
