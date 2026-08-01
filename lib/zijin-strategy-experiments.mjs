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
  "high-coverage": Object.freeze({
    id: "high-coverage",
    label: "高频覆盖",
    shortLabel: "覆盖",
    description: "放宽候选覆盖，但保留趋势、成本、成交与仓位硬风控。",
    experimental: true,
    profile: "灵敏档",
    profileOverrides: Object.freeze({
      score: 2,
      cooldown: 4,
      minHoldMinutes: 3,
      candidateNetPct: 0.32,
      maxCycles: 2,
      deviation: 0.58,
      reversal: 0.18,
      maxSellPullback: 0.42,
      minBuyVolumeRatio: 0.70,
      minSellVolumeRatio: 0.78,
      minMomentum3: 0.08,
      minRewardRisk: 1.25,
      minExecutionConfirmationVotes: 3,
      minBuyExecutionConfirmationVotes: 3,
      minSellExecutionConfirmationVotes: 2,
    }),
    positionSizeMode: "fixed",
    volatilityMode: "causal-hybrid",
    reference: Object.freeze({ cyclesPer100Days: 41.94, winRate: 58.96, afterCostPassed: false }),
  }),
  "dynamic-sizing": Object.freeze({
    id: "dynamic-sizing",
    label: "动态仓位",
    shortLabel: "动态",
    description: "沿用高频候选，按当时已确认的质量将仓位缩为 10% / 25% / 50%。",
    experimental: true,
    profile: "灵敏档",
    profileOverrides: Object.freeze({
      score: 2,
      cooldown: 4,
      minHoldMinutes: 3,
      candidateNetPct: 0.32,
      maxCycles: 2,
      deviation: 0.58,
      reversal: 0.18,
      maxSellPullback: 0.42,
      minBuyVolumeRatio: 0.70,
      minSellVolumeRatio: 0.78,
      minMomentum3: 0.08,
      minRewardRisk: 1.25,
      minExecutionConfirmationVotes: 3,
      minBuyExecutionConfirmationVotes: 3,
      minSellExecutionConfirmationVotes: 2,
    }),
    positionSizeMode: "quality-tiered",
    volatilityMode: "causal-hybrid",
    reference: Object.freeze({ cyclesPer100Days: 41.94, winRate: 58.96, afterCostPassed: false }),
  }),
  "closure-first": Object.freeze({
    id: "closure-first",
    label: "闭环优先实验",
    shortLabel: "闭环",
    description: "优先提高候选转正式闭环的覆盖，仅用于研究和手动回放；不承诺胜率、净收益或可实盘执行。",
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
      timeExitMinutes: 18,
      hardStopPct: 1.00,
    }),
    positionSizeMode: "fixed",
    volatilityMode: "causal-hybrid",
    reference: null,
    coveragePriority: true,
  }),
});

export const ZIJIN_STRATEGY_EXPERIMENT_IDS = Object.freeze(Object.keys(ZIJIN_STRATEGY_EXPERIMENTS));

export const GENERAL_STRATEGY_EXPERIMENTS = Object.freeze({
  "formal-v4": ZIJIN_STRATEGY_EXPERIMENTS["formal-v4"],
  "high-coverage": Object.freeze({
    ...ZIJIN_STRATEGY_EXPERIMENTS["high-coverage"],
    label: "通用覆盖实验",
    description: "按个股自身百分比偏离、相对量能与交易成本运行覆盖实验，不引用紫金专属胜率。",
    profileOverrides: Object.freeze({
      ...ZIJIN_STRATEGY_EXPERIMENTS["high-coverage"].profileOverrides,
      candidateNetPct: 0.38,
      deviation: 0.68,
      minBuyVolumeRatio: 0.75,
      minSellVolumeRatio: 0.82,
      minRewardRisk: 1.30,
    }),
    reference: null,
    scope: "general-a-share",
    volatilityMode: "causal-realized",
  }),
  "dynamic-sizing": Object.freeze({
    ...ZIJIN_STRATEGY_EXPERIMENTS["dynamic-sizing"],
    label: "通用动态仓位实验",
    description: "沿用通用覆盖条件，并按当时已确认的信号质量缩放仓位，不引用紫金专属胜率。",
    profileOverrides: Object.freeze({
      ...ZIJIN_STRATEGY_EXPERIMENTS["dynamic-sizing"].profileOverrides,
      candidateNetPct: 0.38,
      deviation: 0.68,
      minBuyVolumeRatio: 0.75,
      minSellVolumeRatio: 0.82,
      minRewardRisk: 1.30,
    }),
    positionSizeMode: "liquidity-risk-tiered",
    reference: null,
    scope: "general-a-share",
    volatilityMode: "causal-realized",
  }),
  "closure-first": Object.freeze({
    ...ZIJIN_STRATEGY_EXPERIMENTS["closure-first"],
    label: "通用闭环优先实验",
    description: "按本股因果波动与已观察量能优先形成闭环；仅用于覆盖率研究，不承诺胜率或净收益。",
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
