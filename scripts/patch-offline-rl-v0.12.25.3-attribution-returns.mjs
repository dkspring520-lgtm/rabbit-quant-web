import { readFile, writeFile } from "node:fs/promises";

const resultPath = "docs/rl-research/results/offline-rl-v0.12.25.2-benchmark-result.json";
const reportPath = "docs/rl-research/results/offline-rl-v0.12.25.3-t-failure-analysis.md";
const base = JSON.parse(await readFile(resultPath, "utf8"));
let text = await readFile(reportPath, "utf8");
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
function groups(rows, selector) {
  const map = new Map();
  for (const row of rows.filter(item => item.sell_price && item.shares > 0)) {
    const key = selector(row) ?? "UNAVAILABLE";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([key, list]) => {
    const completed = list.filter(row => ["SUCCESSFUL_REBUY", "FAILED_REBUY"].includes(row.outcome));
    const success = completed.filter(row => row.outcome === "SUCCESSFUL_REBUY").length;
    const returns = completed.map(row => Number(row.profit) / Math.max(1, Number(row.sell_price) * Number(row.shares))).filter(Number.isFinite);
    return [key, {
      sampleCount: list.length,
      successRate: completed.length ? success / completed.length : null,
      averageTReturn: returns.length ? average(returns) : null,
      failedRebuyRate: completed.length ? (completed.length - success) / completed.length : null,
      missedTrendRate: list.length ? list.filter(row => (row.missed_trend_risk?.endSession ?? 0) > 0).length / list.length : null,
    }];
  }));
}
function replaceLine(prefix, value) {
  const lines = text.split("\n");
  const index = lines.findIndex(line => line.startsWith(prefix));
  if (index >= 0) lines[index] = prefix + JSON.stringify(value);
  text = lines.join("\n");
}
for (const strategy of ["BIDIRECTIONAL_T", "EXPERT_PRIOR"]) {
  replaceLine("- opportunity attribution: ", groups(base.strategies[strategy].tradeLedger, row => row.opportunity_type));
  replaceLine("- momentum phase attribution: ", groups(base.strategies[strategy].tradeLedger, row => row.momentum_phase));
}
await writeFile(reportPath, text);
console.log(JSON.stringify({ reportPath, status: "ATTRIBUTION_AVERAGE_RETURN_FIXED" }, null, 2));
