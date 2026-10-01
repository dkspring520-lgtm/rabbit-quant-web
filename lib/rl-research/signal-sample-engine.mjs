import { createSignalSample } from "./schema.mjs";

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

function priceAt(minutes, index) {
  const point = minutes[index];
  return finite(point?.price ?? point?.close);
}

/** Enrich samples only after the replay tape is known; never mutates live signals. */
export function buildSignalSamples({ symbol, date, minutes = [], signals = [], modelVersion = "baseline", source = "baseline", horizons = [1, 3, 5, 10] } = {}) {
  const points = Array.isArray(minutes) ? minutes : [];
  const horizonList = [...new Set(horizons.map(value => Math.max(1, Math.floor(Number(value)))).filter(Number.isFinite))];
  return (Array.isArray(signals) ? signals : []).map((signal, signalIndex) => {
    const index = Math.max(0, Math.floor(Number(signal?.index ?? signal?.minuteIndex ?? 0)));
    const entryPrice = finite(signal?.price ?? priceAt(points, index));
    const futureReturns = {};
    for (const horizon of horizonList) {
      const futurePrice = priceAt(points, index + horizon);
      futureReturns[`${horizon}m`] = entryPrice && futurePrice !== null ? futurePrice / entryPrice - 1 : null;
    }
    const available = Object.values(futureReturns).filter(Number.isFinite);
    const direction = String(signal?.signal ?? signal?.action ?? "WAIT").toUpperCase();
    const signed = available.map(value => direction === "SELL" ? -value : value);
    const pnl = signed.length ? signed.at(-1) : null;
    return createSignalSample({
      symbol,
      date: date ?? signal?.date,
      time: signal?.time ?? points[index]?.time,
      asOf: signal?.asOf,
      modelVersion: signal?.modelVersion ?? modelVersion,
      source: signal?.source ?? source,
      candidateId: signal?.candidateId,
      datasetVersion: signal?.datasetVersion,
      signalId: signal?.signalId ?? `${symbol ?? "signal"}-${date ?? ""}-${signal?.time ?? index}-${signalIndex}`,
      price: entryPrice,
      timestamp: signal?.timestamp ?? signal?.asOf,
      signal: direction,
      signalScore: signal?.score ?? signal?.signalScore,
      marketState: signal?.marketState,
      factorSnapshot: signal?.factorSnapshot ?? signal?.factors,
      futureReturns,
      maxFavorableExcursion: signed.length ? Math.max(...signed) : null,
      maxAdverseExcursion: signed.length ? Math.min(...signed) : null,
      executionResult: signal?.executionResult,
      pnl,
      isWin: Number.isFinite(pnl) ? pnl > 0 : null,
    });
  });
}

