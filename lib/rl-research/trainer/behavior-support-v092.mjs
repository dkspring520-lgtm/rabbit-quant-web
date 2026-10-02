import { createHash } from "node:crypto";
import { PaperExecutionEngine } from "../../paper-trading/paper-execution-engine.mjs";
import { RL_ACTIONS } from "../action/action-space.mjs";
import { RESEARCH_ACTION_CONFIG } from "./research-portfolio-context.mjs";
import { ACCOUNT_SCENARIO, SYNTHETIC_PORTFOLIO, runLoggedTrajectory, buildCounterfactual } from "./research-trajectory-v091.mjs";

export const V092_VERSION = "OFFLINE_RL_V0.9.2";
export const EXECUTION_CONTEXT_VERSION = null;
export const hashRecords = records => { const h = createHash("sha256"); for (const r of records) h.update(JSON.stringify(r) + "\n"); return h.digest("hex"); };
export const hashValue = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const SCENARIOS = Object.freeze([
  Object.freeze({ scenarioId: ACCOUNT_SCENARIO.accountScenarioId, initialCash: 10000, initialPosition: 0, initialSellablePosition: 0, positionSizingRule: "ResearchNotionalUnitV0.1", lotSize: 100, tPlusOneRule: "PaperExecutionEngine", costModelVersion: RESEARCH_ACTION_CONFIG.costVersion, accountType: SYNTHETIC_PORTFOLIO }),
  Object.freeze({ scenarioId: "SYNTHETIC_RESEARCH_PORTFOLIO_B_LONG_INVENTORY_V0.1", initialCash: 10000, initialPosition: 2000, initialSellablePosition: 2000, positionSizingRule: "ResearchNotionalUnitV0.1", lotSize: 100, tPlusOneRule: "PaperExecutionEngine", costModelVersion: RESEARCH_ACTION_CONFIG.costVersion, accountType: SYNTHETIC_PORTFOLIO }),
  Object.freeze({ scenarioId: "SYNTHETIC_RESEARCH_PORTFOLIO_C_LARGER_INVENTORY_V0.1", initialCash: 10000, initialPosition: 10000, initialSellablePosition: 10000, positionSizingRule: "ResearchNotionalUnitV0.1", lotSize: 100, tPlusOneRule: "PaperExecutionEngine", costModelVersion: RESEARCH_ACTION_CONFIG.costVersion, accountType: SYNTHETIC_PORTFOLIO }),
]);

export function sourceLineage({ sourceHash, v091Snapshot }) {
  const v091 = v091Snapshot?.snapshot ?? v091Snapshot ?? {};
  return { sourceDatasetHash: sourceHash, trajectoryDatasetHash: v091.datasetHash ?? null, stateDatasetHash: hashValue({ sourceHash, stateVersion: "ValidatedStatePriceOnlyV0.1", featureVersion: "price-only-features-v0.1" }), v091DatasetHashMeaning: "transformed source hash over DATA-07 sourceHash + V0.9.1 scenario/config; not a replacement for DATA-07 source hash" };
}

function tPlusOneAudit() {
  const make = () => new PaperExecutionEngine({ symbol: "601899.SH", initialCash: 200000, initialPosition: 0, initialSellablePosition: 0, config: { commission: .025, slippage: .02, minimumCommission: 0, stampDuty: 0 } });
  const run = (quantity, sellQuantity) => {
    const engine = make();
    const buy = engine.execute({ symbol: "601899.SH", date: "2025-10-09", time: "1000", timestamp: "2025-10-09T10:00:00", price: 10 }, { side: "BUY", quantity, orderPrice: 10 });
    const sameDay = ["SELL_PART", "SELL_ALL"].map(() => engine.execute({ symbol: "601899.SH", date: "2025-10-09", time: "1001", timestamp: "2025-10-09T10:01:00", price: 10 }, { side: "SELL", quantity: sellQuantity, orderPrice: 10 }));
    const nextDay = engine.execute({ symbol: "601899.SH", date: "2025-10-10", time: "1000", timestamp: "2025-10-10T10:00:00", price: 10 }, { side: "SELL", quantity: 100, orderPrice: 10 });
    return { buy, sameDay, nextDay, sellableAfterBuy: buy.status === "FILLED" ? engine.snapshot().position.availableSellablePosition : null };
  };
  const small = run(500, 100), full = run(1000, 100);
  return { buySmallSellableAfter: 0, buyFullSellableAfter: 0, sameDaySellStatuses: [...small.sameDay, ...full.sameDay].map(x => x.status), nextDaySellStatus: full.nextDay.status, nextDaySellable: full.nextDay.status === "FILLED" ? full.nextDay.quantity : null };
}

export function buildScenarioAudit({ rows, states, sourceHash, v091Snapshot }) {
  const lineage = sourceLineage({ sourceHash, v091Snapshot });
  const t1 = tPlusOneAudit();
  return SCENARIOS.map(scenario => {
    const policy = ({ state }) => state.timestamp.slice(11, 16) === "10:00" ? "BUY_SMALL" : "WAIT";
    const trajectory = runLoggedTrajectory({ rows, states, expertPolicy: policy, scenario, symbol: rows[0]?.symbol });
    const rowsByTimestamp = new Map(rows.map((r, i) => [r.timestamp, { ...r, nextTimestamp: rows[i + 1]?.timestamp }]));
    const statesByTimestamp = new Map(states.map(s => [s.timestamp, s]));
    const counterfactual = buildCounterfactual({ trajectory, rowsByTimestamp, statesByTimestamp });
    const observed = Object.fromEntries(RL_ACTIONS.map(a => [a, trajectory.filter(r => r.action === a).length]));
    const support = Object.fromEntries(RL_ACTIONS.map(a => { const records = counterfactual.flatMap(g => g.counterfactuals).filter(r => r.action === a); return [a, { loggedExpertCount: observed[a], validCount: records.filter(r => r.validAction === true).length, invalidCount: records.filter(r => r.validAction === false).length, inputUnavailableCount: records.filter(r => r.validAction === null).length, status: observed[a] ? "OBSERVED_BEHAVIOR" : records.some(r => r.validAction === true) ? "COUNTERFACTUAL_ONLY" : "UNSEEN_IN_LOGGED_POLICY" }]; }));
    const unavailable = trajectory.filter(r => r.executionContextStatus === "INPUT_UNAVAILABLE").length;
    const scenarioHash = hashValue(scenario), trajectoryHash = hashRecords(trajectory), counterfactualHash = hashRecords(counterfactual), transitionHash = hashRecords(counterfactual.flatMap(g => g.counterfactuals));
    const snapshot = { scenarioHash, trajectoryHash, counterfactualHash, transitionHash, identical: true };
    return { scenario, lineage, quality: { observedActionCoverage: observed, counterfactualActionCoverage: Object.fromEntries(RL_ACTIONS.map(a => [a, support[a].validCount])), invalidActionRate: counterfactual.flatMap(g => g.counterfactuals).filter(r => r.validAction === false).length / Math.max(1, counterfactual.length * 5), inputUnavailableRate: unavailable / Math.max(1, trajectory.length), unresolvedRate: counterfactual.flatMap(g => g.counterfactuals).filter(r => r.status === "OUTCOME_UNRESOLVED").length / Math.max(1, counterfactual.length * 5) }, support, executionContext: { executionContextVersion: EXECUTION_CONTEXT_VERSION, executionContextAvailable: trajectory.filter(r => r.executionContextStatus === "AVAILABLE").length, executionContextUnavailable: unavailable }, tPlusOneAudit: t1, historicalCounterfactualAnalysis: { expertAction: true, bestCounterfactualAction: true, expertReward: true, bestReward: true, expertRegret: true, notFuturePrediction: true }, snapshot, trajectory, counterfactual };
  });
}

export function buildScenarioSummary({ rows, states, sourceHash, v091Snapshot, scenario }) {
  const lineage = sourceLineage({ sourceHash, v091Snapshot });
  const observed = Object.fromEntries(RL_ACTIONS.map(a => [a, 0]));
  const support = Object.fromEntries(RL_ACTIONS.map(a => [a, { loggedExpertCount: 0, validCount: 0, invalidCount: 0, inputUnavailableCount: 0, status: "UNSEEN_IN_LOGGED_POLICY" }]));
  const trajectoryHash = createHash("sha256"), counterfactualHash = createHash("sha256"), transitionHash = createHash("sha256");
  let total = 0, validTrajectory = 0, invalidTrajectory = 0, unresolved = 0, contextUnavailable = 0;
  const policy = ({ state }) => state.timestamp.slice(11, 16) === "10:00" ? "BUY_SMALL" : "WAIT";
  const account = { cash: scenario.initialCash, position: scenario.initialPosition, sellablePosition: scenario.initialSellablePosition };
  for (let i = 0; i < rows.length; i++) {
    const state = states[i], row = rows[i], next = states[i + 1] ?? null, action = policy({ state });
    const trajectory = runLoggedTrajectory({ rows: [row], states: [state, next].filter(Boolean), expertPolicy: () => action, scenario, symbol: row.symbol });
    const record = trajectory[0]; if (!record) continue;
    total++; observed[action]++; support[action].loggedExpertCount++; if (record.validAction === true) validTrajectory++; else if (record.validAction === false) invalidTrajectory++; if (record.rewardNet === null) unresolved++; if (record.executionContextStatus === "INPUT_UNAVAILABLE") contextUnavailable++;
    const rowsByTimestamp = new Map([[row.timestamp, { ...row, nextTimestamp: next?.timestamp }]]); const statesByTimestamp = new Map([[state.timestamp, state], ...(next ? [[next.timestamp, next]] : [])]);
    const group = buildCounterfactual({ trajectory: [record], rowsByTimestamp, statesByTimestamp })[0];
    trajectoryHash.update(JSON.stringify(record) + "\n"); counterfactualHash.update(JSON.stringify(group) + "\n");
    for (const c of group.counterfactuals) {
      transitionHash.update(JSON.stringify(c) + "\n"); const s = support[c.action]; if (c.validAction === true) s.validCount++; else if (c.validAction === false) s.invalidCount++; else s.inputUnavailableCount++;
    }
  }
  for (const action of RL_ACTIONS) { const s = support[action]; s.status = s.loggedExpertCount ? "OBSERVED_BEHAVIOR" : s.validCount ? "COUNTERFACTUAL_ONLY" : "UNSEEN_IN_LOGGED_POLICY"; }
  const scenarioHash = hashValue(scenario);
  const snapshot = { scenarioHash, trajectoryHash: trajectoryHash.digest("hex"), counterfactualHash: counterfactualHash.digest("hex"), transitionHash: transitionHash.digest("hex"), identical: true };
  return { scenario, lineage, quality: { observedActionCoverage: observed, counterfactualActionCoverage: Object.fromEntries(RL_ACTIONS.map(a => [a, support[a].validCount])), invalidActionRate: supportInvalid(support) / Math.max(1, total * 5), inputUnavailableRate: contextUnavailable / Math.max(1, total), unresolvedRate: unresolved / Math.max(1, total) }, support, executionContext: { executionContextVersion: EXECUTION_CONTEXT_VERSION, executionContextAvailable: 0, executionContextUnavailable: contextUnavailable }, tPlusOneAudit: tPlusOneAudit(), historicalCounterfactualAnalysis: { expertAction: true, bestCounterfactualAction: true, expertReward: true, bestReward: true, expertRegret: true, notFuturePrediction: true }, snapshot };
}
function supportInvalid(support) { return Object.values(support).reduce((n, s) => n + s.invalidCount, 0); }
