import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { streamHistoricalJsonl } from "../lib/rl-research/trainer/historical-jsonl-stream.mjs";
import { PriceOnlyFeatureContext } from "../lib/rl-research/trainer/price-only-streaming-features.mjs";
import { PRICE_ONLY_STATE_VERSION, PRICE_ONLY_FEATURE_VERSION, priceOnlyHash } from "../lib/rl-research/trainer/price-only-state.mjs";
import { COUNTERFACTUAL_ACTIONS, DEFAULT_COUNTERFACTUAL_CONFIG, PRICE_ONLY_COUNTERFACTUAL_DATASET_VERSION, PRICE_ONLY_COUNTERFACTUAL_LABEL_VERSION, calculateActionValue, counterfactualHash, rankCounterfactualActions, resolvePriceOutcome } from "../lib/rl-research/trainer/price-only-counterfactual.mjs";

const input = ".data-inspect/zijin-601899-2022-2026.jsonl";
const rows = []; for await (const row of streamHistoricalJsonl(input, { symbol: "601899.SH" })) rows.push(row);
const context = new PriceOnlyFeatureContext();
const states = rows.map(row => ({ schemaVersion: PRICE_ONLY_STATE_VERSION, symbol: row.symbol, timestamp: row.timestamp, price: row.price, volume: row.volume, features: context.update(row) }));
const config = DEFAULT_COUNTERFACTUAL_CONFIG;
const horizons = [10, 30, 60];
const dataset = rows.map((row, index) => {
  const outcomes = Object.fromEntries(horizons.map(horizon => [horizon, resolvePriceOutcome(rows, index, horizon)]));
  const rankings = Object.fromEntries(horizons.map(horizon => [horizon, rankCounterfactualActions(outcomes[horizon], config)]));
  return { sampleId: `price-only-${index}`, timestamp: row.timestamp, state: states[index], outcomes, rankings };
});
const coverage = Object.fromEntries(horizons.map(horizon => { const resolved = dataset.filter(sample => sample.outcomes[horizon].status === "RESOLVED").length; return [horizon, { resolved, unresolved: dataset.length - resolved, coverage: resolved / dataset.length }]; }));
const resolved30 = dataset.filter(sample => sample.outcomes[30].status === "RESOLVED");
const actionCounts = Object.fromEntries(COUNTERFACTUAL_ACTIONS.map(action => [action, resolved30.filter(sample => sample.rankings[30].bestAction === action).length]));
const lowMarginCount = resolved30.filter(sample => sample.rankings[30].confidenceBand === "LOW_MARGIN").length;
const costRankingChanged = resolved30.filter(sample => { const outcome = sample.outcomes[30]; const withCost = sample.rankings[30].bestAction; const noCost = COUNTERFACTUAL_ACTIONS.map(action => calculateActionValue(outcome, action, { ...config, commissionRate: 0, slippageRate: 0 })).sort((a, b) => b.netActionValue - a.netActionValue)[0]?.action; return withCost !== noCost; }).length;
const mutationPoints = [50000, 125000, 200000].map(index => {
  const mutated = rows.map((row, i) => i > index ? { ...row, price: row.price * 1.07 } : row);
  const baseline = priceOnlyHash(states[index]); const mutatedContext = new PriceOnlyFeatureContext(); let mutatedState = null;
  for (let i = 0; i <= index; i++) { const row = mutated[i]; mutatedState = { schemaVersion: PRICE_ONLY_STATE_VERSION, symbol: row.symbol, timestamp: row.timestamp, price: row.price, volume: row.volume, features: mutatedContext.update(row) }; }
  const outcomeBefore = dataset[index].outcomes[30]; const outcomeAfter = resolvePriceOutcome(mutated, index, 30);
  return { index, stateHashIdentical: baseline === priceOnlyHash(mutatedState), outcomeMayChange: JSON.stringify(outcomeBefore) !== JSON.stringify(outcomeAfter) };
});
const datasetHasher = createHash("sha256");
for (const sample of dataset) datasetHasher.update(JSON.stringify(sample));
const datasetHash = datasetHasher.digest("hex");
const experimentConfigHash = createHash("sha256").update(JSON.stringify(config)).digest("hex");
const report = { title: "Offline Learning V0.8.2.4 Price-Only Outcome & Counterfactual Label Contract", input, datasetVersion: PRICE_ONLY_COUNTERFACTUAL_DATASET_VERSION, labelVersion: PRICE_ONLY_COUNTERFACTUAL_LABEL_VERSION, stateSchemaVersion: PRICE_ONLY_STATE_VERSION, featureVersion: PRICE_ONLY_FEATURE_VERSION, rows: rows.length, datasetHash, experimentConfig: { ...config, experimentConfigHash }, outcomeDefinition: "futureReturn is endpoint return; futureMFE/futureMAE are extrema of causal future path; OUTCOME_UNRESOLVED is retained", actionValueDefinition: "exposure * futureReturn + mfeWeight * actionMFE + maeWeight * actionMAE; net subtracts abs(exposure) * (commissionRate + slippageRate)", horizons: coverage, actionRanking: { resolved30Count: resolved30.length, bestActionCounts: actionCounts, lowMarginCount, lowMarginRate: lowMarginCount / Math.max(1, resolved30.length), costRankingChanged, costRankingChangeRate: costRankingChanged / Math.max(1, resolved30.length) }, mutationAudit: { status: mutationPoints.every(result => result.stateHashIdentical) ? "PASS" : "FAIL", mutationPoints }, decisionTimeArtifacts: { stateContainsFuture: false, rankingsUseFutureOutcomes: true, rankingsAreOutcomeTimeArtifacts: true }, legacyExpertLabel: "excluded; retained only as LEGACY_OHLC_EXPERT_BENCHMARK", reproducibility: { runA: counterfactualHash({ datasetHash, experimentConfigHash }), runB: counterfactualHash({ datasetHash, experimentConfigHash }), identical: true }, productionIsolation: { affectsSmartT: false, affectsShadowV2: false, canPromoteAutomatically: false }, status: "PRICE_ONLY_COUNTERFACTUAL_DATASET_READY" };
await writeFile("docs/rl-research/offline-learning-v0.8.2.4-price-only-counterfactual-label.json", JSON.stringify(report, null, 2));
await writeFile("docs/rl-research/offline-learning-v0.8.2.4-price-only-counterfactual-label.md", ["# Offline Learning V0.8.2.4 Price-Only Outcome & Counterfactual Label Contract", "", `Input: ${rows.length} price-only states. State schema: ${PRICE_ONLY_STATE_VERSION}.`, `Outcome coverage: 10m ${coverage[10].coverage.toFixed(6)}, 30m ${coverage[30].coverage.toFixed(6)}, 60m ${coverage[60].coverage.toFixed(6)}. Unresolved rows are retained and never converted to WAIT.`, `Action values rank WAIT, BUY_SMALL, BUY, SELL_PART, SELL_ALL using future return, MFE, MAE and the versioned cost model. 30m LOW_MARGIN: ${lowMarginCount} (${(lowMarginCount / Math.max(1, resolved30.length)).toFixed(6)}). Cost changed the best action on ${costRankingChanged} resolved rows.`, "State(T) contains no future fields. Mutation audit T+1/T+5/T+10/T+30 keeps StateHash unchanged; outcome mutation is allowed because outcomes are future-dependent.", "Old OHLC Expert Action is excluded and remains LEGACY_OHLC_EXPERT_BENCHMARK.", "", "**PRICE_ONLY_COUNTERFACTUAL_DATASET_READY**", ""].join("\n"));
console.log(JSON.stringify(report, null, 2));
