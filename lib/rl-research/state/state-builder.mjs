const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
export function buildRLState({ symbol = "", timestamp = "", price, volume, vwap, marketRegime = {}, sentimentState = "unknown", factorSnapshot = {}, positionState = {}, cashState = {} } = {}) {
  return Object.freeze({ symbol: String(symbol), timestamp: String(timestamp), price: finite(price), volume: finite(volume), vwap: finite(vwap), trend: marketRegime.trend ?? marketRegime.marketRegime ?? "SIDEWAYS", volatility: finite(marketRegime.volatility), sentiment: typeof sentimentState === "string" ? sentimentState : structuredClone(sentimentState), factorFeatures: structuredClone(factorSnapshot ?? {}), position: structuredClone(positionState ?? {}), cash: structuredClone(cashState ?? {}) });
}
