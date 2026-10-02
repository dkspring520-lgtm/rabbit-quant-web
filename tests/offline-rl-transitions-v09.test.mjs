import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { causalMarketStates, evaluateTransitionGroup, hashTransition, data07Split, summarizeRegret, TRANSITION_COSTS } from "../lib/rl-research/trainer/counterfactual-transitions.mjs";
import { buildOfflineRLDataset } from "../lib/rl-research/trainer/offline-dataset.mjs";
import { applyResearchAction, ResearchPortfolioContext } from "../lib/rl-research/trainer/research-portfolio-context.mjs";

const rows = [10, 10.2, 9.9].map((price, i) => ({ symbol: "601899.SH", timestamp: `2025-10-09T10:0${i}:00`, price, volume: 100, previousClose: 10 }));
const states = [...causalMarketStates(rows)];
const account = { cash: 20000, position: 2000, sellablePosition: 1600, averageCost: 9 };
const options = { marketState: states[0], nextMarketState: states[1], barIndex: 0, account, accountSource: "TEST_FIXTURE", expertAction: "BUY", datasetHash: "fixture" };
const action = (group, name) => group.transitions.find(t => t.action === name);

test("V0.9 branches five actions independently with shared state and path", () => {
  const before = structuredClone(options), group = evaluateTransitionGroup(options);
  assert.deepEqual(options, before);
  assert.equal(group.transitions.length, 5);
  assert.equal(new Set(group.transitions.map(t => t.marketPathHash)).size, 1);
  assert.equal(new Set(group.transitions.map(t => hashTransition(t.state))).size, 1);
  assert.equal(action(group, "BUY_SMALL").filledQuantity, 500);
  assert.equal(action(group, "BUY").filledQuantity, 1000);
  assert.equal(action(group, "SELL_PART").filledQuantity, 400);
  assert.equal(action(group, "SELL_ALL").filledQuantity, 1600);
  assert.equal(action(group, "BUY").nextState.positionState.sellablePosition, 1600);
  assert.equal(action(group, "BUY").nextState.positionState.position, 3000);
  assert.equal(action(group, "SELL_ALL").positionAfter.totalPosition, 400);
  assert.equal(action(group, "WAIT").fillPrice, null);
  assert.equal(action(group, "WAIT").reward, 0);
  for (const t of group.transitions) {
    assert.equal(t.validAction, true);
    assert.ok(Math.abs(t.cashAfter + t.positionAfter.totalPosition * states[0].price
      - (account.cash + account.position * states[0].price - t.fees - t.slippage)) < 1e-5);
  }
});

test("V0.9 invalid actions retain null outcomes, missing context is not invalid", () => {
  const missing = evaluateTransitionGroup({ ...options, account: null, expertAction: null });
  for (const t of missing.transitions) { assert.equal(t.validAction, null); assert.equal(t.status, "INPUT_UNAVAILABLE"); assert.equal(t.reward, null); }
  for (const invalid of [{ cash: 0, position: 0, sellablePosition: 0 }, { cash: 0, position: 1000, sellablePosition: 0 }]) {
    const g = evaluateTransitionGroup({ ...options, account: invalid });
    assert.equal(action(g, "WAIT").validAction, true);
    for (const t of g.transitions.slice(1)) {
      assert.equal(t.status, "INVALID_ACTION"); assert.equal(t.filledQuantity, 0);
      assert.equal(t.reward, null); assert.equal(t.nextState, null); assert.equal(t.fees, null);
    }
  }
  assert.equal(action(evaluateTransitionGroup({ ...options, account: { ...account, cash: null } }), "BUY").validAction, null);
});

test("V0.9 reuses existing action sizing and normalized reward without new costs", () => {
  const context = new ResearchPortfolioContext({ cash: account.cash, tradeDate: "20251009", lots: [
    { acquiredAt: "20251008", quantity: 1600, sellableQuantity: 1600, sellableAt: "20251009", costBasis: 9 },
    { acquiredAt: "20251009", quantity: 400, sellableQuantity: 0, sellableAt: "20251010", costBasis: 9 },
  ] });
  for (const t of evaluateTransitionGroup(options).transitions) {
    assert.equal(t.requestedQuantity, applyResearchAction(context, t.action, { price: 10, tradeDate: "20251009" }).requestedQuantity);
    const notional = t.fillPrice * t.filledQuantity;
    const [legacy] = buildOfflineRLDataset([{ expertAction: t.action, futureReturn: t.futureReturn,
      feeRate: notional ? t.fees / notional : 0, slippageRate: notional ? t.slippage / notional : 0 }]);
    assert.equal(t.reward, legacy.reward);
    assert.equal(t.stampDuty, 0);
  }
  assert.deepEqual(TRANSITION_COSTS, { commission: 0.025, slippage: 0.02, minimumCommission: 0, stampDuty: 0 });
  assert.equal(action(evaluateTransitionGroup(options), "BUY").fees, 2.5005);
  assert.equal(action(evaluateTransitionGroup(options), "BUY").slippage, 2);
});

test("V0.9 refuses incomplete next observations and split/session crossing", () => {
  for (const nextMarketState of [null, { ...states[1], timestamp: "2026-04-18T10:00:00" }, { ...states[1], timestamp: "2025-10-10T09:30:00" }]) {
    const g = evaluateTransitionGroup({ ...options, nextMarketState });
    for (const t of g.transitions) { assert.equal(t.reward, null); assert.equal(t.nextState, null); assert.equal(t.done, true); }
  }
  const g = evaluateTransitionGroup({ ...options, nextMarketState: { ...states[1], price: NaN } });
  assert.equal(action(g, "BUY").reward, null);
  assert.equal(action(g, "BUY").status, "OUTCOME_UNRESOLVED");
  assert.equal(data07Split("2024-12-31T15:00:00"), "train");
  assert.equal(data07Split("2025-01-01T09:30:00"), "validation");
  assert.equal(data07Split("2025-10-01T09:30:00"), "test");
});

test("V0.9 future mutation preserves all prefix transition inputs and expert action", () => {
  const changedRows = rows.map((r, i) => i > 0 ? { ...r, price: r.price * 1.5, volume: r.volume * 2 } : r);
  const changedStates = [...causalMarketStates(changedRows)];
  const a = evaluateTransitionGroup(options);
  const b = evaluateTransitionGroup({ ...options, marketState: changedStates[0], nextMarketState: changedStates[1] });
  assert.equal(a.inputHash, b.inputHash);
  assert.equal(a.expertAction, b.expertAction);
  assert.notEqual(action(a, "BUY").reward, action(b, "BUY").reward);
  assert.notEqual(action(a, "BUY").marketPathHash, action(b, "BUY").marketPathHash);
  assert.equal(hashTransition(a), hashTransition(evaluateTransitionGroup(structuredClone(options))));
});

test("V0.9 regret excludes missing expert and non-executable expert, handles ties", () => {
  assert.equal(summarizeRegret([evaluateTransitionGroup({ ...options, expertAction: null })]).meanRegret, null);
  const g = evaluateTransitionGroup(options);
  assert.equal(g.expertRegret, 0);
  assert.equal(summarizeRegret([g]).agreementRate, 1);
  const missing = evaluateTransitionGroup({ ...options, account: { cash: 0, position: 0, sellablePosition: 0 } });
  assert.equal(missing.expertRegret, null);
});

test("V0.9 observes execution time and price-limit constraints", () => {
  const limited = evaluateTransitionGroup({ ...options, marketFlags: { limitUp: true } });
  assert.equal(action(limited, "BUY").status, "INVALID_ACTION");
  assert.equal(action(limited, "SELL_ALL").validAction, true);
  const close = evaluateTransitionGroup({ ...options, marketState: { ...states[0], timestamp: "2025-10-09T14:59:00" } });
  assert.equal(action(close, "BUY").status, "INVALID_ACTION");
});

test("V0.9 module is research-only without strategy or training dependencies", () => {
  const source = readFileSync(new URL("../lib/rl-research/trainer/counterfactual-transitions.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+["'][^"']*(smart-t|shadow-v2|trainer\/value-regression|server\/)/i);
  assert.doesNotMatch(source, /fetch\(|trainCentroid|fitRidge|PPO|DQN|SAC/);
});
