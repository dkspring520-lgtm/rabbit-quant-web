import { aShareSession } from "../a-share-session.mjs";
import { createObservation, normalizeResearchAction } from "./schema.mjs";
import { executePaperAction } from "./paper-execution-engine.mjs";

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clone = value => structuredClone(value);

function asShanghaiDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "string" && /^\d{8}$/.test(value)) {
    return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T04:00:00+08:00`);
  }
  return new Date(value);
}

function sessionTime(date, time) {
  const digits = String(time ?? "").replace(/:/g, "").slice(0, 4);
  if (!/^\d{4}$/.test(digits)) return null;
  const hour = Number(digits.slice(0, 2));
  const minute = Number(digits.slice(2));
  if (hour > 23 || minute > 59) return null;
  return new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${digits.slice(0, 2)}:${digits.slice(2)}:00+08:00`);
}

export class TTradingEnvironment {
  constructor({ symbol, session, initialCash = 200_000, openingShares = 0, sellableShares = openingShares, feeConfig = {}, executionConfig = {} } = {}) {
    this.symbol = String(symbol ?? "").trim();
    this.session = clone(session ?? {});
    this.date = String(this.session.date ?? "").replace(/-/g, "");
    this.initialCash = Math.max(0, finite(initialCash));
    this.initialOpeningShares = Math.max(0, Math.floor(finite(openingShares)));
    this.initialSellableShares = Math.min(this.initialOpeningShares, Math.max(0, Math.floor(finite(sellableShares))));
    this.executionConfig = { ...feeConfig, ...executionConfig };
    this.reset();
  }

  reset() {
    this.index = -1;
    this.cash = this.initialCash;
    this.position = this.initialOpeningShares;
    this.sellable = this.initialSellableShares;
    this.averageCost = null;
    this.realizedPnl = 0;
    this.records = [];
    this.done = false;
    this.lastObservation = null;
    return this.observeNext();
  }

  observeNext() {
    const minutes = Array.isArray(this.session.minutes) ? this.session.minutes : [];
    if (this.index + 1 >= minutes.length) {
      this.done = true;
      return null;
    }
    this.index += 1;
    const point = minutes[this.index] ?? {};
    const asOfDate = sessionTime(this.date, point.time);
    const phase = asOfDate ? aShareSession(asOfDate).phase : "invalid";
    const priorPosition = this.position;
    this.lastObservation = createObservation({
      symbol: this.symbol,
      date: this.date,
      time: point.time,
      asOf: asOfDate?.toISOString() ?? "",
      modelVersion: "baseline",
      source: "baseline",
      price: point.price ?? point.close,
      open: point.open,
      high: point.high,
      low: point.low,
      volume: point.volume,
      amount: point.amount,
      vwap: point.vwap,
      position: priorPosition,
      availableSellablePosition: this.sellable,
      cash: this.cash,
      avgCost: this.averageCost,
      unrealizedPnl: this.averageCost && Number.isFinite(Number(point.price ?? point.close))
        ? (Number(point.price ?? point.close) - this.averageCost) * priorPosition
        : null,
      timeOfDay: point.time,
      tradingSession: phase,
      factors: point.factors ?? {},
      dataQuality: point.dataQuality ?? {},
    });
    return this.lastObservation;
  }

  step(actionInput) {
    if (this.done || !this.lastObservation) throw new Error("Environment is complete; reset before stepping again");
    const action = normalizeResearchAction({
      ...this.lastObservation,
      ...actionInput,
      symbol: this.symbol,
      source: actionInput?.source ?? "experimental",
    });
    const record = executePaperAction(this.lastObservation, action, this.executionConfig);
    if (record.status === "filled") {
      if (record.side === "BUY") {
        const oldCost = this.averageCost ?? record.fillPrice;
        const oldValue = oldCost * this.position;
        this.averageCost = (oldValue + record.fillPrice * record.quantity + record.fee) / Math.max(1, record.positionAfter);
      } else {
        this.realizedPnl += (record.fillPrice - (this.averageCost ?? record.fillPrice)) * record.quantity - record.fee;
        if (record.positionAfter === 0) this.averageCost = null;
      }
      this.cash = record.cashAfter;
      this.position = record.positionAfter;
      this.sellable = record.sellableAfter;
    }
    this.records.push(record);
    const nextObservation = this.observeNext();
    return {
      observation: nextObservation,
      record,
      reward: record.status === "filled" ? this.realizedPnl : 0,
      done: this.done,
      info: this.snapshot(),
    };
  }

  getState() {
    return this.lastObservation ? structuredClone(this.lastObservation) : null;
  }

  calculateReward(record = null, { drawdownPenalty = 0, overtradePenalty = 0 } = {}) {
    if (!record || record.status !== "filled") return -Math.max(0, Number(overtradePenalty) || 0);
    return Number((this.realizedPnl - (Number(record.fee) || 0) - (Number(record.slippage) || 0) - (Number(drawdownPenalty) || 0)).toFixed(8));
  }

  snapshot() {
    const price = Number(this.lastObservation?.price) || 0;
    return {
      symbol: this.symbol,
      date: this.date,
      index: this.index,
      cash: this.cash,
      position: this.position,
      sellable: this.sellable,
      sameDayBuyShares: Math.max(0, this.position - this.sellable),
      averageCost: this.averageCost,
      realizedPnl: this.realizedPnl,
      unrealizedPnl: this.averageCost ? (price - this.averageCost) * this.position : 0,
      equity: this.cash + price * this.position,
      done: this.done,
      records: this.records.length,
    };
  }
}
