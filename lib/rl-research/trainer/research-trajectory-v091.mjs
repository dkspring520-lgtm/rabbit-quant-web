import { createHash } from "node:crypto";
import { PaperExecutionEngine } from "../../paper-trading/paper-execution-engine.mjs";
import { RL_ACTIONS } from "../action/action-space.mjs";
import { calculateRateReward } from "../reward/reward-function.mjs";
import { RESEARCH_ACTION_CONFIG, applyResearchAction, ResearchPortfolioContext } from "./research-portfolio-context.mjs";
import { data07Split, hashTransition } from "./counterfactual-transitions.mjs";

export const V091_VERSION = "OFFLINE_RL_V0.9.1";
export const SYNTHETIC_PORTFOLIO = "SYNTHETIC_RESEARCH_PORTFOLIO";
export const REAL_ACCOUNT = "REAL_HISTORICAL_ACCOUNT";
export const ACCOUNT_SCENARIO = Object.freeze({ accountScenarioId: "SYNTHETIC_RESEARCH_PORTFOLIO_C_10000_V0.1", initialCash: 10000, initialPosition: 0, initialSellablePosition: 0, positionSizingRule: "ResearchNotionalUnitV0.1", lotSize: 100, tPlusOneRule: "PaperExecutionEngine", executionRuleVersion: "PaperExecutionEngine", costModelVersion: RESEARCH_ACTION_CONFIG.costVersion, accountType: SYNTHETIC_PORTFOLIO });
export const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const hashRecords = records => { const h = createHash("sha256"); for (const record of records) h.update(JSON.stringify(record) + "\n"); return h.digest("hex"); };

function isValidAccount(a) { return a && Number.isFinite(a.cash) && Number.isInteger(a.position) && Number.isInteger(a.sellablePosition) && a.cash >= 0 && a.position >= a.sellablePosition && a.sellablePosition >= 0; }
function qty(action, price, account) { const c = RESEARCH_ACTION_CONFIG; const raw = action === "BUY_SMALL" ? c.notionalUnit * c.buySmallUnits / price : action === "BUY" ? c.notionalUnit / price : action === "SELL_PART" ? account.sellablePosition * c.sellPartFraction : action === "SELL_ALL" ? account.sellablePosition : 0; return Math.floor(raw / c.lotSize) * c.lotSize; }
function execute(state, action, price, date, context = {}) {
  if (!isValidAccount(state)) return { status: "INPUT_UNAVAILABLE", validAction: null, reason: "MISSING_SYNTHETIC_ACCOUNT", fees: null, slippage: null, filledQuantity: null, fillPrice: null, positionAfter: null, cashAfter: null };
  const engine = new PaperExecutionEngine({ symbol: context.symbol, initialCash: state.cash, initialPosition: state.position, initialSellablePosition: state.sellablePosition, averageCost: state.averageCost, config: { commission: 0.025, slippage: 0.02, minimumCommission: 0, stampDuty: 0 } });
  const side = action.startsWith("BUY") ? "BUY" : action.startsWith("SELL") ? "SELL" : "WAIT";
  const order = engine.execute({ symbol: context.symbol, date, time: context.time, timestamp: context.timestamp, price, marketPrice: price, suspended: context.suspended, limitUp: context.limitUp, limitDown: context.limitDown }, { side, quantity: qty(action, price, state), orderPrice: price, timestamp: context.timestamp });
  if (side === "WAIT") return { status: "VALID", validAction: order.status === "CANCELLED", reason: null, fees: 0, slippage: 0, filledQuantity: 0, fillPrice: null, positionAfter: engine.position, cashAfter: engine.cash, order };
  if (order.status !== "FILLED") return { status: "INVALID_ACTION", validAction: false, reason: order.reason, fees: null, slippage: null, filledQuantity: 0, fillPrice: null, positionAfter: null, cashAfter: null, order };
  return { status: "VALID", validAction: true, reason: null, fees: order.fees, slippage: order.slippage, filledQuantity: order.quantity, fillPrice: order.fillPrice, positionAfter: engine.position, cashAfter: engine.cash, order };
}

function reward(execution, action, currentPrice, futurePrice) {
  if (execution.validAction !== true || !Number.isFinite(futurePrice)) return { rewardGross: null, rewardNet: null, futureReturn: null };
  const futureReturn = futurePrice / currentPrice - 1; const exposure = { WAIT: 0, BUY_SMALL: .5, BUY: 1, SELL_PART: -.25, SELL_ALL: -1 }[action]; const notional = execution.filledQuantity * execution.fillPrice;
  return { futureReturn, rewardGross: calculateRateReward({ futureReturnRate: exposure * futureReturn }), rewardNet: calculateRateReward({ futureReturnRate: exposure * futureReturn, feeRate: notional ? execution.fees / notional : 0, slippageRate: notional ? execution.slippage / notional : 0 }) };
}

export function createSyntheticScenario({ scenario = ACCOUNT_SCENARIO, symbol = "601899.SH", date = "2025-10-09" } = {}) {
  return new ResearchPortfolioContext({ symbol, tradeDate: date, cash: scenario.initialCash, lots: [{ acquiredAt: date, quantity: scenario.initialPosition, remainingQuantity: scenario.initialPosition, sellableQuantity: scenario.initialSellablePosition, sellableAt: date, costBasis: 0 }] });
}

export function runLoggedTrajectory({ rows, states, expertPolicy, scenario = ACCOUNT_SCENARIO, symbol = "601899.SH", marketContext = () => ({ status: "INPUT_UNAVAILABLE" }) }) {
  const account = createSyntheticScenario({ scenario, symbol, date: rows[0]?.timestamp?.slice(0, 10) }); const records = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], state = states[i], next = states[i + 1] ?? null, split = data07Split(row.timestamp);
    if (!split) continue;
    const before = account.snapshot(row.price); const action = expertPolicy({ row, state, account: before });
    const context = { ...marketContext(row), symbol, timestamp: row.timestamp, time: row.timestamp.slice(11, 16), suspended: undefined, limitUp: undefined, limitDown: undefined };
    const execution = execute(before, RL_ACTIONS.includes(action) ? action : "WAIT", row.price, row.timestamp.slice(0, 10), context);
    const rewardInfo = reward(execution, action, row.price, rows[i + 1]?.price);
    if (execution.validAction === true && execution.order?.status === "FILLED") {
      const applied = applyResearchAction(account, action, { price: row.price, tradeDate: row.timestamp.slice(0, 10) });
      if (!applied.applicable) throw new Error(`Engine/context divergence: ${applied.applicabilityReason}`);
      account.cash = applied.afterContext.cash; account.lots = applied.afterContext.lots; account.tradeDate = applied.afterContext.tradeDate;
    }
    const after = account.snapshot(row.price);
    records.push({ datasetVersion: "OFFLINE_RL_LOGGED_TRAJECTORY_V0.9.1", accountType: SYNTHETIC_PORTFOLIO, accountScenarioId: scenario.accountScenarioId, timestamp: row.timestamp, split, state, cash: before.cash, position: before.position, sellablePosition: before.sellablePosition, action, validAction: execution.validAction, executionResult: execution, filledQuantity: execution.filledQuantity, fillPrice: execution.fillPrice, fees: execution.fees, slippage: execution.slippage, reward: rewardInfo.rewardNet, rewardGross: rewardInfo.rewardGross, rewardNet: rewardInfo.rewardNet, nextState: next ? { marketState: next, cash: after.cash, position: after.position, sellablePosition: after.sellablePosition } : null, done: next === null || next.timestamp.slice(0, 10) !== row.timestamp.slice(0, 10), executionContextVersion: context.status === "AVAILABLE" ? context.version : null, executionContextStatus: context.status, realHistoricalAccount: false });
  }
  return records;
}

export function buildCounterfactual({ trajectory, statesByTimestamp, rowsByTimestamp }) {
  return trajectory.map(record => {
    const rows = rowsByTimestamp.get(record.timestamp), state = statesByTimestamp.get(record.timestamp), actions = RL_ACTIONS.map(action => {
      const execution = execute({ cash: record.cash, position: record.position, sellablePosition: record.sellablePosition, averageCost: null }, action, rows.price, rows.timestamp.slice(0, 10), { symbol: rows.symbol, timestamp: rows.timestamp, time: rows.timestamp.slice(11, 16) });
      const r = reward(execution, action, rows.price, rowsByTimestamp.get(rows.nextTimestamp)?.price);
      return { datasetVersion: "OFFLINE_RL_COUNTERFACTUAL_V0.9.1", accountType: SYNTHETIC_PORTFOLIO, accountScenarioId: record.accountScenarioId, counterfactualGroupId: hash({ timestamp: record.timestamp, state, cash: record.cash, position: record.position, sellablePosition: record.sellablePosition }), timestamp: record.timestamp, state, action, validAction: execution.validAction, executionResult: execution, rewardGross: r.rewardGross, rewardNet: r.rewardNet, positionAfter: execution.positionAfter, cashAfter: execution.cashAfter, nextState: r.futureReturn === null ? null : { marketState: statesByTimestamp.get(rows.nextTimestamp) ?? null, cash: execution.cashAfter, position: execution.positionAfter?.totalPosition ?? null, sellablePosition: execution.positionAfter?.availableSellablePosition ?? null }, status: execution.status === "VALID" ? (r.futureReturn === null ? "OUTCOME_UNRESOLVED" : "RESOLVED") : execution.status };
    });
    const ranked = actions.filter(a => a.validAction === true && Number.isFinite(a.rewardNet)).sort((a, b) => b.rewardNet - a.rewardNet); const best = ranked[0], expert = actions.find(a => a.action === record.action);
    return { ...record, counterfactuals: actions, bestCounterfactualAction: best?.action ?? null, expertReward: expert?.rewardNet ?? null, bestReward: best?.rewardNet ?? null, expertRegret: best && expert?.validAction === true ? best.rewardNet - expert.rewardNet : null, analysisType: "historical counterfactual analysis, not future prediction" };
  });
}
