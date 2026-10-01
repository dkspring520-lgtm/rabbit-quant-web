export const PAPER_SCHEMA_VERSION = "1.0.0";
export const ORDER_STATUSES = Object.freeze(["CREATED", "SUBMITTED", "FILLED", "PARTIAL_FILLED", "CANCELLED", "REJECTED"]);
export const ORDER_SIDES = Object.freeze(["BUY", "SELL", "WAIT"]);

const text = (value, fallback = "") => {
  const result = String(value ?? fallback).trim();
  return result || fallback;
};
const number = (value, fallback = null) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
};
const nonNegative = (value, fallback = 0) => Math.max(0, number(value, fallback));
const clone = value => value && typeof value === "object" ? structuredClone(value) : null;

export function normalizePaperCostConfig(input = {}) {
  return Object.freeze({
    commission: nonNegative(input.commission ?? input.feeRate),
    minimumCommission: nonNegative(input.minimumCommission ?? input.minCommission),
    stampDuty: nonNegative(input.stampDuty ?? input.stampDutyRate),
    slippage: nonNegative(input.slippage ?? input.slippagePct),
    slippageUnit: text(input.slippageUnit, "percent"),
  });
}

export function createPaperPosition(input = {}) {
  const totalPosition = Math.floor(nonNegative(input.totalPosition ?? input.position));
  const available = Math.min(totalPosition, Math.floor(nonNegative(input.availableSellablePosition ?? input.sellablePosition)));
  return Object.freeze({
    schemaVersion: PAPER_SCHEMA_VERSION,
    symbol: text(input.symbol),
    totalPosition,
    availableSellablePosition: available,
    averageCost: number(input.averageCost ?? input.avgCost),
  });
}

export function createPaperAccount(input = {}) {
  return Object.freeze({
    schemaVersion: PAPER_SCHEMA_VERSION,
    accountId: text(input.accountId, "paper-default"),
    cash: nonNegative(input.cash),
    currency: text(input.currency, "CNY"),
    positions: clone(input.positions) ?? {},
  });
}

export function createPaperOrder(input = {}) {
  const side = text(input.side ?? input.action, "WAIT").toUpperCase();
  const status = text(input.status, "CREATED").toUpperCase();
  if (!ORDER_SIDES.includes(side)) throw new TypeError(`Unsupported paper order side: ${side}`);
  if (!ORDER_STATUSES.includes(status)) throw new TypeError(`Unsupported paper order status: ${status}`);
  return Object.freeze({
    schemaVersion: PAPER_SCHEMA_VERSION,
    orderId: text(input.orderId),
    symbol: text(input.symbol),
    timestamp: text(input.timestamp ?? input.asOf),
    side,
    status,
    quantity: Math.floor(nonNegative(input.quantity)),
    orderPrice: number(input.orderPrice ?? input.price),
    fillPrice: number(input.fillPrice),
    slippage: nonNegative(input.slippage),
    fees: nonNegative(input.fees ?? input.fee),
    signalId: text(input.signalId),
    candidateId: text(input.candidateId),
    modelVersion: text(input.modelVersion),
    datasetVersion: text(input.datasetVersion),
    reason: text(input.reason),
  });
}
