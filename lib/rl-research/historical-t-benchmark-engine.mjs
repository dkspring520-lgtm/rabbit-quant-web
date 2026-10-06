import { PaperExecutionEngine } from "../paper-trading/paper-execution-engine.mjs";

export const HISTORICAL_T_BENCHMARK_VERSION = "V0.12.24.2";
export const CANONICAL_BENCHMARK_ACTIONS = Object.freeze([
  "WAIT", "HOLD", "REDUCE_T_5", "REDUCE_T_8", "REDUCE_T_10", "REDUCE_T_15", "REDUCE_T_20",
  "REBUILD_T_5", "REBUILD_T_10", "REBUILD_T_FULL", "BLOCKED_ACTION",
]);

const finite = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const nonNegative = value => Math.max(0, finite(value, 0));
const integer = value => Math.floor(nonNegative(value));
const round = (value, digits = 6) => value === null || !Number.isFinite(Number(value)) ? null : Number(Number(value).toFixed(digits));
function clone(value) {
  if (typeof value === "function") return undefined;
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]).filter(([, item]) => item !== undefined));
  return value;
}

function priceOf(bar) { return finite(bar?.observedReferencePrice ?? bar?.price ?? bar?.close); }
function timestampOf(bar, index) { return String(bar?.timestamp ?? bar?.asOf ?? String(bar?.date ?? "") + "T" + String(bar?.time ?? String(index).padStart(4, "0"))); }
function dateOf(bar, index) { return String(bar?.date ?? timestampOf(bar, index).slice(0, 10)).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"); }
function timeOf(bar, index) { return String(bar?.time ?? timestampOf(bar, index).slice(11, 16) ?? "").replace(/:/g, "").slice(0, 4) || String(index).padStart(4, "0"); }
function normalizeBars(bars) {
  return (Array.isArray(bars) ? bars : [])
    .map((bar, index) => ({ ...bar, __index: index, __price: priceOf(bar), __timestamp: timestampOf(bar, index), __date: dateOf(bar, index), __time: timeOf(bar, index) }))
    .filter(bar => bar.__price !== null && bar.__price > 0)
    .sort((left, right) => left.__timestamp.localeCompare(right.__timestamp));
}

function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function standardDeviation(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(mean(values.map(value => (value - average) ** 2)));
}
function returnFrom(prices, lookback) {
  if (prices.length <= lookback) return null;
  const previous = prices[prices.length - lookback - 1];
  return previous > 0 ? prices.at(-1) / previous - 1 : null;
}

function buildCausalMarketState(bars, index) {
  const current = bars[index];
  // Keep the causal feature window bounded. The benchmark can process the
  // complete DATA-07 history without constructing an O(n²) prefix on every bar.
  const prefix = bars.slice(Math.max(0, index - 21), index + 1);
  const prices = prefix.map(bar => bar.__price);
  const volumes = prefix.map(bar => finite(bar.volume)).filter(value => value !== null && value >= 0);
  const returns = [];
  for (let i = 1; i < prices.length; i += 1) returns.push(prices[i - 1] > 0 ? prices[i] / prices[i - 1] - 1 : null);
  const validReturns = returns.filter(value => value !== null);
  const return1m = returnFrom(prices, 1);
  const return5m = returnFrom(prices, 5);
  const return15m = returnFrom(prices, 15);
  const average5 = mean(prices.slice(-5));
  const average15 = mean(prices.slice(-15));
  const recentReturns = validReturns.slice(-20);
  const previousVolumes = volumes.slice(-21, -1);
  const currentVolume = finite(current.volume);
  const volumeAverage = mean(previousVolumes);
  const volumeRatio = currentVolume !== null && volumeAverage > 0 ? currentVolume / volumeAverage : null;
  const trendRegime = return5m !== null && average5 !== null
    ? return5m >= 0.001 && current.__price >= average5 ? "UPTREND"
      : return5m <= -0.001 && current.__price <= average5 ? "DOWNTREND" : "RANGE"
    : "RANGE";
  const previousReturn5m = index > 5 ? returnFrom(prices.slice(0, -1), 5) : null;
  const momentumWeakening = return5m !== null && previousReturn5m !== null && return5m < previousReturn5m;
  const momentumPhase = trendRegime === "UPTREND" && momentumWeakening
    ? "MOMENTUM_EXHAUSTION"
    : trendRegime === "UPTREND" && (volumeRatio === null || volumeRatio >= 1.1) && (return1m ?? 0) > 0
      ? "TREND_ACCELERATION"
      : trendRegime === "UPTREND" || trendRegime === "DOWNTREND" ? "TREND_MATURE" : "REVERSAL_CONFIRMED";
  return {
    timestamp: current.__timestamp,
    observedReferencePrice: current.__price,
    volume: currentVolume,
    return_1m: return1m,
    return_5m: return5m,
    return_15m: return15m,
    volatility: standardDeviation(recentReturns),
    volumeRatio,
    trendRegime,
    momentumPhase,
    average5,
    average15,
    momentumWeakening,
    featureAvailability: {
      price: true,
      volume: currentVolume !== null,
      causalReturns: true,
      causalVolatility: recentReturns.length >= 2,
      syntheticOHLC: false,
      futureFeatures: false,
    },
  };
}

function buildOpportunityCandidate(market) {
  const capitalFlowSpike = market.volumeRatio !== null && market.volumeRatio >= 1.8;
  const momentumExhaustion = market.momentumPhase === "MOMENTUM_EXHAUSTION";
  const trendBreakout = market.trendRegime === "UPTREND" && (market.return_1m ?? 0) > 0 && !market.momentumWeakening;
  const rangeReversal = market.trendRegime === "RANGE" && market.average15 !== null && Math.abs(market.observedReferencePrice / market.average15 - 1) >= 0.002;
  const detected = capitalFlowSpike && momentumExhaustion;
  return {
    capitalFlowSpike,
    momentumExhaustion,
    trendBreakout,
    rangeReversal,
    detected,
    opportunityType: detected ? "CAPITAL_FLOW_SPIKE_MOMENTUM_EXHAUSTION" : trendBreakout ? "TREND_BREAKOUT" : rangeReversal ? "RANGE_REVERSAL" : "UNAVAILABLE",
  };
}

function ratioFromAction(action) {
  const match = String(action).match(/_(5|8|10|15|20)$/);
  return match ? Number(match[1]) / 100 : null;
}
function isReduce(action) { return String(action).startsWith("REDUCE_T_"); }
function isRebuild(action) { return String(action).startsWith("REBUILD_T_"); }
function lotRound(quantity, lotSize) { return Math.floor(Math.max(0, quantity) / lotSize) * lotSize; }
function normalizeAction(value) {
  const action = String(value?.action ?? value ?? "WAIT").toUpperCase();
  return CANONICAL_BENCHMARK_ACTIONS.includes(action) ? action : "BLOCKED_ACTION";
}

function defaultPositivePolicy({ state, context }) {
  if (context.openTrades.length && state.observedReferencePrice <= context.openTrades[0].sellPrice * (1 - context.config.rebuyThreshold)) return "REBUILD_T_FULL";
  if (!context.openTrades.length && state.trendRegime === "UPTREND" && (state.return_1m ?? 0) > 0) return "REDUCE_T_10";
  return "WAIT";
}
function defaultReversePolicy({ state, context }) {
  if (context.openTrades.length && state.observedReferencePrice <= context.openTrades[0].sellPrice * (1 - context.config.rebuyThreshold)) return "REBUILD_T_FULL";
  if (!context.openTrades.length && state.trendRegime === "DOWNTREND" && (state.return_1m ?? 0) > 0) return "REDUCE_T_10";
  return "WAIT";
}
function defaultBidirectionalPolicy({ state, context }) {
  const opportunity = buildOpportunityCandidate(state);
  const opportunityType = opportunity.opportunityType !== "UNAVAILABLE"
    ? opportunity.opportunityType
    : state.trendRegime === "UPTREND" ? "TREND_BREAKOUT"
      : state.trendRegime === "RANGE" ? "RANGE_REVERSAL" : "UNAVAILABLE";
  if (context.openTrades.length && state.observedReferencePrice <= context.openTrades[0].sellPrice * (1 - context.config.rebuyThreshold)) return { action: "REBUILD_T_FULL", opportunityType };
  if (context.openTrades.length) return { action: "WAIT", opportunityType };
  if ((state.trendRegime === "UPTREND" || state.trendRegime === "RANGE") && (state.return_1m ?? 0) > 0.001) return { action: "REDUCE_T_10", opportunityType };
  if (state.trendRegime === "DOWNTREND" && (state.return_1m ?? 0) > 0) return { action: "REDUCE_T_10", opportunityType };
  return { action: "WAIT", opportunityType };
}
function defaultExpertPriorMapper() { return "WAIT"; }

export function createHistoricalTBenchmarkStrategies({ expertPriorActionMapper = defaultExpertPriorMapper } = {}) {
  return Object.freeze({
    BUY_HOLD: ({ state }) => ({ action: "WAIT", opportunityType: "NONE", candidateAction: "WAIT", state }),
    FIXED_POSITIVE_T: defaultPositivePolicy,
    FIXED_REVERSE_T: defaultReversePolicy,
    BIDIRECTIONAL_T: defaultBidirectionalPolicy,
    EXPERT_PRIOR: ({ state, context }) => {
      const candidate = buildOpportunityCandidate(state);
      const candidateAction = expertPriorActionMapper({ candidate: clone(candidate), state: clone(state), context: clone(context) });
      return { action: normalizeAction(candidateAction), candidateAction: normalizeAction(candidateAction), candidate, opportunityType: candidate.opportunityType };
    },
  });
}

function marketForBar(bar, symbol) {
  return {
    symbol,
    date: bar.__date,
    time: bar.__time,
    timestamp: bar.__timestamp,
    marketPrice: bar.__price,
    price: bar.__price,
    suspended: bar.suspended === true,
    limitUp: bar.limitUp === true,
    limitDown: bar.limitDown === true,
  };
}
function createContext(config) {
  return { config, openTrades: [], tradeLedger: [], blockedActions: [], candidateEvents: [], dailyTradeCount: 0, dailyVolume: 0, lastExecutionIndex: null, nextTradeId: 1 };
}
function policyContext(context) {
  return {
    config: context.config,
    openTrades: context.openTrades.map(trade => ({ sellPrice: trade.sellPrice, remainingShares: trade.remainingShares })),
    dailyTradeCount: context.dailyTradeCount,
    dailyVolume: context.dailyVolume,
    lastExecutionIndex: context.lastExecutionIndex,
  };
}
function portfolioSnapshot(paper, corePosition, tPosition, tSellablePosition, price) {
  const snapshot = paper.snapshot();
  return {
    cash: snapshot.cash,
    totalPosition: snapshot.position.totalPosition,
    corePosition,
    tPosition,
    sellablePosition: snapshot.position.availableSellablePosition,
    tSellablePosition,
    todayBought: Math.max(0, snapshot.position.totalPosition - snapshot.position.availableSellablePosition),
    todaySold: 0,
    averageCost: snapshot.position.averageCost,
    portfolioValueResearch: snapshot.cash + snapshot.position.totalPosition * price,
  };
}
function appendBlockedTrade(context, { state, action, reason, signalIndex, opportunityType = "UNAVAILABLE" }) {
  const tradeId = "trade-" + context.nextTradeId++;
  const row = {
    trade_id: tradeId,
    timestamp: state.timestamp,
    signal_timestamp: state.timestamp,
    execution_timestamp: null,
    state: clone(state),
    action,
    sell_price: null,
    buyback_price: null,
    shares: 0,
    profit: null,
    cost_change: null,
    outcome: "BLOCKED_ACTION",
    failure_reason: reason,
    opportunity_type: opportunityType,
    momentum_phase: state.momentumPhase,
    signal_index: signalIndex,
  };
  context.tradeLedger.push(row);
  context.blockedActions.push(row);
  return row;
}

function executePending({ pending, bar, index, context, paper, symbol, state }, { tPosition, tSellablePosition }) {
  const action = pending.action;
  const ratio = ratioFromAction(action);
  const availableForReduce = Math.min(tPosition, tSellablePosition);
  const outstanding = context.openTrades.reduce((sum, trade) => sum + trade.remainingShares, 0);
  let requested = isReduce(action)
    ? ratio === null ? 0 : lotRound(tPosition * ratio, context.config.lotSize)
    : isRebuild(action) ? action === "REBUILD_T_FULL" ? lotRound(outstanding, context.config.lotSize) : lotRound(outstanding * (ratio ?? 0), context.config.lotSize)
      : 0;
  const reason = isReduce(action) && requested > availableForReduce ? "insufficient sellable T position"
    : isReduce(action) && requested < context.config.lotSize ? "T position below lot size"
      : isRebuild(action) && requested < context.config.lotSize ? "no rebuildable T quantity"
        : null;
  if (reason) return { tPosition, tSellablePosition, execution: null, blocked: appendBlockedTrade(context, { state, action, reason, signalIndex: pending.signalIndex, opportunityType: pending.opportunityType }) };
  if (isReduce(action)) requested = Math.min(requested, availableForReduce);
  const execution = paper.execute(marketForBar(bar, symbol), {
    side: isReduce(action) ? "SELL" : "BUY",
    quantity: requested,
    orderPrice: bar.__price,
    timestamp: bar.__timestamp,
    signalId: pending.signalId,
    candidateId: pending.candidateId,
    modelVersion: pending.strategyId,
    datasetVersion: "DATA-07",
  });
  if (execution.status !== "FILLED") {
    const blocked = appendBlockedTrade(context, { state, action, reason: execution.reason || "execution rejected", signalIndex: pending.signalIndex, opportunityType: pending.opportunityType });
    return { tPosition, tSellablePosition, execution, blocked };
  }
  if (isReduce(action)) {
    const tradeId = "trade-" + context.nextTradeId++;
    const trade = {
      tradeId,
      sellIndex: index,
      signalIndex: pending.signalIndex,
      signalTimestamp: pending.signalTimestamp,
      executionTimestamp: bar.__timestamp,
      sellPrice: execution.fillPrice,
      sellFees: execution.fees,
      remainingShares: execution.quantity,
      ledger: {
        trade_id: tradeId,
        timestamp: pending.signalTimestamp,
        signal_timestamp: pending.signalTimestamp,
        execution_timestamp: bar.__timestamp,
        state: clone(state),
        action,
        sell_price: execution.fillPrice,
        buyback_price: null,
        buyback_execution_timestamp: null,
        shares: execution.quantity,
        profit: null,
        cost_change: null,
        outcome: "UNRESOLVED",
        failure_reason: null,
        opportunity_type: pending.opportunityType,
        momentum_phase: state.momentumPhase,
        signal_index: pending.signalIndex,
      },
    };
    context.openTrades.push(trade);
    context.tradeLedger.push(trade.ledger);
    return { tPosition: tPosition - execution.quantity, tSellablePosition: tSellablePosition - execution.quantity, execution };
  }
  let remaining = execution.quantity;
  for (const trade of context.openTrades) {
    if (remaining <= 0) break;
    const matched = Math.min(remaining, trade.remainingShares);
    if (!matched) continue;
    const entry = trade.ledger;
    const gross = (trade.sellPrice - execution.fillPrice) * matched;
    const buyFees = execution.fees * (matched / Math.max(1, execution.quantity));
    const sellFees = trade.sellFees * (matched / Math.max(1, entry.shares));
    const profit = gross - sellFees - buyFees;
    entry.buyback_price = execution.fillPrice;
    entry.buyback_execution_timestamp = bar.__timestamp;
    entry.buyback_shares = (entry.buyback_shares ?? 0) + matched;
    entry.profit = round((entry.profit ?? 0) + profit);
    entry.cost_change = round((entry.profit ?? 0) / Math.max(1, entry.shares));
    trade.remainingShares -= matched;
    remaining -= matched;
    if (trade.remainingShares === 0) {
      entry.outcome = entry.profit > 0 ? "SUCCESSFUL_REBUY" : "FAILED_REBUY";
      entry.failure_reason = entry.profit > 0 ? null : "buyback did not cover execution costs";
    } else entry.outcome = "PARTIAL_REBUY";
  }
  context.openTrades = context.openTrades.filter(trade => trade.remainingShares > 0);
  return { tPosition: tPosition + execution.quantity, tSellablePosition, execution };
}

function futureWindowPrices(bars, startIndex, window, sessionDate) {
  if (window === "Next Session") {
    const firstNextSession = bars.slice(startIndex + 1).find(bar => bar.__date !== sessionDate)?.__date;
    return firstNextSession ? bars.slice(startIndex + 1).filter(bar => bar.__date === firstNextSession).map(bar => bar.__price) : [];
  }
  const sameSession = bars.slice(startIndex + 1).filter(bar => bar.__date === sessionDate);
  if (window === "End Session") return sameSession.map(bar => bar.__price);
  const numericWindow = Math.max(0, Number(window));
  return sameSession.slice(0, numericWindow).map(bar => bar.__price);
}
function finalizeLedger(context, bars, windows) {
  for (const trade of context.openTrades) {
    trade.ledger.outcome = "UNRESOLVED";
    trade.ledger.failure_reason = "no completed rebuy within observed benchmark window";
  }
  for (const row of context.tradeLedger) {
    if (!row.sell_price || row.outcome === "BLOCKED_ACTION") continue;
    const barIndex = row.signal_index ?? 0;
    row.avoided_drawdown = {};
    row.missed_trend_risk = {};
    for (const [name, window] of Object.entries(windows)) {
      const prices = futureWindowPrices(bars, barIndex, window, String(row.timestamp).slice(0, 10));
      const low = prices.length ? prices.reduce((value, price) => Math.min(value, price), Number.POSITIVE_INFINITY) : null;
      const high = prices.length ? prices.reduce((value, price) => Math.max(value, price), Number.NEGATIVE_INFINITY) : null;
      row.avoided_drawdown[name] = low !== null ? round(Math.max(0, row.sell_price - low) * row.shares) : null;
      row.missed_trend_risk[name] = high !== null ? round(Math.max(0, high - row.sell_price) * row.shares) : null;
    }
  }
}

function summarize({ strategyId, bars, initialEquity, equityPath, context, initialAverageCost, finalAverageCost, initialTotalPosition, config, includeEquityPath }) {
  const endingEquity = equityPath.at(-1)?.equity ?? initialEquity;
  let peak = initialEquity;
  let maxDrawdown = 0;
  for (const point of equityPath) {
    peak = Math.max(peak, point.equity);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - point.equity) / peak : 0);
  }
  const completed = context.tradeLedger.filter(row => row.outcome === "SUCCESSFUL_REBUY" || row.outcome === "FAILED_REBUY");
  const profits = completed.map(row => finite(row.profit)).filter(value => value !== null);
  const wins = profits.filter(value => value > 0);
  const losses = profits.filter(value => value < 0);
  const tProfit = profits.reduce((sum, value) => sum + value, 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const avoided = context.tradeLedger.flatMap(row => Object.values(row.avoided_drawdown ?? {})).filter(Number.isFinite);
  const missed = context.tradeLedger.flatMap(row => Object.values(row.missed_trend_risk ?? {})).filter(Number.isFinite);
  const costReduction = initialAverageCost !== null && finalAverageCost !== null ? initialAverageCost - finalAverageCost : null;
  return {
    strategyId,
    benchmarkVersion: HISTORICAL_T_BENCHMARK_VERSION,
    sourceDataset: "DATA-07",
    bars: bars.length,
    initialEquity: round(initialEquity),
    endingEquity: round(endingEquity),
    totalReturn: round((endingEquity - initialEquity) / Math.max(1, initialEquity)),
    tProfit: round(tProfit),
    costReduction: round(costReduction),
    initialEffectiveCost: round(initialAverageCost),
    finalEffectiveCost: round(finalAverageCost),
    costReductionRate: initialAverageCost > 0 && costReduction !== null ? round(costReduction / initialAverageCost) : null,
    costReductionStatus: costReduction === null ? "UNAVAILABLE_COST_BASIS" : "AVAILABLE_SYNTHETIC_RESEARCH_ACCOUNT",
    maximumDrawdown: round(maxDrawdown),
    avoidedDrawdown: round(avoided.length ? mean(avoided) : 0),
    failedRebuyRisk: round(completed.length ? completed.filter(row => row.outcome === "FAILED_REBUY").length / completed.length : 0),
    missedTrendRisk: round(missed.length ? mean(missed) : 0),
    tSuccessRate: round(completed.length ? wins.length / completed.length : 0),
    profitFactor: grossLoss ? round(grossProfit / grossLoss) : grossProfit ? null : 0,
    averageTReturn: round(completed.length ? mean(completed.map(row => finite(row.profit) / Math.max(1, row.sell_price * row.shares)).filter(Number.isFinite)) : 0),
    tradeCount: context.tradeLedger.length,
    completedTradeCount: completed.length,
    unresolvedTradeCount: context.tradeLedger.filter(row => row.outcome === "UNRESOLVED").length,
    blockedActionCount: context.blockedActions.length,
    candidateEvents: clone(context.candidateEvents),
    config: clone(config),
    tradeLedger: clone(context.tradeLedger),
    equityPathCount: equityPath.length,
    equityPath: includeEquityPath ? clone(equityPath) : [],
  };
}

export function runHistoricalTBenchmark({ bars = [], symbol = "601899.SH", strategies = null, strategyConfigs = {}, initialCash = 1_000_000, corePosition = 34_000, tPosition = 3_100, initialAverageCost = null, costConfig = { commission: 0.025, minimumCommission: 5, stampDuty: 0.05, slippage: 0.02 }, lotSize = 100, rebuyThreshold = 0.002, evaluationWindows = { shortT: 15, intradayT: 30, endSession: 240, nextSession: "Next Session" }, includeEquityPath = true } = {}) {
  const orderedBars = normalizeBars(bars);
  if (!orderedBars.length) return Object.freeze({ sourceDataset: "DATA-07", reports: {}, status: "NO_VALID_BARS" });
  const defaultStrategies = createHistoricalTBenchmarkStrategies({ expertPriorActionMapper: strategyConfigs.EXPERT_PRIOR?.expertPriorActionMapper });
  const strategyMap = strategies && !Array.isArray(strategies) ? strategies : defaultStrategies;
  const selected = Object.entries(strategyMap).filter(([strategyId]) => !Array.isArray(strategies) || strategies.includes(strategyId));
  const reports = {};
  for (const [strategyId, policy] of selected) {
    const config = { lotSize, rebuyThreshold, maxDailyTCount: 3, dailyTVolume: Number.POSITIVE_INFINITY, cooldownBars: 1, ...(strategyConfigs[strategyId] ?? {}) };
    const totalInitialPosition = integer(corePosition) + integer(tPosition);
    const paper = new PaperExecutionEngine({ symbol, initialCash, initialPosition: totalInitialPosition, initialSellablePosition: totalInitialPosition, averageCost: initialAverageCost ?? priceOf(orderedBars[0]), config: costConfig });
    const context = createContext(config);
    let currentTPosition = integer(tPosition);
    let currentTSellablePosition = integer(tPosition);
    let pending = null;
    let initialEquity = null;
    let lastDate = null;
    const equityPath = [];
    for (let index = 0; index < orderedBars.length; index += 1) {
      const bar = orderedBars[index];
      if (lastDate && lastDate !== bar.__date) {
        currentTSellablePosition = currentTPosition;
        context.dailyTradeCount = 0;
        context.dailyVolume = 0;
      }
      lastDate = bar.__date;
      const marketState = buildCausalMarketState(orderedBars, index);
      if (pending) {
        const executedAction = pending.action;
        const stateAtExecution = { ...marketState, ...portfolioSnapshot(paper, integer(corePosition), currentTPosition, currentTSellablePosition, bar.__price) };
        const result = executePending({ pending, bar, index, context, paper, symbol, state: stateAtExecution }, { tPosition: currentTPosition, tSellablePosition: currentTSellablePosition });
        currentTPosition = result.tPosition;
        currentTSellablePosition = result.tSellablePosition;
        if (result.execution?.status === "FILLED") {
          if (isReduce(executedAction)) context.dailyTradeCount += 1;
          context.dailyVolume += result.execution.quantity;
          if (isReduce(executedAction)) context.lastExecutionIndex = index;
        }
        pending = null;
      }
      const state = { ...marketState, ...portfolioSnapshot(paper, integer(corePosition), currentTPosition, currentTSellablePosition, bar.__price) };
      const rawDecision = policy({ state: clone(state), context: policyContext(context) });
      const decision = typeof rawDecision === "string" ? { action: rawDecision } : (rawDecision ?? { action: "WAIT" });
      if (decision.candidate) context.candidateEvents.push({ timestamp: state.timestamp, candidate: clone(decision.candidate), action: normalizeAction(decision.action) });
      const action = normalizeAction(decision.action);
      if (action === "BLOCKED_ACTION") appendBlockedTrade(context, { state, action, reason: decision.reason ?? "policy returned unsupported action", signalIndex: index, opportunityType: decision.opportunityType });
      else if (action !== "WAIT" && action !== "HOLD" && index < orderedBars.length - 1) {
        const openingNewCycle = isReduce(action) && context.openTrades.length === 0;
        const openCycleBlocks = isReduce(action) && context.openTrades.length > 0;
        const cooldownActive = openingNewCycle && context.lastExecutionIndex !== null && index - context.lastExecutionIndex <= Number(config.cooldownBars);
        const dailyCountExceeded = openingNewCycle && context.dailyTradeCount >= Number(config.maxDailyTCount);
        const dailyVolumeExceeded = openingNewCycle && context.dailyVolume >= Number(config.dailyTVolume);
        const guardReason = openCycleBlocks ? "open T cycle"
          : cooldownActive ? "cooldown active"
          : dailyCountExceeded ? "max daily T count reached"
            : dailyVolumeExceeded ? "daily T volume reached" : null;
        if (guardReason) appendBlockedTrade(context, { state, action, reason: guardReason, signalIndex: index, opportunityType: decision.opportunityType });
        else pending = { action, signalIndex: index, signalTimestamp: state.timestamp, signalId: strategyId + "-" + index, candidateId: strategyId, strategyId, opportunityType: decision.opportunityType ?? "UNAVAILABLE" };
      }
      const equity = paper.cash + paper.position.totalPosition * bar.__price;
      initialEquity ??= equity;
      equityPath.push({ index, timestamp: bar.__timestamp, equity: round(equity), position: paper.position.totalPosition, tPosition: currentTPosition, price: bar.__price });
    }
    finalizeLedger(context, orderedBars, evaluationWindows);
    reports[strategyId] = summarize({ strategyId, bars: orderedBars, initialEquity, equityPath, context, initialAverageCost: initialAverageCost === null || initialAverageCost === undefined ? null : finite(initialAverageCost), finalAverageCost: finite(paper.position.averageCost), initialTotalPosition: totalInitialPosition, config, includeEquityPath });
  }
  return Object.freeze({ sourceDataset: "DATA-07", symbol, canonicalSchemaVersion: "CANONICAL_V1", executionRule: "CURRENT_BAR_SIGNAL_NEXT_BAR_EXECUTION", reports });
}
