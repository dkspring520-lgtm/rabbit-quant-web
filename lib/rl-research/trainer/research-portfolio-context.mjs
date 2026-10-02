import { createHash } from "node:crypto";

export const RESEARCH_PORTFOLIO_CONTEXT_VERSION = "ResearchPortfolioContextV0.1";
export const RESEARCH_NOTIONAL_UNIT_VERSION = "ResearchNotionalUnitV0.1";
export const RESEARCH_ACTION_CONFIG = Object.freeze({ notionalUnit: 10000, buySmallUnits: 0.5, buyUnits: 1, sellPartFraction: 0.25, lotSize: 100, commissionRate: 0.00025, slippageRate: 0.0002, executionPrice: "price(T)", costVersion: "research-portfolio-cost-v0.1" });
export const RESEARCH_ACTION_CONFIG_HASH = createHash("sha256").update(JSON.stringify(RESEARCH_ACTION_CONFIG)).digest("hex");
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const nonNegativeInt = value => Math.max(0, Math.floor(Number(value) || 0));
const round = value => Number(Number(value).toFixed(8));
const dateKey = date => String(date).replaceAll("-", "").slice(0, 8);
const nextTradingDate = date => { const key = dateKey(date); const value = new Date(`${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}T00:00:00Z`); do value.setUTCDate(value.getUTCDate() + 1); while ([0, 6].includes(value.getUTCDay())); return value.toISOString().slice(0, 10).replaceAll("-", ""); };

export class ResearchPortfolioContext {
  constructor({ cash = 0, lots = [], tradeDate = "", symbol = "" } = {}) {
    this.symbol = symbol; this.cash = round(Math.max(0, Number(cash) || 0)); this.tradeDate = dateKey(tradeDate); this.lots = lots.map(lot => ({ acquiredAt: dateKey(lot.acquiredAt), quantity: nonNegativeInt(lot.quantity), remainingQuantity: nonNegativeInt(lot.remainingQuantity ?? lot.quantity), sellableQuantity: nonNegativeInt(lot.sellableQuantity ?? lot.remainingQuantity ?? lot.quantity), sellableAt: dateKey(lot.sellableAt ?? nextTradingDate(lot.acquiredAt)), costBasis: Number(lot.costBasis) || 0 }));
  }
  clone() { return new ResearchPortfolioContext({ cash: this.cash, lots: this.lots, tradeDate: this.tradeDate, symbol: this.symbol }); }
  settle(date) { this.tradeDate = dateKey(date); for (const lot of this.lots) if (lot.sellableAt <= this.tradeDate) lot.sellableQuantity = lot.remainingQuantity; }
  get position() { return this.lots.reduce((sum, lot) => sum + lot.remainingQuantity, 0); }
  get sellablePosition() { return Math.min(this.position, this.lots.reduce((sum, lot) => sum + lot.sellableQuantity, 0)); }
  get todayBought() { return this.lots.filter(lot => lot.acquiredAt === this.tradeDate).reduce((sum, lot) => sum + lot.remainingQuantity, 0); }
  snapshot(price = 0) { const positionValue = this.position * (Number(price) || 0); return { contextVersion: RESEARCH_PORTFOLIO_CONTEXT_VERSION, symbol: this.symbol, tradeDate: this.tradeDate, cash: round(this.cash), position: this.position, sellablePosition: this.sellablePosition, todayBought: this.todayBought, averageCost: this.position ? this.lots.reduce((sum, lot) => sum + lot.remainingQuantity * lot.costBasis, 0) / this.position : null, totalEquity: round(this.cash + positionValue), positionValue: round(positionValue), lots: this.lots.map(lot => ({ ...lot })) }; }
}

const reject = (before, action, reason, requestedQuantity = 0) => ({ applicable: false, applicabilityReason: reason, requestedQuantity, executedQuantity: 0, executionPrice: null, commission: 0, slippage: 0, cashDelta: 0, positionDelta: 0, sellablePositionDelta: 0, beforeContext: before, action, afterContext: before });

export function applyResearchAction(context, action, { price, tradeDate, config = RESEARCH_ACTION_CONFIG } = {}) {
  const beforeContext = context.snapshot(price); const next = context.clone(); next.settle(tradeDate ?? context.tradeDate); const currentPrice = finite(price); const name = String(action ?? "WAIT").toUpperCase();
  if (!(currentPrice > 0)) return reject(beforeContext, name, "INVALID_EXECUTION_PRICE");
  if (name === "WAIT") return { applicable: true, applicabilityReason: "NO_POSITION_OR_CASH_CHANGE", requestedQuantity: 0, executedQuantity: 0, executionPrice: currentPrice, commission: 0, slippage: 0, cashDelta: 0, positionDelta: 0, sellablePositionDelta: 0, beforeContext, action: name, afterContext: next.snapshot(currentPrice), actionConfigHash: RESEARCH_ACTION_CONFIG_HASH };
  let requestedQuantity = 0;
  if (name === "BUY_SMALL" || name === "BUY") { const units = name === "BUY_SMALL" ? config.buySmallUnits : config.buyUnits; requestedQuantity = Math.floor((config.notionalUnit * units / currentPrice) / config.lotSize) * config.lotSize; if (requestedQuantity < config.lotSize) return reject(beforeContext, name, "BELOW_MINIMUM_LOT", requestedQuantity); }
  else if (name === "SELL_PART") requestedQuantity = Math.floor((next.sellablePosition * config.sellPartFraction) / config.lotSize) * config.lotSize;
  else if (name === "SELL_ALL") requestedQuantity = Math.floor(next.sellablePosition / config.lotSize) * config.lotSize;
  else return reject(beforeContext, name, "UNSUPPORTED_ACTION");
  if (name.startsWith("SELL") && next.sellablePosition === 0) return reject(beforeContext, name, "NO_SELLABLE_POSITION", requestedQuantity);
  if (name.startsWith("SELL") && requestedQuantity <= 0) return reject(beforeContext, name, "INSUFFICIENT_SELLABLE_POSITION", requestedQuantity);
  const isBuy = name.startsWith("BUY"); const executionPrice = currentPrice * (1 + (isBuy ? 1 : -1) * config.slippageRate); const turnover = executionPrice * requestedQuantity; const commission = turnover * config.commissionRate; const slippage = Math.abs(executionPrice - currentPrice) * requestedQuantity;
  if (isBuy && next.cash < turnover + commission) return reject(beforeContext, name, "INSUFFICIENT_CASH", requestedQuantity);
  if (!isBuy && requestedQuantity > next.sellablePosition) return reject(beforeContext, name, "INSUFFICIENT_SELLABLE_POSITION", requestedQuantity);
  if (isBuy) { next.cash -= turnover + commission; next.lots.push({ acquiredAt: next.tradeDate, quantity: requestedQuantity, remainingQuantity: requestedQuantity, sellableQuantity: 0, sellableAt: nextTradingDate(next.tradeDate), costBasis: (turnover + commission) / requestedQuantity }); }
  else { let remaining = requestedQuantity; for (const lot of next.lots) { const sellable = Math.min(lot.sellableQuantity, lot.remainingQuantity); const used = Math.min(remaining, sellable); lot.remainingQuantity -= used; lot.sellableQuantity -= used; remaining -= used; if (!remaining) break; } next.cash += turnover - commission; }
  next.lots = next.lots.filter(lot => lot.remainingQuantity > 0);
  const cashDelta = next.cash - context.cash; return { applicable: true, applicabilityReason: "EXECUTABLE_SINGLE_STEP", requestedQuantity, executedQuantity: requestedQuantity, executionPrice: round(executionPrice), commission: round(commission), slippage: round(slippage), cashDelta: round(cashDelta), positionDelta: next.position - context.position, sellablePositionDelta: next.sellablePosition - context.sellablePosition, beforeContext, action: name, afterContext: next.snapshot(currentPrice), actionConfigHash: RESEARCH_ACTION_CONFIG_HASH };
}
