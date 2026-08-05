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
      minSellVolumeRatio: 0.20,
      minMomentum3: 0,
      minRewardRisk: 0.60,
      minExecutionConfirmationVotes: 1,
      minBuyExecutionConfirmationVotes: 1,
      minSellExecutionConfirmationVotes: 1,
      // 正T只允许一个合并后的趋势风险提示；两个以上通常意味着
      // “局部反弹”仍未完成方向扭转，保留观察而不形成正式买入。
      maxBuyTrendRiskVotes: 1,
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

// The member-facing desk currently runs one audited strategy only. Keep the
// formal V4 definition above for internal comparison, but never resolve it
// from a live monitor, replay, or a stale saved preference.
export const MEMBER_STRATEGY_EXPERIMENT_IDS = Object.freeze(["closure-first"]);
export const ZIJIN_STRATEGY_EXPERIMENT_IDS = MEMBER_STRATEGY_EXPERIMENT_IDS;

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
  return ZIJIN_STRATEGY_EXPERIMENTS[normalizeZijinStrategyExperiment(value)];
}

export function resolveBacktestStrategyExperiment(code, value) {
  const normalized = normalizeZijinStrategyExperiment(value);
  if (String(code) === "601899") return ZIJIN_STRATEGY_EXPERIMENTS[normalized];
  return GENERAL_STRATEGY_EXPERIMENTS[normalized];
}
