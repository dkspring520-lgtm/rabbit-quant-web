import { IndicatorEngine } from "./indicator-engine.mjs";

const equalValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function auditTemporal(engine, indicatorId, marketData, checkpoints = null) {
  const full = engine.calculateSeries(indicatorId, marketData);
  const selected = checkpoints ?? [Math.floor(marketData.length / 3), Math.floor(marketData.length * 2 / 3), marketData.length - 1].filter(index => index >= 0);
  const mismatches = [];
  for (const index of [...new Set(selected)]) {
    const prefix = engine.calculate(indicatorId, marketData, { asOfIndex: index });
    const fullAtIndex = full.series[index];
    if (!equalValue(prefix.value, fullAtIndex?.value)) mismatches.push({ index, prefix: prefix.value, full: fullAtIndex?.value });
  }
  return { indicatorId, pass: mismatches.length === 0, checkpoints: selected, mismatches };
}

export function auditAlignment(engine, indicatorId, marketData) {
  const result = engine.calculateSeries(indicatorId, marketData);
  const expected = marketData.map(item => String(item.timestamp ?? item.time));
  const actual = result.series.map(item => String(item.timestamp));
  const aligned = expected.length === actual.length && expected.every((value, index) => value === actual[index]);
  return { indicatorId, pass: aligned && new Set(actual).size === actual.length, expectedCount: expected.length, actualCount: actual.length, aligned };
}

export function auditWarmup(engine, indicatorId, marketData) {
  const result = engine.calculateSeries(indicatorId, marketData);
  const firstValidIndex = result.series.findIndex(item => item.metadata.valid);
  return { indicatorId, warmupBars: result.metadata.warmupBars, firstValidIndex: firstValidIndex < 0 ? null : firstValidIndex, firstValidTimestamp: firstValidIndex < 0 ? null : result.series[firstValidIndex].timestamp, nullBeforeFirstValid: firstValidIndex < 0 || result.series.slice(0, firstValidIndex).every(item => item.value === null) };
}

export function auditRegistry(registry) {
  const ids = registry.list().map(item => item.id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  const unsafe = registry.list().filter(item => item.lookahead || item.futureData || item.rlEligible).map(item => item.id);
  return { pass: duplicateIds.length === 0 && unsafe.length === 0, count: ids.length, duplicateIds, unsafe };
}
