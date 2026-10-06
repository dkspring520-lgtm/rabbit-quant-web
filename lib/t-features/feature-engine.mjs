import { IndicatorEngine } from "../indicators/index.mjs";
import { CORE_SAFE_DEPENDENCIES, emptyFeatureSnapshot } from "./feature-contract.mjs";

const n = value => Number.isFinite(Number(value)) ? Number(value) : null;
const priceOf = point => n(point?.close ?? point?.price);
const ratio = (a, b) => a !== null && b !== null && b !== 0 ? a / b - 1 : null;
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const allFinite = values => values.every(value => value !== null && Number.isFinite(value));

function causalWindow(points, index, length) { return points.slice(Math.max(0, index - length + 1), index + 1); }
function derived(points, index, length = 20) {
  const point = points[index];
  const prices = points.slice(0, index + 1).map(priceOf);
  const current = priceOf(point);
  const previous = priceOf(points[index - 1]);
  const p2 = priceOf(points[index - 2]);
  const velocity = current !== null && previous !== null && previous !== 0 ? current / previous - 1 : null;
  const prevVelocity = previous !== null && p2 !== null && p2 !== 0 ? previous / p2 - 1 : null;
  const window = causalWindow(points, index, length);
  const highs = window.map(item => n(item?.high ?? item?.close ?? item?.price)).filter(value => value !== null);
  const lows = window.map(item => n(item?.low ?? item?.close ?? item?.price)).filter(value => value !== null);
  const volumes = window.map(item => n(item?.volume)).filter(value => value !== null);
  const high = highs.length ? Math.max(...highs) : null;
  const low = lows.length ? Math.min(...lows) : null;
  const volume = n(point?.volume);
  const volumeBase = volumes.length > 1 ? mean(volumes.slice(0, -1)) : null;
  const range = high !== null && low !== null && high !== low ? high - low : null;
  const prevHigh = index > 0 ? Math.max(...causalWindow(points, index - 1, length).map(item => n(item?.high ?? item?.close ?? item?.price)).filter(value => value !== null)) : null;
  const prevLow = index > 0 ? Math.min(...causalWindow(points, index - 1, length).map(item => n(item?.low ?? item?.close ?? item?.price)).filter(value => value !== null)) : null;
  const closeLocation = current !== null && range ? (current - low) / range : null;
  const volatility = prices.length >= 3 ? Math.sqrt(mean(prices.slice(1).map((value, i) => { const r = value / prices[i] - 1; return r * r; }))) : null;
  return { current, previous, velocity, prevVelocity, acceleration: velocity !== null && prevVelocity !== null ? velocity - prevVelocity : null, high, low, range, closeLocation, volume, volumeBase, prevHigh, prevLow, volatility };
}

export class TFeatureEngine {
  constructor({ indicatorEngine = new IndicatorEngine(), lookback = 20 } = {}) { this.indicatorEngine = indicatorEngine; this.lookback = lookback; }

  calculate(points, { index = points?.length - 1, symbol = "", timeframe = "1m", indicators = null } = {}) {
    if (!Array.isArray(points) || !Number.isInteger(index) || index < 0 || index >= (points?.length ?? 0)) return emptyFeatureSnapshot({ symbol, timeframe, reason: "invalid market data index" });
    const point = points[index];
    const d = derived(points, index, this.lookback);
    const indicatorIds = ["VWAP_SESSION", "EMA_20", "VWMA_20", "RSI_14", "ATR_14", "MFI_14", "HISTORICAL_VOLATILITY_20"];
    const raw = indicators ?? Object.fromEntries(indicatorIds.map(id => [id, this.indicatorEngine.calculateSeries(id, points.slice(0, index + 1)).series.at(-1)?.value ?? null]));
    const value = id => { const item = raw?.[id]; return n(item?.value ?? item); };
    const vwap = value("VWAP_SESSION"); const ema = value("EMA_20"); const vwma = value("VWMA_20");
    const required = [d.current, d.previous, d.velocity, d.acceleration, d.volume, vwap, ema, vwma];
    const validity = allFinite(required) ? "VALID" : (d.current !== null ? "WARMUP" : "INVALID");
    const timestamp = point?.timestamp ?? point?.time ?? null;
    const base = { timestamp, symbol, timeframe, valid: validity === "VALID", validity, reason: validity === "VALID" ? null : "CORE_SAFE dependency warmup or invalid", researchOnly: true, rlEligible: false };
    const trendDirection = d.velocity > 0 ? "UP" : d.velocity < 0 ? "DOWN" : "FLAT";
    const rangePosition = d.closeLocation;
    const snapshot = { ...base, trend: { trendDirection, trendSlope: d.velocity, priceVsVWAP: ratio(d.current, vwap), priceVsEMA: ratio(d.current, ema), priceVsVWMA: ratio(d.current, vwma) }, position: { rangePosition, distanceFromVWAP: ratio(d.current, vwap), distanceFromRecentHigh: ratio(d.current, d.high), distanceFromRecentLow: ratio(d.current, d.low) }, momentum: { shortMomentum: d.velocity, mediumMomentum: ratio(d.current, priceOf(points[Math.max(0, index - 5)])), momentumAcceleration: d.acceleration, momentumDecay: d.velocity !== null && d.prevVelocity !== null ? Math.max(0, Math.abs(d.prevVelocity) - Math.abs(d.velocity)) : null }, volume: { volumeRatio: d.volumeBase ? d.volume / d.volumeBase : null, volumeExpansion: d.volumeBase ? d.volume > d.volumeBase : false, volumeContraction: d.volumeBase ? d.volume < d.volumeBase : false, volumeTrend: d.volumeBase === null ? "UNKNOWN" : d.volume > d.volumeBase ? "EXPANDING" : d.volume < d.volumeBase ? "CONTRACTING" : "STABLE" }, volatility: { ATR: value("ATR_14"), ATRRatio: value("ATR_14") !== null && d.current ? value("ATR_14") / d.current : null, volatilityExpansion: d.volatility !== null && d.volatility > 0, volatilityContraction: d.volatility !== null && d.volatility <= 0, historicalVolatility: value("HISTORICAL_VOLATILITY_20") }, structure: { higherHigh: d.high !== null && d.prevHigh !== null && d.high > d.prevHigh, lowerHigh: d.high !== null && d.prevHigh !== null && d.high < d.prevHigh, higherLow: d.low !== null && d.prevLow !== null && d.low > d.prevLow, lowerLow: d.low !== null && d.prevLow !== null && d.low < d.prevLow, consolidationCandidate: d.range !== null && d.current !== null && Math.abs(d.velocity ?? 0) < 0.001 }, exhaustion: { upwardExhaustionCandidate: d.velocity !== null && d.velocity > 0 && d.acceleration !== null && d.acceleration < 0 && rangePosition !== null && rangePosition > 0.7, downwardExhaustionCandidate: d.velocity !== null && d.velocity < 0 && d.acceleration !== null && d.acceleration > 0 && rangePosition !== null && rangePosition < 0.3, classification: "STRUCTURAL_CANDIDATE" }, dependencies: { coreSafe: CORE_SAFE_DEPENDENCIES, source: { marketData: ["timestamp", "open", "high", "low", "close/price", "volume"], indicators: indicatorIds }, temporal: { lookahead: false, futureData: false } }, dataQuality: { status: validity, reasons: validity === "VALID" ? [] : ["indicator warmup or missing core dependency"], observedThrough: timestamp } };
    return snapshot;
  }

  calculateSeries(points, options = {}) {
    const rows = points ?? [];
    const indicatorIds = ["VWAP_SESSION", "EMA_20", "VWMA_20", "RSI_14", "ATR_14", "MFI_14", "HISTORICAL_VOLATILITY_20"];
    const series = Object.fromEntries(indicatorIds.map(id => [id, this.indicatorEngine.calculateSeries(id, rows).series]));
    return rows.map((_, index) => {
      const indicators = Object.fromEntries(indicatorIds.map(id => [id, series[id]?.[index]?.value ?? null]));
      return this.calculate(rows, { ...options, index, indicators });
    });
  }
}

export const FeatureEngine = TFeatureEngine;
