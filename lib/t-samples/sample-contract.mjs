export const SAMPLE_VERSION = "1.0.0";
export const SAMPLE_MODES = Object.freeze(["RESEARCH_REPLAY"]);
export const STRUCTURE_LABELS = Object.freeze(["POSITIVE_T_STRUCTURE", "COUNTER_T_STRUCTURE", "NEUTRAL_STRUCTURE"]);
export const OUTCOME_LABELS = Object.freeze(["FAVORABLE_OUTCOME", "UNFAVORABLE_OUTCOME", "MIXED_OUTCOME", "INSUFFICIENT_HORIZON"]);

export function structureLabel(type) {
  return type === "POSITIVE_T_ENVIRONMENT" ? "POSITIVE_T_STRUCTURE" : type === "COUNTER_T_ENVIRONMENT" ? "COUNTER_T_STRUCTURE" : "NEUTRAL_STRUCTURE";
}
export function outcomeLabel(outcome) {
  if (!outcome?.complete) return "INSUFFICIENT_HORIZON";
  const value = Number(outcome.futureReturn_5bar);
  if (!Number.isFinite(value)) return "INSUFFICIENT_HORIZON";
  if (value > 0.001 && (outcome.futureMaxFavorableExcursion ?? 0) >= Math.abs(outcome.futureMaxAdverseExcursion ?? 0)) return "FAVORABLE_OUTCOME";
  if (value < -0.001 && Math.abs(outcome.futureMaxAdverseExcursion ?? 0) > (outcome.futureMaxFavorableExcursion ?? 0)) return "UNFAVORABLE_OUTCOME";
  return "MIXED_OUTCOME";
}
