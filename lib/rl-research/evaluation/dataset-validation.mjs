const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

function distribution(values) {
  const xs = values.map(finite).filter(v => v !== null);
  return { count: xs.length, min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null, average: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null };
}

export function auditRLDataset(dataset = []) {
  const rows = Array.isArray(dataset) ? dataset : [];
  const fields = ["symbol", "timestamp", "price", "volume", "vwap", "trend", "volatility", "sentiment", "factorFeatures", "position", "cash"];
  const missing = Object.fromEntries(fields.map(field => [field, rows.filter(row => row?.state?.[field] === null || row?.state?.[field] === undefined || row?.state?.[field] === "").length]));
  const timestamps = rows.map(row => Date.parse(row?.state?.timestamp)).filter(Number.isFinite);
  const symbols = [...new Set(rows.map(row => row?.state?.symbol).filter(Boolean))];
  const actions = {}; for (const row of rows) actions[row.positionDelta ?? row.expertAction ?? 0] = (actions[row.positionDelta ?? row.expertAction ?? 0] ?? 0) + 1;
  return { sampleCount: rows.length, symbolCount: symbols.length, symbols, timeRange: timestamps.length ? { start: new Date(Math.min(...timestamps)).toISOString(), end: new Date(Math.max(...timestamps)).toISOString() } : { start: null, end: null }, stateMissingRate: Object.fromEntries(fields.map(field => [field, rows.length ? missing[field] / rows.length : null])), stateMissingCount: missing, actionDistribution: actions, rewardDistribution: distribution(rows.map(row => row?.reward)), futureReturnDistribution: distribution(rows.map(row => row?.futureReturnRate ?? row?.futureReturn)), trainingPerformed: false, executable: false };
}

export function evaluateBaseline(rows = [], actionSource = () => 0) {
  const values = (Array.isArray(rows) ? rows : []).map((row, index) => ({ row, action: Number(actionSource(row, index)) || 0, value: finite(row?.rawFutureReturnRate ?? row?.futureReturnRate ?? row?.futureReturn) ?? 0 })).filter(item => item.action !== 0);
  const returns = values.map(item => item.value * item.action); let equity = 1; let peak = 1; let maxDrawdown = 0;
  for (const value of returns) { equity *= 1 + value; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak ? (peak - equity) / peak : 0); }
  return { return: returns.reduce((a, b) => a + b, 0), winRate: returns.length ? returns.filter(v => v > 0).length / returns.length : null, tradeCount: returns.length, maxDrawdown };
}
export const AlwaysWaitBaseline = () => 0;
export const AlternatingBaseline = (_, index) => index % 2 ? 1 : -1;
export function SeededRandomBaseline(seed = 1) { let state = Number(seed) >>> 0; return () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296 >= .5 ? 1 : -1; }; }

export function buildRLDatasetQualityReport(dataset = [], { smartTAction = () => 0 } = {}) {
  const audit = auditRLDataset(dataset);
  return { ...audit, baselines: { alwaysWait: evaluateBaseline(dataset, AlwaysWaitBaseline), alternating: evaluateBaseline(dataset, AlternatingBaseline), seededRandom: evaluateBaseline(dataset, SeededRandomBaseline(1)), smartT: evaluateBaseline(dataset, smartTAction) }, trainingPerformed: false, executable: false };
}
