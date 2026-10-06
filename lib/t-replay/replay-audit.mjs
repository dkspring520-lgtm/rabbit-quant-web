export function auditReplaySample(sample) {
  const errors = [];
  if (sample?.provenance?.lookahead !== false) errors.push("observation lookahead flag is not false");
  if (sample?.provenance?.futureDataInObservation !== false) errors.push("future data observation flag is not false");
  if (sample?.outcome && sample?.featureSnapshot?.futureReturn_5bar !== undefined) errors.push("outcome leaked into feature snapshot");
  if (sample?.featureSnapshot?.rlEligible !== false || sample?.stateSnapshot?.rlEligible !== false || sample?.opportunitySnapshot?.rlEligible !== false) errors.push("observation is RL eligible");
  return { pass: errors.length === 0, errors };
}
