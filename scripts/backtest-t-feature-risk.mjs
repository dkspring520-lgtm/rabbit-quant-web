import fs from "node:fs";
import { riskEventOutcome, summarizeRiskOutcomes } from "../lib/risk-event-outcome.mjs";
import { causalTFeatureSnapshot, estimateTFlyRisk } from "../lib/t-feature-normalization.mjs";
const causalRegime = (points, i, vwaps) => {
  if (i < 20) return "range";
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const pct = (a, b) => b > 0 ? (a - b) / b * 100 : 0;
  const slope = pct(mean(points.slice(i - 9, i + 1).map(p => p.price)), mean(points.slice(i - 19, i - 9).map(p => p.price)));
  const vwapSlope = pct(vwaps[i], vwaps[i - 10]);
  return slope >= 0.35 && vwapSlope >= 0.10 ? "uptrend" : slope <= -0.35 && vwapSlope <= -0.10 ? "downtrend" : "range";
};

const file = process.argv[2] ?? ".data-inspect/zijin-601899-2022-2026.jsonl";
const horizons = [5, 15, 30];
const roundTripCostPct = 0.20; // commission, stamp tax and two-sided slippage proxy
const sessions = fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const buckets = new Map();
const add = (risk, h, metrics, count = false) => {
  const key = `${risk.split}:${risk.level}:${risk.score}`;
  const item = buckets.get(key) ?? { split: risk.split, level: risk.level, score: risk.score, samples: 0, returns: Object.fromEntries(horizons.map(x => [x, []])) };
  if (count) item.samples += 1;
  if (metrics) item.returns[h].push(metrics);
  buckets.set(key, item);
};
let observations = 0;
for (const session of sessions) {
  const points = (session.minutes ?? []).map((x) => ({ time: x.time, price: Number(x.price), volume: Number(x.volume) }));
  const split = String(session.date) < "20250000" ? "train" : "test";
  if (points.length < 35) continue;
  const vwaps = [];
  let amount = 0, volume = 0;
  for (const point of points) { const weight = Math.max(1, point.volume || 0); amount += point.price * weight; volume += weight; vwaps.push(amount / volume); }
  for (let i = 8; i < points.length; i += 1) {
    const feature = causalTFeatureSnapshot(points, i, vwaps, 30);
    const risk = { ...estimateTFlyRisk(feature, causalRegime(points, i, vwaps)), split };
    observations += 1;
    for (const h of horizons) {
      const metrics = riskEventOutcome(points, i, h, roundTripCostPct);
      add(risk, h, metrics, h === horizons[0]);
    }
  }
}
const summary = [...buckets.values()].map((x) => ({
  split: x.split, level: x.level, score: x.score, samples: x.samples,
  futurePct: Object.fromEntries(horizons.map(h => [h, summarizeRiskOutcomes(x.returns[h])]))
})).sort((a, b) => a.score - b.score);
console.log(JSON.stringify({ schemaVersion: 2, kind: "t-feature-risk-event-study", file, sessions: sessions.length, observations, roundTripCostPct,
  methodology: { horizon: "consecutive wall-clock minutes; incomplete, missing-minute and lunch-crossing windows excluded", net: "hypothetical long gross return minus fixed round-trip cost in percentage points; not executed T-cycle PnL", score: "T-fly risk score, not buy-confirmation quality", limitations: "overlapping events are not independent trades; fixed costs are not an exact fee model; recoveryPathRate is a path statistic, not win rate" }, buckets: summary }, null, 2));
