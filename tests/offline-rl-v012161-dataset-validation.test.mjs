import assert from "node:assert/strict";
import test from "node:test";
import { validateDatasetContractRecord, VALIDATION_VERSION } from "../lib/rl-research/dataset/reward-dataset-validation-v012161.mjs";

const state = (price = 10, sellablePosition = 100) => ({ marketState: { price, features: { return1m: 0 } }, accountState: { cash: 1000, position: 100, sellablePosition, todayBought: 0, averageCost: 10 } });

test("dataset validation passes a contract-aligned transition", () => {
  const result = validateDatasetContractRecord({ validationVersion: VALIDATION_VERSION, timestamp: "2026-10-04T10:00:00", rewardTimestamp: "2026-10-04T10:00:00", nextTimestamp: "2026-10-04T10:01:00", state: state(), action: { actionType: "HOLD", executionStatus: "CANCELLED" }, reward: 0.01, rewardSource: "REWARD_ARTIFACT", nextState: state(10.1), done: false });
  assert.equal(result.valid, true);
  assert.equal(result.checks.stateLeakage, true);
  assert.equal(result.checks.rewardAlignment, true);
  assert.equal(result.checks.tPlusOne, true);
});

test("future state fields and non-artifact rewards are rejected", () => {
  const result = validateDatasetContractRecord({ timestamp: "2026-10-04T10:00:00", rewardTimestamp: "2026-10-04T10:00:00", state: { ...state(), marketState: { price: 10, futurePrice: 11 } }, action: { actionType: "HOLD", executionStatus: "CANCELLED" }, reward: 0.1, rewardSource: "FUTURE_LABEL", nextState: state(10.1), done: false });
  assert.equal(result.valid, false);
  assert.equal(result.checks.stateLeakage, false);
  assert.equal(result.checks.rewardAlignment, false);
});

test("blocked actions and terminal transitions remain distinct", () => {
  const blocked = validateDatasetContractRecord({ timestamp: "2026-10-04T10:00:00", rewardTimestamp: "2026-10-04T10:00:00", state: state(10, 0), action: { actionType: "SELL_ALL", executionStatus: "REJECTED", blocked: true }, reward: null, rewardSource: "REWARD_ARTIFACT", nextState: state(10, 0), done: false });
  assert.equal(blocked.valid, true);
  const terminal = validateDatasetContractRecord({ timestamp: "2026-10-04T15:00:00", rewardTimestamp: "2026-10-04T15:00:00", state: state(), action: { actionType: "HOLD", executionStatus: "CANCELLED" }, reward: null, rewardSource: "REWARD_ARTIFACT", nextState: null, done: true });
  assert.equal(terminal.valid, true);
  assert.equal(terminal.checks.terminal, true);
});
