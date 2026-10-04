import assert from "node:assert/strict";
import test from "node:test";
import { buildDatasetArtifact, validateDatasetArtifact } from "../lib/rl-research/dataset/offline-dataset-artifact-v012171.mjs";

const transition = { episodeId: "e1", timestamp: "2026-10-04T10:00:00", marketState: { price: 10, features: { return1m: 0 } }, preActionAccountState: { cash: 900, position: 100, sellablePosition: 100, todayBought: 0, averageCost: 10 }, postActionAccountState: { cash: 900, position: 100, sellablePosition: 100, todayBought: 0, averageCost: 10 }, expertAction: "HOLD", executionResult: { status: "CANCELLED", quantity: 0 }, done: false };
const rewardArtifact = { episodeId: "e1", transitionId: "t1", timestamp: transition.timestamp, observedReferencePrice: 11, reward: 100 / 1900, rewardFormulaVersion: "F2_NORMALIZED_PORTFOLIO_RETURN_V0.12.15", attributionType: "POSITION_INTERVAL", accountingMode: "ACCOUNTING_CLOSED" };

test("artifact schema, count, provenance and checksum validate", () => {
  const artifact = buildDatasetArtifact({ transitions: [{ ...transition, transitionId: "t1" }], rewardArtifacts: [rewardArtifact] });
  const result = validateDatasetArtifact(artifact);
  assert.equal(result.valid, true);
  assert.equal(result.recordCountMatches, true);
  assert.equal(result.checksumMatches, true);
  assert.equal(artifact.sourceProvenance.rewardLineage, "VERIFIED");
});

test("deterministic regeneration produces identical checksum", () => {
  const input = { transitions: [{ ...transition, transitionId: "t1" }], rewardArtifacts: [rewardArtifact], generatedAt: "2026-10-04T00:00:00.000Z" };
  const a = buildDatasetArtifact(input);
  const b = buildDatasetArtifact(input);
  assert.equal(a.checksum, b.checksum);
  assert.deepEqual(a.transitions, b.transitions);
});

test("provenance blocks future feature leakage", () => {
  assert.throws(() => buildDatasetArtifact({ transitions: [{ ...transition, transitionId: "t1", marketState: { ...transition.marketState, features: { futurePrice: 11 } } }], rewardArtifacts: [rewardArtifact] }), /DATASET_PROVENANCE_BLOCKED/);
});
