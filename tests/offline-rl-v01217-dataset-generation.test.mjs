import assert from "node:assert/strict";
import test from "node:test";
import { buildOfflineDatasetRecord, validateOfflineDatasetRecord } from "../lib/rl-research/dataset/offline-dataset-v01217.mjs";

const transition = { episodeId: "e1", timestamp: "2026-10-04T10:00:00", marketState: { price: 10, features: { return1m: 0 } }, preActionAccountState: { cash: 900, position: 100, sellablePosition: 100, todayBought: 0, averageCost: 10 }, postActionAccountState: { cash: 900, position: 100, sellablePosition: 100, todayBought: 0, averageCost: 10 }, expertAction: "HOLD", executionResult: { status: "CANCELLED", quantity: 0 }, done: false, observedExpertBehavior: true };
const artifact = { transitionId: "t1", timestamp: transition.timestamp, observedReferencePrice: 11, reward: 100 / 1900, rewardFormulaVersion: "F2_NORMALIZED_PORTFOLIO_RETURN_V0.12.15", attributionType: "POSITION_INTERVAL", accountingMode: "ACCOUNTING_CLOSED" };

test("dataset record is built from replay plus reward artifact", () => {
  const record = buildOfflineDatasetRecord({ transition, rewardArtifact: artifact });
  assert.equal(record.reward.reward, artifact.reward);
  assert.equal(record.rewardSource, "REWARD_ARTIFACT");
  assert.equal(validateOfflineDatasetRecord(record).valid, true);
});

test("terminal and blocked action encodings are preserved", () => {
  const terminal = buildOfflineDatasetRecord({ transition: { ...transition, done: true }, rewardArtifact: { ...artifact, reward: null } });
  assert.equal(terminal.nextState, null);
  const blocked = buildOfflineDatasetRecord({ transition: { ...transition, expertAction: "SELL_ALL", executionResult: { status: "REJECTED", quantity: 100 } }, rewardArtifact: { ...artifact, reward: null } });
  assert.equal(blocked.action.executionStatus, "REJECTED");
  assert.equal(validateOfflineDatasetRecord(blocked).blockedActionPreserved, true);
});
