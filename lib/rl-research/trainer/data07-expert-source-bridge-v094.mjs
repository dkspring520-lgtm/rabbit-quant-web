import { createHash } from "node:crypto";
import { normalizeMarketBars } from "../../paper-trading/historical-data-adapter.mjs";
import { runOHLCVTResearch } from "../../oh-lcv-t-research.mjs";

export const V094_VERSION = "OFFLINE_RL_V0.9.4";
export const REQUIRED_OHLCV_FIELDS = Object.freeze(["timestamp", "symbol", "open", "high", "low", "close", "volume", "amount"]);
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const hashRecords = rows => { const h = createHash("sha256"); for (const row of rows) h.update(JSON.stringify(row) + "\n"); return h.digest("hex"); };

export function auditCanonicalExpertSource(rows = [], { symbol = "601899.SH" } = {}) {
  const input = Array.isArray(rows) ? rows : [];
  const normalized = normalizeMarketBars(input, { symbol });
  const bars = normalized.bars;
  const missing = Object.fromEntries(REQUIRED_OHLCV_FIELDS.map(field => [field, input.filter(row => { const value = field === "timestamp" ? row.timestamp ?? row.datetime : field === "symbol" ? row.symbol ?? row.code : row[field]; return field === "timestamp" || field === "symbol" ? !String(value ?? "").trim() : finite(value) === null; }).length]));
  const timestamps = bars.map(row => row.timestamp);
  const seen = new Set(); let duplicateTimestamp = 0; let outOfOrder = 0; let previous = "";
  for (const timestamp of timestamps) { if (seen.has(timestamp)) duplicateTimestamp++; if (previous && timestamp < previous) outOfOrder++; seen.add(timestamp); previous = timestamp; }
  const sourceHash = hashRecords(input);
  const normalizedHash = hashRecords(bars);
  const complete = input.length > 0 && Object.values(missing).every(count => count === 0) && duplicateTimestamp === 0 && outOfOrder === 0 && bars.length === input.length;
  const signalResult = complete ? runOHLCVTResearch(bars, { symbol }) : null;
  return { version: V094_VERSION, status: complete ? "PASS" : "BLOCKED", rowCount: input.length, normalizedRowCount: bars.length, missing, duplicateTimestamp, outOfOrder, sourceHash, normalizedHash, requiredFields: REQUIRED_OHLCV_FIELDS, canonicalColumns: bars[0] ? Object.keys(bars[0]) : [], complete, fullCoverage: complete, expertSource: complete ? { strategyId: "OHLCV_T_RESEARCH_V1", strategyVersion: "OHLCV_T_RESEARCH_V1", signalCount: signalResult.signals.length, signals: signalResult.signals } : null, reason: complete ? null : "DATA-07 canonical expert source is incomplete; no OHLCV defaults or synthetic field reconstruction are permitted." };
}
