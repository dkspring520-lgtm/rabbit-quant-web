import { createHash } from "node:crypto";
import { buildOfflineDatasetRecord, validateOfflineDatasetRecord, DATASET_VERSION } from "./offline-dataset-v01217.mjs";

export const ARTIFACT_VERSION = "OFFLINE_RL_DATASET_ARTIFACT_V0.12.17.1";
export const CONTRACT_VERSION = "OFFLINE_RL_DATASET_CONTRACT_V0.12.16";

export function hashRows(rows) {
  const hash = createHash("sha256");
  for (const row of rows) hash.update(JSON.stringify(row) + "\n");
  return hash.digest("hex");
}

export function auditDatasetProvenance(transitions, rewardArtifacts) {
  const errors = [];
  if (!Array.isArray(transitions) || !Array.isArray(rewardArtifacts)) errors.push("sources_not_arrays");
  if ((transitions?.length ?? 0) !== (rewardArtifacts?.length ?? 0)) errors.push("source_count_mismatch");
  const rewardsByKey = new Map((rewardArtifacts ?? []).map(row => [`${row.episodeId}|${row.transitionId}|${row.timestamp}`, row]));
  for (const transition of transitions ?? []) {
    const key = `${transition.episodeId}|${transition.transitionId ?? ""}|${transition.timestamp}`;
    const artifact = rewardsByKey.get(key) ?? (rewardArtifacts ?? []).find(row => row.episodeId === transition.episodeId && row.timestamp === transition.timestamp);
    if (!artifact) errors.push(`missing_reward_artifact:${key}`);
  }
  const ordered = (transitions ?? []).every((row, index, rows) => index === 0 || `${rows[index - 1].episodeId}|${rows[index - 1].timestamp}` <= `${row.episodeId}|${row.timestamp}`);
  if (!ordered) errors.push("transition_order");
  const futureLeakage = (transitions ?? []).some(row => Object.keys(row.marketState?.features ?? {}).some(key => key.startsWith("future") || key.startsWith("forward")));
  if (futureLeakage) errors.push("future_feature_leakage");
  return { valid: errors.length === 0, errors, datasetSource: "REPLAY_TRANSITION_PLUS_REWARD_ARTIFACT", rewardLineage: errors.every(error => !error.startsWith("missing_reward_artifact")) ? "VERIFIED" : "BLOCKED", transitionOrder: ordered ? "VERIFIED" : "BLOCKED", futureFeatureLeakage: futureLeakage ? "BLOCKED" : "PASS" };
}

export function buildDatasetArtifact({ transitions = [], rewardArtifacts = [], generatedAt = "2026-10-04T00:00:00.000Z" } = {}) {
  const provenance = auditDatasetProvenance(transitions, rewardArtifacts);
  if (!provenance.valid) throw new Error(`DATASET_PROVENANCE_BLOCKED:${provenance.errors.join(",")}`);
  const artifactRows = transitions.map((transition, index) => buildOfflineDatasetRecord({ transition, rewardArtifact: rewardArtifacts[index] }));
  const validation = artifactRows.map(validateOfflineDatasetRecord);
  if (validation.some(result => !result.valid)) throw new Error("DATASET_RECORD_VALIDATION_FAILED");
  return {
    artifactVersion: ARTIFACT_VERSION,
    datasetVersion: DATASET_VERSION,
    contractVersion: CONTRACT_VERSION,
    rewardFormulaVersion: "F2_NORMALIZED_PORTFOLIO_RETURN_V0.12.15",
    recordCount: artifactRows.length,
    generatedAt,
    sourceProvenance: provenance,
    transitions: artifactRows,
    checksum: hashRows(artifactRows),
    datasetGeneration: "COMPLETE",
    valueQ: "BLOCKED_PENDING_IMPLEMENTATION",
    rlTraining: "NOT_STARTED"
  };
}

export function validateDatasetArtifact(artifact) {
  const rowResults = (artifact?.transitions ?? []).map(validateOfflineDatasetRecord);
  const checksum = hashRows(artifact?.transitions ?? []);
  return { valid: artifact?.artifactVersion === ARTIFACT_VERSION && artifact?.contractVersion === CONTRACT_VERSION && artifact?.recordCount === artifact?.transitions?.length && artifact?.checksum === checksum && rowResults.every(result => result.valid), recordCountMatches: artifact?.recordCount === artifact?.transitions?.length, checksumMatches: artifact?.checksum === checksum, rowsValid: rowResults.every(result => result.valid) };
}
