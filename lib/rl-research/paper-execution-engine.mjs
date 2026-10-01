import { createExecutionRecord } from "./schema.mjs";

export const DEFAULT_PAPER_EXECUTION_CONFIG = Object.freeze({
  feeRate: 0.025,
  minimumCommission: 5,
  stampDutyRate: 0.0005,
  slippagePct: 0.02,
  lotSize: 100,
});

const finite = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const nonNegative = value => Math.max(0, finite(value, 0));
const roundPrice = value => Number(value.toFixed(6));

function withRecord(input, values) {
  return createExecutionRecord({ ...input, ...values });
}

/**
 * Execute one deterministic paper action against a causal observation.
 * Buys become same-day inventory and never increase sellable shares.
 */
export function executePaperAction(observation, action, options = {}) {
  const config = { ...DEFAULT_PAPER_EXECUTION_CONFIG, ...options };
  const price = finite(observation?.price);
  const quantity = Math.floor(nonNegative(action?.quantity));
  const positionBefore = Math.floor(nonNegative(observation?.position));
  const sellableBefore = Math.min(positionBefore, Math.floor(nonNegative(observation?.availableSellablePosition)));
  const cashBefore = nonNegative(observation?.cash);
  const identity = {
    ...observation,
    ...action,
    date: action?.date || observation?.date,
    time: action?.time || observation?.time,
    asOf: action?.asOf || observation?.asOf,
    modelVersion: action?.modelVersion || observation?.modelVersion,
    source: action?.source || observation?.source,
  };
  const reject = rejectionReason => withRecord(identity, {
    status: "rejected",
    orderPrice: price,
    fillPrice: null,
    positionBefore,
    positionAfter: positionBefore,
    sellableBefore,
    sellableAfter: sellableBefore,
    cashBefore,
    cashAfter: cashBefore,
    rejectionReason,
    signalId: action?.signalId,
    signalScore: action?.score,
    factorSnapshot: observation?.factors,
  });

  if (!action || !["WAIT", "BUY", "SELL"].includes(String(action.action).toUpperCase())) return reject("不支持的模拟动作");
  const side = String(action.action).toUpperCase();
  if (side === "WAIT") return withRecord(identity, {
    status: "skipped",
    orderPrice: price,
    positionBefore,
    positionAfter: positionBefore,
    sellableBefore,
    sellableAfter: sellableBefore,
    cashBefore,
    cashAfter: cashBefore,
    signalId: action?.signalId,
    signalScore: action?.score,
    factorSnapshot: observation?.factors,
  });
  if (!(price > 0)) return reject("缺少有效的当前行情价格");
  if (observation?.dataQuality?.stale === true) return reject("行情已过期，禁止模拟成交");
  if (observation?.dataQuality?.suspended === true) return reject("标的停牌，禁止模拟成交");
  if (observation?.dataQuality?.limitUp === true && side === "BUY") return reject("涨停状态下不模拟买入成交");
  if (observation?.dataQuality?.limitDown === true && side === "SELL") return reject("跌停状态下不模拟卖出成交");

  const time = String(action?.time || observation?.time || "").replace(/:/g, "").slice(0, 4);
  if (!/^\d{4}$/.test(time) || time < "0930" || time > "1457" || (time > "1130" && time < "1300")) {
    return reject("当前不在连续竞价模拟成交时段");
  }
  if (quantity < config.lotSize || quantity % config.lotSize !== 0) return reject(`数量必须是${config.lotSize}股的整数倍`);
  if (side === "SELL" && quantity > sellableBefore) return reject("可卖持仓不足，违反 A 股 T+1 限制");

  const slippagePct = Math.max(0, finite(config.slippagePct, 0));
  const fillPrice = roundPrice(price * (1 + (side === "BUY" ? 1 : -1) * slippagePct / 100));
  const turnover = fillPrice * quantity;
  const commission = Math.max(nonNegative(config.minimumCommission), turnover * nonNegative(config.feeRate) / 100);
  const stampDuty = side === "SELL" ? turnover * nonNegative(config.stampDutyRate) : 0;
  const fee = commission + stampDuty;
  const cashAfter = side === "BUY" ? cashBefore - turnover - fee : cashBefore + turnover - fee;
  if (side === "BUY" && cashAfter < -1e-8) return reject("模拟资金不足（含费用和滑点）");

  return withRecord(identity, {
    status: "filled",
    orderPrice: price,
    fillPrice,
    slippage: Math.abs(fillPrice - price) * quantity,
    fee,
    quantity,
    positionBefore,
    positionAfter: side === "BUY" ? positionBefore + quantity : positionBefore - quantity,
    sellableBefore,
    // Shares bought today are intentionally not sellable today.
    sellableAfter: side === "BUY" ? sellableBefore : sellableBefore - quantity,
    cashBefore,
    cashAfter,
    rejectionReason: "",
    signalId: action?.signalId,
    signalScore: action?.score,
    factorSnapshot: observation?.factors,
  });
}

export class PaperExecutionEngine {
  constructor({ config = {}, initialCash = 0, initialPosition = 0, initialSellablePosition = initialPosition, averageCost = null } = {}) {
    this.config = { ...DEFAULT_PAPER_EXECUTION_CONFIG, ...config };
    this.cash = nonNegative(initialCash);
    this.position = Math.floor(nonNegative(initialPosition));
    this.sellablePosition = Math.min(this.position, Math.floor(nonNegative(initialSellablePosition)));
    this.averageCost = finite(averageCost);
    this.orders = new Map();
    this.sequence = 0;
  }

  submit(action = {}) {
    const orderId = String(action.orderId ?? `paper-${++this.sequence}`);
    if (this.orders.has(orderId)) throw new Error(`Duplicate paper order: ${orderId}`);
    const order = Object.freeze({ orderId, status: "open", action: structuredClone(action), createdAt: action.createdAt ?? null });
    this.orders.set(orderId, order);
    return order;
  }

  cancel(orderId, reason = "用户取消模拟订单") {
    const order = this.orders.get(String(orderId));
    if (!order || order.status !== "open") return null;
    const cancelled = Object.freeze({ ...order, status: "cancelled", cancelReason: String(reason) });
    this.orders.set(order.orderId, cancelled);
    return cancelled;
  }

  fill(orderId, observation) {
    const order = this.orders.get(String(orderId));
    if (!order) throw new Error(`Unknown paper order: ${orderId}`);
    if (order.status !== "open") return order;
    const action = order.action;
    const stateObservation = {
      ...observation,
      cash: this.cash,
      position: this.position,
      availableSellablePosition: this.sellablePosition,
      avgCost: this.averageCost,
    };
    const record = executePaperAction(stateObservation, action, this.config);
    if (record.status === "filled") {
      this.cash = record.cashAfter;
      this.position = record.positionAfter;
      this.sellablePosition = record.sellableAfter;
      this.averageCost = action.action === "BUY"
        ? ((this.averageCost ?? record.fillPrice) * record.positionBefore + record.fillPrice * record.quantity + record.fee) / Math.max(1, record.positionAfter)
        : (record.positionAfter > 0 ? this.averageCost : null);
    }
    const filled = Object.freeze({ ...order, status: record.status === "filled" ? "filled" : "rejected", record });
    this.orders.set(order.orderId, filled);
    return filled;
  }

  execute(observation, action) {
    const order = this.submit(action);
    return this.fill(order.orderId, observation);
  }

  snapshot() {
    return Object.freeze({ cash: this.cash, position: this.position, sellablePosition: this.sellablePosition, averageCost: this.averageCost, orders: [...this.orders.values()].map(order => structuredClone(order)) });
  }
}

