import { TFeatureEngine } from "../t-features/index.mjs";
import { TStateEngine } from "../t-state/index.mjs";
import { TOpportunityEngine } from "../t-opportunity/index.mjs";
import { outcomeLabel, structureLabel, SAMPLE_VERSION } from "../t-samples/sample-contract.mjs";
import { replayAuditMetadata, OUTCOME_HORIZONS, REPLAY_MODE, REPLAY_VERSION } from "./replay-contract.mjs";

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const closeOf = point => finite(point?.close ?? point?.price);
const highOf = point => finite(point?.high ?? point?.close ?? point?.price);
const lowOf = point => finite(point?.low ?? point?.close ?? point?.price);
const causalVwap = points => { const rows = points.map(item => ({ price: closeOf(item), volume: finite(item?.volume) ?? 0 })).filter(item => item.price !== null && item.volume > 0); const volume = rows.reduce((sum, item) => sum + item.volume, 0); return volume > 0 ? rows.reduce((sum, item) => sum + item.price * item.volume, 0) / volume : null; };

function outcome(points, index, inputTimestamp) {
  const base = closeOf(points[index]); const values = {};
  for (const horizon of OUTCOME_HORIZONS) {
    const end = points[index + horizon]; const endPrice = closeOf(end);
    values[`futureReturn_${horizon}bar`] = base !== null && endPrice !== null && base !== 0 ? endPrice / base - 1 : null;
    values[`complete_${horizon}bar`] = endPrice !== null;
    const path = points.slice(index + 1, index + horizon + 1);
    const highs = path.map(item => highOf(item)).filter(value => value !== null);
    const lows = path.map(item => lowOf(item)).filter(value => value !== null);
    const maxHigh = highs.length ? Math.max(...highs) : null; const minLow = lows.length ? Math.min(...lows) : null;
    values[`futureMaxFavorableExcursion_${horizon}bar`] = base !== null && maxHigh !== null ? maxHigh / base - 1 : null;
    values[`futureMaxAdverseExcursion_${horizon}bar`] = base !== null && minLow !== null ? minLow / base - 1 : null;
    values[`futurePeakTime_${horizon}bar`] = maxHigh === null ? null : path.find(item => highOf(item) === maxHigh)?.timestamp ?? path.find(item => highOf(item) === maxHigh)?.time ?? null;
    values[`futureTroughTime_${horizon}bar`] = minLow === null ? null : path.find(item => lowOf(item) === minLow)?.timestamp ?? path.find(item => lowOf(item) === minLow)?.time ?? null;
  }
  const future = points.slice(index + 1, index + 11);
  const favorable = future.map(item => highOf(item)).filter(value => value !== null);
  const adverse = future.map(item => lowOf(item)).filter(value => value !== null);
  const maxHigh = favorable.length ? Math.max(...favorable) : null; const minLow = adverse.length ? Math.min(...adverse) : null;
  values.futureMaxFavorableExcursion = base !== null && maxHigh !== null ? maxHigh / base - 1 : null;
  values.futureMaxAdverseExcursion = base !== null && minLow !== null ? minLow / base - 1 : null;
  const peakIndex = favorable.length && maxHigh !== null ? future.findIndex(item => highOf(item) === maxHigh) : -1;
  const troughIndex = adverse.length && minLow !== null ? future.findIndex(item => lowOf(item) === minLow) : -1;
  values.futurePeakTime = peakIndex >= 0 ? future[peakIndex]?.timestamp ?? future[peakIndex]?.time ?? null : null;
  values.futureTroughTime = troughIndex >= 0 ? future[troughIndex]?.timestamp ?? future[troughIndex]?.time ?? null : null;
  values.futureDrawdown = values.futureMaxAdverseExcursion;
  values.inputTimestamp = inputTimestamp; values.outcomeStartTimestamp = future[0]?.timestamp ?? future[0]?.time ?? null; values.outcomeEndTimestamp = future.at(-1)?.timestamp ?? future.at(-1)?.time ?? null;
  values.complete = Boolean(values.complete_5bar);
  return values;
}

export class TReplayEngine {
  replay(points, { symbol = "", dataSource = "UNKNOWN", accountSnapshot = null, sampleVersion = SAMPLE_VERSION, onSample = null, collectSamples = true } = {}) {
    if (!Array.isArray(points)) throw new TypeError("points must be an array");
    const samples = [];
    const features = new TFeatureEngine().calculateSeries(points, { symbol, timeframe: "1m" });
    const states = new TStateEngine().calculateSeries(features);
    const opportunities = new TOpportunityEngine().calculateSeries(features, states);
    for (let index = 0; index < points.length; index += 1) {
      const prefix = points.slice(0, index + 1);
      const observation = { feature: features[index], state: states[index], opportunity: opportunities[index] };
      const timestamp = points[index]?.timestamp ?? points[index]?.time ?? null;
      const realizedOutcome = outcome(points, index, timestamp);
      const sample = { sampleId: `${symbol}:${timestamp}:${REPLAY_VERSION}:${sampleVersion}`, symbol, timestamp, market: { open: finite(points[index]?.open), high: highOf(points[index]), low: lowOf(points[index]), close: closeOf(points[index]), volume: finite(points[index]?.volume), vwap: causalVwap(prefix) }, featureSnapshot: structuredClone(observation.feature), stateSnapshot: structuredClone(observation.state), opportunitySnapshot: structuredClone(observation.opportunity), accountSnapshot: accountSnapshot ? structuredClone(accountSnapshot) : null, t1Snapshot: accountSnapshot ? { position: accountSnapshot.position ?? null, sellablePosition: accountSnapshot.sellablePosition ?? null, todayBought: accountSnapshot.todayBought ?? null, availableSellablePosition: accountSnapshot.availableSellablePosition ?? null } : null, outcome: realizedOutcome, label: { structureLabel: structureLabel(observation.opportunity?.type), outcomeLabel: outcomeLabel(realizedOutcome), labelType: "STRUCTURE_LABEL + OUTCOME_LABEL" }, valid: Boolean(observation.feature?.valid && observation.state?.validity === "STATE_VALID" && observation.opportunity?.valid), invalidReason: observation.feature?.reason ?? (observation.state?.validity === "STATE_INVALID" ? "invalid state" : null), provenance: { dataSource, symbol, timestamp, barIndex: index, indicatorVersion: "1.0.0", featureVersion: "1.0.0", stateVersion: "1.0.0", opportunityVersion: "1.0.0", replayVersion: REPLAY_VERSION, sampleVersion, replayMode: REPLAY_MODE, datasetHash: "UNKNOWN", ...replayAuditMetadata() } };
      if (collectSamples) samples.push(sample);
      if (typeof onSample === "function") onSample(sample);
    }
    return { mode: REPLAY_MODE, replayVersion: REPLAY_VERSION, samples, count: points.length, collected: collectSamples, rlEligible: false };
  }
}
export const ReplayEngine = TReplayEngine;
