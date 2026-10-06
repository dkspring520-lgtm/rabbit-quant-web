export const T_STATE_ENGINE_VERSION = "1.0.0";
export const T_STATES = Object.freeze(["NO_T_ENVIRONMENT", "UPTREND", "DOWNTREND", "RANGE", "TRANSITION", "UP_ACCELERATION", "DOWN_ACCELERATION", "HIGH_LEVEL_EXHAUSTION", "LOW_LEVEL_EXHAUSTION", "PULLBACK", "REBOUND", "WAIT_CONFIRMATION", "POSITIVE_T_CANDIDATE", "COUNTER_T_CANDIDATE", "T_RISK_HIGH", "INVALID"]);
export const STATE_VALIDITY = Object.freeze(["STATE_VALID", "STATE_WARMUP", "STATE_INVALID"]);
export function stateSnapshot({ timestamp = null, symbol = "", state = "INVALID", validity = "STATE_INVALID", previousState = null, transition = null, reasons = [], missingDependencies = [] } = {}) {
  return { timestamp, symbol, state, validity, previousState, transition, reasons, missingDependencies, researchOnly: true, rlEligible: false };
}
