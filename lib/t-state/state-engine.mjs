import { stateSnapshot } from "./state-contract.mjs";
import { classifyCandidate, transitionState, DEFAULT_STATE_OPTIONS } from "./state-transition.mjs";

export class TStateEngine {
  constructor(options = {}) { this.options = { ...DEFAULT_STATE_OPTIONS, ...options }; this.history = []; }
  reset() { this.history = []; }
  calculate(featureSnapshot, context = {}) {
    const previous = this.history.at(-1);
    const candidate = classifyCandidate(featureSnapshot, previous?.state);
    const sameCount = previous?.state === candidate.state ? (previous.dwell ?? 0) + 1 : 1;
    const transition = transitionState(previous, candidate, { ...this.options, dwell: sameCount });
    const state = transition.state;
    const validity = state === "INVALID" ? "STATE_INVALID" : featureSnapshot?.validity === "VALID" ? "STATE_VALID" : "STATE_WARMUP";
    const result = stateSnapshot({ timestamp: featureSnapshot?.timestamp ?? null, symbol: featureSnapshot?.symbol ?? "", state, validity, previousState: previous?.state ?? null, transition: transition.event, reasons: candidate.reasons, missingDependencies: featureSnapshot?.dataQuality?.reasons ?? [] });
    result.confirmed = transition.confirmed; result.dwell = sameCount; result.candidateState = candidate.state; result.researchOnly = true; result.rlEligible = false;
    this.history.push({ state, dwell: sameCount });
    return result;
  }
  calculateSeries(features) { this.reset(); return (features ?? []).map(item => this.calculate(item)); }
}
export const StateEngine = TStateEngine;
