import { createHash } from "node:crypto";

export const PRICE_ONLY_COUNTERFACTUAL_DATASET_VERSION = "PriceOnlyCounterfactualDatasetV0.1";
export const PRICE_ONLY_COUNTERFACTUAL_LABEL_VERSION = "price-only-outcome-counterfactual-v0.1";
export const PRICE_ONLY_COST_MODEL_VERSION = "price-only-cost-v0.1";
export const COUNTERFACTUAL_ACTIONS = Object.freeze(["WAIT", "BUY_SMALL", "BUY", "SELL_PART", "SELL_ALL"]);
export const ACTION_EXPOSURE = Object.freeze({ WAIT: 0, BUY_SMALL: 0.5, BUY: 1, SELL_PART: -0.25, SELL_ALL: -1 });
export const DEFAULT_COUNTERFACTUAL_CONFIG = Object.freeze({ commissionRate: 0.00025, slippageRate: 0.0002, mfeWeight: 0.25, maeWeight: 0.25, lowMarginThreshold: 0.0005, costModelVersion: PRICE_ONLY_COST_MODEL_VERSION });

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function resolvePriceOutcome(rows, index, horizon) {
  const current = finite(rows[index]?.price);
  const end = finite(rows[index + horizon]?.price);
  if (!(current > 0) || !(end > 0) || index + horizon >= rows.length) return { status: "OUTCOME_UNRESOLVED", horizonBars: horizon, futureReturn: null, futureMFE: null, futureMAE: null, futureMaxGain: null, futureMaxLoss: null };
  const pathReturns = rows.slice(index + 1, index + horizon + 1).map(row => { const price = finite(row.price); return price && current ? price / current - 1 : null; }).filter(value => value !== null);
  if (pathReturns.length !== horizon) return { status: "OUTCOME_UNRESOLVED", horizonBars: horizon, futureReturn: null, futureMFE: null, futureMAE: null, futureMaxGain: null, futureMaxLoss: null };
  const futureMFE = Math.max(...pathReturns), futureMAE = Math.min(...pathReturns);
  return { status: "RESOLVED", horizonBars: horizon, futureReturn: end / current - 1, futureMFE, futureMAE, futureMaxGain: Math.max(0, futureMFE), futureMaxLoss: Math.min(0, futureMAE) };
}

export function calculateActionValue(outcome, action, config = DEFAULT_COUNTERFACTUAL_CONFIG) {
  const exposure = ACTION_EXPOSURE[action];
  if (!outcome || outcome.status !== "RESOLVED" || exposure === undefined) return { action, exposure: exposure ?? null, grossActionValue: null, netActionValue: null, actionMFE: null, actionMAE: null, cost: null };
  const actionMFE = exposure >= 0 ? outcome.futureMFE * exposure : -outcome.futureMAE * Math.abs(exposure);
  const actionMAE = exposure >= 0 ? outcome.futureMAE * exposure : -outcome.futureMFE * Math.abs(exposure);
  const grossActionValue = exposure * outcome.futureReturn + config.mfeWeight * actionMFE + config.maeWeight * actionMAE;
  const cost = Math.abs(exposure) * (config.commissionRate + config.slippageRate);
  return { action, exposure, grossActionValue, netActionValue: grossActionValue - cost, actionMFE, actionMAE, cost };
}

export function rankCounterfactualActions(outcomes, config = DEFAULT_COUNTERFACTUAL_CONFIG) {
  const values = Object.fromEntries(COUNTERFACTUAL_ACTIONS.map(action => [action, calculateActionValue(outcomes, action, config)]));
  const ranked = COUNTERFACTUAL_ACTIONS.filter(action => values[action].netActionValue !== null).sort((a, b) => values[b].netActionValue - values[a].netActionValue);
  const best = ranked[0] ?? null, second = ranked[1] ?? null;
  const bestActionValue = best ? values[best].netActionValue : null, secondBestActionValue = second ? values[second].netActionValue : null;
  const actionMargin = bestActionValue === null || secondBestActionValue === null ? null : bestActionValue - secondBestActionValue;
  return { values, ranking: ranked.map((action, index) => ({ rank: index + 1, action, netActionValue: values[action].netActionValue })), bestAction: best, bestActionValue, secondBestActionValue, actionMargin, confidenceBand: actionMargin === null ? "OUTCOME_UNRESOLVED" : actionMargin < config.lowMarginThreshold ? "LOW_MARGIN" : "HIGH_MARGIN" };
}

export const counterfactualHash = hash;
