/**
 * Research-only contracts shared by replay, paper execution and evaluation.
 * These helpers deliberately do not import the production signal engine.
 */

export const RL_RESEARCH_SCHEMA_VERSION = "1.0.0";
export const RL_RESEARCH_SOURCES = Object.freeze(["baseline", "experimental"]);
export const RL_RESEARCH_ACTIONS = Object.freeze(["WAIT", "BUY", "SELL"]);

const text = (value, fallback = "") => {
  const result = String(value ?? fallback).trim();
  return result || fallback;
};

const finite = (value, fallback = null) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
};

const nonNegative = value => Math.max(0, finite(value, 0));

const immutable = value => Object.freeze(value);

function baseIdentity(input = {}) {
  return {
    symbol: text(input.symbol),
    date: text(input.date),
    time: text(input.time),
    asOf: text(input.asOf),
    modelVersion: text(input.modelVersion, "unknown"),
    source: RL_RESEARCH_SOURCES.includes(input.source) ? input.source : "baseline",
  };
}

export function normalizeResearchAction(input = {}) {
  const action = text(input.action, "WAIT").toUpperCase();
  return immutable({
    ...baseIdentity(input),
    action: RL_RESEARCH_ACTIONS.includes(action) ? action : "WAIT",
    quantity: Math.floor(nonNegative(input.quantity)),
    score: finite(input.score),
    reason: text(input.reason),
  });
}

export function createObservation(input = {}) {
  return immutable({
    schemaVersion: RL_RESEARCH_SCHEMA_VERSION,
    ...baseIdentity(input),
    price: finite(input.price),
    open: finite(input.open),
    high: finite(input.high),
    low: finite(input.low),
    volume: nonNegative(input.volume),
    amount: nonNegative(input.amount),
    vwap: finite(input.vwap),
    position: nonNegative(input.position),
    availableSellablePosition: nonNegative(input.availableSellablePosition),
    cash: nonNegative(input.cash),
    avgCost: finite(input.avgCost),
    unrealizedPnl: finite(input.unrealizedPnl),
    timeOfDay: text(input.timeOfDay),
    tradingSession: text(input.tradingSession),
    factors: input.factors && typeof input.factors === "object" ? structuredClone(input.factors) : {},
    dataQuality: input.dataQuality && typeof input.dataQuality === "object" ? structuredClone(input.dataQuality) : {},
  });
}

export function createExecutionRecord(input = {}) {
  const action = normalizeResearchAction(input);
  return immutable({
    schemaVersion: RL_RESEARCH_SCHEMA_VERSION,
    ...baseIdentity(input),
    action: action.action,
    orderId: text(input.orderId),
    status: text(input.status, "rejected"),
    side: action.action === "BUY" ? "BUY" : action.action === "SELL" ? "SELL" : "WAIT",
    quantity: action.quantity,
    orderPrice: finite(input.orderPrice),
    fillPrice: finite(input.fillPrice),
    slippage: nonNegative(input.slippage),
    fee: nonNegative(input.fee),
    positionBefore: nonNegative(input.positionBefore),
    positionAfter: nonNegative(input.positionAfter),
    sellableBefore: nonNegative(input.sellableBefore),
    sellableAfter: nonNegative(input.sellableAfter),
    cashBefore: nonNegative(input.cashBefore),
    cashAfter: nonNegative(input.cashAfter),
    rejectionReason: text(input.rejectionReason),
    signalId: text(input.signalId),
    signalScore: finite(input.signalScore),
    factorSnapshot: input.factorSnapshot && typeof input.factorSnapshot === "object" ? structuredClone(input.factorSnapshot) : {},
  });
}

export function createSignalSample(input = {}) {
  const signalId = text(input.signalId);
  const candidateId = text(input.candidateId);
  const sampleId = text(input.sampleId, `${candidateId || signalId || input.symbol || "signal"}-${input.date ?? ""}-${input.time ?? ""}`);
  const futureReturns = input.futureReturns && typeof input.futureReturns === "object" ? structuredClone(input.futureReturns) : {};
  return immutable({
    schemaVersion: RL_RESEARCH_SCHEMA_VERSION,
    ...baseIdentity(input),
    sampleId,
    candidateId,
    datasetVersion: text(input.datasetVersion),
    signalId,
    timestamp: text(input.timestamp, input.asOf),
    price: finite(input.price),
    signal: RL_RESEARCH_ACTIONS.includes(input.signal) ? input.signal : "WAIT",
    signalScore: finite(input.signalScore),
    marketState: text(input.marketState, "unknown"),
    factorSnapshot: input.factorSnapshot && typeof input.factorSnapshot === "object" ? structuredClone(input.factorSnapshot) : {},
    futureReturns,
    future1mReturn: finite(input.future1mReturn ?? futureReturns["1m"]),
    future3mReturn: finite(input.future3mReturn ?? futureReturns["3m"]),
    future5mReturn: finite(input.future5mReturn ?? futureReturns["5m"]),
    future10mReturn: finite(input.future10mReturn ?? futureReturns["10m"]),
    maxFavorableExcursion: finite(input.maxFavorableExcursion),
    maxAdverseExcursion: finite(input.maxAdverseExcursion),
    executionResult: input.executionResult && typeof input.executionResult === "object" ? structuredClone(input.executionResult) : null,
    entryPrice: finite(input.entryPrice),
    exitPrice: finite(input.exitPrice),
    holdingMinutes: finite(input.holdingMinutes),
    fees: nonNegative(input.fees),
    slippage: nonNegative(input.slippage),
    lifecycle: ["CREATED", "OBSERVING", "RESOLVED"].includes(input.lifecycle) ? input.lifecycle : "CREATED",
    pnl: finite(input.pnl),
    isWin: typeof input.isWin === "boolean" ? input.isWin : null,
  });
}

export function resolveSignalSample(sample, resolution = {}) {
  const current = createSignalSample(sample);
  const mergedReturns = { ...current.futureReturns, ...(resolution.futureReturns ?? {}) };
  const pnl = finite(resolution.pnl ?? current.pnl);
  return createSignalSample({
    ...current,
    ...resolution,
    futureReturns: mergedReturns,
    future1mReturn: resolution.future1mReturn ?? mergedReturns["1m"],
    future3mReturn: resolution.future3mReturn ?? mergedReturns["3m"],
    future5mReturn: resolution.future5mReturn ?? mergedReturns["5m"],
    future10mReturn: resolution.future10mReturn ?? mergedReturns["10m"],
    pnl,
    isWin: typeof resolution.isWin === "boolean" ? resolution.isWin : (Number.isFinite(pnl) ? pnl > 0 : null),
    lifecycle: "RESOLVED",
  });
}

export function createModelVersion(input = {}) {
  return immutable({
    schemaVersion: RL_RESEARCH_SCHEMA_VERSION,
    modelVersion: text(input.modelVersion, "unknown"),
    source: RL_RESEARCH_SOURCES.includes(input.source) ? input.source : "experimental",
    algorithm: text(input.algorithm, "deterministic-baseline"),
    datasetId: text(input.datasetId),
    trainedThrough: text(input.trainedThrough),
    createdAt: text(input.createdAt),
    enabled: input.enabled === true,
  });
}

