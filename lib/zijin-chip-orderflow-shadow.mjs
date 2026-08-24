import {
  evaluateOrderBookImbalance,
  evaluateQmtOrderFlow,
} from "./qmt-orderflow-confirmation.mjs";

export const ZIJIN_CHIP_ORDERFLOW_SHADOW_VERSION = "1.0.0-research";

export const ZIJIN_CHIP_ORDERFLOW_SHADOW_SAFETY = Object.freeze({
  symbol: "601899",
  researchOnly: true,
  shadowOnly: true,
  confirmationOnly: true,
  canCreateSignal: false,
  affectsProductionStrategy: false,
  canPromoteAutomatically: false,
  requiresOutOfSampleValidation: true,
  requiresHumanApproval: true,
});

export const DEFAULT_ZIJIN_CHIP_ORDERFLOW_CONFIG = Object.freeze({
  lookbackSessions: 20,
  minimumHistoricalSessions: 5,
  valueAreaFraction: 0.70,
  highVolumeNodeCount: 5,
  highVolumeNodeSeparationTicks: 3,
  priceTick: 0.01,
  minimumLocationTolerancePct: 0.0015,
  locationToleranceAtrMultiple: 0.75,
  minimumAlignedObi: 0.04,
  absorptionLookbackMinutes: 3,
  minimumAbsorbedAggressionRatio: 0.55,
  maximumAbsorptionPriceMovePct: 0.001,
});

const sessionProfileCache = new WeakMap();

const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
  ? Number(value)
  : null;

const round = (value, digits = 8) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function mergeConfig(options = {}) {
  return { ...DEFAULT_ZIJIN_CHIP_ORDERFLOW_CONFIG, ...options };
}

function profileCacheKey(config) {
  return `${config.priceTick}`;
}

function representativePrice(minute) {
  const averagePrice = finite(minute?.averagePrice);
  if (averagePrice !== null && averagePrice > 0) return averagePrice;
  const high = finite(minute?.high);
  const low = finite(minute?.low);
  const close = finite(minute?.close ?? minute?.price);
  if (high !== null && low !== null && close !== null) return (high + low + close) / 3;
  return close;
}

function addMinuteVolume(profile, minute, config) {
  const volume = finite(minute?.volume);
  const center = representativePrice(minute);
  if (volume === null || volume <= 0 || center === null || center <= 0) return;

  const low = finite(minute?.low) ?? center;
  const high = finite(minute?.high) ?? center;
  const lowTick = Math.round(Math.min(low, high) / config.priceTick);
  const highTick = Math.round(Math.max(low, high) / config.priceTick);
  const span = highTick - lowTick + 1;
  if (span <= 0 || span > 400) {
    const tick = Math.round(center / config.priceTick);
    profile.set(tick, (profile.get(tick) ?? 0) + volume);
    return;
  }
  const perTick = volume / span;
  for (let tick = lowTick; tick <= highTick; tick += 1) {
    profile.set(tick, (profile.get(tick) ?? 0) + perTick);
  }
}

function sessionVolumeProfile(session, config) {
  const cacheKey = profileCacheKey(config);
  const cached = sessionProfileCache.get(session);
  if (cached?.has(cacheKey)) return cached.get(cacheKey);
  const profile = new Map();
  for (const minute of session?.minutes ?? []) addMinuteVolume(profile, minute, config);
  const profiles = cached ?? new Map();
  profiles.set(cacheKey, profile);
  sessionProfileCache.set(session, profiles);
  return profile;
}

function mergeProfile(target, source) {
  for (const [tick, volume] of source) target.set(tick, (target.get(tick) ?? 0) + volume);
}

function selectHighVolumeNodes(entries, config) {
  const nodes = [];
  for (const [tick, volume] of [...entries].sort((left, right) => right[1] - left[1] || left[0] - right[0])) {
    if (nodes.every(node => Math.abs(node.tick - tick) >= config.highVolumeNodeSeparationTicks)) {
      nodes.push({ tick, price: round(tick * config.priceTick, 4), volume: round(volume, 2) });
    }
    if (nodes.length >= config.highVolumeNodeCount) break;
  }
  return nodes.sort((left, right) => left.price - right.price);
}

function summarizeProfile(profile, historicalSessions, currentMinutes, config) {
  const entries = [...profile.entries()].filter(([, volume]) => volume > 0);
  const totalVolume = entries.reduce((sum, [, volume]) => sum + volume, 0);
  if (!entries.length || totalVolume <= 0) {
    return Object.freeze({
      available: false,
      reason: "insufficient-volume-at-price-data",
      historicalSessions,
      currentMinutes,
      poc: null,
      vah: null,
      val: null,
      highVolumeNodes: Object.freeze([]),
    });
  }

  const pocEntry = [...entries].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0];
  const selected = [];
  let selectedVolume = 0;
  for (const entry of [...entries].sort((left, right) => right[1] - left[1] || left[0] - right[0])) {
    selected.push(entry);
    selectedVolume += entry[1];
    if (selectedVolume >= totalVolume * config.valueAreaFraction) break;
  }
  const valueTicks = selected.map(([tick]) => tick);
  const available = historicalSessions >= config.minimumHistoricalSessions;
  return Object.freeze({
    available,
    reason: available ? "causal-volume-at-price-proxy" : "insufficient-historical-sessions",
    approximation: "minute-volume-distributed-across-minute-ohlc-range",
    historicalSessions,
    currentMinutes,
    totalVolume: round(totalVolume, 2),
    valueAreaCoverage: round(selectedVolume / totalVolume),
    poc: round(pocEntry[0] * config.priceTick, 4),
    val: round(Math.min(...valueTicks) * config.priceTick, 4),
    vah: round(Math.max(...valueTicks) * config.priceTick, 4),
    highVolumeNodes: Object.freeze(selectHighVolumeNodes(entries, config)),
  });
}

export function buildCausalZijinChipMap({
  sessions,
  currentSession,
  currentIndex,
  config: options = {},
}) {
  const config = mergeConfig(options);
  const currentDate = String(currentSession?.date ?? "");
  const priorSessions = [...(Array.isArray(sessions) ? sessions : [])]
    .filter(session => String(session?.date ?? "") < currentDate)
    .sort((left, right) => String(left.date).localeCompare(String(right.date)))
    .slice(-config.lookbackSessions);
  const profile = new Map();
  for (const session of priorSessions) mergeProfile(profile, sessionVolumeProfile(session, config));

  const lastCausalIndex = Math.min(
    Math.max(Number.isInteger(currentIndex) ? currentIndex : -1, -1),
    (currentSession?.minutes?.length ?? 0) - 1,
  );
  for (let index = 0; index <= lastCausalIndex; index += 1) {
    addMinuteVolume(profile, currentSession.minutes[index], config);
  }
  return summarizeProfile(profile, priorSessions.length, Math.max(0, lastCausalIndex + 1), config);
}

export function evaluateZijinChipLocation({ direction, price, atrRate, chipMap, config: options = {} }) {
  const config = mergeConfig(options);
  const currentPrice = finite(price);
  if (!chipMap?.available || currentPrice === null || currentPrice <= 0) {
    return Object.freeze({ available: false, confirmed: false, reason: chipMap?.reason ?? "chip-map-unavailable" });
  }
  const tolerance = Math.max(
    currentPrice * config.minimumLocationTolerancePct,
    currentPrice * Math.max(0, finite(atrRate) ?? 0) * config.locationToleranceAtrMultiple,
  );
  const levels = [...new Set([
    chipMap.val,
    chipMap.poc,
    chipMap.vah,
    ...(chipMap.highVolumeNodes ?? []).map(node => node.price),
  ].filter(Number.isFinite))];
  const eligible = direction === "positiveT"
    ? levels.filter(level => level <= currentPrice + tolerance)
    : levels.filter(level => level >= currentPrice - tolerance);
  const nearestLevel = eligible.sort((left, right) => Math.abs(left - currentPrice) - Math.abs(right - currentPrice))[0] ?? null;
  const distance = nearestLevel === null ? null : Math.abs(nearestLevel - currentPrice);
  const insideExtendedValueArea = direction === "positiveT"
    ? currentPrice <= chipMap.vah + tolerance
    : currentPrice >= chipMap.val - tolerance;
  const confirmed = distance !== null && distance <= tolerance && insideExtendedValueArea;
  return Object.freeze({
    available: true,
    confirmed,
    role: direction === "positiveT" ? "support" : "resistance",
    nearestLevel: round(nearestLevel, 4),
    distance: round(distance, 6),
    tolerance: round(tolerance, 6),
    insideExtendedValueArea,
    reason: confirmed ? "near-causal-high-volume-level" : "no-nearby-causal-chip-level",
  });
}

function absorptionConfirmation(points, index, direction, config) {
  const start = Math.max(0, index - config.absorptionLookbackMinutes + 1);
  const recent = points.slice(start, index + 1);
  if (!recent.length) return { available: false, aligned: false };
  const buy = recent.reduce((sum, row) => sum + Math.max(0, finite(row?.activeBuyVolume) ?? 0), 0);
  const sell = recent.reduce((sum, row) => sum + Math.max(0, finite(row?.activeSellVolume) ?? 0), 0);
  const total = buy + sell;
  const firstPrice = finite(recent[0]?.price ?? recent[0]?.close);
  const lastPrice = finite(recent.at(-1)?.price ?? recent.at(-1)?.close);
  if (total <= 0 || firstPrice === null || lastPrice === null || firstPrice <= 0) return { available: false, aligned: false };
  const priceMove = lastPrice / firstPrice - 1;
  const opposingRatio = direction === "positiveT" ? sell / total : buy / total;
  const aligned = opposingRatio >= config.minimumAbsorbedAggressionRatio
    && (direction === "positiveT"
      ? priceMove >= -config.maximumAbsorptionPriceMovePct
      : priceMove <= config.maximumAbsorptionPriceMovePct);
  return {
    available: true,
    aligned,
    opposingRatio: round(opposingRatio),
    priceMove: round(priceMove),
  };
}

export function evaluateZijinOrderFlowConfirmation({ points, index, direction, config: options = {} }) {
  const config = mergeConfig(options);
  const rows = Array.isArray(points) ? points : [];
  const current = rows[index];
  const phase = direction === "positiveT" ? "BUY_FIRST" : "SELL_FIRST";
  const qmt = evaluateQmtOrderFlow(rows, index, phase);
  const recent = rows.slice(Math.max(0, index - 2), index + 1);
  const book = evaluateOrderBookImbalance(current, recent);
  const explicitL2Missing = current?.l2Available === false;
  const available = !explicitL2Missing && qmt.available === true && book.available === true;
  const trapVeto = direction === "positiveT"
    ? book.spoofingRisk === "BULL_TRAP"
    : book.spoofingRisk === "BEAR_TRAP";
  const abnormalDepthDisappearance = book.largeOrderCancellation === true && (
    direction === "positiveT" ? book.cancellationSide === "BID_CANCEL" : book.cancellationSide === "ASK_CANCEL"
  );
  const obiAligned = direction === "positiveT"
    ? book.obi >= config.minimumAlignedObi
    : book.obi <= -config.minimumAlignedObi;
  const absorption = absorptionConfirmation(rows, index, direction, config);
  const confirmed = available
    && qmt.pass === true
    && (obiAligned || absorption.aligned)
    && !trapVeto
    && !abnormalDepthDisappearance;
  return Object.freeze({
    available,
    confirmed,
    qmt,
    obi: round(book.obi),
    depthRatio: round(book.depthRatio),
    obiAligned,
    absorption: Object.freeze(absorption),
    trapRisk: book.spoofingRisk,
    trapVeto,
    abnormalDepthDisappearance,
    abnormalDepthSide: book.cancellationSide,
    reason: !available
      ? "l2-confirmation-unavailable"
      : trapVeto ? "order-book-trap-veto"
        : abnormalDepthDisappearance ? "abnormal-depth-disappearance-veto"
          : confirmed ? "aligned-order-flow-confirmed" : "order-flow-not-confirmed",
  });
}

export function evaluateZijinChipOrderFlowShadow({
  baselineDecision,
  sessions,
  currentSession,
  config: options = {},
}) {
  const formalBaseline = baselineDecision?.formal === true;
  const directionConfirmed = baselineDecision?.directionGate !== false;
  if (!formalBaseline) {
    return Object.freeze({
      retained: false,
      canCreateSignal: false,
      reason: "baseline-not-formal",
      directionConfirmed,
      chipMap: null,
      chipLocation: null,
      orderFlow: null,
    });
  }
  const chipMap = buildCausalZijinChipMap({
    sessions,
    currentSession,
    currentIndex: baselineDecision.index,
    config: options,
  });
  const chipLocation = evaluateZijinChipLocation({
    direction: baselineDecision.direction,
    price: baselineDecision.price,
    atrRate: baselineDecision.atrRate,
    chipMap,
    config: options,
  });
  const orderFlow = evaluateZijinOrderFlowConfirmation({
    points: currentSession?.minutes,
    index: baselineDecision.index,
    direction: baselineDecision.direction,
    config: options,
  });
  const retained = formalBaseline && directionConfirmed && chipLocation.confirmed && orderFlow.confirmed;
  const rejectionReasons = [
    !directionConfirmed ? "baseline-direction-gate" : null,
    !chipLocation.confirmed ? chipLocation.reason : null,
    !orderFlow.confirmed ? orderFlow.reason : null,
  ].filter(Boolean);
  return Object.freeze({
    retained,
    canCreateSignal: false,
    reason: retained ? "four-layer-confirmed" : rejectionReasons[0] ?? "four-layer-rejected",
    rejectionReasons: Object.freeze(rejectionReasons),
    directionConfirmed,
    chipMap,
    chipLocation,
    orderFlow,
  });
}
