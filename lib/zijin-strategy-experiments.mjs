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
      reversal: 0.08,
      maxSellPullback: 0.60,
      minBuyVolumeRatio: 0.20,
      minSellVolumeRatio: 0.20,
      minMomentum3: 0,
      minRewardRisk: 0.60,
      minExecutionConfirmationVotes: 1,
      minBuyExecutionConfirmationVotes: 1,
      minSellExecutionConfirmationVotes: 1,
      maxBuyTrendRiskVotes: 2,
      maxSellTrendRiskVotes: 3,
      enableMatureBuyReversalRiskOverride: 1,
      enableMatureSellReversalRiskOverride: 1,
      matureBuyReversalMinPivotAge: 1,
      matureSellReversalMinPivotAge: 1,
      minSellFormalPivotAge: 0,
      candidateFlipMinutes: 4,
      // 18 分钟只开始复核，不再机械退出。结构仍支持时可延长，
      // 但最长 48 分钟必须退出，避免把日内做 T 变成无期限扛单。
      timeExitMinutes: 18,
      adaptiveTimeExit: 1,
      adaptiveMaxHoldMinutes: 48,
      adaptiveExitPivotBufferPct: 0.15,
      adaptiveExitMomentumPct: 0.03,
      // 闭环研究不再用“覆盖率优先”越过已识别的单边趋势风险。
      hardTrendContinuationGate: 1,
      hardStopPct: 1.00,
    }),
    positionSizeMode: "fixed",
    volatilityMode: "causal-hybrid",
    reference: null,
    errorAuditPriority: true,
  }),
});

export const ZIJIN_STRATEGY_EXPERIMENT_IDS = Object.freeze(Object.keys(ZIJIN_STRATEGY_EXPERIMENTS));

export const GENERAL_STRATEGY_EXPERIMENTS = Object.freeze({
  "formal-v4": ZIJIN_STRATEGY_EXPERIMENTS["formal-v4"],
  "closure-first": Object.freeze({
    ...ZIJIN_STRATEGY_EXPERIMENTS["closure-first"],
    label: "通用闭环错误审计",
    description: "按本股因果波动形成闭环，并硬拦截明显逆势交易；保留失败，不承诺胜率。",
    scope: "general-a-share",
    volatilityMode: "causal-realized",
  }),
});

export function normalizeZijinStrategyExperiment(value) {
  return Object.hasOwn(ZIJIN_STRATEGY_EXPERIMENTS, value) ? value : "formal-v4";
}

export function resolveZijinStrategyExperiment(code, value) {
  if (String(code) !== "601899") return ZIJIN_STRATEGY_EXPERIMENTS["formal-v4"];
  return ZIJIN_STRATEGY_EXPERIMENTS[normalizeZijinStrategyExperiment(value)];
}

export function resolveBacktestStrategyExperiment(code, value) {
  const normalized = normalizeZijinStrategyExperiment(value);
  if (String(code) === "601899") return ZIJIN_STRATEGY_EXPERIMENTS[normalized];
  return GENERAL_STRATEGY_EXPERIMENTS[normalized];
}
