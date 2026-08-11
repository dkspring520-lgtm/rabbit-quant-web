export const ZIJIN_STRATEGY_EXPERIMENTS = Object.freeze({
  "formal-v4": Object.freeze({
    id: "formal-v4",
    label: "V4.1 正式",
    shortLabel: "正式",
    description: "保持当前正式门槛与固定仓位，不启用实验放宽。",
    experimental: false,
    profile: null,
    profileOverrides: Object.freeze({}),
    positionSizeMode: "fixed",
    volatilityMode: "fixed",
    reference: null,
  }),
  "closure-first": Object.freeze({
    id: "closure-first",
    label: "闭环错误审计",
    shortLabel: "闭环",
    description: "优先形成可复盘闭环，同时硬拦截明显逆势交易；保留失败，不承诺胜率。",
    experimental: true,
    profile: "灵敏档",
    profileOverrides: Object.freeze({
      score: 1,
      cooldown: 2,
      minHoldMinutes: 2,
      candidateNetPct: 0.15,
      maxCycles: 3,
      deviation: 0.42,
      reversal: 0.06,
      maxSellPullback: 1.00,
      // Positive-T requires real participation instead of buying the first
      // mechanical bounce. This keeps closure coverage near the 33/100
      // target while removing the weakest low-volume buy attempts.
      minBuyVolumeRatio: 0.35,
      // Positive-T also needs the causal 30-minute price path to recover
      // before entry. This gate applies to BUY_FIRST only; reverse-T keeps
      // its existing entry rules unchanged.
      minBuyPriceMomentum30: 0.40,
      minSellVolumeRatio: 0.20,
      minMomentum3: 0,
      minRewardRisk: 0.60,
      minExecutionConfirmationVotes: 1,
      minBuyExecutionConfirmationVotes: 1,
      minSellExecutionConfirmationVotes: 1,
      // 正T只允许一个合并后的趋势风险提示；两个以上通常意味着
      // “局部反弹”仍未完成方向扭转，保留观察而不形成正式买入。
      maxBuyTrendRiskVotes: 0,
      // A reverse-T must not execute when its short cycle disagrees with the
      // broader direction. One consolidated warning remains observable, but
      // two independent warnings keep it out of the formal pool.
      maxSellTrendRiskVotes: 3,
      enableMatureBuyReversalRiskOverride: 1,
      enableMatureSellReversalRiskOverride: 1,
      matureBuyReversalMinPivotAge: 1,
      matureSellReversalMinPivotAge: 1,
      // Positive-T waits for a confirmed local low before formal entry. The
      // threshold is calibrated against the fixed replay cache below.
      minBuyFormalPivotAge: 0,
      minSellFormalPivotAge: 0,
      candidateFlipMinutes: 4,
      // 18 分钟只开始复核，不再机械退出。结构仍支持时可延长，
      // 但最长 90 分钟必须退出，避免把日内做 T 变成无期限扛单。
      // Review at 45 minutes; only an already profitable excursion may use
      // the extended 90-minute intraday hold.
      timeExitMinutes: 45,
      adaptiveTimeExit: 1,
      adaptiveMaxHoldMinutes: 90,
      adaptiveExitPivotBufferPct: 0.15,
      adaptiveExitMomentumPct: 0.03,
      // 闭环研究不再用“覆盖率优先”越过已识别的单边趋势风险。
      // Persistent directional errors are handled inside the existing grouped
      // trend-risk budget. Do not add a second global veto here: that duplicate
      // gate removed normal oscillation cycles and materially reduced closure.
      hardTrendContinuationGate: 0,
      obviousDirectionalErrorGate: 1,
      hardStopPct: 1.00,
      // A review may extend only after the trade has reached positive
      // after-cost P/L; an intact pivot alone cannot keep a losing position.
      adaptiveExitMinSupportVotes: 2,
      adaptiveProtectIntactLoss: 0,
      sameDirectionWaveLock: 1,
      sameDirectionWaveMinGapMinutes: 10,
      sameDirectionWaveResetPct: 0.35,
      causalTrendDirectionCorrection: 1,
      causalTrendCorrectionRequireAlignedTurn: 1,
      causalTrendDirectionMinVotes: 2,
      causalTrendPullbackMaxVwapExtensionPct: 1.25,
      causalTrendPullbackMinLocalTurnPct: 0.03,
      causalPostCycleTrendMemory: 1,
      causalTrendMemoryFlipMinutes: 5,
      causalTrendMemoryUnanimousFlip: 1,
      causalTrendMemoryRequirePersistentFlip: 1,
    }),
    positionSizeMode: "fixed",
    volatilityMode: "causal-hybrid",
    reference: null,
    errorAuditPriority: true,
  }),
});

// Dedicated production mapping for 601899. The research study uses a richer
// L2 execution model; only parameters with causal equivalents in the live
// engine are promoted here. General A-share profiles remain unchanged.
export const ZIJIN_601899_PRODUCTION_STRATEGY = Object.freeze({
  ...ZIJIN_STRATEGY_EXPERIMENTS["closure-first"],
  label: "紫金专属闭环",
  shortLabel: "紫金闭环",
  description: "仅用于紫金矿业：按上午深度修复、方向确认与严格风险门槛形成正T/反T闭环。",
  scope: "zijin-601899",
  profileOverrides: Object.freeze({
    ...ZIJIN_STRATEGY_EXPERIMENTS["closure-first"].profileOverrides,
    deviation: 0.55,
    reversal: 0.07,
    precisionEntryWindows: 1,
    maxSellEntryTime: "1100",
    minBuyExecutionConfirmationVotes: 3,
    minSellExecutionConfirmationVotes: 3,
    minBuyFormalPivotAge: 2,
    minSellFormalPivotAge: 2,
    maxBuyTrendRiskVotes: 0,
    maxSellTrendRiskVotes: 1,
    hardSellEntryTimingGate: 1,
    requireRapidRiseSellConfirmation: 1,
    requireEarlyOpeningRiskL2: 1,
    timeExitMinutes: 60,
    adaptiveTimeExit: 0,
    adaptiveMaxHoldMinutes: 60,
  }),
  researchReference: Object.freeze({
    source: "zijin-special-strategy-study-20260809",
    symbol: "601899",
    validation: "2025-selection-and-2026-retrospective",
  }),
});

// The member-facing desk currently runs one audited strategy only. Keep the
// formal V4 definition above for internal comparison, but never resolve it
// from a live monitor, replay, or a stale saved preference.
export const MEMBER_STRATEGY_EXPERIMENT_IDS = Object.freeze(["closure-first"]);
export const ZIJIN_STRATEGY_EXPERIMENT_IDS = MEMBER_STRATEGY_EXPERIMENT_IDS;

export const CLOSURE_V2_SHADOW_OBSERVATION_POLICY = Object.freeze({
  targetCandidatePromotionRate: 0.35,
  acceptablePromotionRate: Object.freeze({minimum: 0.30, maximum: 0.40}),
  minimumTradingDays: 60,
  minimumResolvedTrades: 100,
  minimumAfterCostWinRate: 0.55,
  minimumStress5BpsWinRate: 0.55,
  stressSlippageBpsPerSide: 5,
  minimumProfitFactor: 1.2,
  requiresDailyTrade: false,
  forcePromotionQuota: false,
  automaticPromotion: false,
  affectsProduction: false,
  sendsAlerts: false,
  directionEvidence: Object.freeze({
    positiveT: Object.freeze([
      "low-location-confirmed",
      "sell-pressure-decelerating",
      "net-flow-turning-positive",
      "bid-support-improving",
      "price-response-confirmed",
      "market-sector-not-bearish",
    ]),
    reverseT: Object.freeze([
      "high-location-confirmed",
      "buy-pressure-absorbed",
      "net-flow-turning-negative",
      "offer-pressure-improving",
      "price-response-confirmed",
      "market-sector-not-bullish",
    ]),
  }),
});

export function evaluateClosureV2ShadowObservation(metrics = {}) {
  const candidates = Math.max(0, Number(metrics.candidates) || 0);
  const promotedCandidates = Math.max(0, Number(metrics.promotedCandidates) || 0);
  const tradingDays = Math.max(0, Number(metrics.tradingDays) || 0);
  const resolvedTrades = Math.max(0, Number(metrics.resolvedTrades) || 0);
  const promotionRate = candidates > 0 ? Math.min(1, promotedCandidates / candidates) : null;
  const afterCostWinRate = Number(metrics.afterCostWinRate);
  const stress5BpsWinRate = Number(metrics.stress5BpsWinRate);
  const profitFactor = Number(metrics.profitFactor);
  const policy = CLOSURE_V2_SHADOW_OBSERVATION_POLICY;
  const gates = {
    tradingDays: tradingDays >= policy.minimumTradingDays,
    resolvedTrades: resolvedTrades >= policy.minimumResolvedTrades,
    afterCostWinRate: Number.isFinite(afterCostWinRate) && afterCostWinRate >= policy.minimumAfterCostWinRate,
    stress5BpsWinRate: Number.isFinite(stress5BpsWinRate) && stress5BpsWinRate >= policy.minimumStress5BpsWinRate,
    profitFactor: Number.isFinite(profitFactor) && profitFactor >= policy.minimumProfitFactor,
    promotionRate: promotionRate !== null
      && promotionRate >= policy.acceptablePromotionRate.minimum
      && promotionRate <= policy.acceptablePromotionRate.maximum,
  };
  const sampleReady = gates.tradingDays && gates.resolvedTrades;
  const qualityReady = sampleReady && gates.afterCostWinRate && gates.stress5BpsWinRate && gates.profitFactor;
  const readyForManualReview = qualityReady && gates.promotionRate;
  return {
    promotionRate,
    gates,
    sampleReady,
    qualityReady,
    readyForManualReview,
    status: readyForManualReview ? "manual-review" : qualityReady ? "observe-promotion-rate" : "collect-evidence",
    forcedPromotions: 0,
    affectsProduction: false,
    sendsAlerts: false,
  };
}

// Research-only shadow strategy. It is deliberately kept outside the member
// registry so stale preferences and live callers can never select it.
export const ZIJIN_RESEARCH_STRATEGY_EXPERIMENTS = Object.freeze({
  "closure-v2-shadow": Object.freeze({
    ...ZIJIN_STRATEGY_EXPERIMENTS["closure-first"],
    id: "closure-v2-shadow",
    label: "Closure V2 影子",
    shortLabel: "V2影子",
    description: "仅供影子回测：候选信号保留观察，正式成交提高成本、趋势与订单流门槛，不替换线上闭环策略。",
    profileOverrides: Object.freeze({
      ...ZIJIN_STRATEGY_EXPERIMENTS["closure-first"].profileOverrides,
      precisionEntryWindows: 1,
      // Reverse-T is limited to the audited morning window. Any later setup
      // remains visible in the observation ledger but cannot execute.
      maxSellEntryTime: "1110",
      minBuyExecutionConfirmationVotes: 3,
      minSellExecutionConfirmationVotes: 3,
      minSellFormalPivotAge: 2,
      maxSellTrendRiskVotes: 1,
      hardSellEntryTimingGate: 1,
      requireRapidRiseSellConfirmation: 1,
      requireEarlyOpeningRiskL2: 1,
      // Shadow-only payoff experiment: review weak structure sooner while
      // allowing a confirmed winner to run before protecting its profit.
      softStopPct: 0.40,
      softStopMinutes: 14,
      trailActivationPct: 1.20,
      trailMinNetPct: 0.40,
      trailRetracePct: 0.30,
    }),
    executionPolicy: Object.freeze({
      minimumCostCoverageMultiple: 2,
      weakSignalMode: "observation-only",
      positionSizeMode: "fixed",
      externalConfirmation: "market-sector-l2-when-provided",
      primaryObjectives: Object.freeze(["after-cost-net", "profit-factor", "max-drawdown"]),
      secondaryObjectives: Object.freeze(["win-rate"]),
    }),
    observationPolicy: CLOSURE_V2_SHADOW_OBSERVATION_POLICY,
    researchOnly: true,
    shadowOnly: true,
    promotionEligible: false,
  }),
});
export const ZIJIN_RESEARCH_STRATEGY_EXPERIMENT_IDS = Object.freeze(
  Object.keys(ZIJIN_RESEARCH_STRATEGY_EXPERIMENTS),
);

export const GENERAL_STRATEGY_EXPERIMENTS = Object.freeze({
  "formal-v4": ZIJIN_STRATEGY_EXPERIMENTS["formal-v4"],
  "closure-first": Object.freeze({
    ...ZIJIN_STRATEGY_EXPERIMENTS["closure-first"],
    profileOverrides: Object.freeze({
      ...ZIJIN_STRATEGY_EXPERIMENTS["closure-first"].profileOverrides,
      // General A-shares need a completed causal reversal before execution.
      // The Zijin-specific audit keeps its original exploratory threshold.
      minBuyExecutionConfirmationVotes: 4,
      minSellExecutionConfirmationVotes: 4,
    }),
    label: "通用闭环错误审计",
    description: "按本股因果波动形成闭环，并硬拦截明显逆势交易；保留失败，不承诺胜率。",
    scope: "general-a-share",
    volatilityMode: "causal-realized",
  }),
});

export function normalizeZijinStrategyExperiment(value) {
  return value === "closure-first" ? value : "closure-first";
}

export function resolveZijinStrategyExperiment(code, value) {
  const normalized = normalizeZijinStrategyExperiment(value);
  if (String(code) === "601899") return ZIJIN_601899_PRODUCTION_STRATEGY;
  return GENERAL_STRATEGY_EXPERIMENTS[normalized];
}

export function resolveBacktestStrategyExperiment(code, value) {
  const normalized = normalizeZijinStrategyExperiment(value);
  if (String(code) === "601899") return ZIJIN_601899_PRODUCTION_STRATEGY;
  return GENERAL_STRATEGY_EXPERIMENTS[normalized];
}

export function resolveResearchStrategyExperiment(code, value) {
  if (String(code) === "601899" && Object.hasOwn(ZIJIN_RESEARCH_STRATEGY_EXPERIMENTS, value)) {
    return ZIJIN_RESEARCH_STRATEGY_EXPERIMENTS[value];
  }
  return resolveBacktestStrategyExperiment(code, value);
}
