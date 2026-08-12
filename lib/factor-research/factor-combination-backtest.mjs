import { trainingExecutionPrice, trainingOrderFee } from "../personal-replay-training.mjs";
import { auditFutureInvariance, FactorEngine } from "./factor-engine.mjs";
import { assertDisjointTimeSplits, buildTimeSplits } from "./factor-backtest-engine.mjs";
import { evaluateFactorSamples } from "./factor-evaluation.mjs";

export const FACTOR_COMBINATION_BACKTEST_VERSION = "1.1.0";

export const DEFAULT_COMPOSITE_CONFIG = Object.freeze({
  horizons: Object.freeze([5, 10, 15, 30]),
  quantity: 1600,
  feeRate: 0.025,
  minCommission: true,
  slippage: 0.02,
  slippageMode: "percent",
  sampleInterval: 1,
  thresholdQuantile: 0.75,
  normalizationClip: 3,
  minimumPriceMove: 0.08,
  costCoverageMultiple: 2,
  atrMfeQuantile: 0.35,
  cooldownMinutes: 20,
  maximumSignalsPerDay: 2,
  avoidOpeningMinutes: 15,
  avoidClosingMinutes: 10,
  splitRatios: Object.freeze({ train: 0.60, validation: 0.20, test: 0.20 }),
  rolling: Object.freeze({ minimumTrainDays: 60, testDays: 20, stepDays: 20 }),
});

const recipe = (recipeId, name, direction, description, components) => Object.freeze({
  recipeId,
  name,
  direction,
  description,
  version: FACTOR_COMBINATION_BACKTEST_VERSION,
  status: "research",
  components: Object.freeze(components.map(component => Object.freeze(component))),
});

export const DEFAULT_COMPOSITE_RECIPES = Object.freeze([
  recipe(
    "positiveT.pullback_recovery",
    "Positive T Pullback Recovery",
    "positiveT",
    "VWAP pullback with momentum, lower-shadow and order-flow recovery confirmations.",
    [
      { factorId: "vwap.mean_reversion", weight: 0.24, sign: 1 },
      { factorId: "technical.macd_histogram_delta", weight: 0.17, sign: 1 },
      { factorId: "intraday.lower_shadow", weight: 0.13, sign: 1 },
      { factorId: "volume.price_alignment_5m", weight: 0.12, sign: 1 },
      { factorId: "orderflow.active_buy_imbalance", weight: 0.17, sign: 1 },
      { factorId: "orderflow.ofi_change_3m", weight: 0.17, sign: 1 },
    ],
  ),
  recipe(
    "positiveT.vwap_reclaim",
    "Positive T VWAP Reclaim",
    "positiveT",
    "VWAP reclaim supported by trend persistence, volume alignment and L2 buy pressure.",
    [
      { factorId: "vwap.cross", weight: 0.16, sign: 1 },
      { factorId: "vwap.slope_5m", weight: 0.18, sign: 1 },
      { factorId: "vwap.persistence_5m", weight: 0.16, sign: 1 },
      { factorId: "technical.macd_histogram_delta", weight: 0.16, sign: 1 },
      { factorId: "volume.price_alignment_5m", weight: 0.14, sign: 1 },
      { factorId: "orderflow.active_buy_imbalance", weight: 0.20, sign: 1 },
    ],
  ),
  recipe(
    "reverseT.high_exhaustion",
    "Reverse T High Exhaustion",
    "reverseT",
    "Positive VWAP extension with upper-shadow, momentum decay and sell-flow confirmations.",
    [
      { factorId: "vwap.bias", weight: 0.24, sign: 1 },
      { factorId: "technical.macd_histogram_delta", weight: 0.17, sign: -1 },
      { factorId: "intraday.upper_shadow", weight: 0.13, sign: 1 },
      { factorId: "volume.price_alignment_5m", weight: 0.12, sign: -1 },
      { factorId: "orderflow.active_buy_imbalance", weight: 0.17, sign: -1 },
      { factorId: "orderflow.ofi_change_3m", weight: 0.17, sign: -1 },
    ],
  ),
  recipe(
    "reverseT.failed_breakout",
    "Reverse T Failed Breakout",
    "reverseT",
    "Stretched intraday location with a failed high and deteriorating L2 response.",
    [
      { factorId: "price.intraday_position", weight: 0.18, sign: 1 },
      { factorId: "vwap.bias", weight: 0.22, sign: 1 },
      { factorId: "intraday.pullback_10m_high", weight: 0.15, sign: -1 },
      { factorId: "technical.macd_histogram_delta", weight: 0.14, sign: -1 },
      { factorId: "orderflow.ofi_change_3m", weight: 0.16, sign: -1 },
      { factorId: "orderflow.book_depth_imbalance", weight: 0.15, sign: -1 },
    ],
  ),
]);

const round = (value, digits = 8) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function quantile(values, probability) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * Math.max(0, Math.min(1, probability));
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] === undefined
    ? sorted[base]
    : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function standardDeviation(values) {
  const average = mean(values);
  if (average === null || values.length < 2) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

function tradingMinuteOrdinal(time) {
  const normalized = String(time ?? "").replaceAll(":", "").slice(0, 4);
  const hour = Number(normalized.slice(0, 2));
  const minute = Number(normalized.slice(2, 4));
  const total = hour * 60 + minute;
  if (total >= 570 && total <= 690) return total - 570;
  if (total >= 780 && total <= 900) return 120 + total - 780;
  return null;
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
  const entryFee = trainingOrderFee({
    side: entrySide,
    price: entryPrice,
    quantity: config.quantity,
    feeRate: config.feeRate,
    minCommission: config.minCommission,
  });
  const exitFee = trainingOrderFee({
    side: exitSide,
    price: exitPrice,
    quantity: config.quantity,
    feeRate: config.feeRate,
    minCommission: config.minCommission,
  });
  const referenceNotional = startPrice * config.quantity;
  const grossPnl = direction === "positiveT"
    ? (exitPrice - entryPrice) * config.quantity
    : (entryPrice - exitPrice) * config.quantity;
  const fees = entryFee + exitFee;
  return {
    entryPrice,
    exitPrice,
    fees,
    grossReturn: referenceNotional > 0 ? grossPnl / referenceNotional : null,
    netReturn: referenceNotional > 0 ? (grossPnl - fees) / referenceNotional : null,
  };
}

function modeledRoundTripCostReturn({ direction, price, config }) {
  const flat = executionOutcome({ direction, startPrice: price, futurePrice: price, config });
  return flat?.netReturn < 0 ? -flat.netReturn : null;
}

function buildCompositeSamples(computedSessions, currentRecipe, horizon, config) {
  const samples = [];
  for (const computed of computedSessions) {
    const minutes = computed.session.minutes;
    for (const row of computed.rows) {
      if (row.index % config.sampleInterval !== 0 || row.index + horizon >= minutes.length) continue;
      const future = minutes[row.index + horizon];
      const futureWindow = minutes.slice(row.index + 1, row.index + horizon + 1);
      const rawReturn = future.price / row.price - 1;
      const directionalReturn = currentRecipe.direction === "positiveT" ? rawReturn : -rawReturn;
      const favorablePrice = currentRecipe.direction === "positiveT"
        ? Math.max(...futureWindow.map(point => point.high ?? point.price))
        : Math.min(...futureWindow.map(point => point.low ?? point.price));
      const maximumFavorableReturn = currentRecipe.direction === "positiveT"
        ? favorablePrice / row.price - 1
        : row.price / favorablePrice - 1;
      const outcome = executionOutcome({
        direction: currentRecipe.direction,
        startPrice: row.price,
        futurePrice: future.price,
        config,
      });
      if (!outcome) continue;
      samples.push({
        date: row.date,
        time: row.time,
        index: row.index,
        price: row.price,
        marketRegime: row.marketRegime ?? "unknown",
        factorValues: Object.fromEntries(currentRecipe.components.map(component => [
          component.factorId,
          row.factors[component.factorId],
        ])),
        atrRate: row.factors["volatility.atr14"],
        directionalReturn,
        maximumFavorableReturn,
        ...outcome,
      });
    }
  }
  return samples;
}

function fitScaler(values) {
  const clean = values.filter(Number.isFinite);
  const center = quantile(clean, 0.5);
  const interquartileRange = (quantile(clean, 0.75) ?? 0) - (quantile(clean, 0.25) ?? 0);
  const fallbackDeviation = standardDeviation(clean) ?? 0;
  const scale = interquartileRange > 0 ? interquartileRange / 1.349 : fallbackDeviation;
  return { center: round(center), scale: round(scale > 0 ? scale : 1), samples: clean.length };
}

export function scoreCompositeSample(sample, currentRecipe, model, config = DEFAULT_COMPOSITE_CONFIG) {
  let weighted = 0;
  let totalWeight = 0;
  for (const component of currentRecipe.components) {
    const value = sample.factorValues?.[component.factorId];
    const scaler = model.scalers?.[component.factorId];
    if (!Number.isFinite(value) || !scaler || !Number.isFinite(scaler.center) || !Number.isFinite(scaler.scale)) return null;
    const normalized = Math.max(
      -config.normalizationClip,
      Math.min(config.normalizationClip, (value - scaler.center) / scaler.scale),
    );
    weighted += normalized * component.sign * component.weight;
    totalWeight += Math.abs(component.weight);
  }
  return totalWeight > 0 ? weighted / totalWeight : null;
}

function isAllowedTime(sample, horizon, config) {
  const ordinal = tradingMinuteOrdinal(sample.time);
  if (!Number.isFinite(ordinal)) return false;
  return ordinal >= config.avoidOpeningMinutes && ordinal + horizon <= 240 - config.avoidClosingMinutes;
}

export function fitCompositeModel(trainingSamples, currentRecipe, config = DEFAULT_COMPOSITE_CONFIG) {
  const horizonMinutes = config.horizonMinutes ?? config.horizons?.[0] ?? DEFAULT_COMPOSITE_CONFIG.horizons[0];
  const scalers = Object.fromEntries(currentRecipe.components.map(component => [
    component.factorId,
    fitScaler(trainingSamples.map(sample => sample.factorValues?.[component.factorId])),
  ]));
  const provisional = { scalers };
  const scored = trainingSamples
    .map(sample => ({ ...sample, factorValue: scoreCompositeSample(sample, currentRecipe, provisional, config) }))
    .filter(sample => Number.isFinite(sample.factorValue) && isAllowedTime(sample, horizonMinutes, config));
  const scoreThreshold = quantile(scored.map(sample => sample.factorValue), config.thresholdQuantile);
  const candidate = scored.filter(sample => sample.factorValue >= scoreThreshold);
  const atrRatios = candidate
    .map(sample => Number.isFinite(sample.atrRate) && sample.atrRate > 0
      ? Math.max(0, sample.maximumFavorableReturn) / sample.atrRate
      : null)
    .filter(Number.isFinite);
  const atrMfeMultiplier = quantile(atrRatios, config.atrMfeQuantile);
  return Object.freeze({
    recipeId: currentRecipe.recipeId,
    recipeVersion: currentRecipe.version,
    direction: currentRecipe.direction,
    fittedOn: "train-only",
    trainingSamples: trainingSamples.length,
    scorableTrainingSamples: scored.length,
    trainingCandidates: candidate.length,
    scoreThreshold: round(scoreThreshold),
    thresholdQuantile: config.thresholdQuantile,
    atrMfeMultiplier: round(atrMfeMultiplier),
    atrMfeQuantile: config.atrMfeQuantile,
    scalers: Object.freeze(scalers),
  });
}

function requiredCoverageReturn(sample, currentRecipe, config) {
  const costReturn = modeledRoundTripCostReturn({ direction: currentRecipe.direction, price: sample.price, config });
  const fixedMoveReturn = config.minimumPriceMove / sample.price;
  return {
    modeledCostReturn: costReturn,
    requiredReturn: Number.isFinite(costReturn)
      ? Math.max(fixedMoveReturn, costReturn * config.costCoverageMultiple)
      : null,
  };
}

function emptyRejections() {
  return {
    missingFactors: 0,
    timeWindow: 0,
    belowScore: 0,
    costCoverage: 0,
    overlappingTrade: 0,
    cooldown: 0,
    dailyCap: 0,
  };
}

export function applyCompositeSignalGates(samples, currentRecipe, model, options = {}) {
  const config = { ...DEFAULT_COMPOSITE_CONFIG, ...options };
  const horizon = config.horizonMinutes ?? config.horizons?.[0] ?? DEFAULT_COMPOSITE_CONFIG.horizons[0];
  const rejectionReasons = emptyRejections();
  const scorableSamples = [];
  const baselineTrades = [];
  const filteredTrades = [];
  const dailyState = new Map();
  const ordered = [...samples].sort((left, right) => left.date.localeCompare(right.date) || left.index - right.index);

  for (const original of ordered) {
    const factorValue = scoreCompositeSample(original, currentRecipe, model, config);
    if (!Number.isFinite(factorValue)) {
      rejectionReasons.missingFactors += 1;
      continue;
    }
    const sample = { ...original, factorValue };
    scorableSamples.push(sample);
    if (!isAllowedTime(sample, horizon, config)) {
      rejectionReasons.timeWindow += 1;
      continue;
    }
    if (!Number.isFinite(model.scoreThreshold) || factorValue < model.scoreThreshold) {
      rejectionReasons.belowScore += 1;
      continue;
    }
    baselineTrades.push(sample);

    const coverage = requiredCoverageReturn(sample, currentRecipe, config);
    const expectedFavorableReturn = Number.isFinite(sample.atrRate) && Number.isFinite(model.atrMfeMultiplier)
      ? sample.atrRate * model.atrMfeMultiplier
      : null;
    if (!Number.isFinite(expectedFavorableReturn)
      || !Number.isFinite(coverage.requiredReturn)
      || expectedFavorableReturn < coverage.requiredReturn) {
      rejectionReasons.costCoverage += 1;
      continue;
    }

    const state = dailyState.get(sample.date) ?? { count: 0, lastIndex: null, activeUntil: null };
    if (Number.isFinite(state.activeUntil) && sample.index < state.activeUntil) {
      rejectionReasons.overlappingTrade += 1;
      continue;
    }
    if (Number.isFinite(state.lastIndex) && sample.index - state.lastIndex < config.cooldownMinutes) {
      rejectionReasons.cooldown += 1;
      continue;
    }
    if (state.count >= config.maximumSignalsPerDay) {
      rejectionReasons.dailyCap += 1;
      continue;
    }

    const selected = {
      ...sample,
      expectedFavorableReturn: round(expectedFavorableReturn),
      modeledCostReturn: round(coverage.modeledCostReturn),
      requiredCoverageReturn: round(coverage.requiredReturn),
    };
    filteredTrades.push(selected);
    dailyState.set(sample.date, {
      count: state.count + 1,
      lastIndex: sample.index,
      activeUntil: sample.index + horizon,
    });
  }

  return {
    scorableSamples,
    baselineTrades,
    filteredTrades,
    signalFlow: {
      inputSamples: samples.length,
      scorableSamples: scorableSamples.length,
      baselineSignals: baselineTrades.length,
      costEligibleSignals: baselineTrades.length - rejectionReasons.costCoverage,
      finalSignals: filteredTrades.length,
      reductionRate: baselineTrades.length
        ? round(1 - filteredTrades.length / baselineTrades.length)
        : null,
      rejectionReasons,
    },
  };
}

function compactMetrics(trades) {
  const values = trades.map(trade => trade.netReturn).filter(Number.isFinite);
  const gains = values.filter(value => value > 0);
  const losses = values.filter(value => value < 0);
  const grossProfit = gains.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  return {
    trades: values.length,
    winRate: values.length ? round(gains.length / values.length) : null,
    averageNetReturn: values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
    netReturnSum: round(values.reduce((sum, value) => sum + value, 0)),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
  };
}

function evaluateGatedSamples(samples, currentRecipe, model, config) {
  const gated = applyCompositeSignalGates(samples, currentRecipe, model, config);
  return {
    baseline: evaluateFactorSamples({
      samples: gated.scorableSamples,
      trades: gated.baselineTrades,
      orientation: 1,
      threshold: model.scoreThreshold,
    }),
    filtered: evaluateFactorSamples({
      samples: gated.scorableSamples,
      trades: gated.filteredTrades,
      orientation: 1,
      threshold: model.scoreThreshold,
    }),
    signalFlow: gated.signalFlow,
  };
}

function sensitivityReport(training, testing, currentRecipe, baseModel, config) {
  return [0.70, 0.75, 0.80].map(thresholdQuantile => {
    const scores = training
      .map(sample => scoreCompositeSample(sample, currentRecipe, baseModel, config))
      .filter(Number.isFinite);
    const model = { ...baseModel, scoreThreshold: quantile(scores, thresholdQuantile), thresholdQuantile };
    const gated = applyCompositeSignalGates(testing, currentRecipe, model, config);
    return { thresholdQuantile, threshold: round(model.scoreThreshold), ...compactMetrics(gated.filteredTrades) };
  });
}

function rollingOutOfSample(samples, dates, currentRecipe, config) {
  const output = [];
  const { minimumTrainDays, testDays, stepDays } = config.rolling;
  for (let trainEnd = minimumTrainDays; trainEnd < dates.length; trainEnd += stepDays) {
    const testEnd = Math.min(dates.length, trainEnd + testDays);
    const trainDateSet = new Set(dates.slice(0, trainEnd));
    const testDateSet = new Set(dates.slice(trainEnd, testEnd));
    const training = samples.filter(sample => trainDateSet.has(sample.date));
    const testing = samples.filter(sample => testDateSet.has(sample.date));
    const model = fitCompositeModel(training, currentRecipe, config);
    const gated = applyCompositeSignalGates(testing, currentRecipe, model, config);
    output.push({
      trainThrough: dates[trainEnd - 1],
      testStart: dates[trainEnd],
      testEnd: dates[testEnd - 1],
      scoreThreshold: model.scoreThreshold,
      atrMfeMultiplier: model.atrMfeMultiplier,
      signalFlow: gated.signalFlow,
      ...compactMetrics(gated.filteredTrades),
    });
  }
  return output;
}

function mergeConfig(options, horizonMinutes) {
  return {
    ...DEFAULT_COMPOSITE_CONFIG,
    ...options,
    horizonMinutes,
    splitRatios: { ...DEFAULT_COMPOSITE_CONFIG.splitRatios, ...(options.splitRatios ?? {}) },
    rolling: { ...DEFAULT_COMPOSITE_CONFIG.rolling, ...(options.rolling ?? {}) },
  };
}

export class FactorCombinationBacktestEngine {
  constructor({ factorEngine = new FactorEngine(), recipes = DEFAULT_COMPOSITE_RECIPES } = {}) {
    this.factorEngine = factorEngine;
    this.recipes = recipes;
    this.engineVersion = FACTOR_COMBINATION_BACKTEST_VERSION;
  }

  run(sessions, options = {}) {
    const selectedRecipes = options.recipeIds
      ? this.recipes.filter(item => options.recipeIds.includes(item.recipeId))
      : this.recipes;
    const factorIds = [...new Set(selectedRecipes.flatMap(item => item.components.map(component => component.factorId))
      .concat("volatility.atr14"))];
    const orderedSessions = [...(Array.isArray(sessions) ? sessions : [])]
      .sort((left, right) => String(left?.date ?? "").localeCompare(String(right?.date ?? "")));
    const computedSessions = this.factorEngine.computeSessions(orderedSessions, { factorIds });
    const dates = [...new Set(computedSessions.map(computed => computed.session.date).filter(Boolean))].sort();
    const baseConfig = mergeConfig(options, options.horizons?.[0] ?? DEFAULT_COMPOSITE_CONFIG.horizons[0]);
    const splits = buildTimeSplits(dates, baseConfig.splitRatios);
    assertDisjointTimeSplits(splits);
    const trainDates = new Set(splits.train);
    const validationDates = new Set(splits.validation);
    const testDates = new Set(splits.test);
    const reports = [];

    for (const currentRecipe of selectedRecipes) {
      for (const horizon of options.horizons ?? DEFAULT_COMPOSITE_CONFIG.horizons) {
        const config = mergeConfig(options, horizon);
        const samples = buildCompositeSamples(computedSessions, currentRecipe, horizon, config);
        const training = samples.filter(sample => trainDates.has(sample.date));
        const validation = samples.filter(sample => validationDates.has(sample.date));
        const testing = samples.filter(sample => testDates.has(sample.date));
        const model = fitCompositeModel(training, currentRecipe, config);
        const validationResult = evaluateGatedSamples(validation, currentRecipe, model, config);
        const testResult = evaluateGatedSamples(testing, currentRecipe, model, config);
        testResult.filtered.parameterStability = sensitivityReport(training, testing, currentRecipe, model, config);
        testResult.filtered.rollingOutOfSample = rollingOutOfSample(samples, dates, currentRecipe, config);
        reports.push({
          recipeId: currentRecipe.recipeId,
          recipeVersion: currentRecipe.version,
          direction: currentRecipe.direction,
          horizonMinutes: horizon,
          components: currentRecipe.components,
          splitSamples: { train: training.length, validation: validation.length, test: testing.length },
          model,
          validation: validationResult,
          test: testResult,
        });
      }
    }

    return {
      mode: "offline-factor-combination-research",
      affectsShadowV2: false,
      affectsSmartT: false,
      canPromoteAutomatically: false,
      engineVersion: this.engineVersion,
      config: baseConfig,
      recipes: selectedRecipes,
      coverage: {
        sessions: computedSessions.length,
        firstDate: dates[0] ?? null,
        lastDate: dates.at(-1) ?? null,
        recipes: selectedRecipes.length,
        reports: reports.length,
      },
      timeSplits: splits,
      antiOverfitting: {
        timeOrderedSplit: true,
        disjointSplitAudit: true,
        scalingFit: "train-only",
        scoreThresholdFit: "train-only",
        expectedMoveCalibration: "train-only",
        validationRefit: false,
        testRefit: false,
        rollingOutOfSample: true,
        missingInputs: "null-not-zero-filled",
        futureLeakageAudit: orderedSessions.length
          ? auditFutureInvariance(orderedSessions[0], { factorIds })
          : { pass: true, checkpoints: [], factors: factorIds.length, mismatches: [] },
      },
      reports,
    };
  }
}
