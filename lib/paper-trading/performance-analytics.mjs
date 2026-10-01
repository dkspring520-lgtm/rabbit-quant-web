const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const round = value => value === null || !Number.isFinite(value) ? null : Number(value.toFixed(6));

export function checkSampleIntegrity(sample = {}) {
  const missing = [];
  if (!sample.timestamp) missing.push("timestamp");
  if (finite(sample.entryPrice ?? sample.price) === null) missing.push("price");
  if (!sample.factorSnapshot || typeof sample.factorSnapshot !== "object") missing.push("factorSnapshot");
  if (!sample.candidateId) missing.push("candidateId");
  if (![sample.future1mReturn, sample.future3mReturn, sample.future5mReturn, sample.future10mReturn].some(value => finite(value) !== null) && finite(sample.pnl) === null) missing.push("futureReturn");
  return Object.freeze({ valid: missing.length === 0, missing });
}

function metrics(samples) {
  const returns = samples.map(sample => finite(sample.pnl ?? sample.future5mReturn ?? sample.future1mReturn)).filter(value => value !== null);
  const wins = returns.filter(value => value > 0); const losses = returns.filter(value => value < 0);
  const sorted = [...returns].sort((a, b) => a - b);
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;
  const grossWin = wins.reduce((sum, value) => sum + value, 0); const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  let equity = 1; let peak = 1; let maxDrawdown = 0;
  for (const value of returns) { equity *= 1 + value; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak ? (peak - equity) / peak : 0); }
  const holding = samples.map(sample => finite(sample.holdingTime)).filter(value => value !== null);
  return { totalSamples: samples.length, totalTrades: samples.filter(sample => ["BUY", "SELL"].includes(String(sample.signal).toUpperCase())).length, resolvedReturns: returns.length, wins: wins.length, losses: losses.length, winRate: returns.length ? round(wins.length / returns.length) : null, lossRate: returns.length ? round(losses.length / returns.length) : null, averageReturn: returns.length ? round(returns.reduce((a, b) => a + b, 0) / returns.length) : null, medianReturn: round(median), totalPnl: round(returns.reduce((a, b) => a + b, 0)), profitFactor: grossLoss ? round(grossWin / grossLoss) : (grossWin ? null : 0), maxDrawdown: round(maxDrawdown), averageHoldingTime: holding.length ? round(holding.reduce((a, b) => a + b, 0) / holding.length) : null, averageWin: wins.length ? round(grossWin / wins.length) : null, averageLoss: losses.length ? round(losses.reduce((a, b) => a + b, 0) / losses.length) : null, winLossRatio: losses.length && wins.length ? round((grossWin / wins.length) / Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length)) : null };
}

function risk(returns) {
  let maxLoss = 0; let maxWin = 0; let loss = 0; let win = 0;
  for (const value of returns) { if (value < 0) { loss += 1; win = 0; } else if (value > 0) { win += 1; loss = 0; } else { loss = 0; win = 0; } maxLoss = Math.max(maxLoss, loss); maxWin = Math.max(maxWin, win); }
  return { maximumConsecutiveLoss: maxLoss, maximumConsecutiveWin: maxWin };
}

function distribution(samples) {
  const values = samples.map(sample => finite(sample.pnl ?? sample.future5mReturn ?? sample.future1mReturn)).filter(value => value !== null);
  return { largeProfit: values.filter(value => value >= 0.02).length, smallProfit: values.filter(value => value > 0 && value < 0.02).length, smallLoss: values.filter(value => value < 0 && value > -0.02).length, largeLoss: values.filter(value => value <= -0.02).length };
}

export class PerformanceAnalyticsEngine {
  analyze(input = []) {
    const samples = Array.isArray(input) ? input : [];
    const quality = samples.map((sample, index) => ({ index, ...checkSampleIntegrity(sample) }));
    const valid = samples.filter((_, index) => quality[index].valid);
    const grouped = {};
    const dimensions = { candidateId: sample => sample.candidateId, signalType: sample => sample.signal, signalScore: sample => sample.signalScore === null || sample.signalScore === undefined ? "unknown" : Number(sample.signalScore) >= 80 ? "80+" : Number(sample.signalScore) >= 70 ? "70-79" : Number(sample.signalScore) >= 60 ? "60-69" : "0-59", factorId: sample => Object.keys(sample.factorSnapshot ?? {}).filter(key => finite(sample.factorSnapshot[key]) !== null), marketState: sample => sample.marketState, timeOfDay: sample => String(sample.timestamp).match(/T(\d{2}:?\d{2})/)?.[1] ?? "unknown", modelVersion: sample => sample.modelVersion, datasetVersion: sample => sample.datasetVersion };
    for (const [dimension, selector] of Object.entries(dimensions)) { const map = new Map(); for (const sample of valid) { const keys = Array.isArray(selector(sample)) ? selector(sample) : [selector(sample)]; for (const key of keys) { const normalized = String(key ?? "unknown"); if (!map.has(normalized)) map.set(normalized, []); map.get(normalized).push(sample); } } grouped[dimension] = Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => [key, metrics(rows)])); }
    const values = valid.map(sample => finite(sample.pnl ?? sample.future5mReturn ?? sample.future1mReturn)).filter(value => value !== null);
    return { summary: metrics(valid), metrics: metrics(valid), breakdown: grouped, risk: risk(values), returnDistribution: distribution(valid), sampleQuality: { total: samples.length, valid: valid.length, invalid: samples.length - valid.length, invalidSamples: quality.filter(item => !item.valid) } };
  }
}
