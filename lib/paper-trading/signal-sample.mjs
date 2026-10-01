const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const clone = value => value && typeof value === "object" ? structuredClone(value) : null;

export function createSignalSample(input = {}) {
  return Object.freeze({
    sampleId: String(input.sampleId ?? `${input.signalId ?? "signal"}-${input.timestamp ?? ""}`),
    signalId: String(input.signalId ?? ""), candidateId: String(input.candidateId ?? ""), symbol: String(input.symbol ?? ""),
    timestamp: String(input.timestamp ?? ""), price: finite(input.price), signal: String(input.signal ?? "WAIT"), signalScore: finite(input.signalScore),
    marketState: String(input.marketState ?? "unknown"), factorSnapshot: clone(input.factorSnapshot) ?? {}, modelVersion: String(input.modelVersion ?? ""), datasetVersion: String(input.datasetVersion ?? ""),
    lifecycle: input.lifecycle ?? "OBSERVING", future1mReturn: finite(input.future1mReturn), future3mReturn: finite(input.future3mReturn), future5mReturn: finite(input.future5mReturn), future10mReturn: finite(input.future10mReturn),
    mfe: finite(input.mfe), mae: finite(input.mae), holdingTime: finite(input.holdingTime), pnl: finite(input.pnl), fees: finite(input.fees), slippage: finite(input.slippage), isWin: typeof input.isWin === "boolean" ? input.isWin : null,
    execution: clone(input.execution),
  });
}

export function resolveSignalSample(sample, { prices = [], currentIndex = 0, execution = null } = {}) {
  const entry = finite(sample.price); const signal = sample.signal === "SELL" ? -1 : 1;
  const returns = [1, 3, 5, 10].map(h => { const exit = finite(prices[currentIndex + h]); return entry && exit ? exit / entry - 1 : null; });
  const signed = returns.filter(Number.isFinite).map(value => value * signal);
  const pnl = signed.length ? signed.at(-1) : null;
  return createSignalSample({ ...sample, lifecycle: signed.length >= 4 ? "RESOLVED" : "OBSERVING", future1mReturn: returns[0], future3mReturn: returns[1], future5mReturn: returns[2], future10mReturn: returns[3], mfe: signed.length ? Math.max(...signed) : null, mae: signed.length ? Math.min(...signed) : null, holdingTime: signed.length ? Math.max(1, Math.min(10, currentIndex)) : null, pnl, fees: execution?.fees ?? null, slippage: execution?.slippage ?? null, isWin: pnl === null ? null : pnl > 0, execution });
}
