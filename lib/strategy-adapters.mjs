const ACTION_MAP = Object.freeze({ buy: "BUY", sell: "SELL", positive: "BUY", reverse: "SELL", BUY: "BUY", SELL: "SELL", WAIT: "WAIT", HOLD: "HOLD" });
const text = value => String(value ?? "").trim();
const score = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : null;

export function toStrategySignal(input = {}, defaults = {}) {
  const rawAction = text(input.action ?? input.direction ?? input.signal ?? defaults.action ?? "WAIT");
  return Object.freeze({
    strategyId: text(input.strategyId ?? defaults.strategyId ?? "unknown-strategy"), symbol: text(input.symbol ?? defaults.symbol), timestamp: text(input.timestamp ?? input.time ?? defaults.timestamp), action: ACTION_MAP[rawAction] ?? rawAction.toUpperCase(), score: score(input.score ?? input.signalScore), confidence: Math.max(0, Math.min(1, Number(input.confidence ?? (Number(input.score) / 100) ?? 0))), reason: text(input.reason ?? input.label ?? defaults.reason), marketRegime: input.marketRegime ?? defaults.marketRegime ?? null, sentimentState: input.sentimentState ?? defaults.sentimentState ?? null, factorSnapshot: input.factorSnapshot ?? input.factors ?? defaults.factorSnapshot ?? {},
  });
}

export const adaptSmartTSignal = (output, context = {}) => toStrategySignal(output, { ...context, strategyId: "smart-t-engine" });
export const adaptFactorResearchSignal = (output, context = {}) => toStrategySignal(output, { ...context, strategyId: "factor-research" });
export const adaptZijinOrderFlowSignal = (output, context = {}) => toStrategySignal(output, { ...context, strategyId: "zijin-order-flow" });
export const adaptZijinShadowSignal = (output, context = {}) => toStrategySignal(output, { ...context, strategyId: "zijin-shadow-ab" });
export const adaptMarketRegimeSignal = (output, context = {}) => toStrategySignal(output, { ...context, strategyId: "market-regime" });

export function adaptStrategySignals(outputs = []) { return (Array.isArray(outputs) ? outputs : []).map(output => toStrategySignal(output)); }
