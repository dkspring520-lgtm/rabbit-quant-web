export const STRATEGY_PROFILES = Object.freeze(["稳健档", "平衡档", "灵敏档"]);

export const STRATEGY_PROFILE_META = Object.freeze({
  稳健档: Object.freeze({
    tag: "少做，只做最确定", fit: "震荡市、新手、重视回撤", score: 6,
    deviationPct: 0.90, candidateNetPct: 0.55, minBuyVolumeRatio: 0.85, minSellVolumeRatio: 0.95,
    minRewardRisk: 1.55, minHoldMinutes: 5, cooldownMinutes: 10, maxCycles: 1,
    risk: "确认最严格、冷却最长；候选正常显示，正式闭环可能为空。",
  }),
  平衡档: Object.freeze({
    tag: "确认与机会兼顾", fit: "大多数正常交易日", score: 3,
    deviationPct: 0.65, candidateNetPct: 0.42, minBuyVolumeRatio: 0.80, minSellVolumeRatio: 0.90,
    minRewardRisk: 1.50, minHoldMinutes: 4, cooldownMinutes: 5, maxCycles: 2,
    risk: "默认推荐；确认、频率与持仓时间保持平衡。",
  }),
  灵敏档: Object.freeze({
    tag: "更早发现拐点", fit: "活跃行情、熟练用户", score: 2,
    deviationPct: 0.65, candidateNetPct: 0.32, minBuyVolumeRatio: 0.75, minSellVolumeRatio: 0.85,
    minRewardRisk: 1.40, minHoldMinutes: 3, cooldownMinutes: 5, maxCycles: 1,
    risk: "候选更早、量能要求更低；第二轮只观察，避免重复交易。",
  }),
});

export function normalizeStrategyProfile(value, fallback = "平衡档") {
  return STRATEGY_PROFILES.includes(value) ? value : fallback;
}
