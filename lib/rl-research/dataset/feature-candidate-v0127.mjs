import { createHash } from "node:crypto";

export const MARKET_FEATURES = Object.freeze(["return_1m", "return_5m", "price_vs_session_vwap", "rolling_return_std_20", "volume_ratio_20", "minutesSinceOpen"]);
export const ACTIONS = Object.freeze(["WAIT", "BUY_SMALL", "SELL_ALL"]);
export const RIDGE = 0.001;
export const OOD_Z = 3;
export const SAMPLING_VERSION = "SHA256_SYMBOL_TIMESTAMP_SCENARIO_V0.3";
export const COST_CANDIDATES = Object.freeze(["C1_RAW", "C2_HAS_POSITION_RAW", "C3_COST_GAP", "C4_NORMALIZED_COST", "C5_REMOVED"]);

const rawNames = ["cash", "position", "sellablePosition", "averageCost", "todayBought"];
const relativeNames = ["positionEquityRatio", "sellablePositionRatio", "cashEquityRatio", "todayBoughtPositionRatio"];
const ratioNames = ["cashRatio", "positionRatio", "sellableRatio", "todayBoughtRatio"];

export const VARIANTS = Object.freeze({
  E1_MARKET_ONLY: { label: "E1 Market-only", features: [...MARKET_FEATURES] },
  E2_RAW_ACCOUNT: { label: "E2 Market + existing raw account", features: [...MARKET_FEATURES, ...rawNames], nullEncoding: "averageCost null encoded as 0 for legacy raw baseline" },
  E3_RELATIVE_WITH_COST: { label: "E3 Market + relative portfolio + existing cost ratio", features: [...MARKET_FEATURES, ...relativeNames, "averageCostRatioExisting"] },
  E4_RELATIVE_NO_COST: { label: "E4 Market + relative portfolio without averageCost", features: [...MARKET_FEATURES, ...relativeNames] },
  E5_RELATIVE_SAFE_COST: { label: "E5 Market + relative portfolio + safe cost", features: [...MARKET_FEATURES, ...relativeNames, "costGap"] },
  E6_SELLABLE_TODAY: { label: "E6 Market + sellable ratio + todayBought ratio", features: [...MARKET_FEATURES, "sellableRatio", "todayBoughtRatio"] },
  C1_RAW: { label: "C1 relative portfolio + raw averageCost", features: [...MARKET_FEATURES, ...relativeNames, "averageCost"] },
  C2_HAS_POSITION_RAW: { label: "C2 relative portfolio + hasPosition + raw averageCost", features: [...MARKET_FEATURES, ...relativeNames, "hasPosition", "averageCost"] },
  C3_COST_GAP: { label: "C3 relative portfolio + costGap", features: [...MARKET_FEATURES, ...relativeNames, "costGap"] },
  C4_NORMALIZED_COST: { label: "C4 relative portfolio + normalized cost", features: [...MARKET_FEATURES, ...relativeNames, "averageCostRatioSafe"] },
  C5_REMOVED: { label: "C5 relative portfolio without cost", features: [...MARKET_FEATURES, ...relativeNames] }
});

const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const finiteOrNull = value => value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null);

export function splitOf(timestamp) { const day = String(timestamp).slice(0, 10); if (day >= "2022-01-04" && day <= "2024-12-31") return "train"; if (day >= "2025-01-01" && day <= "2025-09-30") return "validation"; if (day >= "2025-10-01" && day <= "2026-04-17") return "test"; return "excluded"; }
export function accountSemantics(record) { const market = record.state?.marketState ?? {}; const account = record.state?.accountState ?? {}; const price = number(market.price) || 1; const cash = number(account.cash); const position = number(account.position); const sellablePosition = number(account.sellablePosition); const averageCost = finiteOrNull(account.averageCost); const todayBought = number(account.todayBought); const totalEquity = cash + position * price; return { price, cash, position, sellablePosition, averageCost, todayBought, totalEquity, hasPosition: position > 0 ? 1 : 0, averageCostRaw: averageCost, averageCostExisting: averageCost === null ? 0 : averageCost, averageCostRatioExisting: averageCost === null ? 0 : averageCost / price, positionEquityRatio: totalEquity > 0 ? position * price / totalEquity : null, sellablePositionRatio: position > 0 ? sellablePosition / position : null, cashEquityRatio: totalEquity > 0 ? cash / totalEquity : null, todayBoughtPositionRatio: position > 0 ? todayBought / position : null, sellableRatio: sellablePosition * price / 10000, todayBoughtRatio: todayBought * price / 10000, costGap: position > 0 && averageCost !== null && averageCost > 0 ? price / averageCost - 1 : null, averageCostRatioSafe: position > 0 && averageCost !== null && averageCost > 0 ? averageCost / price : null }; }
export function averageCostObservation(record) { const account = record.state?.accountState ?? {}; const position = number(account.position); const value = finiteOrNull(account.averageCost); return { positionZero: position === 0, positionPositive: position > 0, value, isNull: value === null, isZero: value === 0, isNonNull: value !== null }; }
export function featureVector(record, variantId) { const variant = VARIANTS[variantId]; if (!variant) throw new Error("UNKNOWN_VARIANT:" + variantId); const market = record.state?.marketState?.features ?? {}; const account = accountSemantics(record); const source = { ...Object.fromEntries(MARKET_FEATURES.map(name => [name, number(market[name])])), cash: account.cash, position: account.position, sellablePosition: account.sellablePosition, averageCost: account.averageCostExisting, todayBought: account.todayBought, positionEquityRatio: account.positionEquityRatio, sellablePositionRatio: account.sellablePositionRatio, cashEquityRatio: account.cashEquityRatio, todayBoughtPositionRatio: account.todayBoughtPositionRatio, averageCostRatioExisting: account.averageCostRatioExisting, sellableRatio: account.sellableRatio, todayBoughtRatio: account.todayBoughtRatio, hasPosition: account.hasPosition, averageCostRaw: account.averageCostRaw, costGap: account.costGap, averageCostRatioSafe: account.averageCostRatioSafe }; const rawValues = variant.features.map(name => source[name]); const undefinedFeatures = variant.features.filter((name, index) => rawValues[index] === null || rawValues[index] === undefined); return { variantId, featureNames: variant.features, values: [1, ...rawValues.map(value => value ?? 0)], rawValues, undefinedFeatures, valid: undefinedFeatures.length === 0, account, nullEncoding: variant.nullEncoding ?? "none" }; }
export function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function ranking(q) { return Object.entries(q).sort((a, b) => b[1] - a[1]).map(([action]) => action); }
export function sigmoid(value) { return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value)))); }
export function deterministicSample(row, rate = 0.001) { const key = String(row.symbol) + "|" + String(row.timestamp) + "|" + String(row.scenarioId); const value = parseInt(createHash("sha256").update(key).digest("hex").slice(0, 8), 16) / 0xffffffff; return value < rate; }
export function summary(values) { const sorted = values.slice().sort((a, b) => a - b); const quantile = q => { if (!sorted.length) return null; const index = (sorted.length - 1) * q; const lo = Math.floor(index); const hi = Math.ceil(index); return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo); }; const mean = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null; return { count: sorted.length, min: sorted.length ? sorted[0] : null, p01: quantile(.01), p05: quantile(.05), p25: quantile(.25), median: quantile(.5), p75: quantile(.75), p95: quantile(.95), p99: quantile(.99), max: sorted.length ? sorted.at(-1) : null, mean, std: sorted.length ? Math.sqrt(Math.max(0, sorted.reduce((a, b) => a + b * b, 0) / sorted.length - mean * mean)) : null }; }
