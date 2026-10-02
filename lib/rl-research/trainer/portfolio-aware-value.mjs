import { createHash } from "node:crypto";
import { applyResearchAction, RESEARCH_ACTION_CONFIG, ResearchPortfolioContext, RESEARCH_ACTION_CONFIG_HASH } from "./research-portfolio-context.mjs";

export const PORTFOLIO_SCENARIO_GRID_VERSION = "portfolio-scenario-grid-v0.1";
export const PORTFOLIO_AWARE_VALUE_VERSION = "portfolio-aware-value-v0.1";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const lotQuantity = (notional, price, lotSize = RESEARCH_ACTION_CONFIG.lotSize) => Math.floor((notional / price) / lotSize) * lotSize;

export function buildPortfolioScenario(scenarioId, price, tradeDate, config = RESEARCH_ACTION_CONFIG) {
  const half = lotQuantity(config.notionalUnit * 0.5, price), full = lotQuantity(config.notionalUnit, price);
  const date = String(tradeDate).replaceAll("-", "").slice(0, 8);
  const next = "20991231";
  const base = { symbol: "601899.SH", tradeDate: date, cash: config.notionalUnit, lots: [] };
  if (scenarioId === "A") return new ResearchPortfolioContext(base);
  if (scenarioId === "B") return new ResearchPortfolioContext({ ...base, cash: config.notionalUnit - half * price, lots: [{ acquiredAt: date, quantity: half, remainingQuantity: half, sellableQuantity: 0, sellableAt: next, costBasis: price }] });
  if (scenarioId === "C") return new ResearchPortfolioContext({ ...base, cash: config.notionalUnit - half * price, lots: [{ acquiredAt: "20000101", quantity: half, remainingQuantity: half, sellableQuantity: half, sellableAt: "20000102", costBasis: price }] });
  if (scenarioId === "D") return new ResearchPortfolioContext({ ...base, cash: config.notionalUnit - full * price, lots: [{ acquiredAt: "20000101", quantity: full, remainingQuantity: full, sellableQuantity: full, sellableAt: "20000102", costBasis: price }] });
  if (scenarioId === "E") return new ResearchPortfolioContext({ ...base, cash: config.notionalUnit - full * price, lots: [{ acquiredAt: "20000101", quantity: Math.max(0, full - half), remainingQuantity: Math.max(0, full - half), sellableQuantity: 0, sellableAt: next, costBasis: price }, { acquiredAt: "20000101", quantity: half, remainingQuantity: half, sellableQuantity: half, sellableAt: "20000102", costBasis: price }] });
  if (scenarioId === "F") return new ResearchPortfolioContext({ ...base, cash: Math.min(100, config.notionalUnit), lots: [] });
  throw new Error(`Unknown portfolio scenario: ${scenarioId}`);
}

export const PORTFOLIO_SCENARIOS = Object.freeze(["A", "B", "C", "D", "E", "F"]);

export function evaluatePortfolioAction(context, action, { price, futurePrice, tradeDate, config = RESEARCH_ACTION_CONFIG } = {}) {
  const before = context.snapshot(price);
  const currentEquity = before.totalEquity;
  const netTransition = applyResearchAction(context, action, { price, tradeDate, config });
  if (!netTransition.applicable) return { action, applicable: false, reason: netTransition.applicabilityReason, transition: netTransition, grossActionValue: null, netActionValue: null, futureEquityDelta: null };
  const grossTransition = applyResearchAction(context, action, { price, tradeDate, config: { ...config, commissionRate: 0, slippageRate: 0 } });
  const grossFutureEquity = grossTransition.afterContext.cash + grossTransition.afterContext.position * futurePrice;
  const netFutureEquity = netTransition.afterContext.cash + netTransition.afterContext.position * futurePrice;
  return { action, applicable: true, reason: "EXECUTABLE_SINGLE_STEP", transition: netTransition, grossActionValue: grossFutureEquity - currentEquity, netActionValue: netFutureEquity - currentEquity, futureEquityDelta: netFutureEquity - currentEquity, grossFutureEquity, netFutureEquity };
}

export function rankPortfolioActions(context, { price, futurePrice, tradeDate, config = RESEARCH_ACTION_CONFIG } = {}) {
  const values = Object.fromEntries(["WAIT", "BUY_SMALL", "BUY", "SELL_PART", "SELL_ALL"].map(action => [action, evaluatePortfolioAction(context, action, { price, futurePrice, tradeDate, config })]));
  const applicable = Object.values(values).filter(value => value.applicable).sort((a, b) => b.netActionValue - a.netActionValue);
  const best = applicable[0] ?? null, second = applicable[1] ?? null;
  return { values, bestApplicableAction: best?.action ?? null, bestActionValue: best?.netActionValue ?? null, secondBestAction: second?.action ?? null, secondBestActionValue: second?.netActionValue ?? null, actionMargin: best && second ? best.netActionValue - second.netActionValue : null, applicabilityStatus: applicable.length <= 1 ? "SINGLE_APPLICABLE_ACTION" : "MULTIPLE_APPLICABLE_ACTIONS" };
}

export function portfolioScenarioHash(value) { return hash(value); }
export { RESEARCH_ACTION_CONFIG_HASH };
