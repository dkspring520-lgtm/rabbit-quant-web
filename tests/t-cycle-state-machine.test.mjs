import test from "node:test";
import assert from "node:assert/strict";

import { closeTCycle, createTCycleState, openTCycle, refreshTCycleState } from "../lib/t-cycle-state-machine.mjs";

test("reverse T must sell existing inventory before buying back", () => {
  const opened = openTCycle(createTCycleState(), {
    direction: "SELL_FIRST", price: 10, quantity: 1000, sellable: 2000, cash: 0, minute: 10,
  });
  assert.equal(opened.ok, true);
  assert.equal(opened.state.phase, "WAIT_BUYBACK");
  assert.equal(opened.state.pending.expectedSide, "BUY");

  const duplicate = openTCycle(opened.state, {
    direction: "SELL_FIRST", price: 10.1, quantity: 1000, sellable: 1000, cash: 0, minute: 12,
  });
  assert.equal(duplicate.ok, false);

  const wrongSide = closeTCycle(opened.state, { side: "SELL", price: 9.8, minute: 20, forced: false });
  assert.equal(wrongSide.ok, false);

  const closed = closeTCycle(opened.state, { side: "BUY", price: 9.8, minute: 20, forced: false });
  assert.equal(closed.ok, true);
  assert.equal(closed.state.phase, "COOLDOWN");
  assert.equal(closed.state.cycles, 1);
});

test("reverse T never chases a higher buyback unless risk control forces it", () => {
  const opened = openTCycle(createTCycleState(), {
    direction: "SELL_FIRST", price: 10, quantity: 1000, sellable: 1000, cash: 0, minute: 10,
  }).state;
  assert.equal(closeTCycle(opened, { side: "BUY", price: 10.1, minute: 20, forced: false }).ok, false);
  assert.equal(closeTCycle(opened, { side: "BUY", price: 10.1, minute: 220, forced: true }).ok, true);
});

test("cooldown must finish before the next cycle can open", () => {
  const opened = openTCycle(createTCycleState(), {
    direction: "BUY_FIRST", price: 10, quantity: 1000, sellable: 0, cash: 20_000, minute: 10,
  }).state;
  const closed = closeTCycle(opened, { side: "SELL", price: 10.1, minute: 20, forced: false }).state;
  assert.equal(refreshTCycleState(closed, 27, 8).phase, "COOLDOWN");
  assert.equal(refreshTCycleState(closed, 28, 8).phase, "READY");
});
