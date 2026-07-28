import test from "node:test";
import assert from "node:assert/strict";

import {
  executePersonalTrainingOrder,
  scorePersonalTrainingActions,
  summarizePersonalTraining,
  trainingExecutionPrice,
} from "../lib/personal-replay-training.mjs";

test("personal training buy uses the currently revealed price and models costs", () => {
  const result = executePersonalTrainingOrder({ side: "buy", quantity: 100, marketPrice: 10, cash: 2_000, shares: 1_000, feeRate: 0.025, slippage: 0.02 });
  assert.equal(result.ok, true);
  assert.equal(result.action.executionPrice, 10.002);
  assert.equal(result.action.fee, 5);
  assert.equal(result.shares, 1_100);
  assert.ok(result.cash < 995);
});

test("personal training refuses an oversell instead of creating negative inventory", () => {
  const result = executePersonalTrainingOrder({ side: "sell", quantity: 300, marketPrice: 10, cash: 1_000, shares: 200 });
  assert.equal(result.ok, false);
  assert.match(result.error, /持仓不足/);
});

test("action scoring only evaluates when the selected future horizon exists", () => {
  const scores = scorePersonalTrainingActions([
    { side: "buy", minuteIndex: 0, marketPrice: 10 },
    { side: "sell", minuteIndex: 2, marketPrice: 10.4 },
  ], [{ price: 10 }, { price: 10.1 }, { price: 10.4 }, { price: 10.2 }], 2);
  assert.equal(scores[0].directionCorrect, true);
  assert.equal(scores[1].evaluated, false);
});

test("training summary keeps a clear baseline for the simulated base position", () => {
  const summary = summarizePersonalTraining({ initialCash: 1_000, initialShares: 100, initialPrice: 10, cash: 500, shares: 150, markPrice: 11, actions: [{ fee: 5 }] });
  assert.equal(summary.initialEquity, 2_000);
  assert.equal(summary.equity, 2_150);
  assert.equal(summary.net, 150);
  assert.equal(summary.fees, 5);
});

test("sell slippage moves the executable price down", () => {
  assert.equal(trainingExecutionPrice({ side: "sell", marketPrice: 10, slippage: 0.02 }), 9.998);
});
