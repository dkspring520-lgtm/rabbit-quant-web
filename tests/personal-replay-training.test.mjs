import test from "node:test";
import assert from "node:assert/strict";

import {
  executePersonalTrainingOrder,
  scorePersonalTrainingActions,
  summarizePersonalTraining,
  summarizeTrainingCycles,
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

test("matched buy then sell reports a profitable T cycle after fees", () => {
  const cycle = summarizeTrainingCycles([
    { side: "buy", quantity: 5_000, executionPrice: 19.89, fee: 25 },
    { side: "sell", quantity: 5_000, executionPrice: 19.96, fee: 35 },
  ]);
  assert.ok(Math.abs(cycle.gross - 350) < 1e-8);
  assert.equal(cycle.fees, 60);
  assert.ok(Math.abs(cycle.net - 290) < 1e-8);
  assert.equal(cycle.closedQuantity, 5_000);
});

test("T-cycle profit stays separate from base-position mark-to-market loss", () => {
  const actions = [
    { side: "buy", quantity: 5_000, executionPrice: 19.89, fee: 25 },
    { side: "sell", quantity: 5_000, executionPrice: 19.96, fee: 35 },
  ];
  const summary = summarizePersonalTraining({
    initialCash: 200_000,
    initialShares: 10_000,
    initialPrice: 19.90,
    cash: 200_290,
    shares: 10_000,
    markPrice: 19.82,
    actions,
  });
  assert.ok(Math.abs(summary.tradeNet - 290) < 1e-8);
  assert.ok(summary.net < 0);
});

test("sell first then buy back is also matched as a reverse-T cycle", () => {
  const cycle = summarizeTrainingCycles([
    { side: "sell", quantity: 5_000, executionPrice: 20, fee: 35 },
    { side: "buy", quantity: 5_000, executionPrice: 19.90, fee: 25 },
  ]);
  assert.ok(Math.abs(cycle.gross - 500) < 1e-8);
  assert.equal(cycle.fees, 60);
  assert.ok(Math.abs(cycle.net - 440) < 1e-8);
  assert.equal(cycle.openQuantity, 0);
});

test("sell slippage moves the executable price down", () => {
  assert.equal(trainingExecutionPrice({ side: "sell", marketPrice: 10, slippage: 0.02 }), 9.998);
});
