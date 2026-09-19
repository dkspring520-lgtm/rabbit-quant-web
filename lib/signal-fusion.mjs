import { scoreGrade } from "./signal-strength.mjs";

// Presentation-only fusion: formal execution gates remain authoritative.
export function fuseSignals(signals = []) {
  const usable = signals.filter(item => item && (item.direction === "buy" || item.direction === "sell") && Number.isFinite(item.score) && item.score >= 0 && item.score <= 100);
  let support = 0;
  let oppose = 0;
  let independent = 0;
  for (const signal of usable) {
    if (signal.direction === "buy") support += 1; else oppose += 1;
    if (signal.independent) independent += 1;
  }
  const direction = !usable.length || (support && oppose) ? "wait" : support ? "buy" : "sell";
  const conflict = support > 0 && oppose > 0 ? "中" : "低";
  const quality = direction === "wait" ? null : Math.round(usable.reduce((sum,item)=>sum+item.score,0)/usable.length);
  return { score: quality, direction, support: direction === "sell" ? oppose : support, oppose: direction === "sell" ? support : oppose, independent, conflict, grade: scoreGrade(quality) };
}
