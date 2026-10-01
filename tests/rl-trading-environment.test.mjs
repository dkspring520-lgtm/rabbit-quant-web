import assert from "node:assert/strict";
import test from "node:test";
import { TTradingEnvironment, executePaperAction } from "../lib/rl-research/index.mjs";

const point = (time, price = 10, extra = {}) => ({ time, price, open: price, high: price, low: price, volume: 1000, amount: price * 1000, ...extra });
const session = { date: "20260930", minutes: [point("0930", 10), point("0931", 10.1), point("0932", 10.2), point("0933", 10.3)] };

test("paper BUY keeps today's shares non-sellable", () => {
  const environment = new TTradingEnvironment({ symbol: "601899", session, initialCash: 10_000, openingShares: 1_000, sellableShares: 1_000 });
  environment.reset();
  const result = environment.step({ action: "BUY", quantity: 100, source: "experimental" });
  assert.equal(result.record.status, "filled");
  assert.equal(result.record.positionAfter, 1_100);
  assert.equal(result.record.sellableAfter, 1_000);
  assert.equal(result.info.sameDayBuyShares, 100);
});

test("paper SELL cannot exceed yesterday's sellable shares", () => {
  const environment = new TTradingEnvironment({ symbol: "601899", session, initialCash: 10_000, openingShares: 1_000, sellableShares: 0 });
  environment.reset();
  const result = environment.step({ action: "SELL", quantity: 100 });
  assert.equal(result.record.status, "rejected");
  assert.match(result.record.rejectionReason, /T\+1/);
  assert.equal(environment.snapshot().position, 1_000);
});

test("paper execution rejects stale data and out-of-session actions", () => {
  const base = { symbol: "601899", date: "20260930", time: "0930", price: 10, position: 1000, availableSellablePosition: 1000, cash: 10000 };
  assert.match(executePaperAction({ ...base, dataQuality: { stale: true } }, { action: "BUY", quantity: 100 }).rejectionReason, /过期/);
  assert.match(executePaperAction({ ...base, time: "1200" }, { action: "BUY", quantity: 100 }).rejectionReason, /连续竞价/);
});

test("environment remains causal and completes after the last observed minute", () => {
  const environment = new TTradingEnvironment({ symbol: "601899", session, initialCash: 10_000 });
  const seen = [];
  let observation = environment.reset();
  while (observation) {
    seen.push(observation.time);
    observation = environment.step({ action: "WAIT" }).observation;
  }
  assert.deepEqual(seen, ["0930", "0931", "0932", "0933"]);
  assert.equal(environment.snapshot().done, true);
});
