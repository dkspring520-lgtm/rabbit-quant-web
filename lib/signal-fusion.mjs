import { scoreGrade } from "./signal-strength.mjs";

// Presentation-only fusion: formal execution gates remain authoritative.
export function fuseSignals(signals = []) {
  const grouped = new Map();
  for (const item of signals) {
    if (!item || !["buy","sell"].includes(item.direction) || !Number.isFinite(item.score) || item.score < 0 || item.score > 100) continue;
    // Unknown provenance is one correlated group, not independent votes.
    const key = `${item.group ?? "unverified"}:${item.direction}`;
    const previous = grouped.get(key);
    if (!previous || item.score < previous.score) grouped.set(key,item);
  }
  const usable = [...grouped.values()];
  let support = 0;
  let oppose = 0;
  let independent = 0;
  for (const signal of usable) {
    if (signal.direction === "buy") support += 1; else oppose += 1;
    if (signal.group) independent += 1;
  }
  const direction = !usable.length || (support && oppose) ? "wait" : support ? "buy" : "sell";
  const conflict = support > 0 && oppose > 0 ? "中" : "低";
  const quality = direction === "wait" ? null : Math.round(usable.reduce((sum,item)=>sum+item.score,0)/usable.length);
  return { score: quality, direction, support: direction === "sell" ? oppose : support, oppose: direction === "sell" ? support : oppose, independent, conflict, grade: scoreGrade(quality) };
}
