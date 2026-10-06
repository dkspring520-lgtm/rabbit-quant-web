import { readFile, writeFile } from "node:fs/promises";

const resultPath = "docs/rl-research/results/offline-rl-v0.12.25.2-benchmark-result.json";
const reportPath = "docs/rl-research/results/offline-rl-v0.12.25.3-t-failure-analysis.md";
const base = JSON.parse(await readFile(resultPath, "utf8"));
let text = await readFile(reportPath, "utf8");
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const pct = value => Number.isFinite(value) ? (value * 100).toFixed(2) + "%" : "N/A";
function group(rows, selector) {
  const map = new Map();
  for (const row of rows.filter(item => item.sell_price && item.shares > 0)) {
    const key = selector(row) ?? "UNAVAILABLE";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([key, list]) => {
    const done = list.filter(row => ["SUCCESSFUL_REBUY", "FAILED_REBUY"].includes(row.outcome));
    const success = done.filter(row => row.outcome === "SUCCESSFUL_REBUY").length;
    const returns = done.map(row => Number(row.profit) / Math.max(1, Number(row.sell_price) * Number(row.shares))).filter(Number.isFinite);
    return [key, { sampleCount: list.length, successRate: done.length ? success / done.length : null, averageTReturn: returns.length ? average(returns) : null, failedRebuyRate: done.length ? (done.length - success) / done.length : null, missedTrendRate: list.length ? list.filter(row => (row.missed_trend_risk?.endSession ?? 0) > 0).length / list.length : null }];
  }));
}
function replaceBetween(startMarker, endMarker, replacement) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error("REPORT_SECTION_NOT_FOUND:" + startMarker);
  text = text.slice(0, start) + replacement + text.slice(end);
}
const section = ["## 4. Successful Rebuy Analysis", "", "说明：Opportunity Type 和 Momentum Phase 分组统计基于可执行 T cycle；average T return 为扣费后 cycle profit / sell notional。", ""];
for (const strategy of ["BIDIRECTIONAL_T", "EXPERT_PRIOR"]) {
  const rows = base.strategies[strategy].tradeLedger.filter(row => row.sell_price && row.shares > 0);
  const success = rows.filter(row => row.outcome === "SUCCESSFUL_REBUY");
  const time = success.map(row => row.buyback_execution_timestamp ? 1 : null).filter(Number.isFinite);
  const advantage = success.map(row => row.buyback_price && row.sell_price ? (row.sell_price - row.buyback_price) / row.sell_price : null).filter(Number.isFinite);
  section.push("### " + strategy, "", "- successful cycles: " + success.length, "- cycles with recorded rebuy timestamp: " + time.length, "- average rebuy price advantage: " + pct(average(advantage)), "- opportunity attribution: " + JSON.stringify(group(rows, row => row.opportunity_type)), "- momentum phase attribution: " + JSON.stringify(group(rows, row => row.momentum_phase)), "");
}
section.push("## 5. Opportunity Attribution", "", "A/B/C/D Opportunity Type 与四类 Momentum Phase 均保持 candidate attribution，不转化为硬规则。", "");
for (const strategy of ["BIDIRECTIONAL_T", "EXPERT_PRIOR"]) { const rows = base.strategies[strategy].tradeLedger.filter(row => row.sell_price && row.shares > 0); section.push("### " + strategy, "", "Opportunity Type: " + JSON.stringify(group(rows, row => row.opportunity_type)), "Momentum Phase: " + JSON.stringify(group(rows, row => row.momentum_phase)), ""); }
replaceBetween("## 4. Successful Rebuy Analysis", "## 6. Position Size Diagnostics", section.join("\n") + "\n");
await writeFile(reportPath, text);
console.log(JSON.stringify({ reportPath, status: "SECTIONS_REBUILT" }, null, 2));
