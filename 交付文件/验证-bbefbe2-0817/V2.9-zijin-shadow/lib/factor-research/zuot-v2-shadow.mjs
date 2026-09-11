import { trainingExecutionPrice, trainingOrderFee } from "../personal-replay-training.mjs";
import { evaluateZijinPreopenGate, resolveZijinPreopenDirectionPermission } from "../zijin-preopen-price-plan.mjs";
import { FactorEngine } from "./factor-engine.mjs";

export const ZUOT_V2_SHADOW_VERSION = "2.0.0-research";

export const ZUOT_V2_CORE_FACTOR_IDS = Object.freeze([
  "vwap.bias",
  "vwap.mean_reversion",
  "volume.ratio_5_20",
  "volume.price_alignment_5m",
  "technical.macd_histogram",
  "technical.macd_histogram_delta",
  "orderflow.active_buy_imbalance",
  "orderflow.ofi_change_3m",
  "price.return_5m",
  "volatility.atr14",
]);

export const ZIJIN_V29_FACTOR_IDS = Object.freeze([
  ...ZUOT_V2_CORE_FACTOR_IDS,
  "orderflow.book_depth_imbalance",
]);

export const ZUOT_V1_DUPLICATE_FACTOR_IDS = Object.freeze([
  "technical.rsi14",
  "technical.kdj_j9",
  "technical.bollinger_position_20",
]);

export const ZUOT_V1_RECONSTRUCTED_FACTOR_IDS = Object.freeze([
  ...ZUOT_V2_CORE_FACTOR_IDS,
  ...ZUOT_V1_DUPLICATE_FACTOR_IDS,
]);

export const ZUOT_V2_SHADOW_SAFETY = Object.freeze({
  symbol: "601899",
  researchOnly: true,
  shadowOnly: true,
  affectsSmartT: false,
  affectsTradingAdapter: false,
  affectsProductionStrategy: false,
  canPromoteAutomatically: false,
  requiresHumanApproval: true,
});

export const DEFAULT_ZUOT_V2_SIGNAL_CONFIG = Object.freeze({
  minimumVwapBias: 0.0005,
  minimumVolumeRatio: 0.75,
  maximumOpposingVolumeAlignment: 0.35,
  minimumOfiImbalance: 0.02,
  minimumOfiChange: 0,
  maximumOpposingReturn5m: 0.004,
  continuationReturn5m: 0.002,
  continuationVolumeRatio: 1.15,
  minimumV1Votes: 4,
  minimumV2CoreVotes: 3,
  avoidOpeningMinutes: 15,
  reverseTAvoidOpeningMinutes: 15,
  avoidClosingMinutes: 10,
  cooldownMinutes: 20,
  maximumSignalsPerDayPerDirection: 2,
});

export const ZUOT_V1_RECONSTRUCTED_REPLAY_CONFIG = Object.freeze({
  minimumPriceMove: 0.08,
  costCoverageMultiple: 2,
  takeProfitAtrMultiple: 0.8,
  minimumStopMove: 0.06,
  stopLossAtrMultiple: 0.65,
  maximumHoldMinutes: Object.freeze({ positiveT: 45, reverseT: 50 }),
  sameMinuteConflict: "stop-first",
});

const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
  ? Number(value)
  : null;

function mergeConfig(options = {}) {
  return { ...DEFAULT_ZUOT_V2_SIGNAL_CONFIG, ...options };
}

export function tradingMinuteOrdinal(time) {
  const normalized = String(time ?? "").replaceAll(":", "").slice(0, 4);
  const hour = Number(normalized.slice(0, 2));
  const minute = Number(normalized.slice(2, 4));
  const total = hour * 60 + minute;
  if (total >= 570 && total <= 690) return total - 570;
  if (total >= 780 && total <= 900) return 120 + total - 780;
  return null;
}

function withinResearchWindow(time, direction, config) {
  const ordinal = tradingMinuteOrdinal(time);
  const openingMinutes = direction === "reverseT"
    ? config.reverseTAvoidOpeningMinutes
    : config.avoidOpeningMinutes;
  return Number.isFinite(ordinal)
    && ordinal >= openingMinutes
    && ordinal <= 240 - config.avoidClosingMinutes;
}

function directionalValue(direction, positiveTValue) {
  return direction === "positiveT" ? positiveTValue : -positiveTValue;
}

function legacyCandidate(direction, factors, config) {
  const vwapBias = finite(factors["vwap.bias"]);
  if (vwapBias === null || directionalValue(direction, -vwapBias) < config.minimumVwapBias) return false;
  const legacy = [
    finite(factors["technical.rsi14"]),
    finite(factors["technical.kdj_j9"]),
    finite(factors["technical.bollinger_position_20"]),
  ].filter(value => value !== null);
  return legacy.some(value => directionalValue(direction, -value) > 0);
}

function standaloneCandidate(direction, factors, config) {
  const vwapBias = finite(factors["vwap.bias"]);
  if (vwapBias === null || directionalValue(direction, -vwapBias) < config.minimumVwapBias) return false;
  const possibleConfirmations = [
    finite(factors["technical.macd_histogram_delta"]),
    finite(factors["orderflow.active_buy_imbalance"]),
    finite(factors["orderflow.ofi_change_3m"]),
  ].filter(value => value !== null);
  return possibleConfirmations.some(value => directionalValue(direction, value) > 0);
}

function v1VoteDetails(direction, factors, config) {
  const vwapBias = finite(factors["vwap.bias"]);
  const volumeRatio = finite(factors["volume.ratio_5_20"]);
  const macdDelta = finite(factors["technical.macd_histogram_delta"]);
  const ofi = finite(factors["orderflow.active_buy_imbalance"]);
  const rsi = finite(factors["technical.rsi14"]);
  const kdj = finite(factors["technical.kdj_j9"]);
  const boll = finite(factors["technical.bollinger_position_20"]);
  return Object.freeze({
    vwap: vwapBias !== null && directionalValue(direction, -vwapBias) >= config.minimumVwapBias,
    volume: volumeRatio !== null && volumeRatio >= 1,
    macd: macdDelta !== null && directionalValue(direction, macdDelta) > 0,
    ofi: ofi !== null && directionalValue(direction, ofi) > 0,
    rsi: rsi !== null && directionalValue(direction, -rsi) > 0.1,
    kdj: kdj !== null && directionalValue(direction, -kdj) > 0.1,
    boll: boll !== null && directionalValue(direction, -boll) > 0.1,
  });
}

function v2Details(direction, factors, config) {
  const vwapBias = finite(factors["vwap.bias"]);
  const volumeRatio = finite(factors["volume.ratio_5_20"]);
  const volumeAlignment = finite(factors["volume.price_alignment_5m"]);
  const macdHistogram = finite(factors["technical.macd_histogram"]);
  const macdDelta = finite(factors["technical.macd_histogram_delta"]);
  const ofi = finite(factors["orderflow.active_buy_imbalance"]);
  const ofiChange = finite(factors["orderflow.ofi_change_3m"]);
  const return5m = finite(factors["price.return_5m"]);
  const directionalReturn = return5m === null ? null : directionalValue(direction, return5m);
  const directionalMacd = macdHistogram === null ? null : directionalValue(direction, macdHistogram);
  const directionalMacdDelta = macdDelta === null ? null : directionalValue(direction, macdDelta);
  const directionalOfi = ofi === null ? null : directionalValue(direction, ofi);
  const directionalOfiChange = ofiChange === null ? null : directionalValue(direction, ofiChange);
  const directionGate = directionalReturn !== null && directionalReturn >= -config.maximumOpposingReturn5m;
  const continuationVeto = directionalReturn !== null
    && directionalReturn <= -config.continuationReturn5m
    && volumeRatio !== null
    && volumeRatio >= config.continuationVolumeRatio
    && directionalMacdDelta !== null
    && directionalMacdDelta < 0
    && directionalOfi !== null
    && directionalOfi < -config.minimumOfiImbalance;
  const votes = Object.freeze({
    vwap: vwapBias !== null && directionalValue(direction, -vwapBias) >= config.minimumVwapBias,
    volume: volumeRatio !== null
      && volumeRatio >= config.minimumVolumeRatio
      && (volumeAlignment === null
        || directionalValue(direction, volumeAlignment) >= -config.maximumOpposingVolumeAlignment),
    macd: directionalMacdDelta !== null
      && (directionalMacdDelta > 0 || (directionalMacd !== null && directionalMacd > 0)),
    ofi: directionalOfi !== null
      && directionalOfi >= config.minimumOfiImbalance
      && (directionalOfiChange === null || directionalOfiChange >= config.minimumOfiChange),
  });
  return Object.freeze({
    votes,
    directionGate,
    continuationVeto,
    ofiAvailable: ofi !== null,
    return5m,
  });
}

function candidateFor(experimentId, direction, factors, config) {
  if (experimentId === "v2-standalone") return standaloneCandidate(direction, factors, config);
  return legacyCandidate(direction, factors, config);
}

export function evaluateZuoTShadowRow({
  row,
  direction,
  experimentId = "v2-standalone",
  config: options = {},
}) {
  if (!["positiveT", "reverseT"].includes(direction)) throw new Error(`Unsupported direction: ${direction}`);
  if (!["v1-reconstructed-baseline", "v2-confirm-only", "v2-standalone"].includes(experimentId)) {
    throw new Error(`Unsupported experiment: ${experimentId}`);
  }
  const config = mergeConfig(options);
  const factors = row?.factors ?? {};
  const inWindow = withinResearchWindow(row?.time, direction, config);
  const candidate = inWindow && candidateFor(experimentId, direction, factors, config);
  const v1Votes = v1VoteDetails(direction, factors, config);
  const v1VoteCount = Object.values(v1Votes).filter(Boolean).length;
  const v2 = v2Details(direction, factors, config);
  const v2VoteCount = Object.values(v2.votes).filter(Boolean).length;
  const formal = candidate && (experimentId === "v1-reconstructed-baseline"
    ? v1VoteCount >= config.minimumV1Votes
    : v2.ofiAvailable
      && v2.directionGate
      && !v2.continuationVeto
      && v2.votes.ofi
      && v2VoteCount >= config.minimumV2CoreVotes);
  const rejectionReasons = [];
  if (!inWindow) rejectionReasons.push("outside-research-window");
  if (!candidate) rejectionReasons.push("not-candidate");
  if (candidate && experimentId !== "v1-reconstructed-baseline") {
    if (!v2.ofiAvailable) rejectionReasons.push("missing-ofi");
    if (!v2.directionGate) rejectionReasons.push("five-minute-direction");
    if (v2.continuationVeto) rejectionReasons.push(direction === "positiveT" ? "bearish-continuation" : "bullish-continuation");
    if (!v2.votes.ofi) rejectionReasons.push("ofi-not-confirmed");
    if (v2VoteCount < config.minimumV2CoreVotes) rejectionReasons.push("insufficient-core-votes");
  }
  if (candidate && experimentId === "v1-reconstructed-baseline" && v1VoteCount < config.minimumV1Votes) {
    rejectionReasons.push("insufficient-v1-votes");
  }
  return Object.freeze({
    date: String(row?.date ?? ""),
    time: String(row?.time ?? ""),
    index: Number(row?.index),
    price: finite(row?.price),
    direction,
    experimentId,
    candidate,
    formal,
    atrRate: finite(factors["volatility.atr14"]),
    vwapBias: finite(factors["vwap.bias"]),
    return5m: v2.return5m,
    v1VoteCount,
    v2VoteCount,
    v1Votes,
    v2Votes: v2.votes,
    directionGate: v2.directionGate,
    continuationVeto: v2.continuationVeto,
    rejectionReasons: Object.freeze(rejectionReasons),
  });
}

export function buildZuoTShadowDecisions(computedSessions, {
  experimentId = "v2-standalone",
  config: options = {},
} = {}) {
  const decisions = [];
  for (const computed of Array.isArray(computedSessions) ? computedSessions : []) {
    for (const row of computed?.rows ?? []) {
      for (const direction of ["positiveT", "reverseT"]) {
        const decision = evaluateZuoTShadowRow({ row, direction, experimentId, config: options });
        if (decision.candidate) decisions.push(decision);
      }
    }
  }
  return decisions;
}

export function selectSpacedZuoTSignals(decisions, {
  includeFormal = true,
  config: options = {},
} = {}) {
  const config = mergeConfig(options);
  const selected = [];
  const state = new Map();
  const ordered = [...(Array.isArray(decisions) ? decisions : [])]
    .filter(decision => includeFormal === null
      ? decision.candidate
      : includeFormal ? decision.formal : decision.candidate && !decision.formal)
    .sort((left, right) => left.date.localeCompare(right.date)
      || left.index - right.index
      || left.direction.localeCompare(right.direction));
  for (const decision of ordered) {
    const key = `${decision.date}:${decision.direction}`;
    const current = state.get(key) ?? { count: 0, lastOrdinal: -Infinity };
    const ordinal = tradingMinuteOrdinal(decision.time);
    if (!Number.isFinite(ordinal)
      || current.count >= config.maximumSignalsPerDayPerDirection
      || ordinal - current.lastOrdinal < config.cooldownMinutes) continue;
    selected.push(decision);
    state.set(key, { count: current.count + 1, lastOrdinal: ordinal });
  }
  return selected;
}

export function buildZuoTCandidateEvents(decisions, { config: options = {} } = {}) {
  const config = mergeConfig(options);
  const events = [];
  const groups = new Map();
  for (const decision of [...(Array.isArray(decisions) ? decisions : [])].filter(item => item.candidate)) {
    const key = `${decision.date}:${decision.direction}`;
    groups.set(key, [...(groups.get(key) ?? []), decision]);
  }
  for (const rows of groups.values()) {
    const ordered = [...rows].sort((left, right) => left.index - right.index);
    const dayEvents = [];
    for (const decision of ordered) {
      const ordinal = tradingMinuteOrdinal(decision.time);
      if (!Number.isFinite(ordinal)) continue;
      const current = dayEvents.at(-1);
      if (!current || ordinal - current.startOrdinal >= config.cooldownMinutes) {
        if (dayEvents.length >= config.maximumSignalsPerDayPerDirection) continue;
        dayEvents.push({
          date: decision.date,
          direction: decision.direction,
          startOrdinal: ordinal,
          firstDecision: decision,
          formalDecision: decision.formal ? decision : null,
          decisions: [decision],
        });
      } else {
        current.decisions.push(decision);
        if (!current.formalDecision && decision.formal) current.formalDecision = decision;
      }
    }
    events.push(...dayEvents);
  }
  return events.sort((left, right) => left.date.localeCompare(right.date)
    || left.startOrdinal - right.startOrdinal
    || left.direction.localeCompare(right.direction));
}

export function assertZuoTExperimentFactorIsolation(experimentId, factorIds) {
  const actual = new Set(factorIds);
  if (experimentId !== "v1-reconstructed-baseline") {
    for (const forbidden of ZUOT_V1_DUPLICATE_FACTOR_IDS) {
      if (actual.has(forbidden)) throw new Error(`${experimentId} must not include duplicate voter ${forbidden}`);
    }
  }
  return true;
}

function replayConfig(options = {}) {
  return {
    ...ZUOT_V1_RECONSTRUCTED_REPLAY_CONFIG,
    capital: 200_000,
    baseShares: 1600,
    sellable: 1600,
    feeRate: 0.025,
    slippage: 0.02,
    slippageMode: "percent",
    minCommission: true,
    forceCloseTime: "1450",
    maximumCycles: Number.POSITIVE_INFINITY,
    targetNetPct: null,
    ...options,
    maximumHoldMinutes: {
      ...ZUOT_V1_RECONSTRUCTED_REPLAY_CONFIG.maximumHoldMinutes,
      ...(options.maximumHoldMinutes ?? {}),
    },
  };
}

function executionCostAt({ direction, entryMarketPrice, exitMarketPrice, quantity, config }) {
  const entrySide = direction === "positiveT" ? "buy" : "sell";
  const exitSide = direction === "positiveT" ? "sell" : "buy";
  const entryPrice = trainingExecutionPrice({
    side: entrySide,
    marketPrice: entryMarketPrice,
    slippage: config.slippage,
    slippageMode: config.slippageMode,
  });
  const exitPrice = trainingExecutionPrice({
    side: exitSide,
    marketPrice: exitMarketPrice,
    slippage: config.slippage,
    slippageMode: config.slippageMode,
  });
  if (!entryPrice || !exitPrice || !quantity) return null;
  const entryFee = trainingOrderFee({
    side: entrySide,
    price: entryPrice,
    quantity,
    feeRate: config.feeRate,
    minCommission: config.minCommission,
  });
  const exitFee = trainingOrderFee({
    side: exitSide,
    price: exitPrice,
    quantity,
    feeRate: config.feeRate,
    minCommission: config.minCommission,
  });
  const grossPnl = direction === "positiveT"
    ? (exitMarketPrice - entryMarketPrice) * quantity
    : (entryMarketPrice - exitMarketPrice) * quantity;
  const executionCost = (Math.abs(entryPrice - entryMarketPrice) + Math.abs(exitPrice - exitMarketPrice)) * quantity;
  const fees = entryFee + exitFee;
  return { entryPrice, exitPrice, entryFee, exitFee, fees, executionCost, grossPnl, netPnl: grossPnl - fees - executionCost };
}

function maximumAffordableQuantity(price, requestedQuantity, config) {
  let quantity = Math.floor(requestedQuantity / 100) * 100;
  while (quantity >= 100) {
    const executionPrice = trainingExecutionPrice({
      side: "buy",
      marketPrice: price,
      slippage: config.slippage,
      slippageMode: config.slippageMode,
    });
    const fee = executionPrice ? trainingOrderFee({
      side: "buy",
      price: executionPrice,
      quantity,
      feeRate: config.feeRate,
      minCommission: config.minCommission,
    }) : Infinity;
    if (executionPrice && executionPrice * quantity + fee <= config.capital) return quantity;
    quantity -= 100;
  }
  return 0;
}

function exitReasonLabel(reason) {
  if (reason === "takeProfit") return "目标价差";
  if (reason === "stopLoss") return "止损退出";
  if (reason === "forceClose") return "尾盘强制恢复";
  return "时间退出";
}

export function simulateZuoTShadowCycle({ session, signal, options = {} }) {
  const config = replayConfig(options);
  const minutes = Array.isArray(session?.minutes) ? session.minutes : [];
  const entry = minutes[signal?.index];
  const entryMarketPrice = finite(entry?.price ?? entry?.close);
  const direction = signal?.direction;
  if (entryMarketPrice === null || !["positiveT", "reverseT"].includes(direction)) return null;
  const baseQuantity = Math.floor(Math.min(config.baseShares, config.sellable) / 3 / 100) * 100;
  const quantity = direction === "positiveT"
    ? maximumAffordableQuantity(entryMarketPrice, baseQuantity, config)
    : baseQuantity;
  if (!quantity) return null;

  const flat = executionCostAt({ direction, entryMarketPrice, exitMarketPrice: entryMarketPrice, quantity, config });
  const costMove = flat ? Math.abs(flat.netPnl) / quantity : 0;
  const atrRate = finite(signal?.atrRate);
  const targetNetPct = finite(config.targetNetPct);
  const targetMove = Math.max(
    config.minimumPriceMove,
    costMove * config.costCoverageMultiple,
    atrRate === null ? 0 : entryMarketPrice * atrRate * config.takeProfitAtrMultiple,
    targetNetPct === null ? 0 : entryMarketPrice * targetNetPct / 100 + costMove,
  );
  const stopMove = Math.max(
    config.minimumStopMove,
    atrRate === null ? 0 : entryMarketPrice * atrRate * config.stopLossAtrMultiple,
  );
  const targetPrice = direction === "positiveT" ? entryMarketPrice + targetMove : entryMarketPrice - targetMove;
  const stopPrice = direction === "positiveT" ? entryMarketPrice - stopMove : entryMarketPrice + stopMove;
  const maximumHold = config.maximumHoldMinutes[direction];
  const lastIndex = Math.min(minutes.length - 1, signal.index + maximumHold);
  let exitIndex = lastIndex;
  let exitMarketPrice = finite(minutes[lastIndex]?.price ?? minutes[lastIndex]?.close);
  let exitReason = "timeout";
  let sameMinuteConflict = false;

  for (let index = signal.index + 1; index <= lastIndex; index += 1) {
    const point = minutes[index];
    const close = finite(point?.price ?? point?.close);
    if (close === null) continue;
    const high = finite(point?.high) ?? close;
    const low = finite(point?.low) ?? close;
    const targetHit = direction === "positiveT" ? high >= targetPrice : low <= targetPrice;
    const stopHit = direction === "positiveT" ? low <= stopPrice : high >= stopPrice;
    if (targetHit && stopHit) {
      sameMinuteConflict = true;
      exitReason = config.sameMinuteConflict === "stop-first" ? "stopLoss" : "takeProfit";
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
    if (String(point.time) >= config.forceCloseTime) {
      exitReason = "forceClose";
      exitMarketPrice = close;
      exitIndex = index;
      break;
    }
  }
  if (exitMarketPrice === null) return null;
  const outcome = executionCostAt({ direction, entryMarketPrice, exitMarketPrice, quantity, config });
  if (!outcome) return null;
  const entryOrdinal = tradingMinuteOrdinal(entry.time);
  const exitOrdinal = tradingMinuteOrdinal(minutes[exitIndex]?.time);
  return {
    direction,
    entryIndex: signal.index,
    entryTime: String(entry.time ?? ""),
    entryMarketPrice,
    exitIndex,
    exitTime: String(minutes[exitIndex]?.time ?? ""),
    exitMarketPrice,
    exitReason,
    exitReasonLabel: exitReasonLabel(exitReason),
    holdingMinutes: Number.isFinite(entryOrdinal) && Number.isFinite(exitOrdinal)
      ? Math.max(0, exitOrdinal - entryOrdinal)
      : Math.max(0, exitIndex - signal.index),
    targetPrice,
    stopPrice,
    targetMove,
    stopMove,
    modeledRoundTripCostMove: costMove,
    quantity,
    sameMinuteConflict,
    ...outcome,
  };
}

function decisionBlockers(decision) {
  const labels = {
    "outside-research-window": "不在有效时段",
    "not-candidate": "未形成候选",
    "missing-ofi": "缺少盘口资金",
    "five-minute-direction": "五分钟方向冲突",
    "bearish-continuation": "下跌延续否决",
    "bullish-continuation": "上涨延续否决",
    "ofi-not-confirmed": "盘口资金未确认",
    "insufficient-core-votes": "核心因子不足",
    "insufficient-v1-votes": "组合投票不足",
    "missing-l2": "缺少历史L2",
    "opening-gap-depth-veto": "开盘深度否决",
    "opening-gap-microprice-veto": "开盘微价否决",
    "preopen-direction-veto": "全天方向锚相反",
  };
  return decision.rejectionReasons.map(reason => labels[reason] ?? reason);
}

function buildReplayResult({
  computed,
  decisions,
  config,
  scoreOf,
  threshold,
  observationReason,
  candidatePrefix,
  actionPrefix,
  statusLabel,
  extraDiagnostics = {},
}) {
  const candidateEvents = buildZuoTCandidateEvents(decisions);
  const formalSignals = selectSpacedZuoTSignals(decisions, { includeFormal: true });
  const observations = candidateEvents.map(event => {
    const decision = event.formalDecision ?? event.firstDecision;
    return {
      time: decision.time,
      price: decision.price,
      direction: decision.direction === "positiveT" ? "正T" : "反T",
      score: scoreOf(decision),
      threshold,
      edge: Math.abs(decision.vwapBias ?? 0),
      executable: Boolean(event.formalDecision),
      stage: "candidate",
      blockers: event.formalDecision ? [] : decisionBlockers(decision),
      reason: observationReason(decision),
      candidateKey: `${candidatePrefix}-${decision.date}-${decision.direction}-${event.startOrdinal}`,
    };
  });

  const trades = [];
  let blockedThrough = -1;
  const maximumCycles = Number.isFinite(Number(config.maximumCycles))
    ? Math.max(0, Math.floor(Number(config.maximumCycles)))
    : Number.POSITIVE_INFINITY;
  for (const signal of formalSignals) {
    if (trades.length >= maximumCycles) break;
    if (signal.index <= blockedThrough || String(signal.time) >= config.forceCloseTime) continue;
    const trade = simulateZuoTShadowCycle({ session: computed.session, signal, options: config });
    if (!trade) continue;
    trades.push(trade);
    blockedThrough = trade.exitIndex;
  }

  const actions = [];
  for (const [index, trade] of trades.entries()) {
    const cycleId = index + 1;
    const direction = trade.direction === "positiveT" ? "正T" : "反T";
    actions.push({
      time: trade.entryTime,
      side: trade.direction === "positiveT" ? "买入" : "卖出",
      price: trade.entryPrice,
      quantity: trade.quantity,
      curveIndex: trade.entryIndex + 1,
      direction,
      cycleId,
      reason: `${actionPrefix} ${trade.direction === "positiveT" ? "正T低吸" : "反T高抛"} · 确认通过`,
      meta: { hold: trade.holdingMinutes, targetPrice: trade.targetPrice, stopPrice: trade.stopPrice },
    });
    actions.push({
      time: trade.exitTime,
      side: trade.direction === "positiveT" ? "卖出" : "买回",
      price: trade.exitPrice,
      quantity: trade.quantity,
      curveIndex: trade.exitIndex + 1,
      direction,
      cycleId,
      reason: trade.exitReasonLabel,
      meta: { hold: trade.holdingMinutes, exitReason: trade.exitReason },
    });
  }
  actions.sort((left, right) => left.curveIndex - right.curveIndex || left.cycleId - right.cycleId);

  const curve = [];
  const curveTimes = [];
  let realized = 0;
  let active = null;
  let tradeIndex = 0;
  let peak = config.capital;
  let maxDrawdown = 0;
  for (let index = 0; index < computed.session.minutes.length; index += 1) {
    const point = computed.session.minutes[index];
    const nextTrade = trades[tradeIndex];
    if (nextTrade?.entryIndex === index) active = nextTrade;
    if (active?.exitIndex === index) {
      realized += active.netPnl;
      active = null;
      tradeIndex += 1;
    }
    let mark = config.capital + realized;
    if (active) {
      const marked = executionCostAt({
        direction: active.direction,
        entryMarketPrice: active.entryMarketPrice,
        exitMarketPrice: point.price,
        quantity: active.quantity,
        config,
      });
      mark += marked?.netPnl ?? 0;
    }
    peak = Math.max(peak, mark);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - mark) / peak : 0);
    curve.push(mark);
    curveTimes.push(point.time);
  }

  const cycleNets = trades.map(trade => trade.netPnl);
  const gross = trades.reduce((sum, trade) => sum + trade.grossPnl, 0);
  const fees = trades.reduce((sum, trade) => sum + trade.fees, 0);
  const executionCost = trades.reduce((sum, trade) => sum + trade.executionCost, 0);
  const net = cycleNets.reduce((sum, value) => sum + value, 0);
  return {
    net,
    gross,
    fees,
    executionCost,
    maxDrawdown,
    trades: trades.length,
    wins: trades.filter(trade => trade.netPnl > 0).length,
    days: computed.session.minutes.length >= 30 ? 1 : 0,
    curve: curve.length ? curve : [config.capital],
    curveTimes,
    cycleNets,
    startTime: formalSignals[0]?.time ?? "",
    status: trades.length
      ? `${statusLabel}完成：${trades.length} 个闭环，已扣除费用与双向滑点。`
      : `${statusLabel}未形成闭环：${candidateEvents.length} 个候选事件，${formalSignals.length} 个正式信号。`,
    actions,
    observations,
    diagnostics: {
      candidates: candidateEvents.length,
      formalSignals: formalSignals.length,
      overlapBlocked: Math.max(0, formalSignals.length - trades.length),
      missingOfi: decisions.filter(decision => decision.rejectionReasons.includes("missing-ofi")).length,
      cycleCap: maximumCycles,
      cycleCapBlocked: Math.max(0, formalSignals.length - maximumCycles),
      ...extraDiagnostics,
    },
  };
}

export function runZuoTV1ReconstructedReplay(session, options = {}) {
  const config = replayConfig(options);
  const factorEngine = options.factorEngine ?? new FactorEngine();
  const computed = factorEngine.computeSession(session, { factorIds: ZUOT_V1_RECONSTRUCTED_FACTOR_IDS });
  const decisions = buildZuoTShadowDecisions([computed], { experimentId: "v1-reconstructed-baseline" });
  return buildReplayResult({
    computed,
    decisions,
    config,
    scoreOf: decision => decision.v1VoteCount,
    threshold: DEFAULT_ZUOT_V2_SIGNAL_CONFIG.minimumV1Votes,
    observationReason: decision => `V1重建投票 ${decision.v1VoteCount}/7，VWAP、量能、MACD、OFI及技术位置共同确认。`,
    candidatePrefix: "zuot-v1",
    actionPrefix: "zuoT-v1",
    statusLabel: "zuoT-v1 重建影子",
  });
}

function normalizeZijinSymbol(session) {
  return String(session?.code ?? session?.symbol ?? "").replace(/\D/g, "").slice(0, 6);
}

function activeBuyRatioAt(point) {
  const supplied = finite(point?.activeBuyRatio);
  if (supplied !== null) return supplied;
  const buy = finite(point?.activeBuyVolume);
  const sell = finite(point?.activeSellVolume);
  return buy !== null && sell !== null && buy + sell > 0 ? buy / (buy + sell) : null;
}

function applyZijinV29L2Confirmation(decision, computed, rowByIndex, preopenGate = null) {
  const row = rowByIndex.get(decision.index);
  const point = computed.session.minutes[decision.index];
  const factors = row?.factors ?? {};
  const activeImbalance = finite(factors["orderflow.active_buy_imbalance"]);
  const ofiChange = finite(factors["orderflow.ofi_change_3m"]);
  const depthImbalance = finite(factors["orderflow.book_depth_imbalance"]);
  const activeBuyRatio = activeBuyRatioAt(point);
  const micropriceEdgeBps = finite(point?.micropriceEdgeBps);
  const previousClose = finite(computed.session.previousClose);
  const openingPrice = finite(computed.session.minutes[0]?.price);
  const openingGap = previousClose && openingPrice !== null ? (openingPrice - previousClose) / previousClose : null;
  const l2Available = activeImbalance !== null && ofiChange !== null;
  const shallowGapDepthVeto = decision.direction === "reverseT"
    && openingGap !== null && openingGap < 0.015
    && depthImbalance !== null && depthImbalance > -0.40;
  const midGapMicropriceVeto = decision.direction === "reverseT"
    && openingGap !== null && openingGap >= 0.02 && openingGap < 0.03
    && activeBuyRatio !== null && activeBuyRatio <= 0.25
    && micropriceEdgeBps !== null && micropriceEdgeBps <= 0;
  const preopenPermission = resolveZijinPreopenDirectionPermission({
    gate: preopenGate,
    direction: decision.direction === "positiveT" ? "正T" : "反T",
    time: decision.time,
  });
  const preopenDirectionVeto = Boolean(preopenPermission.active && preopenPermission.wouldBlock);
  const rejectionReasons = [...decision.rejectionReasons];
  if (!l2Available && !rejectionReasons.includes("missing-l2")) rejectionReasons.push("missing-l2");
  if (shallowGapDepthVeto) rejectionReasons.push("opening-gap-depth-veto");
  if (midGapMicropriceVeto) rejectionReasons.push("opening-gap-microprice-veto");
  if (preopenDirectionVeto) rejectionReasons.push("preopen-direction-veto");
  return Object.freeze({
    ...decision,
    formal: Boolean(decision.formal && l2Available && !shallowGapDepthVeto && !midGapMicropriceVeto && !preopenDirectionVeto),
    l2Available,
    depthImbalance,
    activeBuyRatio,
    micropriceEdgeBps,
    openingGap,
    reverseVeto: shallowGapDepthVeto || midGapMicropriceVeto,
    preopenPermission,
    preopenDirectionVeto,
    depthExpansionObservation: decision.direction === "positiveT" && depthImbalance !== null && depthImbalance >= 0.75,
    rejectionReasons: Object.freeze(rejectionReasons),
  });
}

export function runZijinV29ShadowReplay(session, options = {}) {
  if (normalizeZijinSymbol(session) !== ZUOT_V2_SHADOW_SAFETY.symbol) {
    throw new Error("zijin-v29-shadow only supports 601899");
  }
  const config = replayConfig(options);
  const factorEngine = options.factorEngine ?? new FactorEngine();
  const computed = factorEngine.computeSession(session, { factorIds: ZIJIN_V29_FACTOR_IDS });
  const rowByIndex = new Map(computed.rows.map(row => [row.index, row]));
  const baseDecisions = buildZuoTShadowDecisions([computed], {
    experimentId: "v2-standalone",
    config: { avoidOpeningMinutes: 0, reverseTAvoidOpeningMinutes: 0, ...config },
  });
  const decisions = baseDecisions.map(decision => {
    const suppliedGate = options.preopenGate ?? null;
    const suppliedGateIsCausal = suppliedGate?.asOfTime && suppliedGate.asOfTime <= decision.time;
    const causalGate = suppliedGateIsCausal
      ? suppliedGate
      : evaluateZijinPreopenGate({
        plan: options.preopenPlan ?? null,
        minutes: computed.session.minutes.slice(0, decision.index + 1),
      });
    return applyZijinV29L2Confirmation(decision, computed, rowByIndex, causalGate);
  });
  return buildReplayResult({
    computed,
    decisions,
    config,
    scoreOf: decision => decision.v2VoteCount,
    threshold: DEFAULT_ZUOT_V2_SIGNAL_CONFIG.minimumV2CoreVotes,
    observationReason: decision => decision.depthExpansionObservation
      ? `V2.9核心确认 ${decision.v2VoteCount}/4；盘口深度扩张仅作观察，不单独升级。`
      : `V2.9核心确认 ${decision.v2VoteCount}/4，需同时通过5分钟方向与历史L2/OFI校验。`,
    candidatePrefix: "zijin-v29",
    actionPrefix: "V2.9 紫金影子",
    statusLabel: "V2.9 紫金影子",
    extraDiagnostics: {
      l2Unavailable: decisions.filter(decision => !decision.l2Available).length,
      reverseVetoed: decisions.filter(decision => decision.reverseVeto).length,
      preopenDirectionVetoed: decisions.filter(decision => decision.preopenDirectionVeto).length,
      positiveDepthObservations: decisions.filter(decision => decision.depthExpansionObservation).length,
    },
  });
}
