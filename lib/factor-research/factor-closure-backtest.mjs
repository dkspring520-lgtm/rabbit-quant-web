import { createHash } from "node:crypto";
import { trainingExecutionPrice, trainingOrderFee } from "../personal-replay-training.mjs";
import { assertDisjointTimeSplits, buildTimeSplits } from "./factor-backtest-engine.mjs";
import {
  applyCompositeSignalGates,
  DEFAULT_COMPOSITE_CONFIG,
  DEFAULT_COMPOSITE_RECIPES,
  fitCompositeModel,
} from "./factor-combination-backtest.mjs";
import { auditFutureInvariance, FactorEngine } from "./factor-engine.mjs";
import { maximumDrawdown } from "./factor-evaluation.mjs";

export const FACTOR_CLOSURE_BACKTEST_VERSION = "1.1.0";

export const DEFAULT_CLOSURE_CONFIG = Object.freeze({
  quantity: 1600,
  feeRate: 0.025,
  minCommission: true,
  slippage: 0.02,
  slippageMode: "percent",
  minimumPriceMove: 0.08,
  costCoverageMultiple: 2,
  takeProfitAtrMultiple: 0.8,
  stopLossAtrMultiple: 0.65,
  minimumStopMove: 0.06,
  maximumHoldMinutes: Object.freeze({ positiveT: 45, reverseT: 50 }),
  pricePathMode: "auto",
  sameMinuteConflict: "stop-first",
  l2ContinuityMinutes: 5,
  sampleInterval: 1,
  thresholdQuantile: 0.75,
  normalizationClip: 3,
  atrMfeQuantile: 0.35,
  cooldownMinutes: 20,
  maximumSignalsPerDay: 2,
  avoidOpeningMinutes: 15,
  avoidClosingMinutes: 10,
  splitRatios: Object.freeze({ train: 0.60, validation: 0.20, test: 0.20 }),
  rolling: Object.freeze({ minimumTrainDays: 60, testDays: 20, stepDays: 20 }),
});

const round = (value, digits = 8) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
  ? Number(value)
  : null;

function tradingMinuteOrdinal(time) {
  const normalized = String(time ?? "").replaceAll(":", "").slice(0, 4);
  const hour = Number(normalized.slice(0, 2));
  const minute = Number(normalized.slice(2, 4));
  const total = hour * 60 + minute;
  if (total >= 570 && total <= 690) return total - 570;
  if (total >= 780 && total <= 900) return 120 + total - 780;
  return null;
}

function elapsedTradingMinutes(start, end, fallback) {
  const left = tradingMinuteOrdinal(start);
  const right = tradingMinuteOrdinal(end);
  return Number.isFinite(left) && Number.isFinite(right) && right >= left ? right - left : fallback;
}

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
  const grossPnl = direction === "positiveT"
    ? (exitPrice - entryPrice) * config.quantity
    : (entryPrice - exitPrice) * config.quantity;
  const fees = entryFee + exitFee;
  const referenceNotional = startPrice * config.quantity;
  return {
    entryPrice: round(entryPrice, 6),
    exitPrice: round(exitPrice, 6),
    grossPnl: round(grossPnl, 4),
    fees: round(fees, 4),
    netPnl: round(grossPnl - fees, 4),
    grossReturn: referenceNotional > 0 ? round(grossPnl / referenceNotional) : null,
    netReturn: referenceNotional > 0 ? round((grossPnl - fees) / referenceNotional) : null,
  };
}

function roundTripCostMove(direction, price, config) {
  const flat = executionOutcome({ direction, startPrice: price, futurePrice: price, config });
  return flat && config.quantity > 0 ? Math.abs(flat.netPnl) / config.quantity : null;
}

function normalizedRawSession(session) {
  return {
    date: String(session?.date ?? ""),
    minutes: [...(Array.isArray(session?.minutes) ? session.minutes : [])]
      .filter(point => /^\d{4}$/.test(String(point?.time ?? "").replaceAll(":", "").slice(0, 4)))
      .sort((left, right) => String(left.time).localeCompare(String(right.time))),
  };
}

export function auditMinuteDataSemantics(sessions) {
  let rows = 0;
  let validOhlcRows = 0;
  let adjacentPairs = 0;
  let enclosingExtremaPairs = 0;
  let repeatedSessionOpenPairs = 0;
  let timestampMismatches = 0;
  let duplicateTimestamps = 0;
  let continuityPairs = 0;
  let continuityGaps = 0;
  let scheduledBreakTransitions = 0;
  let l2Rows = 0;
  let cumulativeVolumePairs = 0;
  let volumeDeltaMismatches = 0;

  for (const original of Array.isArray(sessions) ? sessions : []) {
    const session = normalizedRawSession(original);
    const seen = new Set();
    for (let index = 0; index < session.minutes.length; index += 1) {
      const point = session.minutes[index];
      const time = String(point?.time ?? "").replaceAll(":", "").slice(0, 4);
      const open = finite(point?.open);
      const high = finite(point?.high);
      const low = finite(point?.low);
      const close = finite(point?.price ?? point?.close);
      rows += 1;
      if ([open, high, low, close].every(Number.isFinite)
        && high >= Math.max(open, close)
        && low <= Math.min(open, close)) validOhlcRows += 1;
      if (seen.has(time)) duplicateTimestamps += 1;
      seen.add(time);
      if (point?.exchangeMinute && String(point.exchangeMinute) !== `${session.date}-${time}`) timestampMismatches += 1;
      if (point?.l2Available === true || finite(point?.activeBuyVolume) !== null || Array.isArray(point?.bidPrices)) l2Rows += 1;

      const previous = session.minutes[index - 1];
      if (!previous) continue;
      adjacentPairs += 1;
      const previousHigh = finite(previous.high);
      const previousLow = finite(previous.low);
      if ([high, low, previousHigh, previousLow].every(Number.isFinite)
        && high >= previousHigh
        && low <= previousLow) enclosingExtremaPairs += 1;
      if (Number.isFinite(open) && open === finite(previous.open)) repeatedSessionOpenPairs += 1;
      const previousOrdinal = tradingMinuteOrdinal(previous.time);
      const currentOrdinal = tradingMinuteOrdinal(time);
      if (Number.isFinite(previousOrdinal) && Number.isFinite(currentOrdinal)) {
        continuityPairs += 1;
        const previousTime = String(previous.time ?? "").replaceAll(":", "").slice(0, 4);
        const crossesScheduledBreak = previousTime === "1130" && time === "1300";
        if (crossesScheduledBreak) scheduledBreakTransitions += 1;
        else if (currentOrdinal - previousOrdinal !== 1) continuityGaps += 1;
      }
      const cumulative = finite(point.cumulativeVolume);
      const previousCumulative = finite(previous.cumulativeVolume);
      const volume = finite(point.volume);
      if ([cumulative, previousCumulative, volume].every(Number.isFinite)) {
        cumulativeVolumePairs += 1;
        const delta = cumulative - previousCumulative;
        if (Math.abs(delta - volume) > Math.max(1, Math.abs(volume) * 0.001)) volumeDeltaMismatches += 1;
      }
    }
  }

  const validOhlcRatio = rows ? validOhlcRows / rows : null;
  const enclosingExtremaRatio = adjacentPairs ? enclosingExtremaPairs / adjacentPairs : null;
  const repeatedSessionOpenRatio = adjacentPairs ? repeatedSessionOpenPairs / adjacentPairs : null;
  const cumulativeExtremaDetected = (enclosingExtremaRatio ?? 0) >= 0.85
    && (repeatedSessionOpenRatio ?? 0) >= 0.80;
  const ohlcClassification = !rows
    ? "unavailable"
    : cumulativeExtremaDetected
      ? "cumulative-session-extrema"
      : (validOhlcRatio ?? 0) >= 0.98
        ? "minute-ohlc"
        : "untrusted-ohlc";

  return {
    rows,
    ohlc: {
      classification: ohlcClassification,
      safeForFirstTouch: ohlcClassification === "minute-ohlc",
      validRows: validOhlcRows,
      validRatio: round(validOhlcRatio),
      adjacentPairs,
      enclosingExtremaPairs,
      enclosingExtremaRatio: round(enclosingExtremaRatio),
      repeatedSessionOpenPairs,
      repeatedSessionOpenRatio: round(repeatedSessionOpenRatio),
    },
    timestamps: {
      exchangeMinuteMismatches: timestampMismatches,
      duplicateTimestamps,
      continuityPairs,
      continuityGaps,
      scheduledBreakTransitions,
    },
    l2: {
      availableRows: l2Rows,
      coverageRatio: rows ? round(l2Rows / rows) : null,
      alignmentPass: timestampMismatches === 0 && duplicateTimestamps === 0,
    },
    volume: {
      cumulativePairs: cumulativeVolumePairs,
      deltaMismatches: volumeDeltaMismatches,
      deltaMismatchRatio: cumulativeVolumePairs ? round(volumeDeltaMismatches / cumulativeVolumePairs) : null,
    },
  };
}

function resolvePricePathMode(requested, audit) {
  if (requested === "ohlc") {
    if (!audit.ohlc.safeForFirstTouch) {
      throw new Error(`Unsafe OHLC first-touch request: source is ${audit.ohlc.classification}`);
    }
    return "ohlc-first-touch";
  }
  if (requested === "close-only") return "close-only";
  return audit.ohlc.safeForFirstTouch ? "ohlc-first-touch" : "close-only";
}

function closeOnlyFactorSessions(sessions) {
  return sessions.map((original) => {
    const ordered = normalizedRawSession(original).minutes;
    return {
      ...original,
      minutes: ordered.map((point, index) => {
        const price = finite(point?.price ?? point?.close);
        const previousPrice = finite(ordered[index - 1]?.price ?? ordered[index - 1]?.close) ?? price;
        return {
          ...point,
          open: previousPrice,
          high: price,
          low: price,
          close: price,
          price,
        };
      }),
    };
  });
}

function pathExtrema(point, pricePathMode) {
  const price = finite(point?.price ?? point?.close);
  if (!Number.isFinite(price)) return null;
  if (pricePathMode === "ohlc-first-touch") {
    return {
      high: finite(point?.high) ?? price,
      low: finite(point?.low) ?? price,
      timeout: price,
    };
  }
  return { high: price, low: price, timeout: price };
}

function entryContext(session, entryIndex, config) {
  const entry = session.minutes[entryIndex];
  const start = Math.max(0, entryIndex - config.l2ContinuityMinutes + 1);
  const recent = session.minutes.slice(start, entryIndex + 1);
  const available = recent.filter(point => point?.l2Available === true
    || (finite(point?.activeBuyVolume) !== null && finite(point?.activeSellVolume) !== null)).length;
  const l2Continuity = !recent.length || available === 0
    ? "missing"
    : available === recent.length
      ? "continuous"
      : "partial";
  const priceNow = finite(entry?.price ?? entry?.close);
  const priceBefore = finite(recent[0]?.price ?? recent[0]?.close);
  const netFlow = recent.reduce((sum, point) => {
    const explicit = finite(point?.netActiveNotional ?? point?.bigOrderNetNotional ?? point?.bigOrderNet);
    if (explicit !== null) return sum + explicit;
    const buy = finite(point?.activeBuyNotional);
    const sell = finite(point?.activeSellNotional);
    return sum + (buy !== null && sell !== null ? buy - sell : 0);
  }, 0);
  const priceChange = Number.isFinite(priceNow) && Number.isFinite(priceBefore) ? priceNow - priceBefore : null;
  const l2PriceResponse = l2Continuity === "missing" || !Number.isFinite(priceChange) || netFlow === 0 || priceChange === 0
    ? "neutral"
    : Math.sign(netFlow) === Math.sign(priceChange)
      ? "aligned"
      : "divergent";
  return { l2Continuity, l2PriceResponse };
}

function timeBucket(time) {
  const ordinal = tradingMinuteOrdinal(time);
  if (!Number.isFinite(ordinal)) return "unknown";
  if (ordinal < 30) return "open-30m";
  if (ordinal < 120) return "morning";
  if (ordinal < 180) return "afternoon-early";
  return "afternoon-late";
}

export function simulateClosureTrade({ session, entryIndex, direction, atrRate, config = {}, pricePathMode = "ohlc-first-touch" }) {
  const merged = {
    ...DEFAULT_CLOSURE_CONFIG,
    ...config,
    maximumHoldMinutes: { ...DEFAULT_CLOSURE_CONFIG.maximumHoldMinutes, ...(config.maximumHoldMinutes ?? {}) },
  };
  const entry = session?.minutes?.[entryIndex];
  const entryMarketPrice = finite(entry?.price ?? entry?.close);
  if (!Number.isFinite(entryMarketPrice) || !["positiveT", "reverseT"].includes(direction)) return null;
  const maximumHold = merged.maximumHoldMinutes[direction];
  const modeledCostMove = roundTripCostMove(direction, entryMarketPrice, merged);
  const targetMove = Math.max(
    merged.minimumPriceMove,
    Number.isFinite(modeledCostMove) ? modeledCostMove * merged.costCoverageMultiple : 0,
    Number.isFinite(atrRate) ? entryMarketPrice * atrRate * merged.takeProfitAtrMultiple : 0,
  );
  const stopMove = Math.max(
    merged.minimumStopMove,
    Number.isFinite(atrRate) ? entryMarketPrice * atrRate * merged.stopLossAtrMultiple : 0,
  );
  const targetPrice = direction === "positiveT" ? entryMarketPrice + targetMove : entryMarketPrice - targetMove;
  const stopPrice = direction === "positiveT" ? entryMarketPrice - stopMove : entryMarketPrice + stopMove;
  let exitReason = "timeout";
  let exitMarketPrice = null;
  let exitIndex = Math.min(session.minutes.length - 1, entryIndex + maximumHold);
  let sameMinuteConflict = false;
  let maximumFavorableMove = 0;
  let maximumAdverseMove = 0;
  let timeToTarget = null;
  let timeToStop = null;

  for (let index = entryIndex + 1; index <= exitIndex; index += 1) {
    const extrema = pathExtrema(session.minutes[index], pricePathMode);
    if (!extrema) continue;
    const favorableMove = direction === "positiveT"
      ? extrema.high - entryMarketPrice
      : entryMarketPrice - extrema.low;
    const adverseMove = direction === "positiveT"
      ? entryMarketPrice - extrema.low
      : extrema.high - entryMarketPrice;
    maximumFavorableMove = Math.max(maximumFavorableMove, favorableMove);
    maximumAdverseMove = Math.max(maximumAdverseMove, adverseMove);
    const targetHit = direction === "positiveT" ? extrema.high >= targetPrice : extrema.low <= targetPrice;
    const stopHit = direction === "positiveT" ? extrema.low <= stopPrice : extrema.high >= stopPrice;
    const elapsed = elapsedTradingMinutes(entry.time, session.minutes[index].time, index - entryIndex);
    if (targetHit && timeToTarget === null) timeToTarget = elapsed;
    if (stopHit && timeToStop === null) timeToStop = elapsed;
    if (targetHit && stopHit) {
      sameMinuteConflict = true;
      exitReason = merged.sameMinuteConflict === "stop-first" ? "stopLoss" : "takeProfit";
      exitMarketPrice = exitReason === "stopLoss" ? stopPrice : targetPrice;
      exitIndex = index;
      break;
    }
    if (stopHit) {
      exitReason = "stopLoss";
      exitMarketPrice = stopPrice;
      exitIndex = index;
      break;
    }
    if (targetHit) {
      exitReason = "takeProfit";
      exitMarketPrice = targetPrice;
      exitIndex = index;
      break;
    }
  }

  const exit = session.minutes[exitIndex];
  exitMarketPrice ??= finite(exit?.price ?? exit?.close);
  if (!Number.isFinite(exitMarketPrice)) return null;
  const outcome = executionOutcome({ direction, startPrice: entryMarketPrice, futurePrice: exitMarketPrice, config: merged });
  if (!outcome) return null;
  const context = entryContext(session, entryIndex, merged);
  return {
    date: String(session.date ?? ""),
    direction,
    entryIndex,
    entryTime: String(entry.time ?? ""),
    exitIndex,
    exitTime: String(exit?.time ?? ""),
    holdingMinutes: elapsedTradingMinutes(entry.time, exit?.time, exitIndex - entryIndex),
    pricePathMode,
    exitReason,
    sameMinuteConflict,
    entryMarketPrice: round(entryMarketPrice, 6),
    exitMarketPrice: round(exitMarketPrice, 6),
    targetPrice: round(targetPrice, 6),
    stopPrice: round(stopPrice, 6),
    targetMove: round(targetMove, 6),
    stopMove: round(stopMove, 6),
    modeledRoundTripCostMove: round(modeledCostMove, 6),
    mfe: round(maximumFavorableMove / entryMarketPrice),
    mae: round(maximumAdverseMove / entryMarketPrice),
    timeToTarget,
    timeToStop,
    sessionPeriod: timeBucket(entry.time),
    marketRegime: session.marketRegime ?? "unknown",
    ...context,
    ...outcome,
  };
}

function buildRecipeSamples(computedSessions, currentRecipe, horizon, config, pricePathMode) {
  const samples = [];
  for (const computed of computedSessions) {
    const minutes = computed.session.minutes;
    for (const row of computed.rows) {
      if (row.index % config.sampleInterval !== 0 || row.index + horizon >= minutes.length) continue;
      const future = minutes[row.index + horizon];
      const window = minutes.slice(row.index + 1, row.index + horizon + 1);
      const rawReturn = future.price / row.price - 1;
      const favorablePrice = currentRecipe.direction === "positiveT"
        ? Math.max(...window.map(point => pathExtrema(point, pricePathMode)?.high ?? point.price))
        : Math.min(...window.map(point => pathExtrema(point, pricePathMode)?.low ?? point.price));
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
        vwapBias: row.factors["vwap.bias"],
        directionalReturn: currentRecipe.direction === "positiveT" ? rawReturn : -rawReturn,
        maximumFavorableReturn,
        ...outcome,
      });
    }
  }
  return samples;
}

function fitDiagnosticThresholds(trainingSamples) {
  const atrValues = trainingSamples.map(sample => sample.atrRate).filter(Number.isFinite);
  return Object.freeze({
    fittedOn: "train-only",
    atrLow: round(quantile(atrValues, 1 / 3)),
    atrHigh: round(quantile(atrValues, 2 / 3)),
  });
}

function atrBucket(value, thresholds) {
  if (!Number.isFinite(value)) return "unknown";
  if (Number.isFinite(thresholds.atrLow) && value <= thresholds.atrLow) return "low";
  if (Number.isFinite(thresholds.atrHigh) && value >= thresholds.atrHigh) return "high";
  return "middle";
}

function vwapBucket(value) {
  if (!Number.isFinite(value)) return "unknown";
  if (value > 0.0005) return "above";
  if (value < -0.0005) return "below";
  return "near";
}

function closureMetrics(trades) {
  const ordered = [...trades].sort((left, right) => left.date.localeCompare(right.date) || left.entryIndex - right.entryIndex);
  const positive = ordered.filter(trade => trade.netPnl > 0);
  const negative = ordered.filter(trade => trade.netPnl < 0);
  const grossProfit = positive.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(negative.reduce((sum, trade) => sum + trade.netPnl, 0));
  const average = (rows, selector) => rows.length ? rows.reduce((sum, row) => sum + selector(row), 0) / rows.length : null;
  return {
    trades: ordered.length,
    wins: positive.length,
    losses: negative.length,
    winRate: ordered.length ? round(positive.length / ordered.length) : null,
    grossPnl: round(ordered.reduce((sum, trade) => sum + trade.grossPnl, 0), 4),
    fees: round(ordered.reduce((sum, trade) => sum + trade.fees, 0), 4),
    netPnl: round(ordered.reduce((sum, trade) => sum + trade.netPnl, 0), 4),
    averageNetPnl: round(average(ordered, trade => trade.netPnl), 4),
    averageNetReturn: round(average(ordered, trade => trade.netReturn)),
    payoffRatio: positive.length && negative.length
      ? round(average(positive, trade => trade.netPnl) / Math.abs(average(negative, trade => trade.netPnl)))
      : null,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    maximumDrawdown: round(maximumDrawdown(ordered.map(trade => trade.netReturn))),
    averageMfe: round(average(ordered, trade => trade.mfe)),
    averageMae: round(average(ordered, trade => trade.mae)),
    averageHoldingMinutes: round(average(ordered, trade => trade.holdingMinutes), 2),
    exits: Object.fromEntries(["takeProfit", "stopLoss", "timeout"].map(reason => [
      reason,
      ordered.filter(trade => trade.exitReason === reason).length,
    ])),
    sameMinuteConflicts: ordered.filter(trade => trade.sameMinuteConflict).length,
  };
}

function lossDiagnosticMetrics(trades) {
  const losses = trades.filter(trade => trade.netPnl < 0);
  return {
    trades: trades.length,
    losses: losses.length,
    lossRate: trades.length ? round(losses.length / trades.length) : null,
    netPnl: round(trades.reduce((sum, trade) => sum + trade.netPnl, 0), 4),
    averageLoss: losses.length ? round(losses.reduce((sum, trade) => sum + trade.netPnl, 0) / losses.length, 4) : null,
    averageLossMae: losses.length ? round(losses.reduce((sum, trade) => sum + trade.mae, 0) / losses.length) : null,
  };
}

function groupDiagnostics(trades, selector) {
  return Object.fromEntries([...Map.groupBy(trades, selector)]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([key, rows]) => [String(key ?? "unknown"), lossDiagnosticMetrics(rows)]));
}

function evaluateClosures(trades) {
  return {
    metrics: closureMetrics(trades),
    lossDiagnostics: {
      direction: groupDiagnostics(trades, trade => trade.direction),
      sessionPeriod: groupDiagnostics(trades, trade => trade.sessionPeriod),
      vwapPosition: groupDiagnostics(trades, trade => trade.vwapPosition),
      atrRegime: groupDiagnostics(trades, trade => trade.atrRegime),
      l2Continuity: groupDiagnostics(trades, trade => trade.l2Continuity),
      l2PriceResponse: groupDiagnostics(trades, trade => trade.l2PriceResponse),
      marketRegime: groupDiagnostics(trades, trade => trade.marketRegime),
    },
  };
}

function lockedTestDeclaration(splits) {
  const dates = [...splits.test];
  return Object.freeze({
    locked: true,
    selectionRule: "chronological-final-split",
    startDate: dates[0] ?? null,
    endDate: dates.at(-1) ?? null,
    dateCount: dates.length,
    datesChecksum: createHash("sha256").update(JSON.stringify(dates)).digest("hex"),
    usedForFitting: false,
    optimizationAllowed: false,
  });
}

function rollingClosureOutOfSample({
  samples,
  developmentDates,
  currentRecipe,
  compositeConfig,
  config,
  simulate,
}) {
  const folds = [];
  const aggregateTrades = [];
  const { minimumTrainDays, testDays, stepDays } = config.rolling;
  for (let trainEnd = minimumTrainDays; trainEnd < developmentDates.length; trainEnd += stepDays) {
    const testEnd = Math.min(developmentDates.length, trainEnd + testDays);
    const trainDates = developmentDates.slice(0, trainEnd);
    const testDates = developmentDates.slice(trainEnd, testEnd);
    if (!testDates.length) continue;
    const trainDateSet = new Set(trainDates);
    const testDateSet = new Set(testDates);
    const training = samples.filter(sample => trainDateSet.has(sample.date));
    const testing = samples.filter(sample => testDateSet.has(sample.date));
    const model = fitCompositeModel(training, currentRecipe, compositeConfig);
    const diagnosticThresholds = fitDiagnosticThresholds(training);
    const trades = simulate(testing, model, diagnosticThresholds);
    aggregateTrades.push(...trades);
    folds.push({
      trainStart: trainDates[0] ?? null,
      trainThrough: trainDates.at(-1) ?? null,
      trainDateCount: trainDates.length,
      testStart: testDates[0] ?? null,
      testEnd: testDates.at(-1) ?? null,
      testDateCount: testDates.length,
      timeOrdered: (trainDates.at(-1) ?? "") < (testDates[0] ?? ""),
      model,
      diagnosticThresholds,
      result: evaluateClosures(trades),
    });
  }
  return {
    scope: "development-only-excludes-locked-test",
    folds,
    aggregate: evaluateClosures(aggregateTrades),
  };
}

function mergeConfig(options) {
  return {
    ...DEFAULT_CLOSURE_CONFIG,
    ...options,
    maximumHoldMinutes: {
      ...DEFAULT_CLOSURE_CONFIG.maximumHoldMinutes,
      ...(options.maximumHoldMinutes ?? {}),
    },
    splitRatios: { ...DEFAULT_CLOSURE_CONFIG.splitRatios, ...(options.splitRatios ?? {}) },
    rolling: { ...DEFAULT_CLOSURE_CONFIG.rolling, ...(options.rolling ?? {}) },
  };
}

export class FactorClosureBacktestEngine {
  constructor({ factorEngine = new FactorEngine(), recipes = DEFAULT_COMPOSITE_RECIPES } = {}) {
    this.factorEngine = factorEngine;
    this.recipes = recipes;
    this.engineVersion = FACTOR_CLOSURE_BACKTEST_VERSION;
  }

  run(sessions, options = {}) {
    const config = mergeConfig(options);
    const selectedRecipes = options.recipeIds
      ? this.recipes.filter(item => options.recipeIds.includes(item.recipeId))
      : this.recipes;
    const orderedSessions = [...(Array.isArray(sessions) ? sessions : [])]
      .sort((left, right) => String(left?.date ?? "").localeCompare(String(right?.date ?? "")));
    const dataAudit = auditMinuteDataSemantics(orderedSessions);
    const pricePathMode = resolvePricePathMode(config.pricePathMode, dataAudit);
    const factorPriceInputMode = dataAudit.ohlc.safeForFirstTouch
      ? "minute-ohlc"
      : "close-change-proxy";
    const researchSessions = factorPriceInputMode === "minute-ohlc"
      ? orderedSessions
      : closeOnlyFactorSessions(orderedSessions);
    const factorIds = [...new Set(selectedRecipes.flatMap(item => item.components.map(component => component.factorId))
      .concat(["volatility.atr14", "vwap.bias"]))];
    const computedSessions = this.factorEngine.computeSessions(researchSessions, { factorIds });
    const computedByDate = new Map(computedSessions.map(computed => [computed.session.date, computed]));
    const dates = [...computedByDate.keys()].filter(Boolean).sort();
    const splits = buildTimeSplits(dates, config.splitRatios);
    assertDisjointTimeSplits(splits);
    const trainDates = new Set(splits.train);
    const validationDates = new Set(splits.validation);
    const testDates = new Set(splits.test);
    const developmentDates = [...splits.train, ...splits.validation];
    const reports = [];

    for (const currentRecipe of selectedRecipes) {
      const horizon = config.maximumHoldMinutes[currentRecipe.direction];
      const samples = buildRecipeSamples(computedSessions, currentRecipe, horizon, config, pricePathMode);
      const training = samples.filter(sample => trainDates.has(sample.date));
      const validation = samples.filter(sample => validationDates.has(sample.date));
      const testing = samples.filter(sample => testDates.has(sample.date));
      const compositeConfig = { ...DEFAULT_COMPOSITE_CONFIG, ...config, horizonMinutes: horizon };
      const model = fitCompositeModel(training, currentRecipe, compositeConfig);
      const diagnosticThresholds = fitDiagnosticThresholds(training);

      const simulate = (selected, fittedModel = model, fittedDiagnostics = diagnosticThresholds) => applyCompositeSignalGates(selected, currentRecipe, fittedModel, compositeConfig)
        .filteredTrades
        .map(candidate => {
          const computed = computedByDate.get(candidate.date);
          const trade = simulateClosureTrade({
            session: computed?.session,
            entryIndex: candidate.index,
            direction: currentRecipe.direction,
            atrRate: candidate.atrRate,
            config,
            pricePathMode,
          });
          return trade ? {
            ...trade,
            recipeId: currentRecipe.recipeId,
            factorScore: round(candidate.factorValue),
            vwapBias: round(candidate.vwapBias),
            vwapPosition: vwapBucket(candidate.vwapBias),
            atrRate: round(candidate.atrRate),
            atrRegime: atrBucket(candidate.atrRate, fittedDiagnostics),
          } : null;
        })
        .filter(Boolean);

      const validationTrades = simulate(validation);
      const testTrades = simulate(testing);
      const rollingOutOfSample = rollingClosureOutOfSample({
        samples,
        developmentDates,
        currentRecipe,
        compositeConfig,
        config,
        simulate,
      });
      reports.push({
        recipeId: currentRecipe.recipeId,
        recipeVersion: currentRecipe.version,
        direction: currentRecipe.direction,
        maximumHoldMinutes: horizon,
        splitSamples: { train: training.length, validation: validation.length, test: testing.length },
        model,
        diagnosticThresholds,
        rollingOutOfSample,
        validation: evaluateClosures(validationTrades),
        test: evaluateClosures(testTrades),
      });
    }

    return {
      mode: "offline-factor-closure-research",
      affectsShadowV2: false,
      affectsSmartT: false,
      affectsProductionStrategy: false,
      canPromoteAutomatically: false,
      requiresHumanApproval: true,
      engineVersion: this.engineVersion,
      config,
      pricePathMode,
      factorPriceInputMode,
      dataAudit,
      coverage: {
        sessions: computedSessions.length,
        firstDate: dates[0] ?? null,
        lastDate: dates.at(-1) ?? null,
        recipes: selectedRecipes.length,
        reports: reports.length,
      },
      timeSplits: splits,
      lockedTestInterval: lockedTestDeclaration(splits),
      antiOverfitting: {
        timeOrderedSplit: true,
        disjointSplitAudit: true,
        modelFit: "train-only",
        diagnosticThresholdFit: "train-only",
        validationRefit: false,
        testRefit: false,
        testIntervalLocked: true,
        testOptimizationAllowed: false,
        rollingOutOfSample: true,
        rollingScope: "train-and-validation-only",
        rollingExcludesLockedTest: true,
        missingInputs: "null-not-zero-filled",
        futureLeakageAudit: orderedSessions.length
          ? auditFutureInvariance(orderedSessions[0], { factorIds })
          : { pass: true, checkpoints: [], factors: factorIds.length, mismatches: [] },
      },
      reports,
    };
  }
}
