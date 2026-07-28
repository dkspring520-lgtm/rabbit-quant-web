export const STRATEGY_PROFILES = Object.freeze(["稳健档", "平衡档", "灵敏档"]);

export function normalizeStrategyProfile(value, fallback = "平衡档") {
  return STRATEGY_PROFILES.includes(value) ? value : fallback;
}

