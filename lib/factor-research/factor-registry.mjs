export const FACTOR_REGISTRY_VERSION = "1.1.0";
export const FACTOR_CREATED_AT = "2026-08-12T00:00:00.000Z";

export const FACTOR_SCHEMA_FIELDS = Object.freeze([
  "factorId",
  "name",
  "category",
  "description",
  "formula",
  "inputFields",
  "timeframe",
  "direction",
  "version",
  "createdAt",
  "status",
]);

const def = (factorId, name, category, description, formula, inputFields, timeframe, direction) => ({
  factorId,
  name,
  category,
  description,
  formula,
  inputFields,
  timeframe,
  direction,
  version: FACTOR_REGISTRY_VERSION,
  createdAt: FACTOR_CREATED_AT,
  status: "research",
});

const definitions = [
  def("price.return_1m", "Price Return 1m", "price", "One-minute close-to-close return.", "close[t]/close[t-1]-1", ["price"], "1m", "higherSupportsPositiveT"),
  def("price.return_3m", "Price Return 3m", "momentum", "Three-minute price momentum.", "close[t]/close[t-3]-1", ["price"], "3m", "higherSupportsPositiveT"),
  def("price.return_5m", "Price Return 5m", "momentum", "Five-minute price momentum.", "close[t]/close[t-5]-1", ["price"], "5m", "higherSupportsPositiveT"),
  def("price.return_10m", "Price Return 10m", "momentum", "Ten-minute price momentum.", "close[t]/close[t-10]-1", ["price"], "10m", "higherSupportsPositiveT"),
  def("price.return_15m", "Price Return 15m", "momentum", "Fifteen-minute price momentum.", "close[t]/close[t-15]-1", ["price"], "15m", "higherSupportsPositiveT"),
  def("price.return_30m", "Price Return 30m", "momentum", "Thirty-minute price momentum.", "close[t]/close[t-30]-1", ["price"], "30m", "higherSupportsPositiveT"),
  def("price.gap_previous_close", "Opening Gap", "price", "Current session gap relative to previous close.", "open[0]/previousClose-1", ["open", "previousClose"], "session", "contextOnly"),
  def("price.session_return", "Session Return", "price", "Return from the first tradable minute.", "close[t]/open[0]-1", ["price", "open"], "session", "higherSupportsPositiveT"),
  def("price.intraday_position", "Intraday Range Position", "price", "Price location inside the causal session range.", "(close[t]-low[0:t])/(high[0:t]-low[0:t])", ["price", "high", "low"], "session", "contextOnly"),

  def("vwap.bias", "VWAP Bias", "vwap", "Price deviation from causal session VWAP.", "close[t]/VWAP[t]-1", ["price", "volume", "amount"], "session", "higherSupportsPositiveT"),
  def("vwap.slope_3m", "VWAP Slope 3m", "vwap", "Three-minute VWAP slope.", "VWAP[t]/VWAP[t-3]-1", ["price", "volume", "amount"], "3m", "higherSupportsPositiveT"),
  def("vwap.slope_5m", "VWAP Slope 5m", "vwap", "Five-minute VWAP slope.", "VWAP[t]/VWAP[t-5]-1", ["price", "volume", "amount"], "5m", "higherSupportsPositiveT"),
  def("vwap.slope_15m", "VWAP Slope 15m", "vwap", "Fifteen-minute VWAP slope.", "VWAP[t]/VWAP[t-15]-1", ["price", "volume", "amount"], "15m", "higherSupportsPositiveT"),
  def("vwap.cross", "VWAP Cross", "vwap", "Latest causal crossing direction around VWAP.", "sign(bias[t])-sign(bias[t-1])", ["price", "volume", "amount"], "1m", "higherSupportsPositiveT"),
  def("vwap.persistence_5m", "VWAP Persistence 5m", "vwap", "Share of the last five points above VWAP, centered at zero.", "mean(close>VWAP,5)*2-1", ["price", "volume", "amount"], "5m", "higherSupportsPositiveT"),
  def("vwap.mean_reversion", "VWAP Mean Reversion", "vwap", "Inverted VWAP deviation for pullback recovery research.", "-(close[t]/VWAP[t]-1)", ["price", "volume", "amount"], "session", "higherSupportsPositiveT"),
  def("vwap.same_minute_zscore", "Same-Minute VWAP Z-Score", "vwap", "Current VWAP bias standardized against the same minute of prior sessions only.", "zscore(VWAPBias[date,time], priorDatesSameMinute)", ["price", "volume", "amount", "time"], "60d-same-minute", "contextOnly"),

  def("volume.ratio_5_20", "Volume Ratio 5/20", "volume", "Recent volume relative to the 20-minute baseline.", "SMA(volume,5)/SMA(volume,20)", ["volume"], "20m", "contextOnly"),
  def("volume.momentum_3_15", "Volume Momentum 3/15", "volume", "Short volume acceleration against a longer baseline.", "SMA(volume,3)/SMA(volume,15)-1", ["volume"], "15m", "contextOnly"),
  def("volume.zscore_20", "Volume Z-Score 20", "volume", "Standardized current volume surprise.", "(volume[t]-SMA(volume,20))/STD(volume,20)", ["volume"], "20m", "contextOnly"),
  def("volume.price_alignment_5m", "Price Volume Alignment", "volume", "Alignment between one-minute price changes and volume changes.", "corr(return1m,deltaVolume,5)", ["price", "volume"], "5m", "higherSupportsPositiveT"),
  def("volume.dry_up_5_20", "Volume Dry-Up", "volume", "Low recent volume relative to the prior baseline.", "1-SMA(volume,5)/SMA(volume,20)", ["volume"], "20m", "contextOnly"),
  def("volume.same_minute_zscore", "Same-Minute Volume Z-Score", "volume", "Log volume standardized against the same minute of prior sessions only.", "zscore(log1p(volume[date,time]), priorDatesSameMinute)", ["volume", "time"], "60d-same-minute", "contextOnly"),

  def("volatility.true_range", "True Range", "volatility", "Current true range normalized by previous close.", "TR[t]/close[t-1]", ["high", "low", "price"], "1m", "contextOnly"),
  def("volatility.atr14", "ATR 14", "volatility", "Causal 14-minute average true range percentage.", "SMA(TR,14)/close[t]", ["high", "low", "price"], "14m", "contextOnly"),
  def("volatility.realized_10m", "Realized Volatility 10m", "volatility", "Root sum of squared one-minute returns.", "sqrt(sum(return1m^2,10))", ["price"], "10m", "contextOnly"),
  def("volatility.range_expansion_5m", "Range Expansion 5m", "volatility", "Recent range relative to the preceding range.", "range(last5)/range(previous5)-1", ["high", "low"], "10m", "contextOnly"),
  def("volatility.bollinger_bandwidth_20", "Bollinger Bandwidth", "volatility", "Four standard deviations divided by the 20-minute mean.", "4*STD(close,20)/SMA(close,20)", ["price"], "20m", "contextOnly"),

  def("technical.rsi14", "RSI 14", "technical", "Fourteen-minute relative strength index centered at 50.", "RSI(close,14)/50-1", ["price"], "14m", "higherSupportsPositiveT"),
  def("technical.macd_histogram", "MACD Histogram", "technical", "MACD 12/26/9 histogram normalized by price.", "(DIF-DEA)/close[t]", ["price"], "26m", "higherSupportsPositiveT"),
  def("technical.macd_histogram_delta", "MACD Histogram Delta", "technical", "One-minute change in normalized MACD histogram.", "MACDHist[t]-MACDHist[t-1]", ["price"], "1m", "higherSupportsPositiveT"),
  def("technical.kdj_j9", "KDJ J 9", "technical", "Nine-minute KDJ J value centered at 50.", "J(9)/50-1", ["high", "low", "price"], "9m", "higherSupportsPositiveT"),
  def("technical.bollinger_position_20", "Bollinger Position", "technical", "Price position inside the 20-minute Bollinger band.", "(close-lower)/(upper-lower)*2-1", ["price"], "20m", "higherSupportsPositiveT"),

  def("intraday.reversal_3m", "Three-Minute Reversal", "intraday", "Latest one-minute return against the preceding two-minute move.", "return1m[t]-return(close[t-1],close[t-3])", ["price"], "3m", "higherSupportsPositiveT"),
  def("intraday.upper_shadow", "Upper Shadow Ratio", "intraday", "Upper wick share of the current minute range.", "(high-max(open,close))/(high-low)", ["open", "high", "low", "price"], "1m", "higherSupportsReverseT"),
  def("intraday.lower_shadow", "Lower Shadow Ratio", "intraday", "Lower wick share of the current minute range.", "(min(open,close)-low)/(high-low)", ["open", "high", "low", "price"], "1m", "higherSupportsPositiveT"),
  def("intraday.breakout_20m", "Breakout 20m", "intraday", "Distance beyond the prior 20-minute range.", "close[t]/max(high[t-20:t-1])-1", ["price", "high"], "20m", "higherSupportsPositiveT"),
  def("intraday.pullback_10m_high", "Pullback from 10m High", "intraday", "Distance below the causal ten-minute high.", "close[t]/max(high[t-9:t])-1", ["price", "high"], "10m", "contextOnly"),

  def("market.return_5m", "Market Return 5m", "market", "Five-minute benchmark return when supplied.", "marketPrice[t]/marketPrice[t-5]-1", ["marketPrice"], "5m", "higherSupportsPositiveT"),
  def("market.sector_return_5m", "Sector Return 5m", "market", "Five-minute sector return when supplied.", "sectorPrice[t]/sectorPrice[t-5]-1", ["sectorPrice"], "5m", "higherSupportsPositiveT"),
  def("market.relative_strength_5m", "Relative Strength 5m", "market", "Stock five-minute return minus benchmark return.", "stockReturn5m-marketReturn5m", ["price", "marketPrice"], "5m", "higherSupportsPositiveT"),
  def("market.relative_strength_context", "Market Relative Strength Context", "market", "Causal stock session return relative to available market and sector opening gaps.", "stockSessionReturn-mean(marketOpenGap,sectorOpenGap)", ["price", "open", "marketOpenGap", "sectorOpenGap"], "session", "higherSupportsPositiveT"),
  def("market.sector_resonance", "Sector Resonance", "market", "Alignment of the causal stock session move with the sector opening gap.", "mean(stockSessionReturn,sectorOpenGap)", ["price", "open", "sectorOpenGap"], "session", "higherSupportsPositiveT"),
  def("market.metal_resonance", "Gold-Copper Resonance", "market", "Available causal gold and copper opening moves; missing commodity data stays null.", "mean(goldOpenGap,copperOpenGap)", ["goldOpenGap", "copperOpenGap"], "session", "higherSupportsPositiveT"),
  def("market.regime", "Market Regime", "market", "Causal trend and volatility regime encoded from benchmark data.", "sign(marketReturn15m)/(1+marketVolatility15m)", ["marketPrice"], "15m", "contextOnly"),

  def("orderflow.active_buy_imbalance", "Active Buy Imbalance", "orderflow", "Active buy minus sell activity ratio when L2 exists.", "(activeBuy-activeSell)/(activeBuy+activeSell)", ["activeBuyVolume", "activeSellVolume"], "1m", "higherSupportsPositiveT"),
  def("orderflow.ofi_change_3m", "OFI Change 3m", "orderflow", "Three-minute change in active order-flow imbalance.", "OFI[t]-OFI[t-3]", ["activeBuyVolume", "activeSellVolume"], "3m", "higherSupportsPositiveT"),
  def("orderflow.ofi_persistence_5m", "OFI Persistence 5m", "orderflow", "Strength and directional consistency of three to five consecutive order-flow observations.", "mean(OFI,3:5)*sameSignRatio(OFI,3:5)", ["activeBuyVolume", "activeSellVolume"], "5m", "higherSupportsPositiveT"),
  def("orderflow.large_order_net_ratio", "Large Order Net Ratio", "orderflow", "Large-order net notional relative to active notional.", "bigOrderNet/(activeBuyNotional+activeSellNotional)", ["bigOrderNet", "activeBuyNotional", "activeSellNotional"], "1m", "higherSupportsPositiveT"),
  def("orderflow.book_depth_imbalance", "Book Depth Imbalance", "orderflow", "Near-touch bid and ask depth imbalance.", "(bid1Volume-ask1Volume)/(bid1Volume+ask1Volume)", ["bid1Volume", "ask1Volume"], "1m", "higherSupportsPositiveT"),
  def("orderflow.microprice_edge", "Microprice Edge", "orderflow", "Microprice displacement from the best-bid/ask midpoint.", "(microprice-midpoint)/midpoint", ["bid1Price", "ask1Price", "bid1Volume", "ask1Volume"], "1m", "higherSupportsPositiveT"),

  def("time.minutes_from_open", "Minutes from Open", "time", "Causal trading minutes elapsed since 09:30 excluding lunch.", "tradingMinuteOrdinal(time)", ["time"], "session", "contextOnly"),
  def("time.opening_window", "Opening Window", "time", "Indicator for the first 30 trading minutes.", "1[minutesFromOpen<30]", ["time"], "30m", "contextOnly"),
  def("time.afternoon_window", "Afternoon Window", "time", "Indicator for 13:00 through 14:29.", "1[13:00<=time<14:30]", ["time"], "session", "contextOnly"),
  def("time.closing_window", "Closing Window", "time", "Indicator for the final 30 trading minutes.", "1[time>=14:30]", ["time"], "30m", "contextOnly"),
];

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function validateFactorDefinition(value) {
  if (!value || typeof value !== "object") throw new TypeError("Factor definition must be an object");
  for (const field of FACTOR_SCHEMA_FIELDS) {
    if (!(field in value)) throw new TypeError(`Factor definition is missing ${field}`);
  }
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(value.factorId)) throw new TypeError(`Invalid factorId: ${value.factorId}`);
  if (!Array.isArray(value.inputFields) || !value.inputFields.length) throw new TypeError(`${value.factorId} requires inputFields`);
  return true;
}

export class FactorRegistry {
  #factors = new Map();

  constructor(items = []) {
    for (const item of items) this.register(item);
  }

  register(definition) {
    validateFactorDefinition(definition);
    const key = `${definition.factorId}@${definition.version}`;
    if (this.#factors.has(key)) throw new Error(`Immutable factor version already registered: ${key}`);
    const frozen = deepFreeze(structuredClone(definition));
    this.#factors.set(key, frozen);
    return frozen;
  }

  get(factorId, version = FACTOR_REGISTRY_VERSION) {
    return this.#factors.get(`${factorId}@${version}`) ?? null;
  }

  list({ category = null, status = null } = {}) {
    return [...this.#factors.values()].filter(item =>
      (!category || item.category === category) && (!status || item.status === status));
  }

  snapshot() {
    return deepFreeze({
      registryVersion: FACTOR_REGISTRY_VERSION,
      factors: this.list().map(item => structuredClone(item)),
    });
  }
}

export const BASE_T_FACTOR_DEFINITIONS = deepFreeze(definitions);
export const DEFAULT_FACTOR_REGISTRY = new FactorRegistry(BASE_T_FACTOR_DEFINITIONS);
