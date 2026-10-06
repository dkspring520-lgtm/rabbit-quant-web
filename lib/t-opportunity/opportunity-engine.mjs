import { opportunitySnapshot } from "./opportunity-contract.mjs";

export class TOpportunityEngine {
  calculate(feature, state) {
    if (!feature || !state || feature.validity !== "VALID" || state.validity === "STATE_INVALID") return opportunitySnapshot({ type: "INVALID", timestamp: feature?.timestamp, symbol: feature?.symbol, missingConfirmations: ["valid feature/state"] });
    const high = state.state === "HIGH_LEVEL_EXHAUSTION" || state.state === "COUNTER_T_CANDIDATE";
    const low = state.state === "LOW_LEVEL_EXHAUSTION" || state.state === "POSITIVE_T_CANDIDATE";
    const confirmations = []; const missing = []; const reasons = [];
    if (high) { reasons.push("high-level extension with momentum decay candidate"); confirmations.push("causal high-level exhaustion structure"); }
    if (low) { reasons.push("low-level stabilization with downside exhaustion candidate"); confirmations.push("causal low-level exhaustion structure"); }
    const type = high && !low ? "COUNTER_T_ENVIRONMENT" : low && !high ? "POSITIVE_T_ENVIRONMENT" : "NEUTRAL";
    if (type === "NEUTRAL") missing.push("directional T structure");
    const score = type === "NEUTRAL" ? 0 : Math.min(100, 40 + confirmations.length * 20 + (state.confirmed ? 20 : 0));
    return opportunitySnapshot({ type, score, reasons, confirmations, missingConfirmations: missing, invalidations: ["feature invalidation", "opposite acceleration"], valid: true, timestamp: feature.timestamp, symbol: feature.symbol });
  }
  calculateSeries(features, states) { return (features ?? []).map((feature, index) => this.calculate(feature, states?.[index])); }
}
export const OpportunityEngine = TOpportunityEngine;
