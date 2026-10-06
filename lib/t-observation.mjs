import { TFeatureEngine } from "./t-features/index.mjs";
import { TStateEngine } from "./t-state/index.mjs";
import { TOpportunityEngine } from "./t-opportunity/index.mjs";
import { buildHumanTGuidanceSeries, buildTGuidanceReminders } from "./t-guidance/index.mjs";

export function buildTObservation({ minutes = [], symbol = "", timeframe = "1m", portfolio = null } = {}) {
  const points = (minutes ?? []).map(item => ({ ...item, timestamp: item.timestamp ?? item.time, close: item.close ?? item.price, open: item.open ?? item.price, high: item.high ?? item.price, low: item.low ?? item.price }));
  if (!points.length) return { status: "INVALID", feature: null, state: null, opportunity: null, humanGuidance: null, guidanceHistory: [], reminders: [], portfolio, researchOnly: true, rlEligible: false };
  const featureEngine = new TFeatureEngine();
  const features = featureEngine.calculateSeries(points, { symbol, timeframe });
  const stateEngine = new TStateEngine();
  const states = stateEngine.calculateSeries(features);
  const opportunityEngine = new TOpportunityEngine();
  const opportunities = opportunityEngine.calculateSeries(features, states);
  const guidanceHistory = buildHumanTGuidanceSeries({ timestamps: points.map(point => point.timestamp ?? point.time), features, states, opportunities, symbol, mode: "RESEARCH_OBSERVATION" });
  const reminders = buildTGuidanceReminders(guidanceHistory);
  const latest = points.length - 1;
  return { status: features[latest]?.validity === "VALID" ? "VALID" : features[latest]?.validity ?? "INVALID", timestamp: points[latest]?.timestamp ?? null, feature: features[latest], state: states[latest], opportunity: opportunities[latest], humanGuidance: guidanceHistory[latest] ?? null, guidanceHistory, reminders, portfolio, history: { featureCount: features.length, validCount: features.filter(item => item.valid).length, guidanceCount: guidanceHistory.length, reminderCount: reminders.length }, researchOnly: true, rlEligible: false };
}
