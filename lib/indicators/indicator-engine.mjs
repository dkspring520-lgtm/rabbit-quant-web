import { DEFAULT_INDICATOR_REGISTRY } from "./registry.mjs";
import { LightweightChartsIndicatorsAdapter } from "./lightweight-charts-indicators-adapter.mjs";

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const clone = value => structuredClone(value);

export class IndicatorDataError extends Error {
  constructor(message) { super(message); this.name = "IndicatorDataError"; }
}

function timestampOf(point, index) { return String(point?.timestamp ?? point?.time ?? index); }
function validateMarketData(marketData) {
  if (!Array.isArray(marketData)) throw new IndicatorDataError("marketData must be an array");
  const timestamps = marketData.map(timestampOf);
  const unique = new Set(timestamps).size === timestamps.length;
  const ordered = timestamps.every((value, index) => index === 0 || value > timestamps[index - 1]);
  return { timestamps, unique, ordered };
}
function causalPrefix(marketData, asOfIndex) { return Number.isInteger(asOfIndex) ? marketData.slice(0, asOfIndex + 1) : marketData; }
function nonNullValue(value) { return value !== null && value !== undefined && (typeof value !== "object" || Object.values(value).some(item => item !== null && Number.isFinite(Number(item)))); }

function customSeries(id, marketData, parameters) {
  const length = Number(parameters.length ?? 20);
  const series = [];
  let cumulativeVolume = 0;
  let cumulativeAmount = 0;
  for (let index = 0; index < marketData.length; index += 1) {
    const point = marketData[index];
    const price = finite(point?.price ?? point?.close);
    const volume = Math.max(0, finite(point?.volume) ?? 0);
    const amount = finite(point?.amount);
    cumulativeVolume += volume;
    cumulativeAmount += amount !== null && amount > 0 ? amount : (price ?? 0) * volume;
    const prices = marketData.slice(Math.max(0, index - length + 1), index + 1).map(item => finite(item?.price ?? item?.close)).filter(value => value !== null);
    const volumes = marketData.slice(Math.max(0, index - length + 1), index + 1).map(item => finite(item?.volume)).filter(value => value !== null);
    let value = null;
    if (id === "VWAP_SESSION") value = cumulativeVolume > 0 ? cumulativeAmount / cumulativeVolume : null;
    if (id === "RELATIVE_VOLUME_20") value = prices.length >= length && volumes.length >= length ? volume / (volumes.reduce((sum, item) => sum + item, 0) / volumes.length) : null;
    if (id === "HIGHEST_HIGH_20") { const values = marketData.slice(Math.max(0, index - length + 1), index + 1).map(item => finite(item?.high ?? item?.price)).filter(item => item !== null); value = values.length >= length ? Math.max(...values) : null; }
    if (id === "LOWEST_LOW_20") { const values = marketData.slice(Math.max(0, index - length + 1), index + 1).map(item => finite(item?.low ?? item?.price)).filter(item => item !== null); value = values.length >= length ? Math.min(...values) : null; }
    if (id === "EMA20_DISTANCE") { const ema = prices.length >= length ? prices.reduce((sum, item) => sum + item, 0) / prices.length : null; value = ema && price !== null ? price / ema - 1 : null; }
    if (id === "VWAP_DISTANCE") { const vwap = cumulativeVolume > 0 ? cumulativeAmount / cumulativeVolume : null; value = vwap && price !== null ? price / vwap - 1 : null; }
    if (id === "ATR_NORMALIZED_DISTANCE") { const atrValues = marketData.slice(Math.max(0, index - Number(parameters.atrLength ?? 14) + 1), index + 1).map(item => Math.abs((finite(item?.high ?? item?.price) ?? 0) - (finite(item?.low ?? item?.price) ?? 0))).filter(item => item > 0); const atr = atrValues.length >= Number(parameters.atrLength ?? 14) ? atrValues.reduce((sum, item) => sum + item, 0) / atrValues.length : null; value = atr && price !== null ? (price - (cumulativeVolume > 0 ? cumulativeAmount / cumulativeVolume : price)) / atr : null; }
    if (id === "EMA20_DISTANCE") { let ema = null; const alpha = 2 / (length + 1); for (const item of prices) ema = ema === null ? item : alpha * item + (1 - alpha) * ema; value = prices.length >= length && ema && price !== null ? price / ema - 1 : null; }
    series.push({ timestamp: timestampOf(point, index), value });
  }
  return { status: "PASS", series, providerMetadata: { provider: "custom-causal" } };
}

const providerMap = Object.freeze({
  EMA_5: ["EMA", { length: 5 }, ["plot0"]], EMA_10: ["EMA", { length: 10 }, ["plot0"]], EMA_20: ["EMA", { length: 20 }, ["plot0"]], EMA_60: ["EMA", { length: 60 }, ["plot0"]], VWMA_20: ["VWMA", { length: 20 }, ["plot0"]], ADX_14: ["ADX", { length: 14 }, ["plot0"]], SUPERTREND_10_3: ["Supertrend", { length: 10, factor: 3 }, ["plot0", "plot1", "plot2", "plot3"]], RSI_14: ["RSI", { length: 14 }, ["plot0"]], MACD_12_26_9: ["MACD", { fastLength: 12, slowLength: 26, signalLength: 9 }, ["plot0", "plot1", "plot2"]], KDJ_9: ["KDJ", { length: 9 }, ["plot0", "plot1", "plot2"]], CCI_20: ["CCI", { length: 20 }, ["plot0"]], WILLIAMS_R_14: ["WilliamsPercentRange", { length: 14 }, ["plot0"]], ROC_12: ["ROC", { length: 12 }, ["plot0"]], BOLLINGER_20_2: ["BollingerBands", { length: 20, mult: 2 }, ["plot0", "plot1", "plot2"]], BOLLINGER_WIDTH_20: ["BBBandWidth", { length: 20, mult: 2 }, ["plot0"]], ATR_14: ["ATR", { length: 14 }, ["plot0"]], HISTORICAL_VOLATILITY_20: ["HistoricalVolatility", { length: 20 }, ["plot0"]], OBV: ["OBV", {}, ["plot0"]], MFI_14: ["MFI", { length: 14 }, ["plot0"]], CMF_20: ["ChaikinMF", { length: 20 }, ["plot0"]], VOLUME_DELTA: ["VolumeDelta", {}, ["plot0"]], CVD: ["CumulativeVolumeDelta", {}, ["plot0"]],
});
const providerPlotNames = Object.freeze({
  SUPERTREND_10_3: ["value", "direction", "upper", "lower"],
  MACD_12_26_9: ["macd", "signal", "histogram"],
  KDJ_9: ["k", "d", "j"],
  BOLLINGER_20_2: ["upper", "basis", "lower"],
});

export class IndicatorEngine {
  constructor({ registry = DEFAULT_INDICATOR_REGISTRY, adapter = new LightweightChartsIndicatorsAdapter() } = {}) { this.registry = registry; this.adapter = adapter; }

  calculateSeries(indicatorId, marketData, context = {}) {
    const definition = this.registry.get(indicatorId);
    if (!definition) throw new IndicatorDataError("Unsupported indicator: " + indicatorId);
    const validation = validateMarketData(marketData);
    if (!validation.unique || !validation.ordered) throw new IndicatorDataError("Indicator input timestamps must be unique and ordered");
    const input = causalPrefix(marketData, context.asOfIndex);
    let calculation;
    if (definition.provider === "custom-causal") calculation = customSeries(indicatorId, input, definition.parameters);
    else if (providerMap[indicatorId]) calculation = this.adapter.calculate(providerMap[indicatorId][0], input, { ...providerMap[indicatorId][1], ...(context.parameters ?? {}) }, providerPlotNames[indicatorId] ?? providerMap[indicatorId][2]);
    else calculation = { status: "UNAVAILABLE", series: [], providerMetadata: null };
    if (calculation.status !== "PASS") return { indicatorId, series: [], metadata: this.#metadata(definition, [], calculation.status, calculation.providerMetadata) };
    const series = calculation.series.map((item, index) => ({ indicatorId, timestamp: item.timestamp, value: item.value, metadata: { index, valid: nonNullValue(item.value) } }));
    return { indicatorId, series, metadata: this.#metadata(definition, series, "PASS", calculation.providerMetadata) };
  }

  calculate(indicatorId, marketData, context = {}) {
    const result = this.calculateSeries(indicatorId, marketData, context);
    return result.series.at(-1) ?? { indicatorId, timestamp: null, value: null, metadata: { ...result.metadata, valid: false } };
  }

  snapshot(marketData, { symbol = "", timeframe = "1m", indicatorIds = null, asOfIndex = null, context = {} } = {}) {
    const ids = indicatorIds ?? this.registry.list().map(item => item.id);
    const indicators = {};
    const metadata = {};
    for (const id of ids) { const result = this.calculate(id, marketData, { ...context, asOfIndex }); indicators[id] = result.value; metadata[id] = result.metadata; }
    const timestamp = marketData[Number.isInteger(asOfIndex) ? asOfIndex : marketData.length - 1]?.timestamp ?? null;
    return { timestamp, symbol, timeframe, indicators, metadata, status: "RESEARCH_ONLY", rlEligible: false };
  }

  #metadata(definition, series, status, providerMetadata) {
    const firstValid = series.find(item => item.metadata.valid)?.timestamp ?? null;
    return { definition: clone(definition), status, providerMetadata, warmupBars: definition.warmupBars, firstValidTimestamp: firstValid, lookahead: false, futureData: false, rlEligible: false };
  }
}

export function validateIndicatorInput(marketData) { return validateMarketData(marketData); }
