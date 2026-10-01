const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value, digits = 6) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function metrics(samples) {
  const returns = samples.map(sample => finite(sample.pnl)).filter(value => value !== null);
  const wins = returns.filter(value => value > 0);
  const losses = returns.filter(value => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const value of returns) {
    equity *= 1 + value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0);
  }
  const average = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null;
  const variance = returns.length > 1 && average !== null
    ? returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / (returns.length - 1)
    : null;
  return {
    samples: returns.length,
    wins: wins.length,
    losses: losses.length,
    winRate: returns.length ? round(wins.length / returns.length, 4) : null,
    averageReturn: round(average),
    totalReturn: round(returns.reduce((sum, value) => sum + value, 0)),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 4) : grossProfit > 0 ? null : 0,
    maxDrawdown: round(maxDrawdown),
    sharpe: variance && variance > 0 && average !== null ? round(average / Math.sqrt(variance)) : null,
  };
}

function groupBy(samples, selector) {
  const groups = new Map();
  for (const sample of samples) {
    const key = String(selector(sample) ?? "unknown");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sample);
  }
  return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, rows]) => [key, metrics(rows)]));
}

export function evaluateSignalSamples(samples = []) {
  const normalized = Array.isArray(samples) ? samples.filter(sample => sample && typeof sample === "object") : [];
  return {
    overall: metrics(normalized),
    bySignal: groupBy(normalized, sample => sample.signal),
    byScoreBand: groupBy(normalized, sample => {
      const score = finite(sample.signalScore);
      if (score === null) return "unknown";
      if (score < 60) return "0-59";
      if (score < 70) return "60-69";
      if (score < 80) return "70-79";
      return "80+";
    }),
    byModel: groupBy(normalized, sample => `${sample.source ?? "baseline"}:${sample.modelVersion ?? "unknown"}`),
    byMarketState: groupBy(normalized, sample => sample.marketState),
    sampleCount: normalized.length,
  };
}

