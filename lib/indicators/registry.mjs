export const INDICATOR_ENGINE_VERSION = "1.0.0";
export const INDICATOR_STATUS = Object.freeze(["PROPOSAL_ONLY", "UNAVAILABLE", "CUSTOM_CANDIDATE"]);
export const INDICATOR_CATEGORIES = Object.freeze(["trend", "momentum", "volatility", "volume", "priceStructure"]);

const provider = "lightweight-charts-indicators";
const base = (id, name, category, parameters, warmupBars, extras = {}) => Object.freeze({
  id,
  name,
  category,
  provider: extras.provider ?? provider,
  timeframe: extras.timeframe ?? "1m",
  parameters: Object.freeze({ ...parameters }),
  warmupBars,
  lookahead: false,
  futureData: false,
  uiEligible: extras.uiEligible ?? true,
  researchEligible: extras.researchEligible ?? true,
  rlEligible: false,
  status: extras.status ?? "PROPOSAL_ONLY",
  overlay: extras.overlay ?? false,
  plots: extras.plots ?? ["value"],
});

export const INDICATOR_DEFINITIONS = Object.freeze([
  base("EMA_5", "EMA 5", "trend", { length: 5 }, 5, { overlay: true }),
  base("EMA_10", "EMA 10", "trend", { length: 10 }, 10, { overlay: true }),
  base("EMA_20", "EMA 20", "trend", { length: 20 }, 20, { overlay: true }),
  base("EMA_60", "EMA 60", "trend", { length: 60 }, 60, { overlay: true }),
  base("VWMA_20", "VWMA 20", "trend", { length: 20 }, 20, { overlay: true }),
  base("ADX_14", "ADX 14", "trend", { length: 14 }, 14),
  base("SUPERTREND_10_3", "Supertrend 10/3", "trend", { length: 10, factor: 3 }, 10, { overlay: true, plots: ["value", "direction", "upper", "lower"] }),
  base("RSI_14", "RSI 14", "momentum", { length: 14 }, 14),
  base("MACD_12_26_9", "MACD 12/26/9", "momentum", { fastLength: 12, slowLength: 26, signalLength: 9 }, 26, { plots: ["macd", "signal", "histogram"] }),
  base("KDJ_9", "KDJ 9", "momentum", { length: 9 }, 9, { plots: ["k", "d", "j"] }),
  base("CCI_20", "CCI 20", "momentum", { length: 20 }, 20),
  base("WILLIAMS_R_14", "Williams %R 14", "momentum", { length: 14 }, 14),
  base("ROC_12", "ROC 12", "momentum", { length: 12 }, 12),
  base("BOLLINGER_20_2", "Bollinger Bands 20/2", "volatility", { length: 20, mult: 2 }, 20, { overlay: true, plots: ["upper", "basis", "lower"] }),
  base("BOLLINGER_WIDTH_20", "Bollinger Width 20", "volatility", { length: 20, mult: 2 }, 20),
  base("ATR_14", "ATR 14", "volatility", { length: 14 }, 14),
  base("HISTORICAL_VOLATILITY_20", "Historical Volatility 20", "volatility", { length: 20 }, 20),
  base("VWAP_SESSION", "Session VWAP", "volume", {}, 1, { provider: "custom-causal", overlay: true, status: "CUSTOM_CANDIDATE" }),
  base("OBV", "On Balance Volume", "volume", {}, 1),
  base("MFI_14", "MFI 14", "volume", { length: 14 }, 14),
  base("CMF_20", "Chaikin Money Flow 20", "volume", { length: 20 }, 20),
  base("VOLUME_DELTA", "Volume Delta", "volume", {}, 1, { plots: ["delta", "up", "down"] }),
  base("CVD", "Cumulative Volume Delta", "volume", {}, 1),
  base("RELATIVE_VOLUME_20", "Relative Volume 20", "volume", { length: 20 }, 20, { provider: "custom-causal", status: "CUSTOM_CANDIDATE" }),
  base("HIGHEST_HIGH_20", "Highest High 20", "priceStructure", { length: 20 }, 20, { provider: "custom-causal", overlay: true, status: "CUSTOM_CANDIDATE" }),
  base("LOWEST_LOW_20", "Lowest Low 20", "priceStructure", { length: 20 }, 20, { provider: "custom-causal", overlay: true, status: "CUSTOM_CANDIDATE" }),
  base("EMA20_DISTANCE", "EMA20 Distance", "priceStructure", { length: 20 }, 20, { provider: "custom-causal", status: "CUSTOM_CANDIDATE" }),
  base("VWAP_DISTANCE", "VWAP Distance", "priceStructure", {}, 1, { provider: "custom-causal", status: "CUSTOM_CANDIDATE" }),
  base("ATR_NORMALIZED_DISTANCE", "ATR-normalized Distance", "priceStructure", { atrLength: 14 }, 14, { provider: "custom-causal", status: "CUSTOM_CANDIDATE" }),
]);

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

export function validateIndicatorDefinition(definition) {
  if (!definition || typeof definition !== "object") throw new TypeError("Indicator definition must be an object");
  for (const key of ["id", "name", "category", "provider", "parameters", "timeframe", "warmupBars", "lookahead", "futureData", "uiEligible", "researchEligible", "rlEligible", "status"]) {
    if (!(key in definition)) throw new TypeError("Indicator definition missing " + key);
  }
  if (!/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/.test(definition.id)) throw new TypeError("Invalid indicator id: " + definition.id);
  if (!INDICATOR_CATEGORIES.includes(definition.category)) throw new TypeError("Invalid indicator category: " + definition.category);
  if (!Number.isInteger(definition.warmupBars) || definition.warmupBars < 0) throw new TypeError("Invalid warmupBars for " + definition.id);
  if (definition.lookahead || definition.futureData || definition.rlEligible) throw new TypeError("Unsafe indicator definition: " + definition.id);
  if (!INDICATOR_STATUS.includes(definition.status)) throw new TypeError("Invalid indicator status: " + definition.status);
  return true;
}

export class IndicatorRegistry {
  #items = new Map();

  constructor(items = []) { for (const item of items) this.register(item); }

  register(definition) {
    validateIndicatorDefinition(definition);
    if (this.#items.has(definition.id)) throw new Error("Duplicate indicator id: " + definition.id);
    const frozen = freeze(structuredClone(definition));
    this.#items.set(frozen.id, frozen);
    return frozen;
  }

  get(id) { return this.#items.get(String(id)) ?? null; }
  list({ category = null, status = null } = {}) { return [...this.#items.values()].filter(item => (!category || item.category === category) && (!status || item.status === status)); }
  snapshot() { return freeze({ version: INDICATOR_ENGINE_VERSION, indicators: this.list().map(item => structuredClone(item)) }); }
}

export const DEFAULT_INDICATOR_REGISTRY = new IndicatorRegistry(INDICATOR_DEFINITIONS);
