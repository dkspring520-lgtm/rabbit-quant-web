import { createValueAccumulator, fitMean, fitRidge, fitTreeBaseline, predictValue, valueModelHash } from "../trainer/value-regression.mjs";

export const V011_VERSION = "OFFLINE_RL_V0.11_VALUE_Q_BENCHMARK";
export const ALL_ACTIONS = Object.freeze(["WAIT", "BUY_SMALL", "BUY", "SELL_PART", "SELL_ALL"]);
export const PRIMARY_ACTIONS = Object.freeze(["WAIT", "BUY_SMALL", "SELL_ALL"]);
export const FEATURE_MODES = Object.freeze(["market_only", "market_account"]);
export const MODEL_TYPES = Object.freeze(["mean", "ridge", "tree"]);
export const MARKET_FEATURES = Object.freeze(["return_1m", "return_5m", "price_vs_session_vwap", "rolling_return_std_20", "volume_ratio_20", "minutesSinceOpen"]);
export const ACCOUNT_FEATURES = Object.freeze(["cashRatio", "positionRatio", "sellableRatio", "averageCostRatio", "todayBoughtRatio"]);
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export function splitOf(timestamp) {
  const day = String(timestamp).slice(0, 10);
  if (day >= "2022-01-04" && day <= "2024-12-31") return "train";
  if (day >= "2025-01-01" && day <= "2025-09-30") return "validation";
  if (day >= "2025-10-01" && day <= "2026-04-17") return "test";
  return "excluded";
}

export function featureVector(record, mode = "market_account") {
  const market = record.state?.marketState ?? {};
  const features = market.features ?? {};
  const account = record.state?.accountState ?? {};
  const price = number(market.price) || 1;
  const vector = [1, ...MARKET_FEATURES.map(name => number(features[name]))];
  if (mode === "market_account") vector.push(number(account.cash) / 10000, number(account.position) * price / 10000, number(account.sellablePosition) * price / 10000, number(account.averageCost) / price, number(account.todayBought) * price / 10000);
  return vector;
}

export function createLoggedAccumulators(mode = "market_account") {
  const dimension = featureVector({ state: { marketState: { price: 1, features: {} }, accountState: {} } }, mode).length;
  return Object.fromEntries(ALL_ACTIONS.map(action => [action, createValueAccumulator(dimension)]));
}

export function addLoggedSample(accumulators, record, mode = "market_account") {
  if (!Object.hasOwn(accumulators, record.action) || !Number.isFinite(Number(record.reward)) || splitOf(record.timestamp) !== "train") return false;
  const target = Number(record.reward);
  const vector = featureVector(record, mode);
  const accumulator = accumulators[record.action];
  accumulator.count += 1;
  accumulator.sum += target;
  accumulator.sumSq += target * target;
  const side = Number(vector[1]) < 0 ? "left" : "right";
  accumulator.stump[side + "Count"] += 1;
  accumulator.stump[side + "Sum"] += target;
  for (let i = 0; i < vector.length; i++) {
    accumulator.xty[i] += vector[i] * target;
    for (let j = 0; j < vector.length; j++) accumulator.xtx[i][j] += vector[i] * vector[j];
  }
  return true;
}

export function fitLoggedModels(accumulators, ridge = 1e-3) {
  return Object.fromEntries(ALL_ACTIONS.map(action => {
    const accumulator = accumulators[action];
    return [action, { observedCount: accumulator.count, mean: fitMean(accumulator), ridge: fitRidge(accumulator, ridge), tree: fitTreeBaseline(accumulator), ood: !PRIMARY_ACTIONS.includes(action) || accumulator.count === 0 }];
  }));
}

export function predictLoggedValue(model, modelType, vector) { return model ? predictValue(model[modelType], vector) : null; }
export const modelSnapshotHash = valueModelHash;
