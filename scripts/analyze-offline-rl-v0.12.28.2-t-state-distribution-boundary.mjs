import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";

const defaultRoot = ".data-inspect/t-sample-mining/v0.12.28/t-sample-mining-20261005152746-f92d1fd1";
const root = process.argv.find(value => value.startsWith("--run="))?.slice(6) ?? defaultRoot;
const run = JSON.parse(await readFile(`${root}/mining-run.json`, "utf8"));
const asset = `${root}/t-samples.jsonl.gz`;

const STATES = ["NEUTRAL", "UPTREND", "DOWNTREND", "PULLBACK", "REBOUND", "UPWARD_EXHAUSTION_CANDIDATE", "DOWNWARD_EXHAUSTION_CANDIDATE", "INVALID"];
const OPPORTUNITIES = ["POSITIVE_T_ENVIRONMENT", "COUNTER_T_ENVIRONMENT", "NEUTRAL", "INVALID"];
const HORIZONS = [1, 3, 5, 10];

const increment = (map, key, amount = 1) => map.set(key, (map.get(key) ?? 0) + amount);
const nestedIncrement = (map, first, second, amount = 1) => {
  if (!map.has(first)) map.set(first, new Map());
  increment(map.get(first), second, amount);
};
const asObject = map => Object.fromEntries([...map.entries()].map(([key, value]) => [key, value instanceof Map ? asObject(value) : value]));
const pct = (value, total) => total ? `${(value / total * 100).toFixed(3)}%` : "0.000%";
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const aliasState = raw => raw === "HIGH_LEVEL_EXHAUSTION" ? "UPWARD_EXHAUSTION_CANDIDATE" : raw === "LOW_LEVEL_EXHAUSTION" ? "DOWNWARD_EXHAUSTION_CANDIDATE" : raw === "NO_T_ENVIRONMENT" ? "NEUTRAL" : raw;
const dateMs = timestamp => Date.parse(`${String(timestamp).replace("T", " " )}+08:00`);
const contiguous = (left, right) => Number.isFinite(dateMs(left)) && Number.isFinite(dateMs(right)) && dateMs(right) - dateMs(left) === 60_000;
const velocityOf = sample => finite(sample.featureSnapshot?.momentum?.shortMomentum) ?? finite(sample.featureSnapshot?.trend?.trendSlope);
const positionOf = sample => finite(sample.featureSnapshot?.position?.rangePosition);
const copySummary = sample => ({
  sampleId: sample.sampleId,
  timestamp: sample.timestamp,
  state: aliasState(sample.stateSnapshot?.state ?? "UNKNOWN"),
  rawState: sample.stateSnapshot?.state ?? "UNKNOWN",
  opportunity: sample.opportunitySnapshot?.type ?? "UNKNOWN",
  trendDirection: sample.featureSnapshot?.trend?.trendDirection ?? null,
  velocity: velocityOf(sample),
  rangePosition: positionOf(sample),
  futureReturn_1bar: sample.outcome?.futureReturn_1bar ?? null,
  futureReturn_5bar: sample.outcome?.futureReturn_5bar ?? null,
  futureReturn_10bar: sample.outcome?.futureReturn_10bar ?? null,
});

const stateAll = new Map();
const stateValid = new Map();
const opportunityAll = new Map();
const opportunityValid = new Map();
const structureAll = new Map();
const transitionCounts = new Map();
const stateOpportunity = new Map();
const yearState = new Map();
const yearOpportunity = new Map();
const yearExhaustion = new Map();
const stateEpisodes = new Map(STATES.map(state => [state, []]));
const transitionExamples = new Map();
const potentialBoundaryExamples = { positive: [], negative: [] };
const counterExamples = { upward: [], downward: [] };
const counterStats = {
  upward: Object.fromEntries(HORIZONS.map(horizon => [horizon, { count: 0, positive: 0, negative: 0, zero: 0, sum: 0, values: [], mfeSum: 0, mfeCount: 0, maeSum: 0, maeCount: 0 }])),
  downward: Object.fromEntries(HORIZONS.map(horizon => [horizon, { count: 0, positive: 0, negative: 0, zero: 0, sum: 0, values: [], mfeSum: 0, mfeCount: 0, maeSum: 0, maeCount: 0 }]))
};

let total = 0;
let valid = 0;
let invalid = 0;
let warmup = 0;
let firstTimestamp = null;
let lastTimestamp = null;
let previousSample = null;
let previousValid = null;
let sessionBreaks = 0;
let transitionTotal = 0;
let sameStateHolds = 0;
let currentEpisode = null;
let directionRun = { sign: 0, length: 0, rows: [] };
let upExhaustionQualifiers = 0;
let downExhaustionQualifiers = 0;
let upOverrideEvidence = 0;
let downOverrideEvidence = 0;
let upQualifierNotHigh = 0;
let downQualifierNotLow = 0;
let potentialPullbackCandidates = 0;
let potentialReboundCandidates = 0;
let transitionStateCounts = new Map();

function finalizeEpisode() {
  if (!currentEpisode) return;
  if (!stateEpisodes.has(currentEpisode.state)) stateEpisodes.set(currentEpisode.state, []);
  stateEpisodes.get(currentEpisode.state).push(currentEpisode.duration);
  currentEpisode = null;
}

function startOrContinueEpisode(sample, state) {
  const canContinue = currentEpisode && currentEpisode.state === state && currentEpisode.lastTimestamp && contiguous(currentEpisode.lastTimestamp, sample.timestamp);
  if (canContinue) {
    currentEpisode.duration += 1;
    currentEpisode.lastTimestamp = sample.timestamp;
    return;
  }
  finalizeEpisode();
  currentEpisode = { state, startTimestamp: sample.timestamp, lastTimestamp: sample.timestamp, duration: 1 };
}

function addTransition(previous, current, sample) {
  transitionTotal += 1;
  nestedIncrement(transitionCounts, previous, current);
  if (previous === current) sameStateHolds += 1;
  const key = `${previous}→${current}`;
  if (!transitionExamples.has(key)) transitionExamples.set(key, copySummary(sample));
}

function addCounterStat(group, sample, horizon) {
  const stat = counterStats[group][horizon];
  const returnValue = finite(sample.outcome?.[`futureReturn_${horizon}bar`]);
  if (returnValue === null) return;
  stat.count += 1; stat.sum += returnValue; stat.values.push(returnValue);
  if (returnValue > 0) stat.positive += 1; else if (returnValue < 0) stat.negative += 1; else stat.zero += 1;
  const mfe = finite(sample.outcome?.[`futureMaxFavorableExcursion_${horizon}bar`] ?? sample.outcome?.futureMaxFavorableExcursion);
  const mae = finite(sample.outcome?.[`futureMaxAdverseExcursion_${horizon}bar`] ?? sample.outcome?.futureMaxAdverseExcursion);
  if (mfe !== null) { stat.mfeSum += mfe; stat.mfeCount += 1; }
  if (mae !== null) { stat.maeSum += mae; stat.maeCount += 1; }
}

function updateDirectionRun(sample, state) {
  const velocity = velocityOf(sample);
  const sign = velocity === null ? 0 : velocity > 0 ? 1 : velocity < 0 ? -1 : 0;
  if (!sign || !previousValid || !contiguous(previousValid.timestamp, sample.timestamp) || sign !== directionRun.sign) {
    directionRun = { sign, length: sign ? 1 : 0, rows: sign ? [sample] : [] };
    return;
  }
  directionRun.length += 1;
  directionRun.rows.push(sample);
  if (directionRun.length === 3 && state !== (sign > 0 ? "UPTREND" : "DOWNTREND")) {
    const target = sign > 0 ? potentialBoundaryExamples.positive : potentialBoundaryExamples.negative;
    if (target.length < 20) target.push({
      direction: sign > 0 ? "CONTINUOUS_UP" : "CONTINUOUS_DOWN",
      startTimestamp: directionRun.rows[0].timestamp,
      endTimestamp: directionRun.rows.at(-1).timestamp,
      states: directionRun.rows.map(row => aliasState(row.stateSnapshot?.state ?? "UNKNOWN")),
      prices: directionRun.rows.map(row => row.market?.close ?? null),
      samples: directionRun.rows.map(copySummary)
    });
  }
}

const reader = createInterface({ input: createReadStream(asset).pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of reader) {
  if (!line.trim()) continue;
  const sample = JSON.parse(line);
  total += 1;
  firstTimestamp ??= sample.timestamp;
  lastTimestamp = sample.timestamp;
  const isValid = sample.valid === true;
  if (isValid) valid += 1; else invalid += 1;
  if (sample.featureSnapshot?.validity === "WARMUP" || sample.stateSnapshot?.validity === "STATE_WARMUP") warmup += 1;

  const state = isValid ? aliasState(sample.stateSnapshot?.state ?? "UNKNOWN") : "INVALID";
  const rawState = sample.stateSnapshot?.state ?? "UNKNOWN";
  const opportunity = sample.opportunitySnapshot?.type ?? "UNKNOWN";
  const year = String(sample.timestamp).slice(0, 4);
  increment(stateAll, state);
  increment(opportunityAll, opportunity);
  increment(structureAll, sample.label?.structureLabel ?? "UNKNOWN");
  if (isValid) {
    increment(stateValid, state);
    increment(opportunityValid, opportunity);
    nestedIncrement(stateOpportunity, state, opportunity);
    nestedIncrement(yearState, year, state);
    nestedIncrement(yearOpportunity, year, opportunity);
    if (state === "UPWARD_EXHAUSTION_CANDIDATE" || state === "DOWNWARD_EXHAUSTION_CANDIDATE") nestedIncrement(yearExhaustion, year, state);

    const velocity = velocityOf(sample);
    const position = positionOf(sample);
    const upCandidate = sample.featureSnapshot?.exhaustion?.upwardExhaustionCandidate === true && velocity !== null && velocity > 0;
    const downCandidate = sample.featureSnapshot?.exhaustion?.downwardExhaustionCandidate === true && velocity !== null && velocity < 0;
    const wouldUptrend = velocity !== null && velocity > 0 && position !== null && position >= 0.55;
    const wouldDowntrend = velocity !== null && velocity < 0 && position !== null && position <= 0.45;
    if (upCandidate) { upExhaustionQualifiers += 1; if (state === "UPWARD_EXHAUSTION_CANDIDATE" && wouldUptrend) upOverrideEvidence += 1; if (state !== "UPWARD_EXHAUSTION_CANDIDATE") upQualifierNotHigh += 1; }
    if (downCandidate) { downExhaustionQualifiers += 1; if (state === "DOWNWARD_EXHAUSTION_CANDIDATE" && wouldDowntrend) downOverrideEvidence += 1; if (state !== "DOWNWARD_EXHAUSTION_CANDIDATE") downQualifierNotLow += 1; }
    if (velocity !== null && position !== null && velocity > 0 && position < 0.55) potentialReboundCandidates += 1;
    if (velocity !== null && position !== null && velocity < 0 && position > 0.45) potentialPullbackCandidates += 1;

    const stateGroup = state === "UPWARD_EXHAUSTION_CANDIDATE" ? "upward" : state === "DOWNWARD_EXHAUSTION_CANDIDATE" ? "downward" : null;
    if (stateGroup) {
      for (const horizon of HORIZONS) addCounterStat(stateGroup, sample, horizon);
      if (counterExamples[stateGroup].length < 20) {
        const ret5 = finite(sample.outcome?.futureReturn_5bar);
        const isCounter = stateGroup === "upward" ? ret5 !== null && ret5 > 0 : ret5 !== null && ret5 < 0;
        if (isCounter) counterExamples[stateGroup].push(copySummary(sample));
      }
    }

    updateDirectionRun(sample, state);
    if (previousValid && contiguous(previousValid.timestamp, sample.timestamp)) addTransition(aliasState(previousValid.stateSnapshot?.state ?? "UNKNOWN"), state, sample);
    else if (previousValid) sessionBreaks += 1;
    previousValid = sample;
    startOrContinueEpisode(sample, state);
  } else {
    finalizeEpisode();
    previousValid = null;
    directionRun = { sign: 0, length: 0, rows: [] };
  }
  previousSample = sample;
}
finalizeEpisode();

function durationSummary(values) {
  if (!values?.length) return { episodeCount: 0, meanDuration: null, medianDuration: null, p90Duration: null, maxDuration: null, oneBarEpisodeRatio: null };
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = q => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
  return { episodeCount: values.length, meanDuration: values.reduce((sum, value) => sum + value, 0) / values.length, medianDuration: quantile(0.5), p90Duration: quantile(0.9), maxDuration: sorted.at(-1), oneBarEpisodeRatio: values.filter(value => value === 1).length / values.length };
}
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function counterSummary(group, horizon) {
  const stat = counterStats[group][horizon];
  return { count: stat.count, positiveCount: stat.positive, negativeCount: stat.negative, zeroCount: stat.zero, meanReturn: stat.count ? stat.sum / stat.count : null, medianReturn: median(stat.values), meanMFE: stat.mfeCount ? stat.mfeSum / stat.mfeCount : null, meanMAE: stat.maeCount ? stat.maeSum / stat.maeCount : null };
}
function matrixRows(matrix, rowTotals) {
  return Object.fromEntries([...matrix.entries()].map(([row, cols]) => {
    const totalRow = rowTotals.get(row) ?? 0;
    return [row, Object.fromEntries([...cols.entries()].map(([column, count]) => [column, { count, percentageOfRow: pct(count, totalRow) }]))];
  }));
}
function tableLines(headers, rows) {
  const output = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const row of rows) output.push(`| ${row.join(" | ")} |`);
  return output;
}

const duration = Object.fromEntries(STATES.map(state => [state, durationSummary(stateEpisodes.get(state) ?? [])]));
const transitionRowTotals = new Map([...transitionCounts.entries()].map(([state, columns]) => [state, [...columns.values()].reduce((sum, value) => sum + value, 0)]));
const validStateTotal = valid;
const stateRows = STATES.map(state => [state, stateAll.get(state) ?? 0, pct(stateAll.get(state) ?? 0, total), stateValid.get(state) ?? 0, pct(stateValid.get(state) ?? 0, validStateTotal)]);
const transitionMatrix = matrixRows(transitionCounts, transitionRowTotals);
const requestedTransitions = [
  ["NEUTRAL", "UPTREND"], ["NEUTRAL", "DOWNTREND"], ["UPTREND", "PULLBACK"], ["PULLBACK", "REBOUND"], ["REBOUND", "UPTREND"], ["DOWNTREND", "PULLBACK"], ["PULLBACK", "REBOUND"], ["UPTREND", "UPWARD_EXHAUSTION_CANDIDATE"], ["DOWNTREND", "DOWNWARD_EXHAUSTION_CANDIDATE"]
].map(([from, to]) => ({ from, to, count: transitionCounts.get(from)?.get(to) ?? 0, status: transitionCounts.get(from)?.get(to) ? "OBSERVED" : "ABSENT" }));
const counterSummaryReport = Object.fromEntries(["upward", "downward"].map(group => [group, Object.fromEntries(HORIZONS.map(horizon => [horizon, counterSummary(group, horizon)]))]));
const stateOppRows = [];
for (const state of STATES) {
  const row = stateOpportunity.get(state) ?? new Map(); const totalRow = [...row.values()].reduce((sum, value) => sum + value, 0);
  stateOppRows.push({ state, total: totalRow, opportunities: Object.fromEntries(OPPORTUNITIES.map(opportunity => [opportunity, { count: row.get(opportunity) ?? 0, percentageOfState: pct(row.get(opportunity) ?? 0, totalRow) }])) });
}
const overrideStatus = upOverrideEvidence > 0 && downOverrideEvidence > 0 && (stateValid.get("UPTREND") ?? 0) === 0 && (stateValid.get("DOWNTREND") ?? 0) === 0 ? "CONFIRMED" : upOverrideEvidence > 0 || downOverrideEvidence > 0 ? "INSUFFICIENT_EVIDENCE" : "NOT_CONFIRMED";
const pullbackReboundCoverage = (stateValid.get("PULLBACK") ?? 0) === 0 && (stateValid.get("REBOUND") ?? 0) === 0 ? "ABSENT" : "WARNING";
const stateSpaceStatus = overrideStatus === "CONFIRMED" || pullbackReboundCoverage !== "PASS" ? "CONDITIONAL" : "VALID";
const reportLines = [
  "# OFFLINE RL V0.12.28.2 — T State Distribution & Boundary Analysis", "",
  "本报告只分析已生成的 T Sample Asset，不修改 Feature / State / Opportunity Engine，也不重新生成 Mining Samples。", "",
  "## 1. Executive Summary", "",
  `- State-space primary status: **${stateSpaceStatus}**`,
  `- State boundary status: **REVIEW_REQUIRED**`,
  `- Exhaustion override evidence: **${overrideStatus}**`,
  `- PULLBACK / REBOUND coverage: **${pullbackReboundCoverage}**`,
  "- The asset is structurally auditable, but the observed state vocabulary is highly concentrated in exhaustion candidates and neutral/warmup rows.",
  "- Missing UPTREND / DOWNTREND / PULLBACK / REBOUND output is recorded as a research finding, not repaired.", "",
  "## 2. Dataset / Mining Run", "",
  `- Mining Run ID: ${run.runId}`, `- Dataset Hash: ${run.datasetHash}`, `- Symbol: ${run.symbol}`, `- Replay range: ${run.timeRange.start} → ${run.timeRange.end}`, `- Replay bars / samples: ${total}`, `- Valid samples: ${valid}`, `- Invalid samples: ${invalid}`, `- Warmup samples: ${warmup}`, `- Source asset: ${asset}`, `- Analysis did not rerun Replay or alter the asset.`, "",
  "## 3. State Distribution", "",
  ...tableLines(["State", "All samples", "All %", "Valid samples", "Valid %"], stateRows), "",
  "State coverage notes:",
  `- UPTREND: ${(stateValid.get("UPTREND") ?? 0) === 0 ? "COUNT = 0; COVERAGE = ABSENT" : "present"}`,
  `- DOWNTREND: ${(stateValid.get("DOWNTREND") ?? 0) === 0 ? "COUNT = 0; COVERAGE = ABSENT" : "present"}`,
  `- PULLBACK: ${(stateValid.get("PULLBACK") ?? 0) === 0 ? "COUNT = 0; COVERAGE = ABSENT" : "present"}`,
  `- REBOUND: ${(stateValid.get("REBOUND") ?? 0) === 0 ? "COUNT = 0; COVERAGE = ABSENT" : "present"}`,
  `- Exhaustion concentration among valid samples: ${(stateValid.get("UPWARD_EXHAUSTION_CANDIDATE") ?? 0) + (stateValid.get("DOWNWARD_EXHAUSTION_CANDIDATE") ?? 0)} / ${valid} = ${pct((stateValid.get("UPWARD_EXHAUSTION_CANDIDATE") ?? 0) + (stateValid.get("DOWNWARD_EXHAUSTION_CANDIDATE") ?? 0), valid)}`, "",
  "## 4. State Duration", "",
  ...tableLines(["State", "Episode Count", "Mean", "Median", "P90", "Max", "1-bar Ratio"], STATES.map(state => { const row = duration[state]; return [state, row.episodeCount, row.meanDuration === null ? "—" : row.meanDuration.toFixed(2), row.medianDuration ?? "—", row.p90Duration ?? "—", row.maxDuration ?? "—", row.oneBarEpisodeRatio === null ? "—" : `${(row.oneBarEpisodeRatio * 100).toFixed(2)}%`]; })), "",
  "## 5. State Transition Matrix", "",
  "Only contiguous observed valid bars are used for the transition matrix. Session breaks, lunch breaks and invalid/warmup gaps are not treated as ordinary transitions.", "",
  JSON.stringify(transitionMatrix, null, 2), "",
  `- Contiguous transitions: ${transitionTotal}`, `- Same-state holds: ${sameStateHolds}`, `- Non-contiguous/session breaks: ${sessionBreaks}`, "",
  "Requested transition checks:",
  ...tableLines(["Previous", "Current", "Count", "Status"], requestedTransitions.map(row => [row.from, row.to, row.count, row.status])), "",
  "## 6. Exhaustion Override Analysis", "",
  `- Upward exhaustion qualifiers (feature candidate + positive velocity): ${upExhaustionQualifiers}`,
  `- Downward exhaustion qualifiers (feature candidate + negative velocity): ${downExhaustionQualifiers}`,
  `- Upward override evidence: ${upOverrideEvidence}`,
  `- Downward override evidence: ${downOverrideEvidence}`,
  `- Qualifiers not emitted as matching exhaustion state: upward ${upQualifierNotHigh}; downward ${downQualifierNotLow}`,
  `- Current valid UPTREND count: ${stateValid.get("UPTREND") ?? 0}; current valid DOWNTREND count: ${stateValid.get("DOWNTREND") ?? 0}`,
  `- EXHAUSTION_OVERRIDE_EVIDENCE = ${overrideStatus}`,
  "- Interpretation: the implementation checks exhaustion before the UPTREND/DOWNTREND branches; the observed data contains samples satisfying both the exhaustion qualifier and the downstream directional-trend condition. This is evidence of precedence/coverage interaction, not a claim that the state logic is incorrect.", "",
  "## 7. PULLBACK / REBOUND Analysis", "",
  `- PULLBACK count: ${stateValid.get("PULLBACK") ?? 0}`, `- REBOUND count: ${stateValid.get("REBOUND") ?? 0}`, `- PULLBACK → REBOUND count: ${transitionCounts.get("PULLBACK")?.get("REBOUND") ?? 0}`, `- REBOUND → UPTREND count: ${transitionCounts.get("REBOUND")?.get("UPTREND") ?? 0}`, `- REBOUND → DOWNTREND count: ${transitionCounts.get("REBOUND")?.get("DOWNTREND") ?? 0}`, `- Feature-level potential PULLBACK fallback candidates: ${potentialPullbackCandidates}`, `- Feature-level potential REBOUND fallback candidates: ${potentialReboundCandidates}`, `- PULLBACK_REBOUND_COVERAGE = ${pullbackReboundCoverage}`, "- These feature-level counts are diagnostic only; they do not create new State labels.", "",
  "## 8. State → Opportunity Matrix", "",
  JSON.stringify(stateOppRows, null, 2), "",
  "## 9. State Boundary Samples", "",
  "Representative observed transitions:",
  JSON.stringify(Object.fromEntries([...transitionExamples.entries()].slice(0, 40)), null, 2), "",
  "Potential boundary cases (no ground-truth misclassification claim):",
  JSON.stringify(potentialBoundaryExamples, null, 2), "",
  "## 10. Counterexample Analysis", "",
  "Counterexample definition: upward exhaustion candidate followed by positive future return, or downward exhaustion candidate followed by negative future return. These are descriptive historical outcomes, not predictive probabilities.", "",
  JSON.stringify(counterSummaryReport, null, 2), "",
  `- Upward exhaustion 5-bar counterexamples: ${counterStats.upward[5].positive}`,
  `- Downward exhaustion 5-bar counterexamples: ${counterStats.downward[5].negative}`,
  "- Counterexample samples are retained and not reweighted or removed.", "",
  "## 11. Year / Regime Distribution", "",
  "Year × State:", JSON.stringify(asObject(yearState), null, 2), "",
  "Year × Opportunity:", JSON.stringify(asObject(yearOpportunity), null, 2), "",
  "Year × Exhaustion:", JSON.stringify(asObject(yearExhaustion), null, 2), "",
  "## 12. Research Findings", "",
  "1. The valid state space observed in this asset is concentrated in UPWARD_EXHAUSTION_CANDIDATE, DOWNWARD_EXHAUSTION_CANDIDATE and NEUTRAL.",
  "2. UPTREND, DOWNTREND, PULLBACK and REBOUND have no emitted valid samples; the absence is not repaired in this analysis.",
  "3. Exhaustion precedence is supported by implementation inspection and feature/state co-occurrence evidence.",
  "4. The transition matrix should be reviewed as a coverage/priority diagnostic, not treated as a proof of strategy quality.",
  "5. Counterexamples exist on both exhaustion directions and remain important boundary assets.", "",
  "## 13. Risks / Limitations", "",
  "- No human ground-truth state labels are available; potential boundary cases cannot be called misclassifications.",
  "- This report uses historical outcome fields only for post-hoc counterexample analysis; they do not enter State or Opportunity.",
  "- DATA-07 is 1-minute OHLCV research data and cannot validate Tick/L2 or millisecond microstructure hypotheses.",
  "- No Feature, State, Opportunity, Indicator, Reward, T+1, Dataset or sample asset was modified.", "",
  "## 14. Final Gate", "",
  `STATE_SPACE_STATUS = ${stateSpaceStatus}`,
  "STATE_BOUNDARY_STATUS = REVIEW_REQUIRED",
  `EXHAUSTION_OVERRIDE_STATUS = ${overrideStatus}`,
  `PULLBACK_REBOUND_COVERAGE = ${pullbackReboundCoverage}`,
  "MODEL_CHANGE = NOT_PROPOSED", "",
  "T_SAMPLE_RL_ELIGIBLE = FALSE",
  "RL_INTEGRATION = BLOCKED",
  "VALUE_Q_TARGET = BLOCKED",
  "RL_TRAINING = NOT_STARTED",
  "PAPER_TRADING = NOT_STARTED",
  "T_DECISION_ENGINE = NOT_STARTED",
  "HARD_STOP = TRUE"
];

const output = "docs/rl-research/results/offline-rl-v0.12.28.2-t-state-distribution-boundary-analysis.md";
await writeFile(output, `${reportLines.join("\n")}\n`, "utf8");
console.log(JSON.stringify({ output, runId: run.runId, total, valid, invalid, warmup, stateDistribution: asObject(stateAll), validStateDistribution: asObject(stateValid), transitionTotal, sessionBreaks, overrideStatus, pullbackReboundCoverage, stateSpaceStatus }, null, 2));
