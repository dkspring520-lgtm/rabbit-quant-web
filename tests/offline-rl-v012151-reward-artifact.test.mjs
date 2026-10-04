import assert from "node:assert/strict";
import test from "node:test";
import { buildRewardArtifactRecord, validateRewardArtifactRecord } from "../lib/rl-research/reward/observed-price-reward-artifact-v012151.mjs";

const state = (cash, position, sellablePosition, averageCost, price, todayBought = 0) => ({ accountState: { cash, position, sellablePosition, averageCost, todayBought }, marketState: { price } });

test("artifact schema and accounting-closed formula are valid", () => {
  const record = buildRewardArtifactRecord({ episodeId: "e1", transitionId: "t1", timestamp: "2026-10-04T10:00:00", action: "HOLD", preActionState: state(900, 100, 100, 9, 10), postActionState: state(900, 100, 100, 9, 11), executionResult: { status: "CANCELLED" } });
  const validation = validateRewardArtifactRecord(record);
  assert.equal(validation.valid, true);
  assert.equal(record.accountingMode, "ACCOUNTING_CLOSED");
  assert.equal(record.feeDeductedAtRewardLayer, false);
  assert.equal(record.slippageDeductedAtRewardLayer, false);
});

test("T+1 state is copied and blocked SELL is not a losing SELL", () => {
  const record = buildRewardArtifactRecord({ episodeId: "e1", transitionId: "t2", timestamp: "2026-10-04T10:01:00", action: "SELL_ALL", preActionState: state(100, 100, 0, 10, 10, 100), postActionState: state(100, 100, 0, 10, 9, 100), actionResult: { actionFeasibility: "INFEASIBLE" }, executionResult: { status: "REJECTED" } });
  assert.equal(record.blockedExecution, true);
  assert.equal(record.reward, null);
  assert.equal(record.sellablePosition, 0);
  assert.equal(record.postActionState.accountState.todayBought, 100);
});

test("position interval artifact carries one transition attribution", () => {
  const record = buildRewardArtifactRecord({ episodeId: "e1", transitionId: "interval-1", timestamp: "2026-10-04T10:02:00", action: "SELL_ALL", preActionState: state(0, 100, 100, 10, 10), postActionState: state(1100, 0, 0, null, 11), executionResult: { status: "FILLED", fees: 2, slippage: 1 } });
  assert.equal(record.attributionType, "POSITION_INTERVAL");
  assert.equal(record.accountingMode, "ACCOUNTING_CLOSED");
  assert.equal(record.feeDeductedAtRewardLayer, false);
  assert.equal(record.slippageDeductedAtRewardLayer, false);
});
