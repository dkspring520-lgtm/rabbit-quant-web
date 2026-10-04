import { createHash } from "node:crypto";

export const V1_ACTIONS = Object.freeze(["WAIT", "BUY_SMALL", "BUY", "SELL_PART", "SELL_ALL"]);
export const V2_ACTIONS = V1_ACTIONS;
export const V2_STRATEGY_ID = "OHLCV_T_RESEARCH_V2";
export const V2_STRATEGY_VERSION = "OHLCV_T_RESEARCH_V2_RESEARCH_ONLY_V0.1";
export const LOT_SIZE = 100;
export const BUY_NOTIONAL = 10000;
export const COMMISSION_RATE = 0.00025;
export const SLIPPAGE_RATE = 0.0002;

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function regimeOf(features = {}, trend = "SIDEWAYS") {
  const volatility = finite(features.rollingVolatility) ?? 0;
  const distance = finite(features.distanceToVWAP) ?? 0;
  const return5 = finite(features.return5m) ?? 0;
  return { trend, volatility: volatility >= .003 ? "HIGH_VOLATILITY" : "LOW_VOLATILITY", range: Math.abs(distance) >= .01 ? "BREAKOUT_OR_DISLOCATION" : "RANGE_OR_VWAP_NEAR", momentum: return5 > .005 ? "UP" : return5 < -.005 ? "DOWN" : "FLAT" };
}

export function requiredBuyQuantity(action, price) {
  const notional = action === "BUY" ? BUY_NOTIONAL : BUY_NOTIONAL * .5;
  return Math.floor((notional / Math.max(price, .000001)) / LOT_SIZE) * LOT_SIZE;
}

export function decideExpertV2({ signal = {}, account = {}, price = 0, todayBought = 0 } = {}) {
  const features = signal.features ?? {};
  const regime = regimeOf(features, signal.marketRegime ?? "SIDEWAYS");
  const score = finite(signal.score) ?? 50;
  const sentiment = signal.sentimentState ?? "NEUTRAL";
  const cash = finite(account.cash) ?? 0;
  const sellable = finite(account.sellablePosition) ?? 0;
  const hasBuySignal = signal.action === "BUY_SMALL" || signal.action === "BUY" || (regime.trend === "UP" && score >= 60 && sentiment !== "PANIC");
  const strongBuy = signal.action === "BUY" || (hasBuySignal && score >= 75 && regime.volatility !== "HIGH_VOLATILITY");
  const reverseSignal = signal.action === "SELL_PART" || signal.action === "SELL_ALL" || (sentiment === "OVERHEATED" && score >= 60);
  const strongSell = signal.action === "SELL_ALL" || (reverseSignal && score >= 80);
  let action = "WAIT";
  let reason = "no_v2_condition";
  if (strongSell && sellable > 0) { action = "SELL_ALL"; reason = "reverse_signal_and_sellable_inventory"; }
  else if (reverseSignal && sellable > 0) { action = "SELL_PART"; reason = "reverse_signal_and_sellable_inventory"; }
  else if (strongBuy && cash >= requiredBuyQuantity("BUY", price) * price * (1 + COMMISSION_RATE + SLIPPAGE_RATE)) { action = "BUY"; reason = "strong_positive_signal_and_cash"; }
  else if (hasBuySignal && cash >= requiredBuyQuantity("BUY_SMALL", price) * price * (1 + COMMISSION_RATE + SLIPPAGE_RATE)) { action = "BUY_SMALL"; reason = "positive_signal_and_cash"; }
  else if (hasBuySignal) reason = "buy_signal_but_cash_infeasible";
  else if (reverseSignal) reason = "sell_signal_but_sellable_infeasible";
  return { strategyId: V2_STRATEGY_ID, strategyVersion: V2_STRATEGY_VERSION, action, reason, score, regime, signalAction: signal.action ?? "WAIT", executionFeasible: action === "WAIT" || (action === "BUY" || action === "BUY_SMALL" ? cash >= requiredBuyQuantity(action, price) * price * (1 + COMMISSION_RATE + SLIPPAGE_RATE) : sellable > 0), tPlusOneValid: action === "WAIT" || action === "BUY" || action === "BUY_SMALL" ? true : sellable >= LOT_SIZE && todayBought <= Math.max(0, account.position ?? 0) - sellable };
}

export function hashSequence(actions) { return hash(actions); }
export function classifySupport(count, feasibleCount) { if (!count) return "UNSUPPORTED"; if (!feasibleCount) return "INFEASIBLE_CONTEXT"; return count < 1000 ? "RARE_SUPPORTED" : "SUPPORTED"; }
