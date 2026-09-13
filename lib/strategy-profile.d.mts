export type StrategyProfileName = "稳健档" | "平衡档" | "灵敏档";
export const STRATEGY_PROFILES: readonly ["稳健档", "平衡档", "灵敏档"];
export const STRATEGY_PROFILE_META: Record<StrategyProfileName, {
  tag: string;
  fit: string;
  score: number;
  deviationPct: number;
  candidateNetPct: number;
  minBuyVolumeRatio: number;
  minSellVolumeRatio: number;
  minRewardRisk: number;
  minHoldMinutes: number;
  cooldownMinutes: number;
  maxCycles: number;
  risk: string;
}>;
export function normalizeStrategyProfile(value: unknown, fallback?: StrategyProfileName): StrategyProfileName;
