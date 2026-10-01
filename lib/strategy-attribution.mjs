const clamp = value => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));

export function buildStrategyContributions(strategySignals = [], { tradeId = "", decisionId = "" } = {}) {
  const signals = Array.isArray(strategySignals) ? strategySignals : [];
  const total = signals.reduce((sum, signal) => sum + clamp(signal.confidence ?? Number(signal.score) / 100), 0);
  return signals.map(signal => Object.freeze({ tradeId: String(tradeId), decisionId: String(decisionId), strategyId: String(signal.strategyId ?? "unknown"), action: String(signal.action ?? signal.direction ?? "WAIT").toUpperCase(), score: Number.isFinite(Number(signal.score)) ? Number(signal.score) : null, confidence: clamp(signal.confidence ?? Number(signal.score) / 100), weight: total ? Number((clamp(signal.confidence ?? Number(signal.score) / 100) / total).toFixed(6)) : 0, reason: String(signal.reason ?? "") }));
}

export function summarizeStrategyContributions(contributions = [], samples = []) {
  const grouped = new Map();
  for (const contribution of contributions) { if (!grouped.has(contribution.strategyId)) grouped.set(contribution.strategyId, []); grouped.get(contribution.strategyId).push(contribution); }
  const sampleByStrategy = new Map();
  for (const sample of samples) { for (const strategyId of sample.strategyIds ?? (sample.strategyId ? [sample.strategyId] : [])) { if (!sampleByStrategy.has(strategyId)) sampleByStrategy.set(strategyId, []); sampleByStrategy.get(strategyId).push(sample); } }
  return Object.fromEntries([...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([strategyId, rows]) => { const strategySamples = sampleByStrategy.get(strategyId) ?? []; const returns = strategySamples.map(sample => Number(sample.pnl ?? sample.future5mReturn)).filter(Number.isFinite); const wins = returns.filter(value => value > 0); let equity = 1; let peak = 1; let maxDrawdown = 0; for (const value of returns) { equity *= 1 + value; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak); } return [strategyId, { signalCount: rows.length, winRate: returns.length ? wins.length / returns.length : null, averageReturn: returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : null, maxDrawdown, contributionReturn: returns.reduce((sum, value) => sum + value, 0), contributionWeight: rows.reduce((sum, row) => sum + row.weight, 0) }]; }));
}
