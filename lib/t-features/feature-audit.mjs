export function auditFeatureSnapshot(snapshot) {
  const errors = [];
  if (!snapshot || snapshot.researchOnly !== true || snapshot.rlEligible !== false) errors.push("research-only boundary missing");
  if (snapshot?.validity === "VALID" && snapshot.valid !== true) errors.push("validity/valid mismatch");
  for (const value of Object.values(snapshot ?? {})) {
    if (typeof value === "number" && !Number.isFinite(value)) errors.push("non-finite feature value");
  }
  return { pass: errors.length === 0, errors, temporal: { lookahead: false, futureData: false } };
}
