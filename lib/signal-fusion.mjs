const clamp = value => Math.max(0, Math.min(100, Math.round(value)));

// Presentation-only fusion: formal execution gates remain authoritative.
export function fuseSignals(signals = []) {
  const usable = signals.filter(item => item && (item.direction === "buy" || item.direction === "sell"));
  let score = 50;
  let support = 0;
  let oppose = 0;
  let independent = 0;
  for (const signal of usable) {
    const weight = Number.isFinite(signal.weight) ? signal.weight : 20;
    const contribution = signal.direction === "buy" ? weight : -weight;
    score += contribution * (independent === 0 ? 1 : 0.72);
    if (signal.direction === "buy") support += 1; else oppose += 1;
    if (signal.independent) independent += 1;
  }
  const direction = score > 55 ? "buy" : score < 45 ? "sell" : "wait";
  const conflict = support > 0 && oppose > 0 ? "中" : "低";
  const grade = score >= 80 ? "超好" : score >= 70 ? "OK" : score >= 60 ? "及格" : score >= 40 ? "偏弱" : score >= 20 ? "很差" : "极差";
  return { score: clamp(score), direction, support, oppose, independent, conflict, grade };
}
