import assert from "node:assert/strict";
import test from "node:test";
import { causalMarketStates } from "../lib/rl-research/trainer/counterfactual-transitions.mjs";
import { SCENARIOS } from "../lib/rl-research/trainer/behavior-support-v092.mjs";
import { executeOne, evaluateClosure, hashRecords } from "../lib/rl-research/trainer/transition-closure-v093.mjs";

const rows = [
  { symbol: "601899.SH", timestamp: "2025-10-09T10:00:00", price: 10, volume: 100 },
  { symbol: "601899.SH", timestamp: "2025-10-09T10:01:00", price: 10.2, volume: 100 },
  { symbol: "601899.SH", timestamp: "2025-10-10T10:00:00", price: 10.1, volume: 100 },
];
const states = [...causalMarketStates(rows)];
const account = { cash: 20000, position: 2000, sellablePosition: 1600, averageCost: 9 };
const args = { state: account, market: rows[0], nextMarket: rows[1], scenarioId: SCENARIOS[1].scenarioId, sourceDatasetHash: "source", trajectoryDatasetHash: "trajectory" };

test("V0.9.3 closes state-action-execution-reward-nextState contract", () => {
  const t = executeOne({ ...args, action: "BUY_SMALL" });
  assert.equal(t.validAction, true);
  assert.equal(t.status, "RESOLVED");
  assert.equal(t.filledQuantity, 500);
  assert.ok(Number.isFinite(t.rewardGross));
  assert.ok(Number.isFinite(t.rewardNet));
  assert.equal(t.reward, t.rewardNet);
  assert.equal(t.nextState.position, 2500);
  assert.equal(t.nextState.sellablePosition, 1600);
  for (const key of ["state", "action", "reward", "nextState", "done", "timestamp", "scenarioId", "datasetHash", "sourceDatasetHash", "trajectoryDatasetHash", "executionVersion", "rewardVersion", "costModelVersion"]) assert.ok(Object.hasOwn(t, key), key);
});

test("V0.9.3 counterfactual actions are independent and preserve T+1", () => {
  const actions = ["WAIT", "BUY_SMALL", "BUY", "SELL_PART", "SELL_ALL"].map(action => executeOne({ ...args, action }));
  assert.equal(new Set(actions.map(t => t.state.position)).size, 1);
  assert.deepEqual(actions.map(t => t.action), ["WAIT", "BUY_SMALL", "BUY", "SELL_PART", "SELL_ALL"]);
  assert.equal(actions[1].nextState.sellablePosition, account.sellablePosition);
  assert.equal(actions[2].nextState.sellablePosition, account.sellablePosition);
  assert.equal(actions[3].validAction, true);
  assert.equal(actions[4].validAction, true);
});

test("V0.9.3 invalid, unavailable and unresolved are not zero rewards", () => {
  const invalid = executeOne({ ...args, action: "BUY", state: { cash: 1, position: 0, sellablePosition: 0 } });
  assert.equal(invalid.status, "INVALID_ACTION"); assert.equal(invalid.reward, null);
  const unavailable = executeOne({ ...args, action: "BUY", state: null });
  assert.equal(unavailable.status, "INPUT_UNAVAILABLE"); assert.equal(unavailable.reward, null);
  const unresolved = executeOne({ ...args, action: "BUY_SMALL", nextMarket: null });
  assert.equal(unresolved.status, "OUTCOME_UNRESOLVED"); assert.equal(unresolved.reward, null); assert.equal(unresolved.nextState, null);
});

test("V0.9.3 closure hashes are deterministic and no future mutation changes state input", () => {
  const a = evaluateClosure({ rows, states, scenario: SCENARIOS[1], sourceDatasetHash: "source", trajectoryDatasetHash: "trajectory" });
  const b = evaluateClosure({ rows, states, scenario: SCENARIOS[1], sourceDatasetHash: "source", trajectoryDatasetHash: "trajectory" });
  assert.deepEqual(a.hashes, b.hashes);
  assert.equal(a.hashes.trajectoryHash, hashRecords(a.trajectory));
  const mutatedRows = rows.map((row, i) => i > 0 ? { ...row, price: row.price * 1.5 } : row);
  const mutatedStates = [...causalMarketStates(mutatedRows)];
  const mutated = evaluateClosure({ rows: mutatedRows, states: mutatedStates, scenario: SCENARIOS[1], sourceDatasetHash: "source", trajectoryDatasetHash: "trajectory" });
  assert.deepEqual(a.trajectory[0].state, mutated.trajectory[0].state);
  assert.notEqual(a.trajectory[0].rewardNet, mutated.trajectory[0].rewardNet);
});
