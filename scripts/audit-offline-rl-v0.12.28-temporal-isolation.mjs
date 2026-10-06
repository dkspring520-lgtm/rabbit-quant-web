import { readFile } from "node:fs/promises";
import { streamHistoricalJsonl } from "../lib/rl-research/trainer/historical-jsonl-stream.mjs";
import { TReplayEngine } from "../lib/t-replay/index.mjs";

const input = process.argv.find(value => value.startsWith("--input="))?.slice(8) ?? ".data-inspect/zijin-601899-2022-2026.jsonl";
const sourceBytes = await readFile(input);
const byDate = new Map();
for await (const row of streamHistoricalJsonl(input, { symbol: "601899.SH" })) { const date = String(row.timestamp).slice(0, 10); if (!byDate.has(date)) byDate.set(date, []); byDate.get(date).push(row); }
const dates = [...byDate.keys()]; const targets = [0, Math.floor(dates.length / 3), Math.floor(dates.length * 2 / 3), dates.length - 1].filter((value, index, values) => value >= 0 && values.indexOf(value) === index);
const checks = [];
for (const dateIndex of targets) {
  const date = dates[dateIndex]; const rows = byDate.get(date); const targetIndex = Math.min(80, Math.max(20, rows.length - 11));
  const original = new TReplayEngine().replay(rows, { symbol: "601899.SH" }).samples[targetIndex];
  const mutated = rows.map((row, index) => index > targetIndex ? { ...row, price: row.price + 7, close: row.close + 7, high: (row.high ?? row.price) + 7, low: (row.low ?? row.price) + 7 } : row);
  const changed = new TReplayEngine().replay(mutated, { symbol: "601899.SH" }).samples[targetIndex];
  checks.push({ date, targetIndex, featureUnchanged: JSON.stringify(original.featureSnapshot) === JSON.stringify(changed.featureSnapshot), stateUnchanged: JSON.stringify(original.stateSnapshot) === JSON.stringify(changed.stateSnapshot), opportunityUnchanged: JSON.stringify(original.opportunitySnapshot) === JSON.stringify(changed.opportunitySnapshot), outcomeChanged: JSON.stringify(original.outcome) !== JSON.stringify(changed.outcome) });
}
const result = { input, checked: checks.length, checks, TEMPORAL_ISOLATION: checks.every(item => item.featureUnchanged && item.stateUnchanged && item.opportunityUnchanged) ? "PASS" : "FAIL", sourceBytes: sourceBytes.length };
console.log(JSON.stringify(result, null, 2));
