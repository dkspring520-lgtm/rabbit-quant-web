import { createHash } from "node:crypto";
import { calculateZijinTrendContinuationRisk } from "./zijin-factor-research.mjs";
import { resolveZijinPreopenDirectionPermission } from "./zijin-preopen-price-plan.mjs";
import { normalizeQmtOrderFlow } from "./qmt-orderflow-confirmation.mjs";
import { calculateZijinEconomicThreshold } from "./zijin-transaction-cost.mjs";

export const SHADOW_MODELS = Object.freeze({
  A: Object.freeze({
    id: "round10-positive-strict",
    label: "A · 少而精",
    sourceRound: 10,
    sessionStart: "0933",
    sessionEnd: "0944",
    maxSignalsPerDay: 1,
    side: "long",
    executionMode: "shadow-trade",
    parameters: Object.freeze({ gapAbsPct: 0.6, repairPct: 0.16, confirmationVotesRequired: 1 }),
  }),
  B: Object.freeze({
    id: "round11-positive-coverage",
    label: "B · 覆盖优先",
    sourceRound: 11,
    sessionStart: "0933",
    sessionEnd: "1015",
    maxSignalsPerDay: 2,
    side: "long",
    executionMode: "shadow-trade",
    parameters: Object.freeze({ maximumVwapDistancePct: 0.3, minimumPeerBreadth: 0.5, minimumVolumeRatio: 0.7, confirmationVotesRequired: 2 }),
  }),
  C: Object.freeze({
    id: "round12-reverse-relative-weakness",
    label: "C · 反T相对弱势",
    sourceRound: 12,
    sessionStart: "0933",
    sessionEnd: "1430",
    maxSignalsPerDay: 2,
    side: "short",
    executionMode: "observe-only",
    parameters: Object.freeze({
      maximumIntradayPosition: 0.4412,
      minimumAlphaVwapPct: 0.3034,
      maximumReturn5Pct: -0.1104,
    }),
  }),
  D: Object.freeze({
    id: "round13-reverse-high-anchor",
    label: "D 路 高位转弱反T",
    sourceRound: 13,
    sessionStart: "0933",
    sessionEnd: "1430",
    maxSignalsPerDay: 2,
    side: "short",
    executionMode: "observe-only",
    parameters: Object.freeze({
      minimumIntradayPosition: 0.68,
      minimumVwapBiasPct: 0.25,
      minimumAlphaVwapPct: 0.15,
      minimumVolumeRatio: 0.7,
      minimumPeerCoverage: 0.8,
    }),
  }),
  E: Object.freeze({
    id: "round14-positive-vwap-negative-deviation",
    label: "E 路 早盘VWAP偏离回归",
    sourceRound: 14,
    sessionStart: "0933",
    sessionEnd: "1030",
    maxSignalsPerDay: 2,
    side: "long",
    executionMode: "shadow-trade",
    parameters: Object.freeze({
      maximumVwapBiasPct: -0.35,
      maximumIntradayPosition: 0.30,
      minimumVolumeRatio: 0.70,
      minimumPeerBreadth: 0.33,
      minimumPeerCoverage: 0.80,
    }),
  }),
  F: Object.freeze({
    id: "round15-positive-external-resonance",
    label: "F 路 早盘外部共振正T",
    sourceRound: 15,
    sessionStart: "0933",
    sessionEnd: "1030",
    maxSignalsPerDay: 1,
    side: "long",
    executionMode: "shadow-trade",
    parameters: Object.freeze({
      maximumVwapBiasPct: -0.25,
      maximumIntradayPosition: 0.35,
      minimumVolumeRatio: 0.70,
      minimumPeerCoverage: 0.80,
      minimumExternalCoverage: 4,
      minimumExternalSupportVotes: 3,
    }),
  }),
  G: Object.freeze({
    id: "round16-positive-multi-market-consensus",
    label: "G / real-factor consensus positive T",
    sourceRound: 16,
    sessionStart: "0933",
    sessionEnd: "1045",
    maxSignalsPerDay: 1,
    side: "long",
    executionMode: "shadow-trade",
    parameters: Object.freeze({
      maximumVwapBiasPct: -0.15,
      maximumIntradayPosition: 0.40,
      minimumVolumeRatio: 0.65,
      minimumPeerCoverage: 0.80,
      minimumExternalCoverage: 6,
      minimumSupportGroups: 2,
    }),
  }),
  H: Object.freeze({
    id: "round17-range-reverse-quality-l2",
    label: "H / 震荡市反T质量",
    sourceRound: 17,
    sessionStart: "0945",
    sessionEnd: "1125",
    maxSignalsPerDay: 2,
    side: "short",
    executionMode: "observe-only",
    parameters: Object.freeze({
      minimumIntradayPosition: 0.65,
      minimumVwapBiasPct: 0.20,
      minimumVolumeRatio: 0.80,
      maximumPeerBreadth: 0.67,
      maximumReturn3Pct: -0.06,
      minimumL2SellVotes: 2,
    }),
  }),
  I: Object.freeze({
    id: "round18-v3-positive-dynamic-l2",
    label: "I / V3 动态L2共振正T",
    sourceRound: 18,
    sessionStart: "0933",
    sessionEnd: "1430",
    maxSignalsPerDay: 2,
    side: "long",
    executionMode: "shadow-trade",
    parameters: Object.freeze({
      minimumPeerBreadth: 0.33,
      minimumPeerCoverage: 0.80,
      minimumL2Persistence: 3,
      minimumExternalReady: 4,
      minimumExternalSupportVotes: 2,
      maximumVwapBiasPct: 0.05,
      minimumAtrSamples: 5,
      maxHoldMinutes: 50,
    }),
  }),
  J: Object.freeze({
    id: "round18-v3-reverse-dynamic-l2",
    label: "J / V3 动态L2共振反T",
    sourceRound: 18,
    sessionStart: "0933",
    sessionEnd: "1430",
    maxSignalsPerDay: 2,
    side: "short",
    executionMode: "shadow-trade",
    parameters: Object.freeze({
      minimumPeerCoverage: 0.80,
      minimumL2Persistence: 3,
      minimumExternalReady: 4,
      minimumExternalSupportVotes: 2,
      minimumIntradayPosition: 0.68,
      minimumVwapBiasPct: 0.20,
      minimumAtrSamples: 5,
      maxHoldMinutes: 45,
    }),
  }),
});

const COST_PCT = 0.12;
const STRESS_COST_PCT = 0.18;
const MIN_NET_TARGET_PCT = 0.64;
const MAX_NET_TARGET_PCT = 1.0;
const MAX_HOLD_MINUTES = 60;
const PROSPECTIVE_GATE = Object.freeze({
  minimumResolvedTrades: 50,
  minimumResearchCandidateWinRate: 0.65,
  minimumWinRate: 0.70,
  requirePositiveBaseNetPct: true,
  requirePositiveStressNetPct: true,
  manualReviewRequired: true,
});
const TRAILING_GIVEBACK_PCT = 0.15;
const STOP_NET_PCT = -0.45;
const DIRECTION_PERMISSION_PROMOTION_GATE = Object.freeze({
  minimumPositiveTWinRate: 0.55,
  minimumClosedCyclesPer100StockDays: 25,
  requirePositiveAfterCostNet: true,
  manualReviewRequired: true,
});
const RANGE_REVERSE_QUALITY_PROMOTION_GATE = Object.freeze({
  minimumResolvedSignals: 50,
  minimumWinRate: 0.55,
  minimumSignalsPer100StockDays: 25,
  requirePositiveAfterCostNet: true,
  manualReviewRequired: true,
});

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentChange(current, base) {
  return Number.isFinite(current) && Number.isFinite(base) && base > 0
    ? (current / base - 1) * 100
    : 0;
}

function emptyDirectionPermissionState() {
  return {
    mode: "shadow-only",
    promotionGate: { ...DIRECTION_PERMISSION_PROMOTION_GATE },
    marketDates: [],
    pending: [],
    resolved: [],
    today: { rawSignals: 0, permittedSignals: 0, blockedSignals: 0, resolvedSignals: 0 },
    total: { rawSignals: 0, permittedSignals: 0, blockedSignals: 0, resolvedSignals: 0 },
    summary: null,
  };
}

function emptyRangeReverseQualityState() {
  return {
    mode: "shadow-only",
    factorId: SHADOW_MODELS.H.id,
    promotionGate: { ...RANGE_REVERSE_QUALITY_PROMOTION_GATE },
    marketDates: [],
    pending: [],
    resolved: [],
    today: { candidates: 0, resolvedSignals: 0 },
    total: { candidates: 0, resolvedSignals: 0 },
    summary: null,
  };
}

function directionForShadowSide(side) {
  return side === "short" ? "反T" : "正T";
}

function calculateDirectionalAfterCostPct(entryPrice, exitPrice, direction) {
  const grossPct = direction === "反T"
    ? -percentChange(exitPrice, entryPrice)
    : percentChange(exitPrice, entryPrice);
  return { grossPct: round(grossPct), afterCostPct: round(grossPct - COST_PCT) };
}

function summarizeDirectionPermissionArm(records) {
  const outcomes = records
    .map(record => ({ record, outcome: record.outcomes?.find(item => item.minutes === 30 && item.complete) }))
    .filter(item => Number.isFinite(Number(item.outcome?.afterCostPct)));
  let cumulative = 0;
  let peak = 0;
  let maxDrawdownPct = 0;
  for (const { outcome } of outcomes) {
    cumulative += Number(outcome.afterCostPct);
    peak = Math.max(peak, cumulative);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak - cumulative);
  }
  const wins = outcomes.filter(({ outcome }) => Number(outcome.afterCostPct) > 0).length;
  const positiveT = outcomes.filter(({ record }) => record.direction === "正T");
  const positiveTWins = positiveT.filter(({ outcome }) => Number(outcome.afterCostPct) > 0).length;
  return {
    resolvedSignals: outcomes.length,
    wins,
    winRate: outcomes.length ? round(wins / outcomes.length) : null,
    positiveTSignals: positiveT.length,
    positiveTWins,
    positiveTWinRate: positiveT.length ? round(positiveTWins / positiveT.length) : null,
    afterCostNetPct: round(cumulative),
    averageAfterCostPct: outcomes.length ? round(cumulative / outcomes.length) : null,
    maxDrawdownPct: round(maxDrawdownPct),
  };
}

/**
 * Compare every raw candidate against the counterfactual arm where the
 * 09:25/09:35 direction permission would have allowed it.  This cannot
 * promote a model itself: the return value deliberately stops at manual
 * review even after all thresholds are met.
 */
export function summarizeZijinDirectionPermissionAB({ ledger = [], stockDays = 0 } = {}) {
  const resolved = (Array.isArray(ledger) ? ledger : [])
    .filter(record => record?.event === "direction-permission-outcome" && Array.isArray(record.outcomes));
  const baseline = summarizeDirectionPermissionArm(resolved);
  const permitted = summarizeDirectionPermissionArm(resolved.filter(record => !record.blocked));
  const evaluatedDays = Math.max(0, Number(stockDays) || 0);
  const cyclesPer100StockDays = evaluatedDays > 0
    ? round(permitted.resolvedSignals / evaluatedDays * 100)
    : null;
  const enoughEvidence = permitted.resolvedSignals > 0 && evaluatedDays > 0;
  const eligible = enoughEvidence
    && (permitted.positiveTWinRate ?? 0) >= DIRECTION_PERMISSION_PROMOTION_GATE.minimumPositiveTWinRate
    && (cyclesPer100StockDays ?? 0) >= DIRECTION_PERMISSION_PROMOTION_GATE.minimumClosedCyclesPer100StockDays
    && (!DIRECTION_PERMISSION_PROMOTION_GATE.requirePositiveAfterCostNet || permitted.afterCostNetPct > 0);
  return {
    mode: "shadow-only",
    horizonMinutes: 30,
    stockDays: evaluatedDays,
    promotionGate: { ...DIRECTION_PERMISSION_PROMOTION_GATE },
    baseline,
    permitted,
    cyclesPer100StockDays,
    promotion: {
      status: !enoughEvidence ? "insufficient" : eligible ? "manual-review" : "observe",
      eligible,
      automaticPromotion: false,
      reason: !enoughEvidence
        ? "方向许可尚无足够的30分钟影子结果"
        : eligible
          ? "影子A/B门槛已达到；仍需人工复核后才可写入正式因子注册表"
          : "继续影子运行：尚未同时满足正T胜率、闭环覆盖与成本后收益门槛",
    },
  };
}

function summarizeRangeReverseQualityArm(records) {
  const outcomes = records
    .map(record => ({ record, outcome: record.outcomes?.find(item => item.minutes === 30 && item.complete) }))
    .filter(item => Number.isFinite(Number(item.outcome?.afterCostPct)));
  const afterCostNetPct = outcomes.reduce((sum, { outcome }) => sum + Number(outcome.afterCostPct), 0);
  const wins = outcomes.filter(({ outcome }) => Number(outcome.afterCostPct) > 0).length;
  return {
    resolvedSignals: outcomes.length,
    wins,
    winRate: outcomes.length ? round(wins / outcomes.length) : null,
    afterCostNetPct: round(afterCostNetPct),
    averageAfterCostPct: outcomes.length ? round(afterCostNetPct / outcomes.length) : null,
  };
}

/**
 * The range reverse-T quality factor is a forward-only cohort.  It records
 * the exact factor snapshot with 5/15/30 minute cost-adjusted outcomes, but
 * deliberately has no path to Smart-T V4 execution or notifications.
 */
export function summarizeZijinRangeReverseQuality({ ledger = [], stockDays = 0 } = {}) {
  const resolved = (Array.isArray(ledger) ? ledger : [])
    .filter(record => record?.event === "range-reverse-quality-outcome" && Array.isArray(record.outcomes));
  const quality = summarizeRangeReverseQualityArm(resolved);
  const evaluatedDays = Math.max(0, Number(stockDays) || 0);
  const signalsPer100StockDays = evaluatedDays > 0
    ? round(quality.resolvedSignals / evaluatedDays * 100)
    : null;
  const enoughEvidence = quality.resolvedSignals >= RANGE_REVERSE_QUALITY_PROMOTION_GATE.minimumResolvedSignals
    && evaluatedDays > 0;
  const eligible = enoughEvidence
    && (quality.winRate ?? 0) >= RANGE_REVERSE_QUALITY_PROMOTION_GATE.minimumWinRate
    && (signalsPer100StockDays ?? 0) >= RANGE_REVERSE_QUALITY_PROMOTION_GATE.minimumSignalsPer100StockDays
    && (!RANGE_REVERSE_QUALITY_PROMOTION_GATE.requirePositiveAfterCostNet || quality.afterCostNetPct > 0);
  return {
    mode: "shadow-only",
    factorId: SHADOW_MODELS.H.id,
    horizonMinutes: 30,
    stockDays: evaluatedDays,
    promotionGate: { ...RANGE_REVERSE_QUALITY_PROMOTION_GATE },
    quality,
    signalsPer100StockDays,
    promotion: {
      status: !enoughEvidence ? "insufficient" : eligible ? "manual-review" : "observe",
      eligible,
      automaticPromotion: false,
      reason: !enoughEvidence
        ? "震荡市反T质量因子尚未积累足够的前瞻样本"
        : eligible
          ? "影子样本达到研究门槛，仍需人工复核后才可进入下一阶段闭环 A/B"
          : "继续影子运行：尚未同时满足胜率、覆盖和成本后收益门槛",
    },
  };
}

function minuteNumber(time) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(2, 4));
}

function shanghaiMinuteTimestamp(marketDate, time) {
  if (!/^\d{8}$/.test(String(marketDate || "")) || !/^\d{4}$/.test(String(time || ""))) return null;
  const year = Number(marketDate.slice(0, 4));
  const month = Number(marketDate.slice(4, 6));
  const day = Number(marketDate.slice(6, 8));
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  // A minute-bar decision is made at the close of minute t. Allow evidence
  // published inside that same minute, but never anything from minute t+1.
  return Date.UTC(year, month - 1, day, hour - 8, minute, 59, 999);
}

function timestampValue(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())
    ? value.trim()
    : `${value.trim().replace(" ", "T")}+08:00`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function causalExternalSnapshot(externalContext, marketDate, time) {
  const cutoff = shanghaiMinuteTimestamp(marketDate, time);
  if (!externalContext || cutoff === null) return { factors: {}, ready: 0, supportVotes: 0, hardLock: false };
  const factors = Object.fromEntries((Array.isArray(externalContext.factors) ? externalContext.factors : [])
    .filter((factor) => factor?.key !== "events" && factor?.available)
    .flatMap((factor) => {
      const observed = timestampValue(factor.sourceTimestamp);
      return observed !== null && observed <= cutoff
        ? [[factor.key, Number.isFinite(Number(factor.value)) ? Number(factor.value) : null]]
        : [];
    }));
  const supportChecks = [
    Number.isFinite(factors.gold) && factors.gold >= -0.25,
    Number.isFinite(factors.copper) && factors.copper >= -0.50,
    Number.isFinite(factors.market) && factors.market >= -1.00,
    Number.isFinite(factors.hkZijin) && factors.hkZijin >= -1.00,
  ];
  const causalNegativeEvent = (Array.isArray(externalContext.latestEvents) ? externalContext.latestEvents : []).some((event) => {
    const published = timestampValue(event?.publishedAt);
    const negative = ["negative", "bearish", "利空"].includes(String(event?.sentiment || "").toLowerCase());
    const severe = ["high", "critical", "重大", "严重"].includes(String(event?.severity || "").toLowerCase());
    return published !== null && published <= cutoff && negative && severe;
  });
  return {
    factors,
    ready: Object.keys(factors).length,
    supportVotes: supportChecks.filter(Boolean).length,
    hardLock: causalNegativeEvent,
  };
}

export function causalExternalConsensus(externalContext, marketDate, time) {
  const snapshot = causalExternalSnapshot(externalContext, marketDate, time);
  const cutoff = shanghaiMinuteTimestamp(marketDate, time);
  const visible = Object.fromEntries((Array.isArray(externalContext?.factors) ? externalContext.factors : [])
    .filter((factor) => factor?.key !== "events" && factor?.available)
    .flatMap((factor) => {
      const observed = timestampValue(factor.sourceTimestamp);
      const value = Number(factor.value);
      return cutoff !== null && observed !== null && observed <= cutoff && Number.isFinite(value)
        ? [[factor.key, value]]
        : [];
    }));
  const groupDefinitions = {
    commodity: [
      ["gold", -0.35],
      ["copper", -0.60],
      ["domesticGold", -0.35],
      ["domesticCopper", -0.60],
    ],
    equityTransmission: [
      ["market", -1.00],
      ["hkZijin", -1.00],
      ["metalsEtf", -1.00],
      ["goldEtf", -1.00],
    ],
  };
  const groups = Object.fromEntries(Object.entries(groupDefinitions).map(([key, definitions]) => {
    const available = definitions.filter(([factorKey]) => Number.isFinite(visible[factorKey]));
    const supportive = available.filter(([factorKey, floor]) => visible[factorKey] >= floor);
    return [key, {
      ready: available.length,
      supportive: supportive.length,
      passed: available.length >= 2 && supportive.length >= Math.ceil(available.length / 2),
    }];
  }));
  return {
    ...snapshot,
    factors: visible,
    ready: Object.keys(visible).length,
    supportGroups: Object.values(groups).filter((group) => group.passed).length,
    groups,
  };
}

function inSession(time, model) {
  return time >= model.sessionStart && time <= model.sessionEnd;
}

function rollingAverageAt(items, endIndex, window, minimumCount) {
  if (endIndex < 0) return 0;
  const values = items
    .slice(Math.max(0, endIndex - window + 1), endIndex + 1)
    .map((item) => Number(item.price))
    .filter(Number.isFinite);
  return values.length >= minimumCount ? average(values) : 0;
}

function visibleVwapBias(minutes, endIndex) {
  if (!Array.isArray(minutes) || endIndex < 0) return null;
  let weightedPrice = 0;
  let totalVolume = 0;
  let priceSum = 0;
  let count = 0;
  for (const item of minutes.slice(0, endIndex + 1)) {
    const price = Number(item.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const volume = Math.max(0, Number(item.volume) || 0);
    weightedPrice += price * volume;
    totalVolume += volume;
    priceSum += price;
    count += 1;
  }
  const current = Number(minutes[endIndex]?.price);
  if (!Number.isFinite(current) || !count) return null;
  const vwap = totalVolume > 0 ? weightedPrice / totalVolume : priceSum / count;
  return percentChange(current, vwap);
}

export function deriveShadowStatus(marketDate, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const today = `${parts.year}${parts.month}${parts.day}`;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return "closed";
  if (marketDate !== today) return minute < 9 * 60 + 30 ? "waiting" : "degraded";
  if (minute < 9 * 60 + 33) return "waiting";
  if (minute < 15 * 60) return "observing";
  return "closed";
}

export function summarizeZijinExternalContext(marketContext = null, eventRadar = null, observedAt = new Date().toISOString()) {
  const requiredMarketFactors = [
    { key: "gold", label: "国际黄金", ids: ["hf_GC"] },
    { key: "copper", label: "国际铜价", ids: ["hf_CAD"] },
    { key: "domesticGold", label: "沪金连续", ids: ["nf_AU0"] },
    { key: "domesticCopper", label: "沪铜连续", ids: ["nf_CU0"] },
    { key: "market", label: "A股大盘", ids: ["sh000001", "sh000300"] },
    { key: "hkZijin", label: "港股紫金矿业", ids: ["hk02899"] },
    { key: "metalsEtf", label: "有色金属ETF", ids: ["sh512400"] },
    { key: "goldEtf", label: "黄金ETF", ids: ["sh518880"] },
    { key: "usdCny", label: "美元/人民币", ids: ["fx_susdcny"] },
  ];
  const marketItems = (Array.isArray(marketContext?.items) ? marketContext.items : [])
    .filter((item) => item && typeof item.id === "string")
    .map((item) => ({
      id: item.id,
      label: typeof item.label === "string" ? item.label : item.id,
      changePercent: Number.isFinite(Number(item.changePercent)) ? round(Number(item.changePercent)) : null,
      sourceTimestamp: typeof item.sourceTimestamp === "string" ? item.sourceTimestamp : null,
      provider: typeof item.provider === "string" ? item.provider : null,
      inverse: Boolean(item.inverse),
    }));
  const stockRadar = Array.isArray(eventRadar?.stocks)
    ? eventRadar.stocks.find((stock) => stock?.code === "601899")
    : null;
  const eventScanned = Boolean(stockRadar);
  const factors = requiredMarketFactors.map((factor) => {
    const item = marketItems.find((candidate) => factor.ids.includes(candidate.id));
    return {
      key: factor.key,
      label: factor.label,
      available: Boolean(item),
      value: item?.changePercent == null ? null : item.inverse ? -item.changePercent : item.changePercent,
      sourceTimestamp: item?.sourceTimestamp ?? null,
      provider: item?.provider ?? null,
    };
  });
  factors.push({
    key: "events",
    label: "公告与新闻",
    available: eventScanned,
    value: stockRadar?.counts ?? null,
    sourceTimestamp: stockRadar?.items?.[0]?.publishedAt ?? null,
    provider: eventScanned ? "event-radar" : null,
  });
  const ready = factors.filter((factor) => factor.available).length;
  return {
    observedAt,
    marketFetchedAt: typeof marketContext?.fetchedAt === "string" ? marketContext.fetchedAt : null,
    radarFetchedAt: typeof eventRadar?.fetchedAt === "string" ? eventRadar.fetchedAt : null,
    coverage: {
      ready,
      total: factors.length,
      missing: factors.filter((factor) => !factor.available).map((factor) => factor.label),
    },
    factors,
    eventGate: stockRadar?.gate ? {
      level: stockRadar.gate.level ?? null,
      label: stockRadar.gate.label ?? null,
      hardLock: Boolean(stockRadar.gate.hardLock),
      reason: stockRadar.gate.reason ?? null,
    } : null,
    latestEvents: (Array.isArray(stockRadar?.items) ? stockRadar.items : []).slice(0, 3).map((item) => ({
      id: item.id,
      publishedAt: item.publishedAt,
      sentiment: item.sentiment,
      severity: item.severity,
      source: item.source,
      official: Boolean(item.official),
    })),
  };
}

function normalizeLiveL2(l2 = null) {
  const flow = normalizeQmtOrderFlow(l2);
  const connected = flow.status?.connected === true;
  const stale = flow.status?.stale === true || flow.status?.authorized === false;
  const activeBuyRatio = flow.activeBuyRatio ?? (
    (flow.activeBuyVolume ?? 0) + (flow.activeSellVolume ?? 0) > 0
      ? (flow.activeBuyVolume ?? 0) / ((flow.activeBuyVolume ?? 0) + (flow.activeSellVolume ?? 0))
      : null
  );
  const hasBook = flow.nearTouchImbalance !== null || flow.micropriceEdgeBps !== null
    || (flow.bid1Volume !== null && flow.ask1Volume !== null);
  const depthImbalance = flow.nearTouchImbalance ?? (
    flow.bid1Volume !== null && flow.ask1Volume !== null
      ? (flow.bid1Volume - flow.ask1Volume) / Math.max(1, flow.bid1Volume + flow.ask1Volume)
      : null
  );
  const qualityBlocked = (flow.transactionCount !== null && flow.transactionCount < 3)
    || (flow.spreadBps !== null && flow.spreadBps > 18);
  const available = connected && !stale && activeBuyRatio !== null && hasBook;
  const ofi = activeBuyRatio === null && depthImbalance === null
    ? null
    : (activeBuyRatio === null ? 0 : activeBuyRatio - 0.5) * 0.7
      + (depthImbalance === null ? 0 : depthImbalance) * 0.3;
  const buyVotes = [
    activeBuyRatio !== null && activeBuyRatio >= 0.52,
    depthImbalance !== null && depthImbalance >= 0.04,
    flow.micropriceEdgeBps !== null && flow.micropriceEdgeBps > 0,
    flow.bigOrderNet !== null && flow.bigOrderNet > 0,
  ].filter(Boolean).length;
  const sellVotes = [
    activeBuyRatio !== null && activeBuyRatio <= 0.48,
    depthImbalance !== null && depthImbalance <= -0.04,
    flow.micropriceEdgeBps !== null && flow.micropriceEdgeBps < 0,
    flow.bigOrderNet !== null && flow.bigOrderNet < 0,
  ].filter(Boolean).length;
  return {
    available,
    connected,
    stale,
    activeBuyRatio: activeBuyRatio === null ? null : round(activeBuyRatio),
    depthImbalance: depthImbalance === null ? null : round(depthImbalance),
    micropriceEdgeBps: flow.micropriceEdgeBps === null ? null : round(flow.micropriceEdgeBps),
    bigOrderNet: flow.bigOrderNet === null ? null : round(flow.bigOrderNet),
    transactionCount: flow.transactionCount === null ? null : round(flow.transactionCount),
    spreadBps: flow.spreadBps === null ? null : round(flow.spreadBps),
    bid1Volume: flow.bid1Volume === null ? null : round(flow.bid1Volume),
    ask1Volume: flow.ask1Volume === null ? null : round(flow.ask1Volume),
    buyVotes,
    sellVotes,
    ofi: ofi === null ? null : round(ofi),
    qualityBlocked,
    pass: available && !qualityBlocked && Math.max(buyVotes, sellVotes) >= 2,
  };
}

export function buildLiveL2Snapshot(l2 = null, l2History = []) {
  const current = normalizeLiveL2(l2);
  const history = (Array.isArray(l2History) ? l2History : [])
    .map((item) => normalizeLiveL2(item?.snapshot ?? item))
    .filter((item) => item.available && !item.qualityBlocked)
    .slice(-5);
  const samples = current.available && !current.qualityBlocked
    ? [...history, current].slice(-5)
    : history;
  const buyPersistence = samples.filter((item) => (item.activeBuyRatio ?? 0) >= 0.52).length;
  const sellPersistence = samples.filter((item) => (item.activeBuyRatio ?? 1) <= 0.48).length;
  const previous = samples.length > 1 ? samples.at(-2) : null;
  const ofiVelocity = current.ofi !== null && previous && previous.ofi !== null
    ? round(current.ofi - previous.ofi)
    : null;
  const requiredSamples = 3;
  const qualityPass = current.available && !current.qualityBlocked && samples.length >= requiredSamples;
  const askCapacityQuantity = current.ask1Volume === null
    ? null
    : Math.floor(Math.max(0, current.ask1Volume) * 0.25 / 100) * 100;
  const bidCapacityQuantity = current.bid1Volume === null
    ? null
    : Math.floor(Math.max(0, current.bid1Volume) * 0.25 / 100) * 100;
  return {
    ...current,
    historySamples: Array.isArray(l2History) ? l2History.length : 0,
    validSamples: samples.length,
    requiredSamples,
    qualityPass,
    buyPersistence,
    sellPersistence,
    ofiVelocity,
    askCapacityQuantity,
    bidCapacityQuantity,
    capacityQuantity: Math.max(askCapacityQuantity ?? 0, bidCapacityQuantity ?? 0),
  };
}

export function computeVisibleFeatures({ minutes, index, previousClose, peers = [], externalContext = null, marketDate = null, l2 = null, l2History = [] }) {
  if (!Array.isArray(minutes) || index < 0 || index >= minutes.length) return null;
  const visible = minutes.slice(0, index + 1);
  const point = visible.at(-1);
  const open = visible[0]?.price;
  if (!point || !Number.isFinite(point.price) || !Number.isFinite(open) || open <= 0) return null;

  let weightedPrice = 0;
  let totalVolume = 0;
  let cumulativePrice = 0;
  const vwapSeries = visible.map((item, visibleIndex) => {
    const volume = Math.max(0, Number(item.volume) || 0);
    weightedPrice += item.price * volume;
    totalVolume += volume;
    cumulativePrice += item.price;
    return totalVolume > 0 ? weightedPrice / totalVolume : cumulativePrice / (visibleIndex + 1);
  });
  const vwap = vwapSeries.at(-1) || point.price;
  const price3 = visible[Math.max(0, visible.length - 4)]?.price ?? open;
  const price5 = visible[Math.max(0, visible.length - 6)]?.price ?? open;
  const ma5 = average(visible.slice(-5).map((item) => item.price));
  const priorMa5 = average(visible.slice(-10, -5).map((item) => item.price));
  const currentMa5Exact = rollingAverageAt(visible, visible.length - 1, 5, 3);
  const ma5ThreeMinutesAgo = rollingAverageAt(visible, visible.length - 4, 5, 3);
  const previousMa5 = rollingAverageAt(visible, visible.length - 2, 5, 3);
  const previousMa5ThreeMinutesAgo = rollingAverageAt(visible, visible.length - 5, 5, 3);
  const previousPrice = visible.at(-2)?.price ?? point.price;
  const previousPrice3 = visible[Math.max(0, visible.length - 5)]?.price ?? open;
  const priorVolumes = visible.slice(Math.max(0, visible.length - 21), -1).map((item) => Number(item.volume) || 0).filter((value) => value > 0);
  const volumeBase = median(priorVolumes) || average(priorVolumes) || Number(point.volume) || 1;

  const peerReturns = peers.flatMap((peer) => {
    const peerIndex = peer.minutes.findIndex((item) => item.time === point.time);
    if (peerIndex < 0) return [];
    const peerCurrent = peer.minutes[peerIndex]?.price;
    const peerPrior = peer.minutes[Math.max(0, peerIndex - 3)]?.price;
    if (!Number.isFinite(peerCurrent) || !Number.isFinite(peerPrior) || peerPrior <= 0) return [];
    return [percentChange(peerCurrent, peerPrior)];
  });
  const peerVwapBiases = peers.flatMap((peer) => {
    const peerIndex = peer.minutes.findIndex((item) => item.time === point.time);
    const value = visibleVwapBias(peer.minutes, peerIndex);
    return Number.isFinite(value) ? [value] : [];
  });
  const runningHigh = Math.max(...visible.map((item) => Number(item.high) || Number(item.price)).filter(Number.isFinite));
  const runningLow = Math.min(...visible.map((item) => Number(item.low) || Number(item.price)).filter(Number.isFinite));
  const range = runningHigh - runningLow;
  const intradayPosition = range > 0 ? (point.price - runningLow) / range : 0.5;
  const reboundFromLowPct = percentChange(point.price, runningLow);
  const currentMa5SlopeExact = ma5ThreeMinutesAgo > 0 ? percentChange(currentMa5Exact, ma5ThreeMinutesAgo) : 0;
  const previousMa5SlopeExact = previousMa5ThreeMinutesAgo > 0 ? percentChange(previousMa5, previousMa5ThreeMinutesAgo) : 0;
  const currentReturn3Pct = percentChange(point.price, price3);
  const previousReturn3Pct = percentChange(previousPrice, previousPrice3);
  const peerVwapBiasPct = peerVwapBiases.length ? average(peerVwapBiases) : 0;
  const trueRanges = visible.map((item, visibleIndex) => {
    const high = Number(item.high);
    const low = Number(item.low);
    const close = Number(item.price);
    const previousCloseValue = Number(visible[visibleIndex - 1]?.price);
    if (!Number.isFinite(close)) return null;
    const rangeHigh = Number.isFinite(high) ? high : close;
    const rangeLow = Number.isFinite(low) ? low : close;
    return visibleIndex === 0 || !Number.isFinite(previousCloseValue)
      ? Math.max(0, rangeHigh - rangeLow)
      : Math.max(0, rangeHigh - rangeLow, Math.abs(rangeHigh - previousCloseValue), Math.abs(rangeLow - previousCloseValue));
  }).filter(Number.isFinite).slice(-14);
  const atr14 = trueRanges.length ? average(trueRanges) : null;
  const atrPct14 = Number.isFinite(atr14) && point.price > 0 ? atr14 / point.price * 100 : null;

  return {
    time: point.time,
    price: round(point.price),
    open: round(open),
    previousClose: Number.isFinite(previousClose) ? round(previousClose) : null,
    vwap: round(vwap),
    gapPct: round(percentChange(open, previousClose)),
    openDeviationPct: round(percentChange(point.price, open)),
    vwapBiasPct: round(percentChange(point.price, vwap)),
    vwapSlope5Pct: round(percentChange(vwap, vwapSeries[Math.max(0, vwapSeries.length - 6)] || vwap)),
    return3Pct: round(currentReturn3Pct),
    previousReturn3Pct: round(previousReturn3Pct),
    return5Pct: round(percentChange(point.price, price5)),
    ma5SlopePct: round(priorMa5 > 0 ? percentChange(ma5, priorMa5) : percentChange(point.price, ma5)),
    ma5Slope3Pct: round(currentMa5SlopeExact),
    previousMa5Slope3Pct: round(previousMa5SlopeExact),
    intradayPosition: round(intradayPosition),
    reboundFromLowPct: round(reboundFromLowPct),
    volumeRatio: round((Number(point.volume) || 0) / volumeBase),
    peerBreadth3: peerReturns.length ? round(peerReturns.filter((value) => value > 0).length / peerReturns.length) : 0,
    peerCoverage: round(peerReturns.length / Math.max(1, peers.length)),
    peerVwapBiasPct: round(peerVwapBiasPct),
    zijinAlphaVwapPct: round(percentChange(point.price, vwap) - peerVwapBiasPct),
    visibleMinuteCount: visible.length,
    atr14: atr14 === null ? null : round(atr14),
    atrPct14: atrPct14 === null ? null : round(atrPct14),
    atrSamples: trueRanges.length,
    atrReady: trueRanges.length >= 5,
    buyTrendContinuationRisk: calculateZijinTrendContinuationRisk(visible, "正T"),
    sellTrendContinuationRisk: calculateZijinTrendContinuationRisk(visible, "反T"),
    // External factors remain prospective evidence. Frozen A-E ignore them;
    // preregistered model F may read only evidence available by this minute.
    externalContext,
    // This is a strictly same-minute snapshot. The observer intentionally
    // passes null for any retained minute that has no matching L2 timestamp.
    l2: buildLiveL2Snapshot(l2, l2History),
    marketDate,
  };
}

function strictRound10(features) {
  const parameters = SHADOW_MODELS.A.parameters;
  const votes = [
    features.return3Pct > 0,
    features.ma5SlopePct > 0,
    features.vwapBiasPct >= 0,
  ];
  const passedVotes = votes.filter(Boolean).length;
  const failures = [];
  if (features.gapPct > -parameters.gapAbsPct) failures.push("低开幅度不足0.60%");
  if (features.openDeviationPct < parameters.repairPct) failures.push("尚未修复开盘价0.16%");
  if (passedVotes < parameters.confirmationVotesRequired) failures.push(`确认票不足${parameters.confirmationVotesRequired}票（当前${passedVotes}票）`);
  return { passed: failures.length === 0, failures, votes: passedVotes };
}

function coverageRound11(features) {
  const parameters = SHADOW_MODELS.B.parameters;
  const votes = [
    features.return3Pct > 0,
    features.ma5SlopePct > 0,
    features.vwapSlope5Pct >= 0,
    features.openDeviationPct > 0,
  ];
  const passedVotes = votes.filter(Boolean).length;
  const failures = [];
  if (Math.abs(features.vwapBiasPct) > parameters.maximumVwapDistancePct) failures.push("距VWAP超过0.30%");
  if (features.peerCoverage < 0.8) failures.push("同业覆盖不足80%");
  if (features.peerBreadth3 < parameters.minimumPeerBreadth) failures.push("同业转强不足50%");
  if (features.volumeRatio < parameters.minimumVolumeRatio) failures.push("分钟量比不足0.70");
  if (passedVotes < parameters.confirmationVotesRequired) failures.push(`转强确认不足${parameters.confirmationVotesRequired}票（当前${passedVotes}票）`);
  return { passed: failures.length === 0, failures, votes: passedVotes };
}

function reverseRound12(features) {
  const parameters = SHADOW_MODELS.C.parameters;
  const reverseTurn = (
    features.return3Pct < 0 && features.previousReturn3Pct >= 0
  ) || (
    features.ma5Slope3Pct < 0 && features.previousMa5Slope3Pct >= 0
  );
  const reverseLocation = features.vwapBiasPct >= 0.10
    || features.intradayPosition >= 0.65
    || features.reboundFromLowPct >= 0.60;
  const failures = [];
  if (!reverseTurn) failures.push("尚未出现实时转弱交叉");
  if (!reverseLocation) failures.push("尚未出现反T位置锚点");
  if (features.peerCoverage < 0.8) failures.push("同业实时覆盖不足80%");
  if (features.intradayPosition > parameters.maximumIntradayPosition) failures.push("日内位置高于44.12%");
  if (features.zijinAlphaVwapPct < parameters.minimumAlphaVwapPct) failures.push("相对同业VWAP优势不足0.3034%");
  if (features.return5Pct > parameters.maximumReturn5Pct) failures.push("5分钟回落不足0.1104%");
  return { passed: failures.length === 0, failures, votes: Math.max(0, 6 - failures.length) };
}

function reverseHighAnchorRound13(features) {
  const parameters = SHADOW_MODELS.D.parameters;
  const reverseTurn = (
    features.return3Pct < 0 && features.previousReturn3Pct >= 0
  ) || (
    features.ma5Slope3Pct < 0 && features.previousMa5Slope3Pct >= 0
  );
  const failures = [];
  if (!reverseTurn) failures.push("尚未出现实时转弱交叉");
  if (features.intradayPosition < parameters.minimumIntradayPosition) failures.push("日内位置未达到高位区68%");
  if (features.vwapBiasPct < parameters.minimumVwapBiasPct) failures.push("价格高于VWAP不足0.25%");
  if (features.zijinAlphaVwapPct < parameters.minimumAlphaVwapPct) failures.push("相对同业VWAP优势不足0.15%");
  if (features.volumeRatio < parameters.minimumVolumeRatio) failures.push("分钟量比不足0.70");
  if (features.peerCoverage < parameters.minimumPeerCoverage) failures.push("同业实时覆盖不足80%");
  return { passed: failures.length === 0, failures, votes: Math.max(0, 6 - failures.length) };
}

function positiveVwapDeviationRound14(features) {
  const parameters = SHADOW_MODELS.E.parameters;
  const positiveTurn = (
    features.return3Pct > 0 && features.previousReturn3Pct <= 0
  ) || (
    features.ma5Slope3Pct > 0 && features.previousMa5Slope3Pct <= 0
  );
  const failures = [];
  if (!positiveTurn) failures.push("尚未出现实时转强交叉");
  if (features.vwapBiasPct > parameters.maximumVwapBiasPct) failures.push("低于VWAP不足0.35%");
  if (features.intradayPosition > parameters.maximumIntradayPosition) failures.push("日内位置高于低位区30%");
  if (features.volumeRatio < parameters.minimumVolumeRatio) failures.push("分钟量比不足0.70");
  if (features.peerBreadth3 < parameters.minimumPeerBreadth) failures.push("同业转强不足33%");
  if (features.peerCoverage < parameters.minimumPeerCoverage) failures.push("同业实时覆盖不足80%");
  return { passed: failures.length === 0, failures, votes: Math.max(0, 6 - failures.length) };
}

function positiveExternalResonanceRound15(features) {
  const parameters = SHADOW_MODELS.F.parameters;
  const positiveTurn = (
    features.return3Pct > 0 && features.previousReturn3Pct <= 0
  ) || (
    features.ma5Slope3Pct > 0 && features.previousMa5Slope3Pct <= 0
  );
  const external = causalExternalSnapshot(features.externalContext, features.marketDate, features.time);
  const failures = [];
  if (!positiveTurn) failures.push("尚未出现实时转强交叉");
  if (features.vwapBiasPct > parameters.maximumVwapBiasPct) failures.push("低于VWAP不足0.25%");
  if (features.intradayPosition > parameters.maximumIntradayPosition) failures.push("日内位置高于低位区35%");
  if (features.volumeRatio < parameters.minimumVolumeRatio) failures.push("分钟量比不足0.70");
  if (features.peerCoverage < parameters.minimumPeerCoverage) failures.push("同业实时覆盖不足80%");
  if (external.ready < parameters.minimumExternalCoverage) failures.push("外部因子因果覆盖不足4项");
  if (external.supportVotes < parameters.minimumExternalSupportVotes) failures.push("黄金、铜价、大盘与港股紫金共振不足3票");
  if (external.hardLock) failures.push("当时已发布的重大利空触发锁定");
  return { passed: failures.length === 0, failures, votes: Math.max(0, 7 - failures.length), external };
}

function positiveMultiMarketConsensusRound16(features) {
  const parameters = SHADOW_MODELS.G.parameters;
  const positiveTurn = (
    features.return3Pct > 0 && features.previousReturn3Pct <= 0
  ) || (
    features.ma5Slope3Pct > 0 && features.previousMa5Slope3Pct <= 0
  );
  const pullbackAnchor = features.vwapBiasPct <= parameters.maximumVwapBiasPct
    || features.intradayPosition <= parameters.maximumIntradayPosition;
  const external = causalExternalConsensus(features.externalContext, features.marketDate, features.time);
  const failures = [];
  if (!positiveTurn) failures.push("尚未出现实时转强交叉");
  if (!pullbackAnchor) failures.push("未处于VWAP折价或日内低位");
  if (features.volumeRatio < parameters.minimumVolumeRatio) failures.push("分钟量比不足0.65");
  if (features.peerCoverage < parameters.minimumPeerCoverage) failures.push("同行实时覆盖不足80%");
  if (external.ready < parameters.minimumExternalCoverage) failures.push("真实外因因果覆盖不足6项");
  if (external.supportGroups < parameters.minimumSupportGroups) failures.push("商品与权益传导分组尚未形成共识");
  if (external.hardLock) failures.push("当时已发布的重大利空触发锁定");
  return { passed: failures.length === 0, failures, votes: Math.max(0, 7 - failures.length), external };
}

function rangeReverseQualityRound17(features) {
  const parameters = SHADOW_MODELS.H.parameters;
  const reverseTurn = (
    features.return3Pct <= parameters.maximumReturn3Pct && features.previousReturn3Pct >= 0
  ) || (
    features.ma5Slope3Pct < 0 && features.previousMa5Slope3Pct >= 0
  );
  const permission = features.preopenPermission || null;
  const l2 = features.l2 || buildLiveL2Snapshot();
  const failures = [];
  if (features.visibleMinuteCount < 16) failures.push("可见分钟不足，暂不判断震荡结构");
  if (!reverseTurn) failures.push("尚未出现因果转弱交叉");
  if (features.intradayPosition < parameters.minimumIntradayPosition) failures.push("未处于日内高位锚点");
  if (features.vwapBiasPct < parameters.minimumVwapBiasPct) failures.push("价格未显著高于 VWAP");
  if (features.volumeRatio < parameters.minimumVolumeRatio) failures.push("分钟量比不足");
  if (features.peerCoverage < 0.8) failures.push("同行实时覆盖不足80%");
  if (features.peerBreadth3 > parameters.maximumPeerBreadth) failures.push("同行仍处于广泛同步走强");
  if (!l2.available) failures.push("当分钟 L2 快照不可用或已过期");
  else if (l2.qualityBlocked) failures.push("L2 流动性或价差异常");
  else if (l2.sellVotes < parameters.minimumL2SellVotes) failures.push("L2 卖方确认不足");
  if (permission?.active && permission.wouldBlock) failures.push("盘前方向许可未放行反T");
  return {
    passed: failures.length === 0,
    failures,
    votes: Math.max(0, 9 - failures.length),
    l2,
    preopenPermission: permission,
  };
}

export function buildDynamicTradePolicy(price, features = {}, side = "long") {
  const safePrice = Number(price);
  const l2 = features.l2 || buildLiveL2Snapshot();
  const capacityQuantity = side === "short" ? l2.bidCapacityQuantity : l2.askCapacityQuantity;
  const quantity = Number.isFinite(capacityQuantity) ? Math.floor(capacityQuantity / 100) * 100 : 0;
  if (!Number.isFinite(safePrice) || safePrice <= 0) {
    return { eligible: false, reason: "价格无效", quantity: 0 };
  }
  if (!l2.qualityPass || quantity < 100) {
    return {
      eligible: false,
      reason: !l2.qualityPass ? "连续L2质量不足3个有效分钟" : "盘口深度不足100股",
      quantity,
      capacityQuantity,
    };
  }
  const economic = calculateZijinEconomicThreshold(safePrice, {
    quantity,
    minimumGrossSpreadYuan: 0.08,
  });
  const atrTargetPct = Math.max(0, Number(features.atrPct14) || 0) * 0.5;
  const fixedMovePct = 0.08 / safePrice * 100;
  const targetGrossPct = Math.max(atrTargetPct, fixedMovePct, economic.roundTripCostPct * 2);
  const costPct = economic.roundTripCostPct;
  const stressCostPct = costPct + 0.06;
  const stopGrossPct = Math.max(0.30, targetGrossPct * 0.75);
  return {
    eligible: true,
    side,
    quantity,
    capacityQuantity,
    economic,
    atrTargetPct: round(atrTargetPct),
    fixedMovePct: round(fixedMovePct),
    targetGrossPct: round(targetGrossPct),
    targetNetPct: round(targetGrossPct - costPct),
    stopGrossPct: round(stopGrossPct),
    stopNetPct: round(-stopGrossPct - costPct),
    costPct: round(costPct),
    stressCostPct: round(stressCostPct),
  };
}

function externalV3Confirmation(features, parameters) {
  const external = causalExternalSnapshot(features.externalContext, features.marketDate, features.time);
  const failures = [];
  if (external.ready < parameters.minimumExternalReady) failures.push(`外部因子因果覆盖不足${parameters.minimumExternalReady}项`);
  if (external.supportVotes < parameters.minimumExternalSupportVotes) failures.push("大盘、商品与港股紫金共振不足");
  if (external.hardLock) failures.push("当时已发布的重大利空触发锁定");
  return { external, failures };
}

function dynamicPositiveV3(features) {
  const parameters = SHADOW_MODELS.I.parameters;
  const l2 = features.l2 || buildLiveL2Snapshot();
  const external = externalV3Confirmation(features, parameters);
  const positiveTurn = (features.return3Pct > 0 && features.previousReturn3Pct <= 0)
    || (features.ma5Slope3Pct > 0 && features.previousMa5Slope3Pct <= 0);
  const failures = [...external.failures];
  if (!positiveTurn) failures.push("尚未出现3分钟转强交叉");
  if (features.vwapBiasPct > parameters.maximumVwapBiasPct) failures.push("未处于VWAP低位确认区");
  if (features.intradayPosition > 0.45) failures.push("日内位置已脱离低位区");
  if (features.peerCoverage < parameters.minimumPeerCoverage) failures.push("同业实时覆盖不足80%");
  if (features.peerBreadth3 < parameters.minimumPeerBreadth) failures.push("同业转强不足33%");
  if (!features.atrReady || features.atrSamples < parameters.minimumAtrSamples) failures.push("ATR有效样本不足");
  if (!l2.qualityPass) failures.push("连续L2有效质量不足3/5");
  if (l2.buyPersistence < parameters.minimumL2Persistence) failures.push("L2买方持续性不足3分钟");
  if (l2.ofi === null || l2.ofi < 0.01) failures.push("L2 OFI未转正");
  if (l2.ofiVelocity !== null && l2.ofiVelocity < -0.03) failures.push("L2 OFI变化速度恶化");
  const policy = buildDynamicTradePolicy(features.price, features, "long");
  if (!policy.eligible) failures.push(policy.reason);
  return { passed: failures.length === 0, failures, votes: Math.max(0, 10 - failures.length), l2, external: external.external, policy };
}

function dynamicReverseV3(features) {
  const parameters = SHADOW_MODELS.J.parameters;
  const l2 = features.l2 || buildLiveL2Snapshot();
  const external = externalV3Confirmation(features, parameters);
  const reverseTurn = (features.return3Pct < 0 && features.previousReturn3Pct >= 0)
    || (features.ma5Slope3Pct < 0 && features.previousMa5Slope3Pct >= 0);
  const failures = [...external.failures];
  if (!reverseTurn) failures.push("尚未出现3分钟转弱交叉");
  if (features.vwapBiasPct < parameters.minimumVwapBiasPct) failures.push("价格高于VWAP不足0.20%");
  if (features.intradayPosition < parameters.minimumIntradayPosition) failures.push("日内位置未达到高位区68%");
  if (features.peerCoverage < parameters.minimumPeerCoverage) failures.push("同业实时覆盖不足80%");
  if (!features.atrReady || features.atrSamples < parameters.minimumAtrSamples) failures.push("ATR有效样本不足");
  if (!l2.qualityPass) failures.push("连续L2有效质量不足3/5");
  if (l2.sellPersistence < parameters.minimumL2Persistence) failures.push("L2卖方持续性不足3分钟");
  if (l2.ofi === null || l2.ofi > -0.01) failures.push("L2 OFI未转弱");
  if (l2.ofiVelocity !== null && l2.ofiVelocity > 0.03) failures.push("L2 OFI变化速度反向");
  const policy = buildDynamicTradePolicy(features.price, features, "short");
  if (!policy.eligible) failures.push(policy.reason);
  return { passed: failures.length === 0, failures, votes: Math.max(0, 10 - failures.length), l2, external: external.external, policy };
}

export function evaluateShadowCandidate(modelKey, features) {
  const model = SHADOW_MODELS[modelKey];
  if (!model || !features) return { passed: false, failures: ["模型或特征无效"], votes: 0 };
  if (!inSession(features.time, model)) return { passed: false, failures: ["不在固定观察窗口"], votes: 0 };
  const trendContinuationRisk = model.side === "short"
    ? features.sellTrendContinuationRisk
    : features.buyTrendContinuationRisk;
  if (trendContinuationRisk?.blocked) {
    return {
      passed: false,
      failures: [`方向硬门禁：${trendContinuationRisk.reason}`],
      votes: 0,
      trendContinuationRisk,
    };
  }
  if (modelKey === "A") return strictRound10(features);
  if (modelKey === "B") return coverageRound11(features);
  if (modelKey === "C") return reverseRound12(features);
  if (modelKey === "D") return reverseHighAnchorRound13(features);
  if (modelKey === "E") return positiveVwapDeviationRound14(features);
  if (modelKey === "F") return positiveExternalResonanceRound15(features);
  if (modelKey === "G") return positiveMultiMarketConsensusRound16(features);
  if (modelKey === "H") return rangeReverseQualityRound17(features);
  if (modelKey === "I") return dynamicPositiveV3(features);
  if (modelKey === "J") return dynamicReverseV3(features);
  return { passed: false, failures: ["未知影子模型"], votes: 0 };
}

function emptyModelState(model) {
  return {
    ...model,
    today: { candidates: 0, entries: 0, exits: 0, wins: 0, netPct: 0, lastDecision: "等待观察窗口", activeTrade: null },
    total: { candidateDays: 0, candidates: 0, resolvedTrades: 0, wins: 0, winRate: null, netPct: 0, stressNetPct: 0 },
    rejectionReasons: {},
  };
}

export function createShadowState(now = new Date().toISOString()) {
  return {
    schemaVersion: 5,
    experimentId: "zijin-round10-vs-round11-forward-shadow",
    stock: { code: "601899", name: "紫金矿业" },
    registeredAt: now,
    updatedAt: now,
    status: "waiting",
    affectsV4: false,
    sendsAlerts: false,
    usesFutureMinutes: false,
    fillPolicy: "minute-t-close decision; minute-t+1 price shadow fill",
    costPolicy: { baseRoundTripPct: COST_PCT, stressRoundTripPct: STRESS_COST_PCT },
    targetPolicy: { minimumNetPct: MIN_NET_TARGET_PCT, maximumNetPct: MAX_NET_TARGET_PCT, maximumHoldMinutes: MAX_HOLD_MINUTES },
    prospectiveGate: { ...PROSPECTIVE_GATE },
    marketDate: null,
    lastProcessedMinute: null,
    l2History: [],
    source: { provider: null, sourceTimestamp: null, fetchedAt: null, error: null },
    models: Object.fromEntries(Object.entries(SHADOW_MODELS).map(([key, model]) => [key, emptyModelState(model)])),
    directionPermission: emptyDirectionPermissionState(),
    rangeReverseQuality: emptyRangeReverseQualityState(),
    integrity: { eventCount: 0, lastHash: "GENESIS" },
  };
}

export function upgradeShadowState(value, now = new Date().toISOString()) {
  if (!value || typeof value !== "object") return createShadowState(now);
  const upgraded = { ...value, schemaVersion: 5, updatedAt: value.updatedAt || now };
  upgraded.l2History = Array.isArray(value.l2History)
    ? value.l2History.filter((item) => item && typeof item.time === "string" && item.snapshot).slice(-8)
    : [];
  const storedGate = value.prospectiveGate || {};
  upgraded.prospectiveGate = {
    ...PROSPECTIVE_GATE,
    ...storedGate,
    minimumResolvedTrades: Math.max(
      PROSPECTIVE_GATE.minimumResolvedTrades,
      Number(storedGate.minimumResolvedTrades) || 0,
    ),
    minimumWinRate: Math.max(
      PROSPECTIVE_GATE.minimumWinRate,
      Number(storedGate.minimumWinRate) || 0,
    ),
    minimumResearchCandidateWinRate: Math.min(
      PROSPECTIVE_GATE.minimumWinRate,
      Math.max(
        PROSPECTIVE_GATE.minimumResearchCandidateWinRate,
        Number(storedGate.minimumResearchCandidateWinRate) || 0,
      ),
    ),
  };
  upgraded.models = { ...(value.models || {}) };
  for (const [key, config] of Object.entries(SHADOW_MODELS)) {
    if (!upgraded.models[key]) upgraded.models[key] = emptyModelState(config);
    else upgraded.models[key] = { ...upgraded.models[key], ...config };
  }
  const directionPermission = { ...emptyDirectionPermissionState(), ...(value.directionPermission || {}) };
  directionPermission.promotionGate = { ...DIRECTION_PERMISSION_PROMOTION_GATE, ...(value.directionPermission?.promotionGate || {}) };
  directionPermission.marketDates = Array.isArray(directionPermission.marketDates) ? directionPermission.marketDates : [];
  directionPermission.pending = Array.isArray(directionPermission.pending) ? directionPermission.pending : [];
  directionPermission.resolved = Array.isArray(directionPermission.resolved) ? directionPermission.resolved.slice(-500) : [];
  directionPermission.today = { ...emptyDirectionPermissionState().today, ...(directionPermission.today || {}) };
  directionPermission.total = { ...emptyDirectionPermissionState().total, ...(directionPermission.total || {}) };
  upgraded.directionPermission = directionPermission;
  const rangeReverseQuality = { ...emptyRangeReverseQualityState(), ...(value.rangeReverseQuality || {}) };
  const storedRangeGate = value.rangeReverseQuality?.promotionGate || {};
  rangeReverseQuality.promotionGate = {
    ...RANGE_REVERSE_QUALITY_PROMOTION_GATE,
    ...storedRangeGate,
    minimumResolvedSignals: Math.max(
      RANGE_REVERSE_QUALITY_PROMOTION_GATE.minimumResolvedSignals,
      Number(storedRangeGate.minimumResolvedSignals) || 0,
    ),
    minimumWinRate: Math.max(
      RANGE_REVERSE_QUALITY_PROMOTION_GATE.minimumWinRate,
      Number(storedRangeGate.minimumWinRate) || 0,
    ),
    minimumSignalsPer100StockDays: Math.max(
      RANGE_REVERSE_QUALITY_PROMOTION_GATE.minimumSignalsPer100StockDays,
      Number(storedRangeGate.minimumSignalsPer100StockDays) || 0,
    ),
    requirePositiveAfterCostNet: true,
    manualReviewRequired: true,
  };
  rangeReverseQuality.marketDates = Array.isArray(rangeReverseQuality.marketDates) ? rangeReverseQuality.marketDates : [];
  rangeReverseQuality.pending = Array.isArray(rangeReverseQuality.pending) ? rangeReverseQuality.pending : [];
  rangeReverseQuality.resolved = Array.isArray(rangeReverseQuality.resolved) ? rangeReverseQuality.resolved.slice(-500) : [];
  rangeReverseQuality.today = { ...emptyRangeReverseQualityState().today, ...(rangeReverseQuality.today || {}) };
  rangeReverseQuality.total = { ...emptyRangeReverseQualityState().total, ...(rangeReverseQuality.total || {}) };
  upgraded.rangeReverseQuality = rangeReverseQuality;
  upgraded.integrity ||= { eventCount: 0, lastHash: "GENESIS" };
  return upgraded;
}

function resetForDate(state, marketDate) {
  if (state.marketDate === marketDate) return state;
  state.marketDate = marketDate;
  state.lastProcessedMinute = null;
  for (const model of Object.values(state.models)) {
    model.today = { candidates: 0, entries: 0, exits: 0, wins: 0, netPct: 0, lastDecision: "等待观察窗口", activeTrade: null };
  }
  state.directionPermission ||= emptyDirectionPermissionState();
  state.directionPermission.today = { rawSignals: 0, permittedSignals: 0, blockedSignals: 0, resolvedSignals: 0 };
  if (!state.directionPermission.marketDates.includes(marketDate)) {
    state.directionPermission.marketDates = [...state.directionPermission.marketDates, marketDate].slice(-500);
  }
  state.rangeReverseQuality ||= emptyRangeReverseQualityState();
  state.rangeReverseQuality.today = { candidates: 0, resolvedSignals: 0 };
  if (!state.rangeReverseQuality.marketDates.includes(marketDate)) {
    state.rangeReverseQuality.marketDates = [...state.rangeReverseQuality.marketDates, marketDate].slice(-500);
  }
  return state;
}

function recordDirectionPermissionCandidate(state, { marketDate, model, point, index, direction, permission }) {
  if (!permission.active) return null;
  const audit = state.directionPermission;
  const signal = {
    id: `${marketDate}:${model}:${point.time}:${direction}`,
    event: "direction-permission-pending",
    marketDate,
    model,
    time: point.time,
    index,
    price: round(point.price),
    direction,
    blocked: permission.wouldBlock,
    permission,
  };
  audit.pending.push(signal);
  audit.today.rawSignals += 1;
  audit.total.rawSignals += 1;
  if (permission.wouldBlock) {
    audit.today.blockedSignals += 1;
    audit.total.blockedSignals += 1;
  } else {
    audit.today.permittedSignals += 1;
    audit.total.permittedSignals += 1;
  }
  return signal;
}

function resolveDirectionPermissionOutcomes(state, { minutes, index }) {
  const audit = state.directionPermission;
  if (!audit?.pending?.length) return [];
  const pending = [];
  const events = [];
  for (const signal of audit.pending) {
    if (index < signal.index + 30) {
      pending.push(signal);
      continue;
    }
    const outcomes = [5, 15, 30].map((minutesAhead) => {
      const endPoint = minutes[signal.index + minutesAhead] || null;
      if (!endPoint || !Number.isFinite(Number(endPoint.price))) return { minutes: minutesAhead, complete: false };
      const result = calculateDirectionalAfterCostPct(signal.price, Number(endPoint.price), signal.direction);
      return {
        minutes: minutesAhead,
        complete: true,
        endTime: endPoint.time,
        price: round(endPoint.price),
        ...result,
      };
    });
    const outcome = {
      ...signal,
      event: "direction-permission-outcome",
      resolvedAt: minutes[index]?.time || null,
      outcomes,
    };
    audit.resolved = [...audit.resolved, outcome].slice(-500);
    audit.today.resolvedSignals += 1;
    audit.total.resolvedSignals += 1;
    events.push(outcome);
  }
  audit.pending = pending;
  audit.summary = summarizeZijinDirectionPermissionAB({
    ledger: audit.resolved,
    stockDays: audit.marketDates.length,
  });
  return events;
}

function recordRangeReverseQualityCandidate(state, { marketDate, model, point, index, features, decision }) {
  const audit = state.rangeReverseQuality;
  const signal = {
    id: `${marketDate}:${model}:${point.time}:反T`,
    event: "range-reverse-quality-pending",
    marketDate,
    model,
    time: point.time,
    index,
    price: round(point.price),
    direction: "反T",
    factorSnapshot: {
      visibleMinuteCount: features.visibleMinuteCount,
      intradayPosition: round(features.intradayPosition),
      vwapBiasPct: round(features.vwapBiasPct),
      volumeRatio: round(features.volumeRatio),
      return3Pct: round(features.return3Pct),
      previousReturn3Pct: round(features.previousReturn3Pct),
      ma5Slope3Pct: round(features.ma5Slope3Pct),
      previousMa5Slope3Pct: round(features.previousMa5Slope3Pct),
      peerCoverage: round(features.peerCoverage),
      peerBreadth3: round(features.peerBreadth3),
      l2: decision.l2,
      preopenPermission: decision.preopenPermission,
    },
  };
  audit.pending.push(signal);
  audit.today.candidates += 1;
  audit.total.candidates += 1;
  return signal;
}

function resolveRangeReverseQualityOutcomes(state, { minutes, index }) {
  const audit = state.rangeReverseQuality;
  if (!audit?.pending?.length) return [];
  const pending = [];
  const events = [];
  for (const signal of audit.pending) {
    if (index < signal.index + 30) {
      pending.push(signal);
      continue;
    }
    const outcomes = [5, 15, 30].map((minutesAhead) => {
      const endPoint = minutes[signal.index + minutesAhead] || null;
      if (!endPoint || !Number.isFinite(Number(endPoint.price))) return { minutes: minutesAhead, complete: false };
      const result = calculateDirectionalAfterCostPct(signal.price, Number(endPoint.price), signal.direction);
      return {
        minutes: minutesAhead,
        complete: true,
        endTime: endPoint.time,
        price: round(endPoint.price),
        ...result,
      };
    });
    const outcome = {
      ...signal,
      event: "range-reverse-quality-outcome",
      resolvedAt: minutes[index]?.time || null,
      outcomes,
    };
    audit.resolved = [...audit.resolved, outcome].slice(-500);
    audit.today.resolvedSignals += 1;
    audit.total.resolvedSignals += 1;
    events.push(outcome);
  }
  audit.pending = pending;
  audit.summary = summarizeZijinRangeReverseQuality({
    ledger: audit.resolved,
    stockDays: audit.marketDates.length,
  });
  return events;
}

function incrementReason(model, reason) {
  model.rejectionReasons[reason] = (model.rejectionReasons[reason] || 0) + 1;
}

function closeTrade(model, point, reason) {
  const trade = model.today.activeTrade;
  const grossPct = trade.side === "short"
    ? -percentChange(point.price, trade.entryPrice)
    : percentChange(point.price, trade.entryPrice);
  const costPct = Number.isFinite(Number(trade.costPct)) ? Number(trade.costPct) : COST_PCT;
  const stressCostPct = Number.isFinite(Number(trade.stressCostPct)) ? Number(trade.stressCostPct) : STRESS_COST_PCT;
  const netPct = grossPct - costPct;
  const stressNetPct = grossPct - stressCostPct;
  const win = netPct > 0;
  const result = {
    event: "exit",
    model: trade.model,
    side: trade.side,
    time: point.time,
    price: round(point.price),
    reason,
    entryTime: trade.entryTime,
    entryPrice: trade.entryPrice,
    holdMinutes: minuteNumber(point.time) - minuteNumber(trade.entryTime),
    grossPct: round(grossPct),
    netPct: round(netPct),
    stressNetPct: round(stressNetPct),
    quantity: trade.quantity ?? null,
    targetGrossPct: trade.targetGrossPct ?? null,
    stopGrossPct: trade.stopGrossPct ?? null,
    dynamicCostPct: trade.dynamicCostPct ?? null,
    win,
  };
  model.today.activeTrade = null;
  model.today.exits += 1;
  model.today.wins += win ? 1 : 0;
  model.today.netPct = round(model.today.netPct + netPct);
  model.total.resolvedTrades += 1;
  model.total.wins += win ? 1 : 0;
  model.total.winRate = round(model.total.wins / model.total.resolvedTrades);
  model.total.netPct = round(model.total.netPct + netPct);
  model.total.stressNetPct = round(model.total.stressNetPct + stressNetPct);
  model.today.lastDecision = `${point.time} 影子平仓：${reason}`;
  return result;
}

export function processVisibleMinute(state, context) {
  const { marketDate, minutes, index, previousClose, peers = [], externalContext = null, preopenGate = null, l2 = null, l2History = [] } = context;
  resetForDate(state, marketDate);
  const point = minutes[index];
  const features = computeVisibleFeatures({ minutes, index, previousClose, peers, externalContext, marketDate, l2, l2History });
  if (!point || !features || state.lastProcessedMinute === point.time) return [];
  const events = [
    ...resolveDirectionPermissionOutcomes(state, { minutes, index }),
    ...resolveRangeReverseQualityOutcomes(state, { minutes, index }),
  ];

  for (const [modelKey, config] of Object.entries(SHADOW_MODELS)) {
    const model = state.models[modelKey];
    const trade = model.today.activeTrade;
    if (trade?.pendingEntry) {
      trade.pendingEntry = false;
      trade.entryTime = point.time;
      trade.entryPrice = round(point.price);
      trade.peakPrice = round(point.price);
      trade.troughPrice = round(point.price);
      trade.model = modelKey;
      trade.side = config.side;
      model.today.entries += 1;
      model.today.lastDecision = `${point.time} 下一分钟影子${config.side === "short" ? "先卖" : "买入"}`;
      events.push({
        event: "entry",
        model: modelKey,
        side: config.side,
        time: point.time,
        price: trade.entryPrice,
        candidateTime: trade.candidateTime,
        features: trade.features,
        quantity: trade.quantity ?? null,
        targetGrossPct: trade.targetGrossPct ?? null,
        stopGrossPct: trade.stopGrossPct ?? null,
        dynamicCostPct: trade.dynamicCostPct ?? null,
      });
      continue;
    }
    if (trade?.entryPrice) {
      trade.peakPrice = Math.max(trade.peakPrice, point.price);
      trade.troughPrice = Math.min(trade.troughPrice, point.price);
      const shortSide = trade.side === "short";
      const dynamic = trade.v3 === true;
      const costPct = dynamic ? trade.costPct : COST_PCT;
      const netPct = (shortSide ? -percentChange(point.price, trade.entryPrice) : percentChange(point.price, trade.entryPrice)) - costPct;
      const bestNetPct = (shortSide ? -percentChange(trade.troughPrice, trade.entryPrice) : percentChange(trade.peakPrice, trade.entryPrice)) - costPct;
      const givebackPct = shortSide ? percentChange(point.price, trade.troughPrice) : percentChange(trade.peakPrice, point.price);
      const held = minuteNumber(point.time) - minuteNumber(trade.entryTime);
      let exitReason = null;
      if (dynamic) {
        const v3Target = Number(trade.targetNetPct);
        const v3Stop = Number(trade.stopNetPct);
        const trendInvalid = shortSide
          ? (features.return3Pct > 0.08 && features.ma5Slope3Pct > 0)
          : (features.return3Pct < -0.08 && features.ma5Slope3Pct < 0);
        if (Number.isFinite(v3Target) && netPct >= v3Target) exitReason = `${shortSide ? "反T" : "正T"}达到动态目标${trade.targetGrossPct.toFixed(3)}%`;
        else if (bestNetPct >= v3Target && givebackPct >= TRAILING_GIVEBACK_PCT) exitReason = "动态目标后回撤";
        else if (trendInvalid) exitReason = `${shortSide ? "反T" : "正T"}趋势失效退出`;
        else if (Number.isFinite(v3Stop) && netPct <= v3Stop) exitReason = `${shortSide ? "反T" : "正T"}动态止损`;
        else if (held >= trade.maxHoldMinutes) exitReason = `独立持有达到${trade.maxHoldMinutes}分钟`;
      } else if (netPct >= MAX_NET_TARGET_PCT) exitReason = "达到1.00%最大净止盈";
      else if (bestNetPct >= MIN_NET_TARGET_PCT && givebackPct >= TRAILING_GIVEBACK_PCT) exitReason = "达到0.64%后回撤0.15%";
      else if (netPct <= STOP_NET_PCT) exitReason = "净亏损达到-0.45%";
      else if (held >= MAX_HOLD_MINUTES) exitReason = "持有达到60分钟";
      else if (point.time >= "1450") exitReason = "14:50影子恢复底仓";
      if (exitReason) events.push(closeTrade(model, point, exitReason));
      continue;
    }

    if (!inSession(point.time, config)) continue;
    if (model.today.candidates >= config.maxSignalsPerDay) continue;
    const direction = directionForShadowSide(config.side);
    const directionPermission = resolveZijinPreopenDirectionPermission({
      gate: preopenGate,
      direction,
      time: point.time,
    });
    const candidateFeatures = modelKey === "H"
      ? { ...features, preopenPermission: directionPermission }
      : features;
    const decision = evaluateShadowCandidate(modelKey, candidateFeatures);
    if (decision.passed) {
      model.today.candidates += 1;
      model.total.candidates += 1;
      if (model.today.candidates === 1) model.total.candidateDays += 1;
      const observationOnly = config.executionMode === "observe-only";
      const directionPermissionSignal = modelKey === "H"
        ? null
        : recordDirectionPermissionCandidate(state, {
          marketDate,
          model: modelKey,
          point,
          index,
          direction,
          permission: directionPermission,
        });
      const rangeReverseQualitySignal = modelKey === "H"
        ? recordRangeReverseQualityCandidate(state, {
          marketDate,
          model: modelKey,
          point,
          index,
          features: candidateFeatures,
          decision,
        })
        : null;
      if (!observationOnly) {
        const v3 = modelKey === "I" || modelKey === "J";
        const policy = decision.policy || null;
        model.today.activeTrade = {
          pendingEntry: true,
          candidateTime: point.time,
          features: candidateFeatures,
          ...(v3 && policy ? {
            v3: true,
            policy,
            quantity: policy.quantity,
            targetGrossPct: policy.targetGrossPct,
            targetNetPct: policy.targetNetPct,
            stopGrossPct: policy.stopGrossPct,
            stopNetPct: policy.stopNetPct,
            costPct: policy.costPct,
            stressCostPct: policy.stressCostPct,
            dynamicCostPct: policy.costPct,
            maxHoldMinutes: SHADOW_MODELS[modelKey].parameters.maxHoldMinutes,
          } : {}),
        };
      }
      model.today.lastDecision = observationOnly
        ? `${point.time} 反T候选成立，仅观察不生成影子成交`
        : `${point.time} 正T候选成立，等待下一分钟影子成交`;
      events.push({
        event: "candidate",
        model: modelKey,
        time: point.time,
        price: point.price,
        features: candidateFeatures,
        votes: decision.votes,
        executionMode: config.executionMode,
        observationOnly,
        direction,
        directionPermission,
        directionPermissionSignalId: directionPermissionSignal?.id || null,
        rangeReverseQualitySignalId: rangeReverseQualitySignal?.id || null,
      });
    } else {
      for (const reason of decision.failures) incrementReason(model, reason);
      model.today.lastDecision = `${point.time} 未通过：${decision.failures[0]}`;
    }
  }

  state.lastProcessedMinute = point.time;
  state.updatedAt = new Date().toISOString();
  state.status = point.time < "0933" ? "waiting" : point.time < "1500" ? "observing" : "closed";
  return events;
}

export function appendIntegrity(event, previousHash = "GENESIS") {
  const record = { ...event, previousHash };
  const hash = createHash("sha256").update(JSON.stringify(record)).digest("hex");
  return { ...record, hash };
}

export const SHADOW_CONSTANTS = Object.freeze({
  COST_PCT,
  STRESS_COST_PCT,
  MIN_NET_TARGET_PCT,
  MAX_NET_TARGET_PCT,
  RANGE_REVERSE_QUALITY_PROMOTION_GATE,
  MAX_HOLD_MINUTES,
  PROSPECTIVE_GATE,
  DIRECTION_PERMISSION_PROMOTION_GATE,
});
