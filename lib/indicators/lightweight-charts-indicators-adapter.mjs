import * as provider from "lightweight-charts-indicators";

export const PROVIDER_NAME = "lightweight-charts-indicators";

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

function normalizeBars(marketData) {
  if (!Array.isArray(marketData)) throw new TypeError("marketData must be an array");
  return marketData.map((raw, index) => ({
    ...raw,
    time: index,
    open: finite(raw?.open ?? raw?.price ?? raw?.close),
    high: finite(raw?.high ?? raw?.price ?? raw?.close),
    low: finite(raw?.low ?? raw?.price ?? raw?.close),
    close: finite(raw?.close ?? raw?.price),
    volume: finite(raw?.volume) ?? 0,
  }));
}

function valueFromPlot(plot, index) {
  const point = Array.isArray(plot) ? plot[index] : null;
  return point && Number.isFinite(Number(point.value)) ? Number(point.value) : null;
}

function plotsToSeries(result, bars, plotNames) {
  const plots = result?.plots ?? {};
  const candlePlots = result?.plotCandles ?? {};
  return bars.map((bar, index) => {
    const values = {};
    for (const [name, plot] of Object.entries(plots)) values[name] = valueFromPlot(plot, index);
    for (const [name, plot] of Object.entries(candlePlots)) values[name] = Number.isFinite(Number(plot?.[index]?.close)) ? Number(plot[index].close) : null;
    const names = Object.keys(values);
    const value = plotNames.length > 1
      ? Object.fromEntries(plotNames.map((name, plotIndex) => [name, values[name] ?? values["plot" + plotIndex] ?? null]))
      : (values[plotNames[0]] ?? values.plot0 ?? values[names[0]] ?? null);
    return { timestamp: bar.timestamp ?? null, value };
  });
}

export class LightweightChartsIndicatorsAdapter {
  constructor({ module = provider } = {}) { this.module = module; }

  supports(exportName) { return Boolean(this.module?.[exportName]?.calculate); }

  calculate(exportName, marketData, parameters = {}, plotNames = ["plot0"]) {
    const indicator = this.module?.[exportName];
    if (!indicator || typeof indicator.calculate !== "function") return { status: "UNAVAILABLE", series: [] };
    const bars = normalizeBars(marketData);
    const result = indicator.calculate(bars, parameters);
    return { status: "PASS", series: plotsToSeries(result, bars, plotNames), providerMetadata: result?.metadata ?? null };
  }
}

export function normalizeProviderBars(marketData) { return normalizeBars(marketData); }
