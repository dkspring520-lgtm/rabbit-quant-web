import { createPaperOrder, createPaperPosition, normalizePaperCostConfig } from "./schema.mjs";

const finite = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const nonNegative = value => Math.max(0, finite(value, 0));
const round = value => Number(Number(value).toFixed(6));

export function calculatePaperCosts({ side, orderPrice, fillPrice, quantity, config }) {
  const costs = normalizePaperCostConfig(config);
  const turnover = nonNegative(fillPrice) * Math.max(0, Math.floor(nonNegative(quantity)));
  const commission = Math.max(costs.minimumCommission, turnover * costs.commission / 100);
  const stampDuty = String(side).toUpperCase() === "SELL" ? turnover * costs.stampDuty / 100 : 0;
  const slippage = Math.abs(nonNegative(fillPrice) - nonNegative(orderPrice)) * Math.max(0, Math.floor(nonNegative(quantity)));
  return Object.freeze({ commission: round(commission), stampDuty: round(stampDuty), slippage: round(slippage), fees: round(commission + stampDuty) });
}

export class PaperExecutionEngine {
  constructor({ accountId = "paper-default", symbol = "", initialCash = 0, initialPosition = 0, initialSellablePosition = initialPosition, averageCost = null, config = {} } = {}) {
    this.accountId = accountId;
    this.symbol = symbol;
    this.config = normalizePaperCostConfig(config);
    this.cash = nonNegative(initialCash);
    this.position = createPaperPosition({ symbol, totalPosition: initialPosition, availableSellablePosition: initialSellablePosition, averageCost });
    this.tradeDate = null;
    this.boughtToday = 0;
    this.orders = new Map();
    this.sequence = 0;
  }

  advanceTo(date) {
    const next = String(date ?? "");
    if (this.tradeDate && next && next !== this.tradeDate) {
      this.position = createPaperPosition({ ...this.position, availableSellablePosition: this.position.totalPosition });
      this.boughtToday = 0;
    }
    if (next) this.tradeDate = next;
  }

  submit(input = {}) {
    const orderId = String(input.orderId ?? `paper-${++this.sequence}`);
    if (this.orders.has(orderId)) throw new Error(`Duplicate paper order: ${orderId}`);
    const order = createPaperOrder({ ...input, orderId, symbol: input.symbol ?? this.symbol, status: "SUBMITTED" });
    this.orders.set(orderId, order);
    return order;
  }

  cancel(orderId, reason = "cancelled") {
    const existing = this.orders.get(String(orderId));
    if (!existing || !["CREATED", "SUBMITTED"].includes(existing.status)) return existing ?? null;
    const order = createPaperOrder({ ...existing, status: "CANCELLED", reason });
    this.orders.set(order.orderId, order);
    return order;
  }

  execute(market = {}, input = {}) {
    const order = this.submit({ ...input, symbol: input.symbol ?? market.symbol ?? this.symbol, timestamp: input.timestamp ?? market.timestamp ?? market.date });
    return this.fill(order.orderId, market);
  }

  fill(orderId, market = {}) {
    const order = this.orders.get(String(orderId));
    if (!order) throw new Error(`Unknown paper order: ${orderId}`);
    if (order.status !== "SUBMITTED") return order;
    this.advanceTo(market.date ?? market.tradingDate);
    const side = order.side;
    const price = finite(market.marketPrice ?? market.price);
    const quantity = Math.floor(nonNegative(order.quantity));
    const reject = reason => {
      const rejected = createPaperOrder({ ...order, status: "REJECTED", reason });
      this.orders.set(order.orderId, rejected);
      return rejected;
    };
    if (side === "WAIT") return this.cancel(order.orderId, "WAIT does not create a fill");
    if (!(price > 0)) return reject("missing market price");
    if (market.suspended === true) return reject("suspended stock");
    const time = String(market.time ?? "").replace(/:/g, "").slice(0, 4);
    if (!/^\d{4}$/.test(time) || time < "0930" || time > "1457" || (time > "1130" && time < "1300")) return reject("outside continuous auction");
    if (quantity < 100 || quantity % 100 !== 0) return reject("quantity must be 100-share lot");
    if (market.limitUp === true && side === "BUY") return reject("buy blocked at limit up");
    if (market.limitDown === true && side === "SELL") return reject("sell blocked at limit down");
    if (side === "SELL" && this.boughtToday > 0 && quantity <= this.boughtToday) return reject("same-day bought shares are not sellable (T+1)");
    if (side === "SELL" && quantity > this.position.availableSellablePosition) return reject("insufficient sellable position (T+1)");
    const slip = this.config.slippage;
    const fillPrice = round(price * (1 + (side === "BUY" ? 1 : -1) * slip / 100));
    const costs = calculatePaperCosts({ side, orderPrice: order.orderPrice ?? price, fillPrice, quantity, config: this.config });
    const cashDelta = side === "BUY" ? -(fillPrice * quantity + costs.fees) : fillPrice * quantity - costs.fees;
    if (side === "BUY" && this.cash + cashDelta < -1e-8) return reject("insufficient cash");
    const before = this.position;
    const total = side === "BUY" ? before.totalPosition + quantity : before.totalPosition - quantity;
    const sellable = side === "BUY" ? before.availableSellablePosition : before.availableSellablePosition - quantity;
    const averageCost = side === "BUY" ? round(((before.averageCost ?? fillPrice) * before.totalPosition + fillPrice * quantity + costs.fees) / Math.max(1, total)) : (total ? before.averageCost : null);
    this.cash = round(this.cash + cashDelta);
    this.position = createPaperPosition({ symbol: this.symbol, totalPosition: total, availableSellablePosition: sellable, averageCost });
    if (side === "BUY") this.boughtToday += quantity;
    const filled = createPaperOrder({ ...order, status: "FILLED", fillPrice, fees: costs.fees, slippage: costs.slippage, quantity, orderPrice: order.orderPrice ?? price });
    this.orders.set(order.orderId, filled);
    return filled;
  }

  snapshot() { return Object.freeze({ accountId: this.accountId, symbol: this.symbol, cash: this.cash, position: this.position, tradeDate: this.tradeDate, orders: [...this.orders.values()] }); }
}
