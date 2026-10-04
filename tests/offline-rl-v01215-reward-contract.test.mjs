import assert from "node:assert/strict";
import test from "node:test";
import { calculateObservedPriceReward, ATTRIBUTION_TYPE, HORIZON_TYPE, ACCOUNTING_MODE } from "../lib/rl-research/reward/observed-price-reward-contract-v01215.mjs";

const state = (cash, position, price) => ({ accountState: { cash, position, sellablePosition: position, todayBought: 0 }, marketState: { price } });

test("approved reward contract calculates normalized accounting-closed movement", () => {
  const result = calculateObservedPriceReward({ preActionState: state(900, 100, 10), postActionState: state(900, 100, 11), executionResult: { status: "CANCELLED" } });
  // V_start = 900 + 100*10 = 1900; V_end = 900 + 100*11 = 2000.
  // F2 = (2000 - 1900) / 1900 = 100/1900.
  assert.equal(result.rewardValue, 100 / 1900);
  assert.equal(result.attributionType, ATTRIBUTION_TYPE);
  assert.equal(result.horizonType, HORIZON_TYPE);
  assert.equal(result.accountingMode, ACCOUNTING_MODE);
  assert.equal(result.validationStatus, "VALID");
  assert.equal(result.feeDeductedAtRewardLayer, false);
  assert.equal(result.slippageDeductedAtRewardLayer, false);
});

test("blocked execution is feasibility-aware and not a losing execution", () => {
  const result = calculateObservedPriceReward({ preActionState: state(900, 100, 10), postActionState: state(900, 100, 9), executionResult: { status: "REJECTED" } });
  assert.equal(result.rewardValue, null);
  assert.equal(result.validationStatus, "BLOCKED_FEASIBILITY_AWARE");
  assert.equal(result.blockedExecution, true);
});

test("terminal open position remains valuation-only and does not synthesize liquidation", () => {
  const result = calculateObservedPriceReward({ preActionState: state(900, 100, 10), postActionState: state(900, 100, 10.5), executionResult: { status: "CANCELLED" }, terminal: true });
  assert.equal(result.terminal, true);
  // V_start = 1900; V_end = 900 + 100*10.5 = 1950.
  // Terminal valuation remains observed-price valuation; no synthetic liquidation.
  assert.equal(result.rewardValue, 50 / 1900);
});
