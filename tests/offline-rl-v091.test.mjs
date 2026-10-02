import assert from "node:assert/strict";
import test from "node:test";
import { causalMarketStates } from "../lib/rl-research/trainer/counterfactual-transitions.mjs";
import { ACCOUNT_SCENARIO, SYNTHETIC_PORTFOLIO, buildCounterfactual, runLoggedTrajectory } from "../lib/rl-research/trainer/research-trajectory-v091.mjs";

const rows = [
  { symbol: "601899.SH", timestamp: "2025-10-09T10:00:00", price: 10, volume: 100 },
  { symbol: "601899.SH", timestamp: "2025-10-09T10:01:00", price: 10.2, volume: 100 },
  { symbol: "601899.SH", timestamp: "2025-10-10T10:00:00", price: 10.1, volume: 100 },
];
const states = [...causalMarketStates(rows)];
const policy = ({ state }) => state.timestamp.endsWith("10:00:00") ? "BUY_SMALL" : "WAIT";

test("V0.9.1 records a synthetic logged trajectory and never calls it real", () => {
  const records = runLoggedTrajectory({ rows, states, expertPolicy: policy });
  assert.equal(records.length, 3);
  assert.ok(records.every(r => r.accountType === SYNTHETIC_PORTFOLIO));
  assert.ok(records.every(r => r.realHistoricalAccount === false));
  assert.equal(records[0].action, "BUY_SMALL");
  assert.equal(records[0].validAction, true);
  for (const key of ["timestamp", "state", "cash", "position", "sellablePosition", "action", "validAction", "filledQuantity", "fillPrice", "fees", "slippage", "rewardGross", "rewardNet", "nextState", "done"]) {
    assert.ok(Object.hasOwn(records[0], key) || Object.hasOwn(records[0].executionResult ?? {}, key), key);
  }
  assert.ok(Math.abs(records[0].nextState.cash - 4997.74975) < 1e-8);
  assert.equal(ACCOUNT_SCENARIO.accountType, SYNTHETIC_PORTFOLIO);
});

test("V0.9.1 clones the same pre-action account for every counterfactual action", () => {
  const trajectory = runLoggedTrajectory({ rows, states, expertPolicy: policy });
  const byTimestamp = new Map(rows.map((row, i) => [row.timestamp, { ...row, nextTimestamp: rows[i + 1]?.timestamp }]));
  const stateMap = new Map(states.map(state => [state.timestamp, state]));
  const result = buildCounterfactual({ trajectory, rowsByTimestamp: byTimestamp, statesByTimestamp: stateMap });
  assert.equal(result[0].counterfactuals.length, 5);
  assert.equal(new Set(result[0].counterfactuals.map(x => x.state.timestamp)).size, 1);
  assert.equal(new Set(result[0].counterfactuals.map(x => x.counterfactualGroupId)).size, 1);
  assert.equal(result[0].bestCounterfactualAction, "BUY_SMALL");
  assert.equal(typeof result[0].expertRegret, "number");
  assert.match(result[0].analysisType, /not future prediction/);
});

test("V0.9.1 leaves unresolved outcomes null and uses next day T+1 settlement", () => {
  const trajectory = runLoggedTrajectory({ rows, states, expertPolicy: () => "BUY" });
  assert.equal(trajectory.at(-1).rewardNet, null);
  assert.equal(trajectory[0].validAction, false);
});
