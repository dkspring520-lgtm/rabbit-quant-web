export const OPPORTUNITY_TYPES = Object.freeze(["POSITIVE_T_ENVIRONMENT", "COUNTER_T_ENVIRONMENT", "NEUTRAL", "INVALID"]);
export function opportunitySnapshot({ type = "INVALID", score = null, reasons = [], confirmations = [], missingConfirmations = [], invalidations = [], valid = false, timestamp = null, symbol = "" } = {}) {
  return { timestamp, symbol, type, score, reasons, confirmations, missingConfirmations, invalidations, valid, scoreMeaning: "T_STRUCTURE_STRENGTH_ONLY", researchOnly: true, rlEligible: false };
}
