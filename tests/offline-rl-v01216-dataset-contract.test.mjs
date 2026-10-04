import assert from "node:assert/strict";
import test from "node:test";
import { auditDatasetContractRecord, DATASET_CONTRACT_STATUS, TRANSITION_SCHEMA } from "../lib/rl-research/dataset/reward-dataset-contract-v01216.mjs";

const state = (price, sellablePosition = 0) => ({ marketState: { price, features: { return1m: 0 } }, accountState: { cash: 1000, position: 100, sellablePosition, averageCost: 10, observedReferencePrice: price, portfolioValue: 2000 } });

test("dataset contract is proposal-only and transition-shaped", () => {
  assert.equal(DATASET_CONTRACT_STATUS, "PROPOSAL_ONLY");
  assert.equal(TRANSITION_SCHEMA, "(state, action, reward, next_state, done)");
});

test("valid nonterminal record passes core audit", () => {
  const r = auditDatasetContractRecord({ timestamp: "2026-10-04T10:00:00", state: state(10, 100), action: { actionType: "HOLD", executionStatus: "CANCELLED" }, reward: 0, rewardFormulaVersion: "F2_NORMALIZED_PORTFOLIO_RETURN_V0.12.15", attributionType: "POSITION_INTERVAL", nextState: state(10.1, 100), done: false });
  assert.equal(r.valid, true);
  assert.equal(r.checks.noFutureFeatureLeakage, true);
  assert.equal(r.checks.tPlusOneSellableConsistency, true);
});

test("blocked and terminal encodings are audited", () => {
  const blocked = auditDatasetContractRecord({ timestamp: "2026-10-04T10:00:00", state: state(10, 0), action: { actionType: "SELL_ALL", executionStatus: "REJECTED" }, reward: null, blockedAction: true, nextState: state(10, 0), done: false });
  assert.equal(blocked.valid, true);
  const terminal = auditDatasetContractRecord({ timestamp: "2026-10-04T15:00:00", state: state(10, 100), action: { actionType: "HOLD", executionStatus: "CANCELLED" }, reward: 0, nextState: null, done: true });
  assert.equal(terminal.valid, true);
  assert.equal(terminal.checks.terminalStateEncoding, true);
});

test("future outcome feature is rejected", () => {
  const r = auditDatasetContractRecord({ timestamp: "2026-10-04T10:00:00", state: { ...state(10, 100), marketState: { price: 10, futurePrice: 11 } }, action: { actionType: "HOLD", executionStatus: "CANCELLED" }, reward: 0, nextState: state(10.1, 100), done: false });
  assert.equal(r.valid, false);
  assert.equal(r.checks.noFutureFeatureLeakage, false);
});
