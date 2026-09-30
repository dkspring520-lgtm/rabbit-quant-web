import { sha256, stableStringify } from "./reproducibility.mjs";

export const CANDIDATE_LINEAGE_VERSION = "1.0.0";
export const CANDIDATE_LIFECYCLE_STATES = Object.freeze([
  "GENERATED",
  "VALIDATED",
  "CANDIDATE",
  "SHADOW",
  "REJECTED",
  "PROMOTED",
]);

const TRANSITIONS = Object.freeze({
  GENERATED: ["VALIDATED", "REJECTED"],
  VALIDATED: ["CANDIDATE", "REJECTED"],
  CANDIDATE: ["SHADOW", "REJECTED"],
  SHADOW: ["PROMOTED", "REJECTED"],
  REJECTED: [],
  PROMOTED: [],
});

const clone = value => value === undefined ? null : JSON.parse(stableStringify(value));
const requiredText = (value, name) => {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${name} is required`);
  return text;
};

export function buildCandidateSnapshot(input = {}) {
  const expression = String(input.expression ?? input.recipeId ?? "").trim();
  const recipeId = String(input.recipeId ?? expression).trim();
  const factorIds = [...new Set((Array.isArray(input.factorIds) ? input.factorIds : []).map(String).filter(Boolean))].sort();
  const payload = {
    expression,
    recipeId,
    factorIds,
    transform: String(input.transform ?? "identity"),
    transformParameters: clone(input.transformParameters ?? {}),
    threshold: Number.isFinite(Number(input.threshold)) ? Number(input.threshold) : null,
    datasetVersion: requiredText(input.datasetVersion, "datasetVersion"),
    modelVersion: requiredText(input.modelVersion, "modelVersion"),
    asOf: requiredText(input.asOf, "asOf"),
    validationResult: clone(input.validationResult ?? null),
  };
  const candidateId = String(input.candidateId ?? `candidate-${sha256(payload).slice(0, 16)}`);
  const createdAt = requiredText(input.createdAt ?? new Date().toISOString(), "createdAt");
  return Object.freeze({
    schemaVersion: CANDIDATE_LINEAGE_VERSION,
    candidateId,
    ...payload,
    createdAt,
    mode: "shadow-only",
    affectsProduction: false,
    canPromoteAutomatically: false,
  });
}

export function transitionCandidateLifecycle(snapshot, from, to, { timestamp = new Date().toISOString(), reason = "", evidence = null } = {}) {
  const candidate = buildCandidateSnapshot(snapshot);
  if (!CANDIDATE_LIFECYCLE_STATES.includes(from) || !CANDIDATE_LIFECYCLE_STATES.includes(to)) {
    throw new TypeError("Unknown candidate lifecycle state");
  }
  if (!TRANSITIONS[from].includes(to)) throw new Error(`Invalid candidate lifecycle transition: ${from} -> ${to}`);
  return Object.freeze({
    candidateId: candidate.candidateId,
    from,
    to,
    timestamp: requiredText(timestamp, "timestamp"),
    reason: String(reason ?? ""),
    evidence: clone(evidence),
    datasetVersion: candidate.datasetVersion,
    modelVersion: candidate.modelVersion,
    mode: "shadow-only",
    affectsProduction: false,
    canPromoteAutomatically: false,
  });
}
