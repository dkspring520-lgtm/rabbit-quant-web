const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const clone = value => value && typeof value === "object" ? structuredClone(value) : null;
const HORIZONS = Object.freeze([1, 3, 5, 10]);

export function createSignalSample(input = {}) {
  const lifecycle = input.lifecycle ?? "CREATED";
  if (!["CREATED", "OBSERVING", "RESOLVED"].includes(lifecycle)) throw new TypeError(`Invalid sample lifecycle: ${lifecycle}`);
  return Object.freeze({
    sampleId: String(input.sampleId ?? `${input.signalId ?? "signal"}-${input.timestamp ?? ""}`),
    signalId: String(input.signalId ?? ""), candidateId: String(input.candidateId ?? ""), symbol: String(input.symbol ?? ""),
    timestamp: String(input.timestamp ?? ""), entryPrice: finite(input.entryPrice ?? input.price), signal: String(input.signal ?? "WAIT"), signalScore: finite(input.signalScore),
    entryIndex: Number.isInteger(input.entryIndex) ? input.entryIndex : null,
    marketState: String(input.marketState ?? "unknown"), marketRegime: String(input.marketRegime ?? input.marketState ?? "unknown"), trend: String(input.trend ?? ""), volatility: finite(input.volatility), tradingMode: String(input.tradingMode ?? ""), factorSnapshot: clone(input.factorSnapshot) ?? {}, modelVersion: String(input.modelVersion ?? ""), datasetVersion: String(input.datasetVersion ?? ""),
    lifecycle,
    future1mReturn: finite(input.future1mReturn), future3mReturn: finite(input.future3mReturn), future5mReturn: finite(input.future5mReturn), future10mReturn: finite(input.future10mReturn),
    mfe: finite(input.mfe), mae: finite(input.mae), holdingTime: finite(input.holdingTime), pnl: finite(input.pnl), fees: finite(input.fees), slippage: finite(input.slippage), isWin: typeof input.isWin === "boolean" ? input.isWin : null,
    execution: clone(input.execution),
  });
}

export class SampleResolver {
  constructor({ horizons = HORIZONS } = {}) { this.horizons = [...new Set(horizons.map(Number).filter(value => Number.isInteger(value) && value > 0))].sort((a, b) => a - b); }
  advance(samples, bars, currentIndex, executions = []) {
    return samples.map((sample, sampleIndex) => {
      const entryIndex = sample.entryIndex;
      if (!Number.isInteger(entryIndex)) return sample;
      const points = bars.slice(entryIndex + 1, currentIndex + 1);
      const values = points.map(bar => finite(bar.price ?? bar.close)).filter(Number.isFinite);
      const direction = sample.signal === "SELL" ? -1 : 1;
      const returns = Object.fromEntries(this.horizons.map(horizon => {
        if (currentIndex < entryIndex + horizon) return [`${horizon}m`, null];
        const future = finite(bars[entryIndex + horizon]?.price ?? bars[entryIndex + horizon]?.close);
        return [`${horizon}m`, sample.entryPrice > 0 && future !== null ? future / sample.entryPrice - 1 : null];
      }));
      const matured = this.horizons.every(horizon => currentIndex >= entryIndex + horizon);
      const signedPath = values.map(price => (price / sample.entryPrice - 1) * direction);
      const pnl = matured && signedPath.length ? signedPath.at(-1) : null;
      const execution = executions[sampleIndex] ?? sample.execution;
      return createSignalSample({ ...sample, lifecycle: matured ? "RESOLVED" : "OBSERVING", ...Object.fromEntries(this.horizons.map(h => [`future${h}mReturn`, returns[`${h}m`]])), mfe: signedPath.length ? Math.max(...signedPath) : null, mae: signedPath.length ? Math.min(...signedPath) : null, holdingTime: points.length || null, pnl, fees: execution?.fees ?? null, slippage: execution?.slippage ?? null, isWin: pnl === null ? null : pnl > 0, execution });
    });
  }
}

export function resolveSignalSample(sample, { bars = [], currentIndex = -1, execution = sample.execution } = {}) {
  const indexed = { ...sample, entryIndex: sample.entryIndex ?? 0 };
  return new SampleResolver().advance([indexed], bars, currentIndex, [execution])[0];
}
