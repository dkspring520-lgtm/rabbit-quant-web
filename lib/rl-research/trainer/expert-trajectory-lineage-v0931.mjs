import { createHash } from "node:crypto";
import { runOHLCVTResearch } from "../../oh-lcv-t-research.mjs";
import { RL_ACTIONS } from "../action/action-space.mjs";
import { evaluateClosure, hashRecords, hashValue } from "./transition-closure-v093.mjs";
import { SCENARIOS } from "./behavior-support-v092.mjs";

export const V0931_VERSION = "OFFLINE_RL_V0.9.3.1";
export const SYNTHETIC_FIXED_SCHEDULE_BASELINE = "SYNTHETIC_FIXED_SCHEDULE_BASELINE";
export const EXPERT_ACTION_SOURCE_UNAVAILABLE = "EXPERT_ACTION_SOURCE_UNAVAILABLE";
export const OHLCV_EXPERT_SOURCE = Object.freeze({ strategyId: "OHLCV_T_RESEARCH_V1", entryPoint: "runOHLCVTResearch", generator: "generateOHLCVResearchSignal", strategyVersion: "OHLCV_T_RESEARCH_V1" });

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

export function normalizeExpertBars(rows = []) {
  return rows.map(row => ({ timestamp: row.timestamp, symbol: row.symbol, close: finite(row.price), price: finite(row.price), volume: finite(row.volume), open: finite(row.open), high: finite(row.high), low: finite(row.low), amount: finite(row.amount), previousClose: finite(row.previousClose) }));
}

export function assessExpertActionSource(rows = []) {
  const required = ["open", "high", "low", "amount"];
  const missingCounts = Object.fromEntries(required.map(field => [field, rows.filter(row => finite(row[field]) === null).length]));
  const unavailable = required.some(field => missingCounts[field] > 0);
  let legacySignalCount = 0;
  if (!unavailable) legacySignalCount = runOHLCVTResearch(normalizeExpertBars(rows), { symbol: rows[0]?.symbol ?? "" }).signals.length;
  return { status: unavailable ? EXPERT_ACTION_SOURCE_UNAVAILABLE : "AVAILABLE", source: OHLCV_EXPERT_SOURCE, requiredFields: required, missingCounts, legacySignalCount, reason: unavailable ? "DATA-07 does not provide complete causal OHLCV+amount fields required by the existing OHLCV Expert Strategy; no fallback values are allowed." : null };
}

export function syntheticFixedScheduleAction(timestamp) { return timestamp.slice(11, 16) === "10:00" ? "BUY_SMALL" : "WAIT"; }

export function buildExpertLineageAudit({ rows, states, sourceDatasetHash, trajectoryDatasetHash, scenario = SCENARIOS[0] }) {
  const sourceAudit = assessExpertActionSource(rows);
  const baselineActions = rows.map(row => ({ timestamp: row.timestamp, action: syntheticFixedScheduleAction(row.timestamp), sourceStrategyId: SYNTHETIC_FIXED_SCHEDULE_BASELINE, strategyVersion: V0931_VERSION, reason: "fixed schedule baseline only; not observed Expert behavior" }));
  const expertActions = rows.map(row => ({ timestamp: row.timestamp, expertAction: null, sourceStrategyId: sourceAudit.status === "AVAILABLE" ? sourceAudit.source.strategyId : EXPERT_ACTION_SOURCE_UNAVAILABLE, strategyVersion: sourceAudit.status === "AVAILABLE" ? sourceAudit.source.strategyVersion : null, reason: sourceAudit.reason, state: states.find(state => state.timestamp === row.timestamp) ?? null, accountState: null }));
  const closure = evaluateClosure({ rows, states, scenario, sourceDatasetHash, trajectoryDatasetHash });
  const syntheticTrajectory = closure.trajectory.map(record => ({ ...record, actionSource: SYNTHETIC_FIXED_SCHEDULE_BASELINE, observedExpertBehavior: false, sourceStrategyId: SYNTHETIC_FIXED_SCHEDULE_BASELINE, strategyVersion: V0931_VERSION }));
  const observedTrajectory = rows.map((row, index) => ({ timestamp: row.timestamp, state: { marketState: states[index], accountState: null }, expertAction: null, executionResult: null, reward: null, rewardGross: null, rewardNet: null, nextState: null, done: true, strategyId: EXPERT_ACTION_SOURCE_UNAVAILABLE, strategyVersion: null, actionSourceStatus: sourceAudit.status, observedExpertBehavior: false, reason: sourceAudit.reason, datasetHash: hash({ sourceDatasetHash, trajectoryDatasetHash }) }));
  const syntheticBaselineHash = hashRecords(baselineActions);
  const expertTrajectoryHash = hashRecords(observedTrajectory);
  const counterfactualHash = closure.hashes.counterfactualHash;
  const transitionHash = closure.hashes.transitionHash;
  const rewardHash = closure.hashes.rewardHash;
  const nextStateHash = closure.hashes.nextStateHash;
  const observedCounts = Object.fromEntries(RL_ACTIONS.map(action => [action, observedTrajectory.filter(record => record.expertAction === action).length]));
  return { version: V0931_VERSION, scenario, sourceAudit, baseline: { name: SYNTHETIC_FIXED_SCHEDULE_BASELINE, actions: baselineActions, hash: syntheticBaselineHash, observedExpertBehavior: false }, observedExpert: { status: sourceAudit.status, records: observedTrajectory, hash: expertTrajectoryHash, actionCounts: observedCounts }, syntheticTrajectory, counterfactual: closure.counterfactual, hashes: { expertTrajectoryHash, syntheticBaselineHash, counterfactualHash, transitionHash, rewardHash, nextStateHash, executionHash: closure.hashes.executionHash, identical: true }, trainingEligibility: "BLOCKED" };
}
