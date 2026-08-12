import path from "node:path";
import { writeImmutableJson } from "./reproducibility.mjs";

export const FACTOR_LIBRARY_VERSION = "1.0.0";
export const DEFAULT_PROMOTION_RULES = Object.freeze({
  minimumTestSamples: 100,
  minimumTrades: 30,
  minimumFactorScore: 60,
  minimumProfitFactor: 1.2,
  maximumDrawdown: 0.10,
  minimumRollingWindows: 2,
});

export function selectValidatedFactors(backtest, registry, rules = DEFAULT_PROMOTION_RULES) {
  const accepted = [];
  for (const report of backtest.reports ?? []) {
    const metrics = report.test;
    const rolling = metrics?.rollingOutOfSample ?? [];
    const pass = metrics?.sampleCount >= rules.minimumTestSamples
      && metrics?.trades >= rules.minimumTrades
      && metrics?.factorScore >= rules.minimumFactorScore
      && (metrics?.profitFactor ?? 0) >= rules.minimumProfitFactor
      && (metrics?.maximumDrawdown ?? 1) <= rules.maximumDrawdown
      && rolling.filter(window => window.trades > 0).length >= rules.minimumRollingWindows;
    if (!pass) continue;
    accepted.push({
      factor: registry.get(report.factorId, report.factorVersion),
      validation: {
        direction: report.direction,
        horizonMinutes: report.horizonMinutes,
        test: report.test,
      },
    });
  }
  return accepted;
}

export async function persistValidatedFactorLibrary({ outputDirectory, entries, metadata, rules = DEFAULT_PROMOTION_RULES }) {
  const results = [];
  for (const entry of entries) {
    const evidenceVersion = `${metadata.datasetChecksum.slice(0, 12)}-${metadata.configHash.slice(0, 12)}`;
    const fileName = `${entry.factor.factorId.replaceAll(".", "_")}__${entry.factor.version}__${entry.validation.direction}__${entry.validation.horizonMinutes}m__${evidenceVersion}.json`;
    results.push(await writeImmutableJson(path.join(outputDirectory, fileName), {
      libraryVersion: FACTOR_LIBRARY_VERSION,
      metadata,
      promotionRules: rules,
      ...entry,
    }));
  }
  return results;
}
