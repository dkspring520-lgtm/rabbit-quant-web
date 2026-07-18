import test from "node:test";
import assert from "node:assert/strict";
import { evaluateStockAgent, resolveStockAgent } from "../lib/stock-agent-router.mjs";

const opening = [
  { time:"0930", price:28.60, volume:100 },
  { time:"0931", price:28.30, volume:90 },
  { time:"0932", price:28.22, volume:80 },
  { time:"0933", price:28.38, volume:180 },
  { time:"0934", price:28.49, volume:190 },
  { time:"0935", price:28.55, volume:210 },
];

test("601899 is routed to an isolated non-executable agent", () => {
  const agent = resolveStockAgent("601899");
  assert.equal(agent.id, "zijin-agent");
  assert.equal(agent.mode, "research-only");
  assert.equal(agent.canExecute, false);
  assert.equal(agent.affectsV4, false);
});

test("other stocks continue to use Smart-T V4", () => {
  const agent = resolveStockAgent("603993");
  assert.equal(agent.id, "smart-t-v4");
  assert.equal(agent.canExecute, true);
});

test("Zijin opening evaluation stays causal and non-executable", () => {
  const prefix = opening.slice(0, 4);
  const first = evaluateStockAgent({ code:"601899", minutes:prefix, previousClose:28.70 });
  const repeated = evaluateStockAgent({ code:"601899", minutes:prefix, previousClose:28.70 });
  assert.deepEqual(first, repeated);
  assert.equal(first.phase, "opening");
  assert.equal(first.executable, false);
});

test("Zijin stays active after 10:30 with the intraday factor layer", () => {
  const later = [...opening];
  for (let index = 0; index < 30; index += 1) {
    later.push({ time:`11${String(index).padStart(2,"0")}`, price:28.40 + index * 0.002, volume:100 + index });
  }
  const result = evaluateStockAgent({ code:"601899", minutes:later, previousClose:28.70 });
  assert.equal(result.phase, "intraday");
  assert.notEqual(result.status, "blocked");
  assert.equal(result.affectsV4, false);
});

test("non-Zijin stocks do not receive the standalone evaluation", () => {
  assert.equal(evaluateStockAgent({ code:"601012", minutes:opening }), null);
});
