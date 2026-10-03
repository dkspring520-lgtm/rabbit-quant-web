import { createHash } from "node:crypto";
export const OFFLINE_DATASET_VERSION = "OFFLINE_RL_V0.10";
export const ACTIONS = Object.freeze(["WAIT", "BUY_SMALL", "BUY", "SELL_PART", "SELL_ALL"]);
const hashRows = rows => { const h = createHash("sha256"); for (const row of rows) h.update(JSON.stringify(row) + "\n"); return h.digest("hex"); };
const required = ["state", "action", "reward", "nextState", "done", "timestamp", "symbol", "scenarioId", "episodeId", "strategyId", "strategyVersion", "sourceDatasetHash", "expertSignalHash", "executionVersion", "rewardVersion", "costModelVersion"];
export function transformTrajectoryRecordV010(record) { return { datasetVersion: OFFLINE_DATASET_VERSION, state: record.state, action: record.expertAction, reward: record.reward, nextState: record.nextState, done: record.done, timestamp: record.timestamp, symbol: record.symbol, scenarioId: record.scenarioId, episodeId: record.episodeId, strategyId: record.strategyId, strategyVersion: record.strategyVersion, sourceDatasetHash: record.sourceDatasetHash, normalizedDatasetHash: record.normalizedDatasetHash, expertSignalHash: record.expertSignalHash, trajectoryDatasetHash: record.trajectoryDatasetHash, stateDatasetHash: record.stateDatasetHash, executionVersion: record.executionVersion, rewardVersion: record.rewardVersion, costModelVersion: record.costModelVersion, observedExpertBehavior: record.observedExpertBehavior ?? true }; }
export function buildOfflineDatasetV010(records = []) {
  const dataset = records.map(transformTrajectoryRecordV010);
  dataset.sort((a, b) => String(a.scenarioId).localeCompare(String(b.scenarioId)) || String(a.episodeId).localeCompare(String(b.episodeId)) || String(a.timestamp).localeCompare(String(b.timestamp)));
  return Object.freeze(dataset.map(Object.freeze));
}
export function validateOfflineDatasetV010(dataset = []) {
  const errors = []; const seen = new Set(); let previous = null;
  for (let i = 0; i < dataset.length; i++) { const row = dataset[i]; for (const key of required) if (!Object.hasOwn(row, key)) errors.push(`row ${i}: missing ${key}`); if (!ACTIONS.includes(row.action)) errors.push(`row ${i}: invalid action`); if (row.state?.marketState?.schemaVersion !== "ValidatedStatePriceOnlyV0.1") errors.push(`row ${i}: invalid state schema`); if (row.done && row.nextState !== null) errors.push(`row ${i}: done transition has nextState`); const key = `${row.scenarioId}|${row.episodeId}|${row.timestamp}`; if (seen.has(key)) errors.push(`row ${i}: duplicate transition`); seen.add(key); const order = `${row.scenarioId}|${row.episodeId}|${row.timestamp}`; if (previous && order < previous) errors.push(`row ${i}: chronology`); previous = order; }
  return { valid: errors.length === 0, errors, count: dataset.length, datasetHash: hashRows(dataset), actionCounts: Object.fromEntries(ACTIONS.map(action => [action, dataset.filter(row => row.action === action).length])), scenarioIds: [...new Set(dataset.map(row => row.scenarioId))] };
}
