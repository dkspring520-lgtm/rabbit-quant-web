/** Offline-only: no production strategy, fitting, broker, or network imports. */
import { createHash } from "node:crypto";
import { PaperExecutionEngine, calculatePaperCosts } from "../../paper-trading/paper-execution-engine.mjs";
import { RL_ACTIONS, normalizePositionDeltaAction } from "../action/action-space.mjs";
import { calculateRateReward } from "../reward/reward-function.mjs";
import { RESEARCH_ACTION_CONFIG } from "./research-portfolio-context.mjs";
import { PRICE_ONLY_STATE_VERSION } from "./price-only-state.mjs";
import { PriceOnlyFeatureContext } from "./price-only-streaming-features.mjs";

export const TRANSITION_VERSION = "OFFLINE_RL_TRANSITIONS_V0.9";
// Same rates as the research contract; explicitly disable the paper engine's
// additional minimum fee and stamp duty, rather than silently changing costs.
export const TRANSITION_COSTS = Object.freeze({ commission: 0.025, slippage: 0.02, minimumCommission: 0, stampDuty: 0 });
export const hashTransition = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function data07Split(timestamp) {
  const date = timestamp.slice(0, 10);
  if (date >= "2022-01-04" && date <= "2024-12-31") return "train";
  if (date >= "2025-01-01" && date <= "2025-09-30") return "validation";
  if (date >= "2025-10-01" && date <= "2026-04-17") return "test";
  return null;
}

export function* causalMarketStates(rows) {
  const context = new PriceOnlyFeatureContext();
  for (const row of rows) yield {
    schemaVersion: PRICE_ONLY_STATE_VERSION, symbol: row.symbol,
    timestamp: row.timestamp, price: row.price, volume: row.volume,
    features: context.update(row),
  };
}

function accountAvailable(account) {
  return account && Number.isFinite(account.cash) && account.cash >= 0
    && Number.isInteger(account.position) && account.position >= 0
    && Number.isInteger(account.sellablePosition) && account.sellablePosition >= 0
    && account.sellablePosition <= account.position;
}

// Sizing only: mirrors the existing ResearchNotionalUnitV0.1 contract.
// Execution, costs, rounding of fills and account mutation belong to PaperExecutionEngine.
function requestedQuantity(action, price, account) {
  const c = RESEARCH_ACTION_CONFIG;
  const raw = action === "BUY_SMALL" ? c.notionalUnit * c.buySmallUnits / price
    : action === "BUY" ? c.notionalUnit * c.buyUnits / price
      : action === "SELL_PART" ? account.sellablePosition * c.sellPartFraction
        : action === "SELL_ALL" ? account.sellablePosition : 0;
  return Math.floor(raw / c.lotSize) * c.lotSize;
}

/** One observed bar step, not a 30-bar label paired with a 1-bar nextState.
 * account is a pre-action snapshot, never an outcome-derived portfolio.
 * Missing context has unknown validity, not a fabricated rejected order.
 */
export function evaluateTransitionGroup({ marketState, nextMarketState = null, barIndex,
  account = null, accountSource = "UNAVAILABLE", expertAction = null,
  datasetHash, marketFlags = null }) {
  if (expertAction !== null && !RL_ACTIONS.includes(expertAction)) throw new Error("Unsupported expert action");
  const timestamp = marketState.timestamp;
  const split = data07Split(timestamp);
  const state = { marketState, positionState: accountAvailable(account) ? {
    position: account.position, sellablePosition: account.sellablePosition,
    averageCost: account.averageCost ?? null,
  } : null, cashState: accountAvailable(account) ? { cash: account.cash } : null };
  const input = { timestamp, barIndex, state, accountSource, expertAction, marketFlags };
  const inputHash = hashTransition(input);
  const counterfactualGroupId = inputHash;
  const sameSplit = nextMarketState !== null && split !== null && data07Split(nextMarketState.timestamp) === split;
  const sameSession = sameSplit && nextMarketState.timestamp.slice(0, 10) === timestamp.slice(0, 10);
  // Intraday episodes avoid pretending that unknown overnight adjustments are known.
  const resolved = sameSession && nextMarketState.timestamp > timestamp
    && Number.isFinite(nextMarketState.price) && nextMarketState.price > 0;
  const marketPathHash = hashTransition([marketState, resolved ? nextMarketState : null]);
  const transitions = RL_ACTIONS.map(action => {
    const result = { datasetVersion: TRANSITION_VERSION, datasetHash, counterfactualGroupId,
      inputHash, marketPathHash, timestamp, barIndex, split, state, accountSource,
      expertAction, action, validAction: null, status: "INPUT_UNAVAILABLE",
      reason: "MISSING_PRE_ACTION_ACCOUNT", filledQuantity: null, fillPrice: null,
      fees: null, commission: null, stampDuty: null, slippage: null,
      positionAfter: null, cashAfter: null, reward: null, rewardGross: null,
      rewardNet: null, rewardVersion: "rate-v2", futureReturn: null, nextState: null,
      done: !sameSession, truncated: !sameSession,
      terminationReason: !nextMarketState ? "DATASET_END" : !sameSplit ? "SPLIT_BOUNDARY" : !sameSession ? "SESSION_BOUNDARY" : null,
      shadowOnly: true, executable: false };
    if (!accountAvailable(account)) return result;
    if (!Number.isFinite(marketState.price) || marketState.price <= 0) return { ...result, reason: "INVALID_MARKET_PRICE" };
    const quantity = requestedQuantity(action, marketState.price, account);
    const engine = new PaperExecutionEngine({ symbol: marketState.symbol,
      initialCash: account.cash, initialPosition: account.position,
      initialSellablePosition: account.sellablePosition, averageCost: account.averageCost,
      config: TRANSITION_COSTS });
    const side = action.startsWith("BUY") ? "BUY" : action.startsWith("SELL") ? "SELL" : "WAIT";
    const order = engine.execute({ symbol: marketState.symbol, timestamp,
      date: timestamp.slice(0, 10), time: timestamp.slice(11, 16), price: marketState.price,
      suspended: marketFlags?.suspended, limitUp: marketFlags?.limitUp, limitDown: marketFlags?.limitDown,
    }, { side, quantity, orderPrice: marketState.price, timestamp });
    const validAction = side === "WAIT" ? order.status === "CANCELLED" : order.status === "FILLED";
    if (!validAction) return { ...result, validAction: false, status: "INVALID_ACTION", reason: order.reason,
      filledQuantity: 0, requestedQuantity: quantity };
    const costs = side === "WAIT" ? { fees: 0, commission: 0, stampDuty: 0, slippage: 0 }
      : calculatePaperCosts({ side, orderPrice: marketState.price, fillPrice: order.fillPrice, quantity: order.quantity, config: TRANSITION_COSTS });
    if (!Object.values(costs).every(Number.isFinite)) return { ...result, status: "COST_UNAVAILABLE", reason: "NONFINITE_ENGINE_COST" };
    const futureReturn = resolved ? nextMarketState.price / marketState.price - 1 : null;
    const notional = side === "WAIT" ? null : order.fillPrice * order.quantity;
    // Preserve rate-v2 + replay-adapter normalization exactly. This reward is
    // action-conditioned return, NOT account equity P&L or AI prediction accuracy.
    const rewardInput = { futureReturnRate: normalizePositionDeltaAction(action) * (futureReturn ?? 0),
      feeRate: notional ? costs.fees / notional : 0, slippageRate: notional ? costs.slippage / notional : 0 };
    const rewardNet = resolved ? calculateRateReward(rewardInput) : null;
    return { ...result, validAction: true, status: resolved ? "RESOLVED" : "OUTCOME_UNRESOLVED", reason: null,
      requestedQuantity: quantity, filledQuantity: side === "WAIT" ? 0 : order.quantity,
      fillPrice: side === "WAIT" ? null : order.fillPrice, ...costs,
      positionAfter: engine.position, cashAfter: engine.cash, futureReturn,
      reward: rewardNet, rewardNet,
      rewardGross: resolved ? calculateRateReward({ futureReturnRate: rewardInput.futureReturnRate }) : null,
      nextState: resolved ? { marketState: nextMarketState, positionState: {
        position: engine.position.totalPosition, sellablePosition: engine.position.availableSellablePosition,
        averageCost: engine.position.averageCost,
      }, cashState: { cash: engine.cash } } : null,
    };
  });
  const ranked = transitions.filter(t => t.validAction === true && Number.isFinite(t.reward))
    .sort((a, b) => b.reward - a.reward);
  const best = ranked[0] ?? null;
  const expert = ranked.find(t => t.action === expertAction) ?? null;
  const bestActionsByReward = best ? ranked.filter(t => t.reward === best.reward).map(t => t.action) : [];
  return { counterfactualGroupId, inputHash, timestamp, barIndex, split, transitions,
    bestActionByReward: best?.action ?? null, bestActionsByReward, expertAction,
    bestActionReward: best?.reward ?? null, expertActionReward: expert?.reward ?? null,
    expertRegret: best && expert ? best.reward - expert.reward : null,
    expertAgreement: best && expert ? bestActionsByReward.includes(expertAction) : null,
  };
}

export function summarizeRegret(groups) {
  const eligible = groups.filter(g => Number.isFinite(g.expertRegret));
  const values = eligible.map(g => g.expertRegret).sort((a, b) => a - b);
  const quantile = p => {
    if (!values.length) return null;
    const x = (values.length - 1) * p, lo = Math.floor(x), hi = Math.ceil(x);
    return values[lo] + (values[hi] - values[lo]) * (x - lo);
  };
  return { count: values.length, agreementRate: values.length ? eligible.filter(g => g.expertAgreement).length / values.length : null,
    meanRegret: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    medianRegret: quantile(0.5), P90: quantile(0.9), P95: quantile(0.95), interpretation: "historical simulation, not prediction accuracy" };
}
