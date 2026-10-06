export function auditStateSnapshot(snapshot) {
  const forbidden = Object.keys(snapshot ?? {}).filter(key => /buy|sell|auto/i.test(key));
  const errors = forbidden.length ? [`forbidden action field: ${forbidden.join(",")}`] : [];
  if (snapshot?.rlEligible !== false || snapshot?.researchOnly !== true) errors.push("research-only boundary missing");
  return { pass: errors.length === 0, errors, temporal: { lookahead: false, futureData: false } };
}
