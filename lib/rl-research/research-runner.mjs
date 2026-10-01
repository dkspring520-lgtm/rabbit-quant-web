import { runSmartTReplay } from "../smart-t-engine.mjs";
import { buildSignalSamples } from "./signal-sample-engine.mjs";
import { evaluateSignalSamples } from "./performance-engine.mjs";

function numeric(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function actionSignal(action, index, minutes) {
  const side = String(action?.side ?? "").toUpperCase();
  const signal = side === "BUY" ? "BUY" : side === "SELL" ? "SELL" : "WAIT";
  return {
    index: numeric(action?.minuteIndex, index),
    time: action?.time ?? minutes[index]?.time,
    price: numeric(action?.price ?? action?.marketPrice ?? action?.executionPrice ?? minutes[index]?.price),
    signal,
    score: numeric(action?.score ?? action?.signalScore),
    signalId: action?.id ?? action?.cycleId,
    source: "baseline",
    modelVersion: action?.strategyVersion ?? "V2.9",
    factors: action?.factorSnapshot ?? action?.features ?? {},
    marketState: action?.marketRegime ?? action?.regime ?? "unknown",
    executionResult: action,
  };
}

/**
 * Replay adapter for research only. It converts the existing deterministic
 * Smart-T result into immutable samples; it never changes its thresholds.
 */
export function replayBaselineSession({ symbol, session, options = {}, horizons = [1, 3, 5, 10] } = {}) {
  const minutes = Array.isArray(session?.minutes) ? session.minutes : [];
  const replay = runSmartTReplay(minutes, {
    capital: 200_000,
    baseShares: 0,
    sellable: 0,
    feeRate: 0.025,
    slippage: 0.02,
    minCommission: true,
    slippageMode: "percent",
    forceCloseTime: "1450",
    previousClose: session?.previousClose ?? null,
    profile: "平衡档",
    randomValue: 0,
    ...options,
  });
  const actions = (replay.actions ?? []).map((action, index) => actionSignal(action, index, minutes));
  const samples = buildSignalSamples({ symbol, date: session?.date, minutes, signals: actions, modelVersion: "V2.9", source: "baseline", horizons });
  return {
    source: "baseline",
    modelVersion: "V2.9",
    replayStatus: replay.status,
    diagnostics: replay.diagnostics ?? {},
    actions,
    samples,
    performance: evaluateSignalSamples(samples),
  };
}

export function exportResearchRows(samples = []) {
  return (Array.isArray(samples) ? samples : []).map(sample => ({
    schemaVersion: sample.schemaVersion,
    symbol: sample.symbol,
    date: sample.date,
    time: sample.time,
    asOf: sample.asOf,
    signal: sample.signal,
    signalScore: sample.signalScore,
    marketState: sample.marketState,
    source: sample.source,
    modelVersion: sample.modelVersion,
    factorSnapshot: sample.factorSnapshot,
    futureReturns: sample.futureReturns,
    pnl: sample.pnl,
    isWin: sample.isWin,
  }));
}

/** Create non-executable chart notes from research samples. */
export function buildResearchObservationPoints(samples = [], { minimumSamples = 20 } = {}) {
  const rows = Array.isArray(samples) ? samples : [];
  const eligible = rows.filter(row => row && row.signal !== "WAIT" && Number.isFinite(Number(row.pnl)));
  if (eligible.length < Math.max(1, minimumSamples)) return [];
  const grouped = new Map();
  for (const row of eligible) {
    const key = `${row.signal}:${row.modelVersion}:${row.marketState}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return [...grouped.entries()].flatMap(([key, group]) => {
    const wins = group.filter(row => row.isWin === true).length;
    const winRate = wins / group.length;
    if (group.length < minimumSamples) return [];
    const [signal, modelVersion, marketState] = key.split(":");
    return group.slice(-1).map(row => ({
      type: "research-observation",
      executable: false,
      time: row.time,
      price: row.price ?? null,
      signal,
      modelVersion,
      marketState,
      sampleCount: group.length,
      winRate,
      label: `${signal === "BUY" ? "买入" : "卖出"}研究观察`,
      detail: `同类样本 ${group.length} 次，历史表现 ${(winRate * 100).toFixed(0)}%；仅作研究参考，不是正式买卖信号。`,
    }));
  });
}

