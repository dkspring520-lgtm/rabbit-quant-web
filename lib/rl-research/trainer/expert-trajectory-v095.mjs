import { createHash } from "node:crypto";
import { buildPriceOnlyState, PRICE_ONLY_STATE_VERSION } from "./price-only-state.mjs";
import { buildPriceOnlyFeaturesStreaming } from "./price-only-streaming-features.mjs";
import { PaperExecutionEngine } from "../../paper-trading/paper-execution-engine.mjs";
import { calculateRateReward } from "../reward/reward-function.mjs";

export const V095_VERSION = "OFFLINE_RL_V0.9.5";
export const ACTIONS = Object.freeze(["WAIT", "BUY_SMALL", "BUY", "SELL_PART", "SELL_ALL"]);
const exposure = Object.freeze({ WAIT: 0, BUY_SMALL: .5, BUY: 1, SELL_PART: -.25, SELL_ALL: -1 });
const costs = Object.freeze({ commission: .025, slippage: .02, minimumCommission: 0, stampDuty: 0 });
const hashRecords = rows => { const h = createHash("sha256"); for (const row of rows) h.update(JSON.stringify(row) + "\n"); return h.digest("hex"); };
const makeCausalMarketStates = marketRows => { const features = buildPriceOnlyFeaturesStreaming(marketRows); return marketRows.map((row, index) => Object.freeze({ schemaVersion: PRICE_ONLY_STATE_VERSION, symbol: row.symbol, timestamp: row.timestamp, price: row.price, volume: row.volume, features: features[index] })); };
const joinKey = row => `${String(row?.symbol ?? "")}\u0000${String(row?.timestamp ?? "")}`;
const joinHash = rows => hashRecords(rows.map(row => ({ symbol: row.symbol, timestamp: row.timestamp, expertAction: row.expertAction, strategyId: row.strategyId, strategyVersion: row.strategyVersion })));
export function joinExpertSignals({ marketRows = [], signals = [], expertSignalHash = null } = {}) {
  const market = new Map(), expert = new Map(), duplicateJoinKeys = [];
  for (const row of marketRows) { const key = joinKey(row); if (market.has(key)) duplicateJoinKeys.push(key); else market.set(key, row); }
  for (const signal of signals) { const key = joinKey(signal); if (expert.has(key)) duplicateJoinKeys.push(key); else expert.set(key, signal); }
  const joined = [], unmatchedMarketBars = [];
  for (const row of marketRows) {
    const signal = expert.get(joinKey(row));
    if (!signal) { unmatchedMarketBars.push(joinKey(row)); continue; }
    if (!ACTIONS.includes(signal.action)) throw new Error(`INVALID_EXPERT_ACTION: ${signal.action} at ${joinKey(row)}`);
    joined.push({ symbol: row.symbol, timestamp: row.timestamp, expertAction: signal.action, strategyId: signal.strategyId ?? "OHLCV_T_RESEARCH_V1", strategyVersion: signal.strategyVersion ?? "OHLCV_T_RESEARCH_V1", expertSignalHash });
  }
  const marketKeys = new Set(marketRows.map(joinKey));
  const unmatchedExpertSignals = signals.filter(signal => !marketKeys.has(joinKey(signal))).map(joinKey);
  if (unmatchedMarketBars.length) throw new Error(`EXPERT_SIGNAL_UNMATCHED: ${unmatchedMarketBars[0]}`);
  if (unmatchedExpertSignals.length) throw new Error(`EXPERT_SIGNAL_UNMATCHED: ${unmatchedExpertSignals[0]}`);
  if (duplicateJoinKeys.length) throw new Error(`DUPLICATE_JOIN_KEY: ${duplicateJoinKeys[0]}`);
  return { joined, matchedCount: joined.length, unmatchedMarketBars, unmatchedExpertSignals, duplicateJoinKeys, expertJoinHash: joinHash(joined), expertActionSequenceHash: hashRecords(joined.map(row => ({ symbol: row.symbol, timestamp: row.timestamp, expertAction: row.expertAction }))), actionCounts: Object.fromEntries(ACTIONS.map(action => [action, joined.filter(row => row.expertAction === action).length])) };
}

export const PRE_ACTION_SCENARIOS = Object.freeze([
  Object.freeze({ scenarioId: "SYNTHETIC_RESEARCH_PORTFOLIO_C_10000_V0.1", accountType: "SYNTHETIC_RESEARCH_PORTFOLIO", initialCash: 10000, initialPosition: 0, initialSellablePosition: 0, initialAverageCost: null }),
  Object.freeze({ scenarioId: "SYNTHETIC_RESEARCH_PORTFOLIO_B_LONG_INVENTORY_V0.1", accountType: "SYNTHETIC_RESEARCH_PORTFOLIO", initialCash: 10000, initialPosition: 2000, initialSellablePosition: 2000, initialAverageCost: 10 }),
  Object.freeze({ scenarioId: "SYNTHETIC_RESEARCH_PORTFOLIO_C_LARGER_INVENTORY_V0.1", accountType: "SYNTHETIC_RESEARCH_PORTFOLIO", initialCash: 10000, initialPosition: 10000, initialSellablePosition: 10000, initialAverageCost: 10 }),
]);

export function createPreActionState({ marketRows, signals, scenario }) {
  if (scenario?.accountType !== "SYNTHETIC_RESEARCH_PORTFOLIO") throw new Error("PRE_ACTION_STATE_REQUIRES_SYNTHETIC_SCENARIO");
  if (!Number.isFinite(scenario.initialCash) || !Number.isInteger(scenario.initialPosition) || !Number.isInteger(scenario.initialSellablePosition) || scenario.initialPosition < scenario.initialSellablePosition || scenario.initialSellablePosition < 0) throw new Error("INVALID_SYNTHETIC_INITIAL_ACCOUNT_STATE");
  const joined = joinExpertSignals({ marketRows, signals });
  const joinedByKey = new Map(joined.joined.map(row => [joinKey(row), row]));
  const marketRowsByKey = new Map(marketRows.map(row => [joinKey(row), row]));
  let cash = scenario.initialCash;
  let position = scenario.initialPosition;
  let sellablePosition = scenario.initialSellablePosition;
  let averageCost = scenario.initialAverageCost ?? null;
  let todayBought = 0;
  let currentDate = null;
  const states = [];
  const marketStates = arguments[0]?.marketStates ?? null;
  for (let index = 0; index < marketRows.length; index++) {
    const row = marketRows[index];
    const key = joinKey(row);
    const joinedSignal = joinedByKey.get(key);
    if (!joinedSignal) throw new Error(`EXPERT_SIGNAL_UNMATCHED: ${key}`);
    const date = row.timestamp.slice(0, 10);
    if (currentDate !== date) {
      if (currentDate !== null) sellablePosition = position;
      todayBought = 0;
      currentDate = date;
    }
    const accountState = Object.freeze({
      scenarioId: scenario.scenarioId,
      cash,
      position,
      sellablePosition,
      averageCost,
      todayBought,
    });
    const marketState = marketStates?.[index] ?? buildPriceOnlyState(row, index, marketRows);
    states.push(Object.freeze({
      symbol: row.symbol,
      timestamp: row.timestamp,
      scenarioId: scenario.scenarioId,
      scenarioType: scenario.accountType,
      state: Object.freeze({ marketState, accountState }),
      marketState,
      accountState,
      expertAction: joinedSignal.expertAction,
      strategyId: joinedSignal.strategyId,
      strategyVersion: joinedSignal.strategyVersion,
    }));
  }
  return states;
}

export function auditPreActionScenarios({ marketRows, signals, scenarios = PRE_ACTION_SCENARIOS }) {
  const joined = joinExpertSignals({ marketRows, signals });
  const actionSequence = joined.joined.map(row => ({ symbol: row.symbol, timestamp: row.timestamp, expertAction: row.expertAction, strategyId: row.strategyId, strategyVersion: row.strategyVersion }));
  const actionHash = hashRecords(actionSequence);
  const marketStates = makeCausalMarketStates(marketRows);
  const scenarioStates = scenarios.map(scenario => {
    const states = createPreActionState({ marketRows, signals, scenario, marketStates });
    const accountStateHash = hashRecords(states.map(row => ({ scenarioId: row.scenarioId, timestamp: row.timestamp, accountState: row.accountState })));
    const stateHash = hashRecords(states.map(row => ({ scenarioId: row.scenarioId, timestamp: row.timestamp, marketState: row.marketState, accountState: row.accountState })));
    return { scenario, states, sampleCount: states.length, expertActionHash: hashRecords(states.map(row => ({ symbol: row.symbol, timestamp: row.timestamp, expertAction: row.expertAction, strategyId: row.strategyId, strategyVersion: row.strategyVersion }))), accountStateHash, stateHash };
  });
  const expertActionSequencesEqual = scenarioStates.every(row => row.expertActionHash === actionHash);
  const accountsAreIndependent = scenarioStates.every((left, i) => scenarioStates.every((right, j) => i === j || left.states[0]?.accountState !== right.states[0]?.accountState));
  return { matchedCount: joined.matchedCount, actionCounts: joined.actionCounts, expertActionHash: actionHash, expertActionSequencesEqual, accountsAreIndependent, scenarios: scenarioStates };
}
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

function quantityFor(action, price, account) { const raw = action === "BUY_SMALL" ? 5000 / price : action === "BUY" ? 10000 / price : action === "SELL_PART" ? account.sellablePosition * .25 : action === "SELL_ALL" ? account.sellablePosition : 0; return Math.floor(raw / 100) * 100; }
function accountState(engine, scenarioId = null) { return { scenarioId, cash: engine.cash, position: engine.position.totalPosition, sellablePosition: engine.position.availableSellablePosition, averageCost: engine.position.averageCost, todayBought: engine.boughtToday }; }

export function materializeScenario({ rows, signals, scenario, sourceDatasetHash, normalizedDatasetHash, expertSignalHash, trajectoryDatasetHash, stateDatasetHash }) {
  const joined = joinExpertSignals({ marketRows: rows, signals, expertSignalHash });
  const signalByKey = new Map(joined.joined.map(signal => [joinKey(signal), signal]));
  const engine = new PaperExecutionEngine({ symbol: rows[0]?.symbol ?? "601899.SH", initialCash: scenario.initialCash, initialPosition: scenario.initialPosition, initialSellablePosition: scenario.initialSellablePosition, averageCost: scenario.initialAverageCost ?? null, config: costs });
  const marketStates = makeCausalMarketStates(rows);
  const records = [], joinMismatches = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], signal = signalByKey.get(joinKey(row)), next = rows[i + 1] ?? null;
    if (!signal) { joinMismatches.push(row.timestamp); continue; }
    engine.advanceTo(row.timestamp.slice(0, 10));
    const before = accountState(engine, scenario.scenarioId); const action = signal.expertAction; const side = action.startsWith("BUY") ? "BUY" : action.startsWith("SELL") ? "SELL" : "WAIT";
    const order = engine.execute({ symbol: row.symbol, timestamp: row.timestamp, date: row.timestamp.slice(0, 10), time: row.timestamp.slice(11, 16), price: row.price }, { side, quantity: quantityFor(action, row.price, before), orderPrice: row.price, timestamp: row.timestamp });
    const validAction = side === "WAIT" ? order.status === "CANCELLED" : order.status === "FILLED";
    const futureReturn = next && next.timestamp.slice(0, 10) === row.timestamp.slice(0, 10) && finite(next.price) > 0 ? next.price / row.price - 1 : null;
    const notional = order.status === "FILLED" ? order.fillPrice * order.quantity : null;
    const rewardGross = validAction && futureReturn !== null ? calculateRateReward({ futureReturnRate: exposure[action] * futureReturn }) : null;
    const rewardNet = validAction && futureReturn !== null ? calculateRateReward({ futureReturnRate: exposure[action] * futureReturn, feeRate: notional ? order.fees / notional : 0, slippageRate: notional ? order.slippage / notional : 0 }) : null;
    const after = accountState(engine, scenario.scenarioId);
    const done = next === null || next.timestamp.slice(0, 10) !== row.timestamp.slice(0, 10);
    records.push({ datasetVersion: V095_VERSION, timestamp: row.timestamp, symbol: row.symbol, scenarioId: scenario.scenarioId, episodeId: `${scenario.scenarioId}:${row.timestamp.slice(0, 10)}`, state: { marketState: marketStates[i], accountState: before }, marketState: marketStates[i], accountState: before, expertAction: action, validAction, executionResult: order, filledQuantity: order.status === "FILLED" ? order.quantity : 0, fillPrice: order.status === "FILLED" ? order.fillPrice : null, fees: order.status === "FILLED" ? order.fees : null, slippage: order.status === "FILLED" ? order.slippage : null, rewardGross, rewardNet, reward: rewardNet, nextState: done ? null : { marketState: marketStates[i + 1], accountState: after }, done, strategyId: signal.strategyId ?? "OHLCV_T_RESEARCH_V1", strategyVersion: signal.strategyVersion ?? "OHLCV_T_RESEARCH_V1", sourceDatasetHash, normalizedDatasetHash, expertSignalHash, trajectoryDatasetHash, stateDatasetHash, executionVersion: "PaperExecutionEngine", rewardVersion: "rate-v2", costModelVersion: "research-portfolio-cost-v0.1", executionContextStatus: "INPUT_UNAVAILABLE", observedExpertBehavior: true });
  }
  return { records, joinMismatches, hashes: { expertActionHash: hashRecords(records.map(r => ({ timestamp: r.timestamp, action: r.expertAction }))), accountStateHash: hashRecords(records.map(r => r.accountState)), executionHash: hashRecords(records.map(r => r.executionResult)), rewardHash: hashRecords(records.map(r => ({ rewardGross: r.rewardGross, rewardNet: r.rewardNet }))), nextStateHash: hashRecords(records.map(r => r.nextState)), trajectoryHash: hashRecords(records), transitionHash: hashRecords(records.map(r => ({ state: r.state, action: r.expertAction, reward: r.reward, nextState: r.nextState, done: r.done }))) } };
}
