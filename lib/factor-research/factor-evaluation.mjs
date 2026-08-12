export const FACTOR_EVALUATION_VERSION = "1.0.0";

const finiteValues = values => values.filter(Number.isFinite);
const mean = values => {
  const clean = finiteValues(values);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
};
const standardDeviation = values => {
  const clean = finiteValues(values);
  const average = mean(clean);
  if (clean.length < 2 || average === null) return null;
  return Math.sqrt(clean.reduce((sum, value) => sum + (value - average) ** 2, 0) / clean.length);
};
const round = (value, digits = 8) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function pearsonCorrelation(left, right) {
  if (left.length !== right.length) throw new TypeError("Correlation arrays must have equal length");
  const pairs = left.map((value, index) => [value, right[index]])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length < 3) return null;
  const leftMean = mean(pairs.map(pair => pair[0]));
  const rightMean = mean(pairs.map(pair => pair[1]));
  const numerator = pairs.reduce((sum, [x, y]) => sum + (x - leftMean) * (y - rightMean), 0);
  const denominator = Math.sqrt(
    pairs.reduce((sum, [x]) => sum + (x - leftMean) ** 2, 0)
    * pairs.reduce((sum, [, y]) => sum + (y - rightMean) ** 2, 0),
  );
  return denominator > 0 ? numerator / denominator : null;
}

function rank(values) {
  const indexed = values.map((value, index) => ({ value, index })).sort((left, right) => left.value - right.value);
  const output = Array(values.length);
  for (let start = 0; start < indexed.length;) {
    let end = start + 1;
    while (end < indexed.length && indexed[end].value === indexed[start].value) end += 1;
    const averageRank = (start + end - 1) / 2 + 1;
    for (let cursor = start; cursor < end; cursor += 1) output[indexed[cursor].index] = averageRank;
    start = end;
  }
  return output;
}

export function spearmanCorrelation(left, right) {
  const pairs = left.map((value, index) => [value, right[index]])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length < 3) return null;
  return pearsonCorrelation(rank(pairs.map(pair => pair[0])), rank(pairs.map(pair => pair[1])));
}

export function maximumDrawdown(returns) {
  let equity = 1;
  let peak = 1;
  let maximum = 0;
  for (const value of finiteValues(returns)) {
    equity *= 1 + value;
    peak = Math.max(peak, equity);
    maximum = Math.max(maximum, peak > 0 ? (peak - equity) / peak : 0);
  }
  return maximum;
}

function tradeMetrics(trades) {
  const returns = trades.map(trade => trade.netReturn).filter(Number.isFinite);
  const positive = returns.filter(value => value > 0);
  const negative = returns.filter(value => value < 0);
  const grossProfit = positive.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(negative.reduce((sum, value) => sum + value, 0));
  return {
    trades: returns.length,
    winRate: returns.length ? positive.length / returns.length : null,
    averageGrossReturn: round(mean(trades.map(trade => trade.grossReturn))),
    averageNetReturn: round(mean(returns)),
    payoffRatio: positive.length && negative.length ? round(mean(positive) / Math.abs(mean(negative))) : null,
    netReturnSum: round(returns.reduce((sum, value) => sum + value, 0)),
    maximumDrawdown: round(maximumDrawdown(returns)),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
  };
}

function groupedPerformance(trades, keySelector) {
  return Object.fromEntries([...Map.groupBy(trades, keySelector)].sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([key, rows]) => [String(key ?? "unknown"), tradeMetrics(rows)]));
}

function dailyIcStability(samples, orientation) {
  const daily = [...Map.groupBy(samples, sample => sample.date)].map(([date, rows]) => ({
    date,
    ic: pearsonCorrelation(rows.map(row => row.factorValue * orientation), rows.map(row => row.directionalReturn)),
  })).filter(row => row.ic !== null);
  const values = daily.map(row => row.ic);
  const average = mean(values);
  const deviation = standardDeviation(values);
  return {
    days: daily.length,
    mean: round(average),
    standardDeviation: round(deviation),
    informationRatio: average !== null && deviation > 0 ? round(average / deviation) : null,
    positiveDayRatio: values.length ? round(values.filter(value => value > 0).length / values.length) : null,
  };
}

export function calculateFactorScore({ sampleCount, orientedIc, icStability, metrics }) {
  const score = 100 * (
    0.22 * clamp01(Math.abs(orientedIc ?? 0) / 0.08)
    + 0.13 * clamp01((icStability?.positiveDayRatio ?? 0.5) - 0.4)
    + 0.15 * clamp01(((metrics.winRate ?? 0.5) - 0.45) / 0.20)
    + 0.12 * clamp01((metrics.averageNetReturn ?? 0) / 0.002)
    + 0.16 * clamp01(((metrics.profitFactor ?? 1) - 1) / 1)
    + 0.10 * clamp01(1 - (metrics.maximumDrawdown ?? 1) / 0.10)
    + 0.12 * clamp01(sampleCount / 500)
  );
  return round(score, 2);
}

export function evaluateFactorSamples({
  samples,
  trades,
  orientation,
  threshold,
  sensitivity = [],
  rollingOutOfSample = [],
}) {
  const factorValues = samples.map(sample => sample.factorValue * orientation);
  const returns = samples.map(sample => sample.directionalReturn);
  const rawIc = pearsonCorrelation(samples.map(sample => sample.factorValue), returns);
  const orientedIc = pearsonCorrelation(factorValues, returns);
  const metrics = tradeMetrics(trades);
  const icStability = dailyIcStability(samples, orientation);
  return {
    sampleCount: samples.length,
    ic: round(rawIc),
    orientedIc: round(orientedIc),
    rankIc: round(spearmanCorrelation(factorValues, returns)),
    icStability,
    threshold: round(threshold),
    ...metrics,
    yearlyPerformance: groupedPerformance(trades, trade => String(trade.date).slice(0, 4)),
    marketRegimePerformance: groupedPerformance(trades, trade => trade.marketRegime ?? "unknown"),
    parameterStability: sensitivity,
    rollingOutOfSample,
    factorScore: calculateFactorScore({ sampleCount: samples.length, orientedIc, icStability, metrics }),
  };
}
