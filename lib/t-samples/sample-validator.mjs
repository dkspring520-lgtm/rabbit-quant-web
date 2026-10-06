import { OUTCOME_LABELS, SAMPLE_MODES, SAMPLE_VERSION, STRUCTURE_LABELS } from "./sample-contract.mjs";

export function validateSample(sample) {
  const errors = [];
  for (const key of ["sampleId", "symbol", "timestamp", "featureSnapshot", "stateSnapshot", "opportunitySnapshot", "outcome", "label", "provenance"]) if (!(key in (sample ?? {}))) errors.push(`missing ${key}`);
  if (sample?.provenance?.sampleVersion !== SAMPLE_VERSION) errors.push("sample version mismatch");
  if (sample?.provenance?.replayMode && !SAMPLE_MODES.includes(sample.provenance.replayMode)) errors.push("unsupported replay mode");
  if (sample?.label?.structureLabel && !STRUCTURE_LABELS.includes(sample.label.structureLabel)) errors.push("invalid structure label");
  if (sample?.label?.outcomeLabel && !OUTCOME_LABELS.includes(sample.label.outcomeLabel)) errors.push("invalid outcome label");
  if (sample?.outcome?.inputTimestamp && sample?.outcome?.outcomeStartTimestamp && String(sample.outcome.outcomeStartTimestamp) <= String(sample.outcome.inputTimestamp)) errors.push("outcome starts before input");
  if (sample?.featureSnapshot?.rlEligible !== false || sample?.stateSnapshot?.rlEligible !== false || sample?.opportunitySnapshot?.rlEligible !== false) errors.push("sample contains RL-eligible observation");
  return { valid: errors.length === 0, errors };
}
