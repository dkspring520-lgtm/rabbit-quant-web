/**
 * Deterministic daily/weekly context for the trading desk.
 *
 * This module is display-only. It describes the observed daily bars and their
 * causal weekly aggregation; it does not emit a buy/sell signal, score, or
 * probability and it never reads a bar after the requested as-of date.
 */

export const MULTI_TIMEFRAME_CONTEXT_CONTRACT = Object.freeze({
  version: "2026.09-multi-timeframe-context-v1",
  displayOnly: true,
  emitsSignals: false,
  emitsScores: false,
  emitsProbabilities: false,
  supportResistanceMethod: "causal-recent-extrema",
});

const DEFAULT_SUPPORT_LOOKBACK = 20;
const DEFAULT_DAILY_SHORT_WINDOW = 5;
const DEFAULT_DAILY_LONG_WINDOW = 20;
const DEFAULT_DAILY_MOMENTUM_LOOKBACK = 5;
const DEFAULT_WEEKLY_SHORT_WINDOW = 2;
const DEFAULT_WEEKLY_LONG_WINDOW = 8;
const DEFAULT_WEEKLY_MOMENTUM_LOOKBACK = 2;

function finitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function normalizeDate(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = `${year}-${month}-${day}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return date;
}

function normalizeDailyBars(bars, asOfDate = null) {
  if (!Array.isArray(bars)) return [];
  const cutoff = normalizeDate(asOfDate);
  const byDate = new Map();

  for (const source of bars) {
    const date = normalizeDate(source?.date ?? source?.time);
    if (!date || (cutoff && date > cutoff)) continue;
    const close = Number(source?.close);
    if (!finitePositive(close)) continue;

    const open = finitePositive(source?.open) ? Number(source.open) : close;
    const highCandidate = finitePositive(source?.high) ? Number(source.high) : Math.max(open, close);
    const lowCandidate = finitePositive(source?.low) ? Number(source.low) : Math.min(open, close);
    const high = Math.max(highCandidate, open, close);
    const low = Math.min(lowCandidate, open, close);
    if (!finitePositive(high) || !finitePositive(low) || low > high) continue;

    // A duplicate date is replaced by the last source row, while output is
    // sorted below. This keeps a corrected provider row from being counted
    // twice without mutating the caller's array.
    byDate.set(date, {
      date,
      open,
      close,
      high,
      low,
      volume: Number.isFinite(Number(source?.volume)) ? Math.max(0, Number(source.volume)) : null,
      amount: Number.isFinite(Number(source?.amount)) ? Math.max(0, Number(source.amount)) : null,
    });
  }

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function mondayOf(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const day = parsed.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Aggregate observed daily bars by ISO-like Monday-starting exchange week.
 * The current partial week is intentionally retained because it is already
 * observable; callers must pass an as-of date when replaying a prefix.
 */
export function aggregateWeeklyBars(bars = []) {
  const normalized = normalizeDailyBars(bars);
  const grouped = new Map();
  for (const bar of normalized) {
    const weekStart = mondayOf(bar.date);
    const current = grouped.get(weekStart);
    if (!current) {
      grouped.set(weekStart, {
        date: weekStart,
        weekStart,
        weekEnd: bar.date,
        open: bar.open,
        close: bar.close,
        high: bar.high,
        low: bar.low,
        volume: bar.volume,
        amount: bar.amount,
        sourceBars: 1,
      });
      continue;
    }
    current.weekEnd = bar.date;
    current.close = bar.close;
    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.volume = current.volume === null || bar.volume === null
      ? null
      : current.volume + bar.volume;
    current.amount = current.amount === null || bar.amount === null
      ? null
      : current.amount + bar.amount;
    current.sourceBars += 1;
  }
  const weeks = [...grouped.values()].sort((left, right) => left.date.localeCompare(right.date));
  return weeks.map((week) => ({ ...week, observedSessions: week.sourceBars }));
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function trailingAverage(closes, requestedWindow) {
  const window = Math.max(1, Math.min(closes.length, Math.trunc(Number(requestedWindow) || 1)));
  return average(closes.slice(-window));
}

function classifyTrend(bars, options = {}) {
  const closes = bars.map(bar => bar.close).filter(finitePositive);
  const minBars = Math.max(2, Math.trunc(Number(options.minBars) || 2));
  const shortWindow = Math.max(1, Math.trunc(Number(options.shortWindow) || 1));
  const longWindow = Math.max(shortWindow, Math.trunc(Number(options.longWindow) || shortWindow));
  const momentumLookback = Math.max(1, Math.trunc(Number(options.momentumLookback) || 1));
  const latest = closes.at(-1) ?? null;

  if (closes.length < minBars || latest === null) {
    return {
      key: "insufficient",
      label: "数据不足",
      bars: closes.length,
      latestClose: latest,
      shortAverage: null,
      longAverage: null,
      momentumPct: null,
      averageGapPct: null,
      observedSessions: Number.isFinite(Number(bars.at(-1)?.observedSessions))
        ? Number(bars.at(-1).observedSessions)
        : null,
      reason: `至少需要 ${minBars} 根已观测周期数据`,
    };
  }

  const shortAverage = trailingAverage(closes, shortWindow);
  const longAverage = trailingAverage(closes, longWindow);
  const anchorIndex = Math.max(0, closes.length - 1 - momentumLookback);
  const anchor = closes[anchorIndex];
  const momentumPct = finitePositive(anchor) ? ((latest - anchor) / anchor) * 100 : null;
  const averageGapPct = finitePositive(longAverage)
    ? ((shortAverage - longAverage) / longAverage) * 100
    : null;
  const threshold = Number.isFinite(Number(options.thresholdPct))
    ? Math.max(0.1, Number(options.thresholdPct))
    : 1;
  const momentumThreshold = Number.isFinite(Number(options.momentumThresholdPct))
    ? Math.max(0.1, Number(options.momentumThresholdPct))
    : threshold;

  const strong = latest >= longAverage
    && averageGapPct >= threshold
    && momentumPct >= momentumThreshold;
  const weak = latest <= longAverage
    && averageGapPct <= -threshold
    && momentumPct <= -momentumThreshold;
  const key = strong ? "strong-up" : weak ? "strong-down" : "range";
  return {
    key,
    label: key === "strong-up" ? "偏强" : key === "strong-down" ? "偏弱" : "震荡",
    bars: closes.length,
    latestClose: latest,
    shortAverage,
    longAverage,
    momentumPct,
    averageGapPct,
    observedSessions: Number.isFinite(Number(bars.at(-1)?.observedSessions))
      ? Number(bars.at(-1).observedSessions)
      : null,
    reason: key === "strong-up"
      ? "价格位于长期均值上方，短期均值和近期动量同步偏强"
      : key === "strong-down"
        ? "价格位于长期均值下方，短期均值和近期动量同步偏弱"
        : "短期均值、长期均值与近期动量尚未形成同向结构",
  };
}

function extremum(bars, side) {
  let selected = null;
  for (const bar of bars) {
    const price = side === "support" ? bar.low : bar.high;
    if (!selected || (side === "support" ? price <= selected.price : price >= selected.price)) {
      selected = { price, date: bar.date };
    }
  }
  return selected;
}

function buildSupportResistance(bars, requestedLookback) {
  const lookback = Math.max(1, Math.min(bars.length, Math.trunc(Number(requestedLookback) || DEFAULT_SUPPORT_LOOKBACK)));
  const recent = bars.slice(-lookback);
  const support = extremum(recent, "support");
  const resistance = extremum(recent, "resistance");
  return {
    method: "causal-recent-extrema",
    lookbackBars: lookback,
    asOfDate: bars.at(-1)?.date ?? null,
    support: support ? { ...support, label: "近期支撑参考", causal: true, confirmed: false } : null,
    resistance: resistance ? { ...resistance, label: "近期压力参考", causal: true, confirmed: false } : null,
    note: "仅取截至当前日期的最近高低点参考，不使用未来数据，也不代表已确认的交易位。",
  };
}

function invalidationFor(dailyTrend, supportResistance) {
  const support = supportResistance.support?.price ?? null;
  const resistance = supportResistance.resistance?.price ?? null;
  if (dailyTrend.key === "strong-up") {
    return { key: "break-support", label: "跌破支撑后重新判断", price: support, reference: "support" };
  }
  if (dailyTrend.key === "strong-down") {
    return { key: "recover-resistance", label: "站回压力后重新判断", price: resistance, reference: "resistance" };
  }
  if (dailyTrend.key === "range") {
    return { key: "range-break", label: "突破压力或跌破支撑后重新判断", price: null, reference: "support-resistance" };
  }
  return { key: "insufficient", label: "数据积累后再判断", price: null, reference: null };
}

/**
 * Build compact daily/weekly context for display in the desk.
 *
 * @param {Array<{date:string,open?:number,close:number,high?:number,low?:number,volume?:number,amount?:number}>} bars
 * @param {{asOfDate?:string,supportLookback?:number}} [options]
 */
export function buildMultiTimeframeContext(bars = [], options = {}) {
  const dailyBars = normalizeDailyBars(bars, options.asOfDate);
  const weeklyBars = aggregateWeeklyBars(dailyBars);
  const dailyTrend = classifyTrend(dailyBars, {
    minBars: 5,
    shortWindow: DEFAULT_DAILY_SHORT_WINDOW,
    longWindow: DEFAULT_DAILY_LONG_WINDOW,
    momentumLookback: DEFAULT_DAILY_MOMENTUM_LOOKBACK,
    thresholdPct: 1,
    momentumThresholdPct: 1.5,
  });
  const weeklyTrend = classifyTrend(weeklyBars, {
    minBars: 3,
    shortWindow: DEFAULT_WEEKLY_SHORT_WINDOW,
    longWindow: DEFAULT_WEEKLY_LONG_WINDOW,
    momentumLookback: DEFAULT_WEEKLY_MOMENTUM_LOOKBACK,
    thresholdPct: 1.5,
    momentumThresholdPct: 2,
  });
  const supportResistance = buildSupportResistance(dailyBars, options.supportLookback);

  return {
    ...MULTI_TIMEFRAME_CONTEXT_CONTRACT,
    available: dailyBars.length > 0,
    asOfDate: dailyBars.at(-1)?.date ?? null,
    daily: dailyTrend,
    weekly: weeklyTrend,
    supportResistance,
    invalidation: invalidationFor(dailyTrend, supportResistance),
    note: "日线和周线只作为背景，不并入实时买卖评分；周线按本周已观测日线聚合，盘中数据可能变化。",
  };
}
