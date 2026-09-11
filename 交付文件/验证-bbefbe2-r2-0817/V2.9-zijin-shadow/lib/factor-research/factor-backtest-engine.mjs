import { trainingExecutionPrice, trainingOrderFee } from "../personal-replay-training.mjs";
import { DEFAULT_FACTOR_REGISTRY } from "./factor-registry.mjs";
import { auditFutureInvariance, FactorEngine } from "./factor-engine.mjs";
import { evaluateFactorSamples } from "./factor-evaluation.mjs";

export const FACTOR_BACKTEST_VERSION = "1.0.0";
export const DEFAULT_HORIZONS = Object.freeze([5, 10, 15, 30]);
export const DEFAULT_BACKTEST_CONFIG = Object.freeze({
  horizons: DEFAULT_HORIZONS,
  quantity: 1600,
  feeRate: 0.025,
  minCommission: true,
  slippage: 0.02,
  slippageMode: "percent",
  sampleInterval: 5,
  thresholdQuantile: 0.70,
  splitRatios: Object.freeze({ train: 0.60, validation: 0.20, test: 0.20 }),
  rolling: Object.freeze({ minimumTrainDays: 20, testDays: 10, stepDays: 10 }),
});

const round = (value, digits = 8) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function quantile(values, probability) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * Math.max(0, Math.min(1, probability));
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] === undefined ? sorted[base] : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

export function buildTimeSplits(dates, ratios = DEFAULT_BACKTEST_CONFIG.splitRatios) {
  const ordered = [...new Set(dates)].sort();
  if (ordered.length < 3) return { train: ordered, validation: [], test: [] };
  const trainEnd = Math.max(1, Math.min(ordered.length - 2, Math.floor(ordered.length * ratios.train)));
  const validationEnd = Math.max(trainEnd + 1, Math.min(ordered.length - 1, Math.floor(ordered.length * (ratios.train + ratios.validation))));
  return {
    train: ordered.slice(0, trainEnd),
    validation: ordered.slice(trainEnd, validationEnd),
    test: ordered.slice(validationEnd),
  };
}

export function assertDisjointTimeSplits(splits) {
  const memberships = new Map();
  for (const [name, dates] of Object.entries(splits)) {
    for (const date of dates) {
      if (memberships.has(date)) throw new Error(`Data leakage: ${date} appears in ${memberships.get(date)} and ${name}`);
      memberships.set(date, name);
    }
  }
  return true;
}

function orientationFor(definition, direction) {
  if (definition.direction === "higherSupportsReverseT") return direction === "reverseT" ? 1 : -1;
  return direction === "positiveT" ? 1 : -1;
}

function executionOutcome({ direction, startPrice, futurePrice, config }) {
  const entrySide = direction === "positiveT" ? "buy" : "sell";
  const exitSide = direction === "positiveT" ? "sell" : "buy";
  const entryPrice = trainingExecutionPrice({
    side: entrySide,
    marketPrice: startPrice,
    slippage: config.slippage,
    slippageMode: config.slippageMode,
  });
  const exitPrice = trainingExecutionPrice({
    side: exitSide,
    marketPrice: futurePrice,
    slippage: config.slippage,
    slippageMode: config.slippageMode,
  });
  if (!entryPrice || !exitPrice) return null;
  const entryFee = trainingOrderFee({ side: entrySide, price: entryPrice, quantity: config.quantity, feeRate: config.feeRate, minCommission: config.minCommission });
  const exitFee = trainingOrderFee({ side: exitSide, price: exitPrice, quantity: config.quantity, feeRate: config.feeRate, minCommission: config.minCommission });
  const referenceNotional = startPrice * config.quantity;
  const grossPnl = direction === "positiveT"
    ? (exitPrice - entryPrice) * config.quantity
    : (entryPrice - exitPrice) * config.quantity;
  const netPnl = grossPnl - entryFee - exitFee;
  return {
    entryPrice,
    exitPrice,
    fees: entryFee + exitFee,
    grossReturn: referenceNotional > 0 ? grossPnl / referenceNotional : null,
    netReturn: referenceNotional > 0 ? netPnl / referenceNotional : null,
  };
}

function buildSamples(computedSessions, factorId, horizon, direction, config) {
  const samples = [];
  for (const computed of computedSessions) {
    const minutes = computed.session.minutes;
    for (const row of computed.rows) {
      if (row.index % config.sampleInterval !== 0 || row.index + horizon >= minutes.length) continue;
      const factorValue = row.factors[factorId];
      if (!Number.isFinite(factorValue)) continue;
      const futurePrice = minutes[row.index + horizon].price;
      const rawReturn = futurePrice / row.price - 1;
      const directionalReturn = direction === "positiveT" ? rawReturn : -rawReturn;
      const outcome = executionOutcome({ direction, startPrice: row.price, futurePrice, config });
      if (!outcome) continue;
      samples.push({
        date: row.date,
        time: row.time,
        factorValue,
        directionalReturn,
        marketRegime: row.marketRegime ?? "unknown",
        ...outcome,
      });
    }
  }
  return samples;
}

function selectedTrades(samples, orientation, threshold) {
  if (!Number.isFinite(threshold)) return [];
  return samples.filter(sample => sample.factorValue * orientation >= threshold);
}

function sensitivityReport(trainSamples, testSamples, orientation, probabilities) {
  return probabilities.map(probability => {
    const threshold = quantile(trainSamples.map(sample => sample.factorValue * orientation), probability);
    const trades = selectedTrades(testSamples, orientation, threshold);
    const wins = trades.filter(trade => trade.netReturn > 0).length;
    const gains = trades.filter(trade => trade.netReturn > 0).reduce((sum, trade) => sum + trade.netReturn, 0);
    const losses = Math.abs(trades.filter(trade => trade.netReturn < 0).reduce((sum, trade) => sum + trade.netReturn, 0));
    return {
      thresholdQuantile: probability,
      threshold: round(threshold),
      trades: trades.length,
      winRate: trades.length ? round(wins / trades.length) : null,
      averageNetReturn: trades.length ? round(trades.reduce((sum, trade) => sum + trade.netReturn, 0) / trades.length) : null,
      profitFactor: losses > 0 ? round(gains / losses) : gains > 0 ? null : 0,
    };
  });
}

function rollingOutOfSample(samples, dates, orientation, config) {
  const output = [];
  const { minimumTrainDays, testDays, stepDays } = config.rolling;
  for (let trainEnd = minimumTrainDays; trainEnd < dates.length; trainEnd += stepDays) {
    const testEnd = Math.min(dates.length, trainEnd + testDays);
    const trainDates = new Set(dates.slice(0, trainEnd));
    const testDates = new Set(dates.slice(trainEnd, testEnd));
    const training = samples.filter(sample => trainDates.has(sample.date));
    const testing = samples.filter(sample => testDates.has(sample.date));
    const threshold = quantile(training.map(sample => sample.factorValue * orientation), config.thresholdQuantile);
    const trades = selectedTrades(testing, orientation, threshold);
    output.push({
      trainThrough: dates[trainEnd - 1],
      testStart: dates[trainEnd],
      testEnd: dates[testEnd - 1],
      threshold: round(threshold),
      samples: testing.length,
      trades: trades.length,
      winRate: trades.length ? round(trades.filter(trade => trade.netReturn > 0).length / trades.length) : null,
      averageNetReturn: trades.length ? round(trades.reduce((sum, trade) => sum + trade.netReturn, 0) / trades.length) : null,
    });
  }
  return output;
}

export class FactorBacktestEngine {
  constructor({ factorEngine = new FactorEngine(), registry = DEFAULT_FACTOR_REGISTRY } = {}) {
    this.factorEngine = factorEngine;
    this.registry = registry;
    this.engineVersion = FACTOR_BACKTEST_VERSION;
  }

  run(sessions, options = {}) {
    const config = {
      ...DEFAULT_BACKTEST_CONFIG,
      ...options,
      splitRatios: { ...DEFAULT_BACKTEST_CONFIG.splitRatios, ...(options.splitRatios ?? {}) },
      rolling: { ...DEFAULT_BACKTEST_CONFIG.rolling, ...(options.rolling ?? {}) },
    };
    const factorIds = options.factorIds ?? this.registry.list().map(definition => definition.factorId);
    const orderedSessions = [...(Array.isArray(sessions) ? sessions : [])]
      .sort((left, right) => String(left?.date ?? "").localeCompare(String(right?.date ?? "")));
    const computedSessions = this.factorEngine.computeSessions(orderedSessions, { factorIds });
    const dates = [...new Set(computedSessions.map(computed => computed.session.date).filter(Boolean))].sort();
    const splits = buildTimeSplits(dates, config.splitRatios);
    assertDisjointTimeSplits(splits);
    const trainDates = new Set(splits.train);
    const validationDates = new Set(splits.validation);
    const testDates = new Set(splits.test);
    const reports = [];

    for (const factorId of factorIds) {
      const definition = this.registry.get(factorId);
      if (!definition) throw new Error(`Unknown factor ${factorId}`);
      for (const horizon of config.horizons) {
        for (const direction of ["positiveT", "reverseT"]) {
          const orientation = orientationFor(definition, direction);
          const samples = buildSamples(computedSessions, factorId, horizon, direction, config);
          const training = samples.filter(sample => trainDates.has(sample.date));
          const validation = samples.filter(sample => validationDates.has(sample.date));
          const testing = samples.filter(sample => testDates.has(sample.date));
          const threshold = quantile(training.map(sample => sample.factorValue * orientation), config.thresholdQuantile);
          const testTrades = selectedTrades(testing, orientation, threshold);
          reports.push({
            factorId,
            factorVersion: definition.version,
            category: definition.category,
            direction,
            horizonMinutes: horizon,
            orientation,
            splitSamples: { train: training.length, validation: validation.length, test: testing.length },
            validation: evaluateFactorSamples({
              samples: validation,
              trades: selectedTrades(validation, orientation, threshold),
              orientation,
              threshold,
            }),
            test: evaluateFactorSamples({
              samples: testing,
              trades: testTrades,
              orientation,
              threshold,
              sensitivity: sensitivityReport(training, testing, orientation, [0.65, 0.70, 0.75]),
              rollingOutOfSample: rollingOutOfSample(samples, dates, orientation, config),
            }),
          });
        }
      }
    }

    return {
      mode: "offline-factor-research",
      affectsShadowV2: false,
      affectsSmartT: false,
      engineVersion: this.engineVersion,
      config,
      coverage: {
        sessions: computedSessions.length,
        firstDate: dates[0] ?? null,
        lastDate: dates.at(-1) ?? null,
        factors: factorIds.length,
        reports: reports.length,
      },
      timeSplits: splits,
      antiOverfitting: {
        timeOrderedSplit: true,
        disjointSplitAudit: true,
        thresholdFit: "train-only",
        rollingOutOfSample: true,
        parameterSensitivityQuantiles: [0.65, 0.70, 0.75],
        futureLeakageAudit: orderedSessions.length
          ? auditFutureInvariance(orderedSessions[0], { factorIds })
          : { pass: true, checkpoints: [], factors: factorIds.length, mismatches: [] },
        labelFieldsAllowedAsFactorInputs: false,
      },
      reports,
    };
  }
}
