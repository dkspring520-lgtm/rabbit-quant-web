import { createHash } from "node:crypto";
import { PaperExecutionEngine } from "../../paper-trading/paper-execution-engine.mjs";
import { RL_ACTIONS } from "../action/action-space.mjs";
import { calculateRateReward } from "../reward/reward-function.mjs";
import { RESEARCH_ACTION_CONFIG } from "./research-portfolio-context.mjs";
import { SCENARIOS, EXECUTION_CONTEXT_VERSION } from "./behavior-support-v092.mjs";

export const V093_VERSION = "OFFLINE_RL_V0.9.3";
export const REWARD_VERSION = "rate-v2";
export const EXECUTION_VERSION = "PaperExecutionEngine";
export const hashValue = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const hashRecords = records => { const h = createHash("sha256"); for (const row of records) h.update(JSON.stringify(row) + "\n"); return h.digest("hex"); };

const exposure = Object.freeze({ WAIT: 0, BUY_SMALL: .5, BUY: 1, SELL_PART: -.25, SELL_ALL: -1 });
const costs = Object.freeze({ commission: .025, slippage: .02, minimumCommission: 0, stampDuty: 0 });
function validAccount(account) { return account && Number.isFinite(account.cash) && Number.isInteger(account.position) && Number.isInteger(account.sellablePosition) && account.cash >= 0 && account.position >= account.sellablePosition && account.sellablePosition >= 0; }
function quantityFor(action, price, account) { const c = RESEARCH_ACTION_CONFIG; const raw = action === "BUY_SMALL" ? c.notionalUnit * c.buySmallUnits / price : action === "BUY" ? c.notionalUnit / price : action === "SELL_PART" ? account.sellablePosition * c.sellPartFraction : action === "SELL_ALL" ? account.sellablePosition : 0; return Math.floor(raw / c.lotSize) * c.lotSize; }

export function executeOne({ action, state, market, nextMarket = null, scenarioId, sourceDatasetHash, trajectoryDatasetHash }) {
  const base = { datasetVersion: V093_VERSION, timestamp: market.timestamp, scenarioId, action, state, datasetHash: hashValue({ sourceDatasetHash, trajectoryDatasetHash, scenarioId }), sourceDatasetHash, trajectoryDatasetHash, executionVersion: EXECUTION_VERSION, rewardVersion: REWARD_VERSION, costModelVersion: RESEARCH_ACTION_CONFIG.costVersion, executionContextVersion: EXECUTION_CONTEXT_VERSION, executionContextStatus: "INPUT_UNAVAILABLE", nextState: null, done: nextMarket === null || nextMarket.timestamp.slice(0, 10) !== market.timestamp.slice(0, 10) };
  if (!validAccount(state)) return { ...base, validAction: null, status: "INPUT_UNAVAILABLE", reason: "MISSING_PRE_ACTION_ACCOUNT", filledQuantity: null, fillPrice: null, fees: null, slippage: null, cashAfter: null, positionAfter: null, sellablePositionAfter: null, rewardGross: null, rewardNet: null, reward: null, outcomeStatus: "INPUT_UNAVAILABLE" };
  const engine = new PaperExecutionEngine({ symbol: market.symbol, initialCash: state.cash, initialPosition: state.position, initialSellablePosition: state.sellablePosition, averageCost: state.averageCost, config: costs });
  const side = action.startsWith("BUY") ? "BUY" : action.startsWith("SELL") ? "SELL" : "WAIT";
  const order = engine.execute({ symbol: market.symbol, date: market.timestamp.slice(0, 10), time: market.timestamp.slice(11, 16), timestamp: market.timestamp, price: market.price, marketPrice: market.price }, { side, quantity: quantityFor(action, market.price, state), orderPrice: market.price, timestamp: market.timestamp });
  if (side === "WAIT") {
    const nextState = nextMarket && nextMarket.timestamp.slice(0, 10) === market.timestamp.slice(0, 10) ? { marketState: nextMarket, cash: engine.cash, position: engine.position.totalPosition, sellablePosition: engine.position.availableSellablePosition, averageCost: engine.position.averageCost } : null;
    return { ...base, validAction: order.status === "CANCELLED", status: order.status === "CANCELLED" ? (nextState ? "RESOLVED" : "OUTCOME_UNRESOLVED") : "INVALID_ACTION", reason: order.reason || null, filledQuantity: 0, fillPrice: null, fees: 0, slippage: 0, cashAfter: engine.cash, positionAfter: engine.position.totalPosition, sellablePositionAfter: engine.position.availableSellablePosition, rewardGross: nextState ? 0 : null, rewardNet: nextState ? 0 : null, reward: nextState ? 0 : null, nextState, outcomeStatus: nextState ? "RESOLVED" : "OUTCOME_UNRESOLVED" };
  }
  if (order.status !== "FILLED") return { ...base, validAction: false, status: "INVALID_ACTION", reason: order.reason || "execution rejected", filledQuantity: 0, fillPrice: null, fees: null, slippage: null, cashAfter: null, positionAfter: null, sellablePositionAfter: null, rewardGross: null, rewardNet: null, reward: null, outcomeStatus: "INVALID_ACTION" };
  const futureReturn = nextMarket && nextMarket.timestamp.slice(0, 10) === market.timestamp.slice(0, 10) ? nextMarket.price / market.price - 1 : null;
  const notional = order.fillPrice * order.quantity;
  const rewardInput = { futureReturnRate: exposure[action] * (futureReturn ?? 0), feeRate: order.fees / notional, slippageRate: order.slippage / notional };
  const nextState = futureReturn === null ? null : { marketState: nextMarket, cash: engine.cash, position: engine.position.totalPosition, sellablePosition: engine.position.availableSellablePosition, averageCost: engine.position.averageCost };
  const rewardGross = futureReturn === null ? null : calculateRateReward({ futureReturnRate: rewardInput.futureReturnRate });
  const rewardNet = futureReturn === null ? null : calculateRateReward(rewardInput);
  return { ...base, validAction: true, status: futureReturn === null ? "OUTCOME_UNRESOLVED" : "RESOLVED", reason: null, filledQuantity: order.quantity, fillPrice: order.fillPrice, fees: order.fees, slippage: order.slippage, cashAfter: engine.cash, positionAfter: engine.position.totalPosition, sellablePositionAfter: engine.position.availableSellablePosition, rewardGross, rewardNet, reward: rewardNet, futureReturn, nextState, outcomeStatus: futureReturn === null ? "OUTCOME_UNRESOLVED" : "RESOLVED" };
}

export function evaluateClosure({ rows, states, scenario, sourceDatasetHash, trajectoryDatasetHash }) {
  const account = { cash: scenario.initialCash, position: scenario.initialPosition, sellablePosition: scenario.initialSellablePosition, averageCost: null };
  const trajectory = [], counterfactual = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], state = states[i], next = rows[i + 1] ?? null;
    if (!row || !state) continue;
    const action = state.timestamp.slice(11, 16) === "10:00" ? "BUY_SMALL" : "WAIT";
    const t = executeOne({ action, state: account, market: row, nextMarket: next, scenarioId: scenario.scenarioId, sourceDatasetHash, trajectoryDatasetHash });
    const pre = { ...t, state: { ...account }, observed: true }; trajectory.push(pre);
    if (t.validAction === true) { account.cash = t.cashAfter; account.position = t.positionAfter; account.sellablePosition = t.sellablePositionAfter; account.averageCost = t.nextState?.averageCost ?? account.averageCost; }
    const group = RL_ACTIONS.map(a => executeOne({ action: a, state: { cash: account.cash, position: account.position, sellablePosition: account.sellablePosition, averageCost: account.averageCost }, market: row, nextMarket: next, scenarioId: scenario.scenarioId, sourceDatasetHash, trajectoryDatasetHash }));
    counterfactual.push({ timestamp: row.timestamp, scenarioId: scenario.scenarioId, state: state, actions: group, bestAction: group.filter(x => x.validAction === true && Number.isFinite(x.rewardNet)).sort((a, b) => b.rewardNet - a.rewardNet)[0]?.action ?? null, expertAction: action, expertReward: group.find(x => x.action === action)?.rewardNet ?? null, bestReward: group.filter(x => x.validAction === true && Number.isFinite(x.rewardNet)).sort((a, b) => b.rewardNet - a.rewardNet)[0]?.rewardNet ?? null });
  }
  return { trajectory, counterfactual, hashes: { trajectoryHash: hashRecords(trajectory), counterfactualHash: hashRecords(counterfactual), transitionHash: hashRecords(counterfactual.flatMap(x => x.actions)), rewardHash: hashRecords(trajectory.map(x => ({ rewardGross: x.rewardGross, rewardNet: x.rewardNet }))), nextStateHash: hashRecords(trajectory.map(x => x.nextState)), executionHash: hashRecords(trajectory.map(x => ({ status: x.status, filledQuantity: x.filledQuantity, fillPrice: x.fillPrice, fees: x.fees, slippage: x.slippage }))) } };
}

export { SCENARIOS };
