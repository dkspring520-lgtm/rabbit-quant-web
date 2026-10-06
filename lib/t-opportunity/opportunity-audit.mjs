export function auditOpportunitySnapshot(snapshot) {
  const errors = [];
  if (!snapshot || !["POSITIVE_T_ENVIRONMENT", "COUNTER_T_ENVIRONMENT", "NEUTRAL", "INVALID"].includes(snapshot.type)) errors.push("invalid opportunity type");
  if (snapshot?.scoreMeaning !== "T_STRUCTURE_STRENGTH_ONLY") errors.push("score contract missing");
  if (Object.keys(snapshot ?? {}).some(key => /buy|sell|auto/i.test(key))) errors.push("action field present");
  if (snapshot?.rlEligible !== false || snapshot?.researchOnly !== true) errors.push("research-only boundary missing");
  return { pass: errors.length === 0, errors, temporal: { lookahead: false, futureData: false } };
}
