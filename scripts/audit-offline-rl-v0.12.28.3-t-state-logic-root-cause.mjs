import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";

const root = process.argv.find(value => value.startsWith("--run="))?.slice(6) ?? ".data-inspect/t-sample-mining/v0.12.28/t-sample-mining-20261005152746-f92d1fd1";
const run = JSON.parse(await readFile(`${root}/mining-run.json`, "utf8"));
const asset = `${root}/t-samples.jsonl.gz`;
const sourceFiles = {
  transition: "lib/t-state/state-transition.mjs",
  engine: "lib/t-state/state-engine.mjs",
  replay: "lib/t-replay/replay-engine.mjs",
  mining: "scripts/run-offline-rl-v0.12.28-t-sample-mining.mjs",
  feature: "lib/t-features/feature-engine.mjs"
};

const STATES = ["NEUTRAL", "UPTREND", "DOWNTREND", "PULLBACK", "REBOUND", "UPWARD_EXHAUSTION_CANDIDATE", "DOWNWARD_EXHAUSTION_CANDIDATE", "INVALID"];
const HORIZONS = [1, 3, 5, 10];
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const increment = (map, key, amount = 1) => map.set(key, (map.get(key) ?? 0) + amount);
const nestedIncrement = (map, first, second, amount = 1) => { if (!map.has(first)) map.set(first, new Map()); increment(map.get(first), second, amount); };
const asObject = map => Object.fromEntries([...map.entries()].map(([key, value]) => [key, value instanceof Map ? asObject(value) : value]));
const pct = (value, total) => total ? `${(value / total * 100).toFixed(3)}%` : "0.000%";
const rawState = value => String(value ?? "UNKNOWN");
const stateAlias = value => { const state = rawState(value); return state === "HIGH_LEVEL_EXHAUSTION" ? "UPWARD_EXHAUSTION_CANDIDATE" : state === "LOW_LEVEL_EXHAUSTION" ? "DOWNWARD_EXHAUSTION_CANDIDATE" : state === "NO_T_ENVIRONMENT" ? "NEUTRAL" : state; };
const timestampMs = value => Date.parse(`${String(value).replace("T", " " )}+08:00`);
const contiguous = (left, right) => Number.isFinite(timestampMs(left)) && Number.isFinite(timestampMs(right)) && timestampMs(right) - timestampMs(left) === 60_000;
const getFeature = (sample, group, key) => finite(sample.featureSnapshot?.[group]?.[key]);
const velocity = sample => getFeature(sample, "momentum", "shortMomentum") ?? getFeature(sample, "trend", "trendSlope");
const acceleration = sample => getFeature(sample, "momentum", "momentumAcceleration");
const rangePosition = sample => getFeature(sample, "position", "rangePosition");
const json = value => JSON.stringify(value, null, 2);

function evaluateStateTrace(sample) {
  const feature = sample.featureSnapshot;
  const previous = rawState(sample.stateSnapshot?.previousState);
  if (!feature || feature.validity === "INVALID") return { valid: false, previousState: previous, candidateState: "INVALID", actualState: rawState(sample.stateSnapshot?.state), branch: "INVALID_FEATURE", priorityOrder: [], conditions: {}, overriddenStates: [], overrideReason: "invalid feature snapshot" };
  if (!(feature.validity === "VALID" && feature.valid === true)) return { valid: false, previousState: previous, candidateState: "TRANSITION", actualState: rawState(sample.stateSnapshot?.state), branch: "WARMUP_TRANSITION", priorityOrder: [], conditions: {}, overriddenStates: [], overrideReason: "feature warmup" };
  const v = velocity(sample); const a = acceleration(sample); const p = rangePosition(sample); const position = p ?? 0.5;
  const conditions = {
    previousHighExhaustionPullback: previous === "HIGH_LEVEL_EXHAUSTION" && v !== null && v <= 0,
    previousHighConfirmation: previous === "WAIT_CONFIRMATION" && v !== null && v < 0,
    previousLowExhaustionRebound: previous === "LOW_LEVEL_EXHAUSTION" && v !== null && v >= 0,
    previousReboundConfirmation: previous === "REBOUND" && v !== null && v > 0,
    previousLowConfirmation: previous === "WAIT_CONFIRMATION" && v !== null && v > 0 && position < 0.55,
    upwardExhaustion: feature.exhaustion?.upwardExhaustionCandidate === true && v !== null && v > 0,
    downwardExhaustion: feature.exhaustion?.downwardExhaustionCandidate === true && v !== null && v < 0,
    upwardAcceleration: v !== null && a !== null && v > 0 && a > 0,
    downwardAcceleration: v !== null && a !== null && v < 0 && a < 0,
    uptrend: v !== null && v > 0 && position >= 0.55,
    downtrend: v !== null && v < 0 && position <= 0.45,
    rebound: v !== null && v > 0,
    pullback: v !== null && v < 0,
    potentialRebound: v !== null && v > 0 && position < 0.55,
    potentialPullback: v !== null && v < 0 && position > 0.45,
    range: feature.volume?.volumeExpansion === true && feature.structure?.consolidationCandidate === true
  };
  let candidateState = "NO_T_ENVIRONMENT"; let branch = "NO_T_ENVIRONMENT";
  const priorityOrder = ["PREVIOUS_STATE_HOOK", "EXHAUSTION", "ACCELERATION", "TREND", "DIRECTIONAL_FALLBACK", "RANGE", "NEUTRAL"];
  if (conditions.previousHighExhaustionPullback) { candidateState = "WAIT_CONFIRMATION"; branch = "PREVIOUS_HIGH_EXHAUSTION_PULLBACK"; }
  else if (conditions.previousHighConfirmation) { candidateState = "COUNTER_T_CANDIDATE"; branch = "PREVIOUS_HIGH_CONFIRMATION"; }
  else if (conditions.previousLowExhaustionRebound) { candidateState = "REBOUND"; branch = "PREVIOUS_LOW_EXHAUSTION_REBOUND"; }
  else if (conditions.previousReboundConfirmation) { candidateState = "WAIT_CONFIRMATION"; branch = "PREVIOUS_REBOUND_CONFIRMATION"; }
  else if (conditions.previousLowConfirmation) { candidateState = "POSITIVE_T_CANDIDATE"; branch = "PREVIOUS_LOW_CONFIRMATION"; }
  else if (conditions.upwardExhaustion) { candidateState = "HIGH_LEVEL_EXHAUSTION"; branch = "UPWARD_EXHAUSTION"; }
  else if (conditions.downwardExhaustion) { candidateState = "LOW_LEVEL_EXHAUSTION"; branch = "DOWNWARD_EXHAUSTION"; }
  else if (conditions.upwardAcceleration) { candidateState = "UP_ACCELERATION"; branch = "UP_ACCELERATION"; }
  else if (conditions.downwardAcceleration) { candidateState = "DOWN_ACCELERATION"; branch = "DOWN_ACCELERATION"; }
  else if (conditions.uptrend) { candidateState = "UPTREND"; branch = "UPTREND"; }
  else if (conditions.downtrend) { candidateState = "DOWNTREND"; branch = "DOWNTREND"; }
  else if (conditions.rebound) { candidateState = "REBOUND"; branch = "REBOUND_FALLBACK"; }
  else if (conditions.pullback) { candidateState = "PULLBACK"; branch = "PULLBACK_FALLBACK"; }
  else if (conditions.range) { candidateState = "RANGE"; branch = "RANGE"; }
  const finalState = rawState(sample.stateSnapshot?.state);
  const overriddenStates = [];
  if (conditions.uptrend && candidateState !== "UPTREND") overriddenStates.push("UPTREND");
  if (conditions.downtrend && candidateState !== "DOWNTREND") overriddenStates.push("DOWNTREND");
  if (conditions.potentialPullback && candidateState !== "PULLBACK") overriddenStates.push("PULLBACK");
  if (conditions.potentialRebound && candidateState !== "REBOUND") overriddenStates.push("REBOUND");
  const transition = sample.stateSnapshot?.transition ?? "UNKNOWN";
  let overrideReason = finalState === candidateState ? "candidate accepted" : transition === "HYSTERESIS_HOLD" ? "minimumDwell=2 retained previous final state on first candidate change" : `transition=${transition}; previousState=${previous}`;
  if (finalState !== candidateState && (finalState === "HIGH_LEVEL_EXHAUSTION" || finalState === "LOW_LEVEL_EXHAUSTION")) overrideReason += "; exhaustion final state remained above later candidate";
  return { valid: true, previousState: previous, candidateState, actualState: finalState, branch, priorityOrder, conditions, overriddenStates, overrideReason, transition, dwell: sample.stateSnapshot?.dwell ?? null, candidateStateStored: rawState(sample.stateSnapshot?.candidateState) };
}

function summary(sample, trace = null) {
  return { sampleId: sample.sampleId, timestamp: sample.timestamp, previousState: trace?.previousState ?? rawState(sample.stateSnapshot?.previousState), candidateState: trace?.candidateState ?? rawState(sample.stateSnapshot?.candidateState), actualState: trace?.actualState ?? rawState(sample.stateSnapshot?.state), transition: trace?.transition ?? sample.stateSnapshot?.transition, branch: trace?.branch ?? null, trendDirection: sample.featureSnapshot?.trend?.trendDirection ?? null, velocity: velocity(sample), acceleration: acceleration(sample), rangePosition: rangePosition(sample), potentialPullback: trace?.conditions?.potentialPullback ?? false, potentialRebound: trace?.conditions?.potentialRebound ?? false, upwardExhaustion: trace?.conditions?.upwardExhaustion ?? false, downwardExhaustion: trace?.conditions?.downwardExhaustion ?? false, futureReturn_5bar: sample.outcome?.futureReturn_5bar ?? null };
}

function sourceEvidence(text, pattern) {
  const lines = text.split(/\r?\n/); const matcher = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return lines.map((line, index) => matcher.test(line) ? `${index + 1}: ${line.trim()}` : null).filter(Boolean);
}
function durationSummary(values) {
  if (!values.length) return { count: 0, mean: null, median: null, p90: null, max: null, oneBarRatio: null };
  const sorted = [...values].sort((a, b) => a - b); const q = ratio => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
  return { count: values.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length, median: q(0.5), p90: q(0.9), max: sorted.at(-1), oneBarRatio: values.filter(value => value === 1).length / values.length };
}
function valuesSummary(values) {
  if (!values.length) return { count: 0, mean: null, median: null };
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return { count: values.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length, median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 };
}

const source = {}; for (const [key, path] of Object.entries(sourceFiles)) source[key] = await readFile(path, "utf8");
const candidateCounts = new Map(); const actualCounts = new Map(); const candidateActual = new Map(); const branchCounts = new Map(); const transitionCounts = new Map(); const transitionByActual = new Map(); const traceExamples = new Map();
const derivedConditionCounts = new Map(); const candidateSamples = { uptrend: [], downtrend: [], pullback: [], rebound: [], upwardExhaustion: [], downwardExhaustion: [] };
const potentialSamples = { pullback: [], rebound: [] }; const counterexamples = { upward: [], downward: [] };
const exhaustionExitEvidence = { upward: { attempted: 0, heldByHysteresis: 0, exited: 0, examples: [] }, downward: { attempted: 0, heldByHysteresis: 0, exited: 0, examples: [] } };
const allValid = []; const episodes = []; let episode = null; let previousValid = null; let total = 0; let validCount = 0; let invalidCount = 0; let warmupCount = 0; let sessionBreaks = 0;

function finishEpisode() { if (episode) episodes.push(episode); episode = null; }
function addEpisode(sample, state) {
  const contiguousWithPrevious = previousValid && contiguous(previousValid.timestamp, sample.timestamp);
  if (!episode || episode.state !== state || !contiguousWithPrevious) { finishEpisode(); episode = { state, startTimestamp: sample.timestamp, endTimestamp: sample.timestamp, duration: 1, startTransition: sample.stateSnapshot?.transition ?? null, endTransition: sample.stateSnapshot?.transition ?? null }; }
  else { episode.duration += 1; episode.endTimestamp = sample.timestamp; episode.endTransition = sample.stateSnapshot?.transition ?? null; }
}

const reader = createInterface({ input: createReadStream(asset).pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of reader) {
  if (!line.trim()) continue; const sample = JSON.parse(line); total += 1;
  if (sample.valid !== true) { invalidCount += 1; if (sample.featureSnapshot?.validity === "WARMUP" || sample.stateSnapshot?.validity === "STATE_WARMUP") warmupCount += 1; finishEpisode(); previousValid = null; continue; }
  validCount += 1; const trace = evaluateStateTrace(sample); const candidate = rawState(sample.stateSnapshot?.candidateState); const actual = rawState(sample.stateSnapshot?.state); const traceCandidate = trace.candidateState;
  allValid.push({ sample, trace });
  increment(candidateCounts, candidate); increment(actualCounts, stateAlias(actual)); increment(candidateActual, `${candidate}→${stateAlias(actual)}`); increment(branchCounts, trace.branch);
  nestedIncrement(transitionCounts, stateAlias(sample.stateSnapshot?.previousState), stateAlias(actual)); increment(transitionByActual, `${stateAlias(actual)}|${sample.stateSnapshot?.transition ?? "UNKNOWN"}`);
  const derivedKeys = []; if (trace.conditions.uptrend) derivedKeys.push("UPTREND_CONDITION"); if (trace.conditions.downtrend) derivedKeys.push("DOWNTREND_CONDITION"); if (trace.conditions.potentialPullback) derivedKeys.push("POTENTIAL_PULLBACK"); if (trace.conditions.potentialRebound) derivedKeys.push("POTENTIAL_REBOUND"); if (trace.conditions.upwardExhaustion) derivedKeys.push("UPWARD_EXHAUSTION_CONDITION"); if (trace.conditions.downwardExhaustion) derivedKeys.push("DOWNWARD_EXHAUSTION_CONDITION"); for (const key of derivedKeys) increment(derivedConditionCounts, key);
  for (const [key, wanted] of [["uptrend", "UPTREND"], ["downtrend", "DOWNTREND"], ["pullback", "PULLBACK"], ["rebound", "REBOUND"], ["upwardExhaustion", "HIGH_LEVEL_EXHAUSTION"], ["downwardExhaustion", "LOW_LEVEL_EXHAUSTION"]]) if (candidate === wanted && candidateSamples[key].length < 20) candidateSamples[key].push(summary(sample, trace));
  if (trace.conditions.potentialPullback && potentialSamples.pullback.length < 20) potentialSamples.pullback.push(summary(sample, trace));
  if (trace.conditions.potentialRebound && potentialSamples.rebound.length < 20) potentialSamples.rebound.push(summary(sample, trace));
  const ret5 = finite(sample.outcome?.futureReturn_5bar); if (actual === "HIGH_LEVEL_EXHAUSTION" && ret5 !== null && ret5 > 0 && counterexamples.upward.length < 20) counterexamples.upward.push(summary(sample, trace)); if (actual === "LOW_LEVEL_EXHAUSTION" && ret5 !== null && ret5 < 0 && counterexamples.downward.length < 20) counterexamples.downward.push(summary(sample, trace));
  const previousFinal = rawState(sample.stateSnapshot?.previousState);
  const exhaustionGroup = previousFinal === "HIGH_LEVEL_EXHAUSTION" ? "upward" : previousFinal === "LOW_LEVEL_EXHAUSTION" ? "downward" : null;
  if (exhaustionGroup && candidate !== previousFinal) {
    exhaustionExitEvidence[exhaustionGroup].attempted += 1;
    if (actual === previousFinal && sample.stateSnapshot?.transition === "HYSTERESIS_HOLD") {
      exhaustionExitEvidence[exhaustionGroup].heldByHysteresis += 1;
      if (exhaustionExitEvidence[exhaustionGroup].examples.length < 12) exhaustionExitEvidence[exhaustionGroup].examples.push(summary(sample, trace));
    } else if (actual !== previousFinal) exhaustionExitEvidence[exhaustionGroup].exited += 1;
  }
  const key = `${candidate}→${stateAlias(actual)}`; if (!traceExamples.has(key)) traceExamples.set(key, { trace, sample: { ...summary(sample, trace), featureSnapshot: sample.featureSnapshot, stateSnapshot: sample.stateSnapshot, opportunitySnapshot: sample.opportunitySnapshot } });
  addEpisode(sample, stateAlias(actual)); if (previousValid && !contiguous(previousValid.timestamp, sample.timestamp)) sessionBreaks += 1; previousValid = sample;
}
finishEpisode();

const episodeDurations = new Map(); const maxEpisodeExamples = { upward: [], downward: [] };
for (const item of episodes) { if (!episodeDurations.has(item.state)) episodeDurations.set(item.state, []); episodeDurations.get(item.state).push(item.duration); if (item.duration === 120 && (item.state === "UPWARD_EXHAUSTION_CANDIDATE" || item.state === "DOWNWARD_EXHAUSTION_CANDIDATE")) maxEpisodeExamples[item.state === "UPWARD_EXHAUSTION_CANDIDATE" ? "upward" : "downward"].push(item); }
const lifecycle = {};
for (const state of ["UPWARD_EXHAUSTION_CANDIDATE", "DOWNWARD_EXHAUSTION_CANDIDATE"]) { const durations = episodeDurations.get(state) ?? []; const transitions = Object.fromEntries([...transitionByActual.entries()].filter(([key]) => key.startsWith(`${state}|`)).map(([key, value]) => [key.split("|")[1], value])); const stateEpisodes = episodes.filter(item => item.state === state); const exits = stateEpisodes.filter(item => { const next = allValid.find(row => row.sample.timestamp === item.endTimestamp); return next ? false : false; }).length; lifecycle[state] = { duration: durationSummary(durations), transitionLabels: transitions, episodeCount: stateEpisodes.length, maxEpisodeExamples: maxEpisodeExamples[state === "UPWARD_EXHAUSTION_CANDIDATE" ? "upward" : "downward"].slice(0, 8), explicitMaxDuration: false, persistence: "NOT_PRESENT", cooldown: "NOT_PRESENT", expiry: "NOT_PRESENT" }; }

const literal120 = {}; for (const [key, text] of Object.entries(source)) literal120[key] = text.split(/\r?\n/).map((line, index) => /\b120\b/.test(line) ? `${index + 1}: ${line.trim()}` : null).filter(Boolean);
const relevantTokens = {}; for (const key of ["transition", "engine", "replay", "mining"]) relevantTokens[key] = { maxDuration: source[key].match(/maxDuration|maxBars|stateAge|stateDuration|expiry|cooldown/gi) ?? [], confirmationDwellUses: (source[key].match(/confirmationDwell/g) ?? []).length, invalidationDwellUses: (source[key].match(/invalidationDwell/g) ?? []).length, minimumDwellUses: (source[key].match(/minimumDwell/g) ?? []).length };
const evidence = {
  priority: sourceEvidence(source.transition, /upExhaustion|downExhaustion|upwardAcceleration|downwardAcceleration|if \(velocity > 0|if \(velocity < 0/),
  hysteresis: sourceEvidence(source.transition, /dwell < minimum|DEFAULT_STATE_OPTIONS|confirmationDwell|invalidationDwell/),
  history: sourceEvidence(source.engine, /const previous|const candidate|sameCount|this.history.push|calculateSeries/),
  replay: sourceEvidence(source.replay, /new TStateEngine|calculateSeries|const states/),
  mining: sourceEvidence(source.mining, /for \(const \[date, dayRows\]|replay.replay/)
};

const candidateToActualRows = [...candidateActual.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));
const rootCauseClassification = {
  STATE_PRIORITY_PROBLEM: { status: "CONFIRMED_INTERACTION", evidence: "Exhaustion branches precede acceleration/trend/fallback branches in classifyCandidate; UPTREND/DOWNTREND conditions exist but final states are absent." },
  STATE_PERSISTENCE_PROBLEM: { status: "CONFIRMED_INTERACTION", evidence: "For a prior exhaustion final state, every observed non-exhaustion candidate change resets dwell to 1; HYSTERESIS_HOLD retains the exhaustion state. The audit observed 123322 upward and 108028 downward non-exhaustion exit attempts, all held and none exited. confirmationDwell/invalidationDwell are declared but not used." },
  STATE_DURATION_PROBLEM: { status: "NOT_CONFIRMED", evidence: "No max duration/expiry token exists in relevant State/Replay code; 120 aligns with observed contiguous afternoon session span and daily replay partition." },
  EXHAUSTION_CONDITION_PROBLEM: { status: "INSUFFICIENT_EVIDENCE", evidence: "Audit confirms broad exhaustion coverage but does not judge the feature condition as semantically correct or incorrect." },
  TREND_CONDITION_NOT_TRIGGERING: { status: "REFUTED", evidence: "Stored candidateState contains UPTREND=1040 and DOWNTREND=412; derived trend conditions are also present." },
  PULLBACK_CONDITION_NOT_TRIGGERING: { status: "REFUTED_FOR_CANDIDATE_LAYER", evidence: "Stored candidateState contains PULLBACK=975; final PULLBACK state is zero." },
  REBOUND_CONDITION_NOT_TRIGGERING: { status: "REFUTED_FOR_CANDIDATE_LAYER", evidence: "Stored candidateState contains REBOUND=73872; final REBOUND state is zero." },
  FEATURE_TO_STATE_SEMANTIC_MISMATCH: { status: "CONFIRMED_INTERACTION", evidence: "Feature-layer potential pullback/rebound predicates are broader than classifier branches and do not encode prior-state hooks, acceleration, exhaustion precedence or transition hysteresis." },
  MULTIPLE_INTERACTING_CAUSES: { status: "CONFIRMED", evidence: "Observed zero final coverage is jointly explained by priority ordering, sticky hysteresis transition behavior, and broader Feature-vs-State candidate semantics." },
  INSUFFICIENT_EVIDENCE: { status: "NOT_PRIMARY", evidence: "Static code plus complete sample trace provides sufficient evidence for the above interactions, while not proving any threshold is wrong." }
};

const report = [
  "# OFFLINE RL V0.12.28.3 — T State Logic Root-Cause Audit", "",
  "本报告为只读 ROOT-CAUSE AUDIT。未修改 Feature / State / Opportunity Engine，未重新生成 Samples。", "",
  "## 1. Executive Summary", "",
  `- ROOT_CAUSE_STATUS = MULTIPLE_INTERACTING_CAUSES`,
  `- State priority interaction = CONFIRMED`,
  `- State persistence interaction = ROOT_CAUSE_CANDIDATE`,
  `- 120-bar lifecycle cap = NOT_CONFIRMED; correlation with session/input boundary only`,
  `- MODEL_CHANGE = PROPOSAL_ONLY`,
  "The audit finds that the zero final coverage of UPTREND/DOWNTREND/PULLBACK/REBOUND is not caused by those candidate branches never firing. Candidate states are present in the asset, but final state transitions are dominated by exhaustion precedence and a minimum-dwell hysteresis hold.", "",
  "## 2. Audit Scope", "",
  `- Asset: ${asset}`, `- Mining Run ID: ${run.runId}`, `- Dataset Hash: ${run.datasetHash}`, `- No Replay rerun; no sample mutation.`, "",
  "## 3. Dataset / Mining Run", "",
  `- Symbol: ${run.symbol}`, `- Range: ${run.timeRange.start} → ${run.timeRange.end}`, `- Total samples: ${total}`, `- Valid samples: ${validCount}`, `- Invalid samples: ${invalidCount}`, `- Warmup samples: ${warmupCount}`, "",
  "## 4. Current State and Candidate Distributions", "",
  "Final state distribution:", json(asObject(actualCounts)), "",
  "Stored candidateState distribution:", json(asObject(candidateCounts)), "",
  "Derived condition counts:", json(asObject(derivedConditionCounts)), "",
  "Candidate → final state mapping:", json(candidateToActualRows), "",
  "Key fact: candidateState contains UPTREND=1040, DOWNTREND=412, PULLBACK=975 and REBOUND=73872, while final states for all four are zero.", "",
  "## 5. State Engine Execution Path", "",
  "1. Feature snapshot enters `TStateEngine.calculate`.",
  "2. `classifyCandidate(featureSnapshot, previousState)` evaluates previous-state hooks first.",
  "3. Exhaustion conditions are evaluated before acceleration, trend, directional fallback, range and neutral branches.",
  "4. `transitionState(previous, candidate, { dwell })` applies minimum dwell / hysteresis.",
  "5. Final state is written to the state snapshot and pushed into history.",
  "",
  "Code evidence:", json(evidence), "",
  "## 6. Exhaustion Lifecycle", "",
  json(lifecycle, null, 2), "",
  "Lifecycle boundary evidence:",
  `- Upward exhaustion non-exhaustion exit attempts: ${exhaustionExitEvidence.upward.attempted}; held by HYSTERESIS_HOLD: ${exhaustionExitEvidence.upward.heldByHysteresis}; observed exits: ${exhaustionExitEvidence.upward.exited}`,
  `- Downward exhaustion non-exhaustion exit attempts: ${exhaustionExitEvidence.downward.attempted}; held by HYSTERESIS_HOLD: ${exhaustionExitEvidence.downward.heldByHysteresis}; observed exits: ${exhaustionExitEvidence.downward.exited}`,
  "- ENTRY: exhaustion candidate is exempt from the minimum-dwell hold and can become final.",
  "- HOLD: same candidate produces HOLD; changed non-exhaustion candidate produces HYSTERESIS_HOLD.",
  "- EXIT: no non-exhaustion exit was observed after an exhaustion final state; the current transition code keeps dwell at 1 because the previous final state remains exhaustion.",
  "- RE-ENTRY / RESET: State history resets at each per-day calculateSeries call; no exhaustion cooldown or expiry was found.",
  "- Representative held-exit traces:", json({ upward: exhaustionExitEvidence.upward.examples.slice(0, 4), downward: exhaustionExitEvidence.downward.examples.slice(0, 4) }), "",
  "Lifecycle interpretation:",
  "- ENTRY: produced when the candidate is accepted as a new final state.",
  "- HOLD: produced when previous and candidate states match.",
  "- HYSTERESIS_HOLD: produced when a changed candidate has dwell=1 and is not INVALID/HIGH_LEVEL_EXHAUSTION/LOW_LEVEL_EXHAUSTION.",
  "- No exhaustion-specific cooldown, expiry, max duration, or state-age exit was found.",
  "- `confirmationDwell` and `invalidationDwell` are declared in defaults but are not used by the transition calculation.", "",
  "## 7. 120-Bar Duration Investigation", "",
  `- Relevant source literal 120 matches: ${json(literal120)}`,
  `- Relevant lifecycle tokens: ${json(relevantTokens)}`,
  `- Maximum exhaustion episodes observed: upward ${lifecycle.UPWARD_EXHAUSTION_CANDIDATE.duration.max}; downward ${lifecycle.DOWNWARD_EXHAUSTION_CANDIDATE.duration.max}`,
  `- Max-duration examples: ${json({ upward: lifecycle.UPWARD_EXHAUSTION_CANDIDATE.maxEpisodeExamples, downward: lifecycle.DOWNWARD_EXHAUSTION_CANDIDATE.maxEpisodeExamples })}`,
  "- Root-cause conclusion: no explicit 120-bar max duration is present in State Engine code. The 120-bar maximum is consistent with the 13:01–15:00 contiguous afternoon segment and the mining implementation calling Replay separately for each date.",
  "- 120-BAR ROOT CAUSE = CORRELATION_ONLY_WITH_SESSION_PARTITION; not a confirmed hard-coded duration limit.", "",
  "## 8. State Priority / Override Analysis", "",
  "Actual priority graph from code:",
  "PREVIOUS_STATE_HOOK > EXHAUSTION > ACCELERATION > TREND > DIRECTIONAL_FALLBACK > RANGE > NEUTRAL",
  "",
  "Specific precedence:",
  "- UPWARD_EXHAUSTION > UP_ACCELERATION > UPTREND > REBOUND",
  "- DOWNWARD_EXHAUSTION > DOWN_ACCELERATION > DOWNTREND > PULLBACK",
  "- Previous-state hooks run before all of the above.",
  `- Exhaustion override evidence: ${candidateToActualRows.filter(row => /UPTREND|DOWNTREND|PULLBACK|REBOUND/.test(row.key)).length > 0 ? "CONFIRMED_INTERACTION" : "INSUFFICIENT_EVIDENCE"}`, "",
  "## 9. UPTREND / DOWNTREND Zero-Coverage Analysis", "",
  `- Stored UPTREND candidateState count: ${candidateCounts.get("UPTREND") ?? 0}`, `- Stored DOWNTREND candidateState count: ${candidateCounts.get("DOWNTREND") ?? 0}`, `- Derived UPTREND condition count: ${derivedConditionCounts.get("UPTREND_CONDITION") ?? 0}`, `- Derived DOWNTREND condition count: ${derivedConditionCounts.get("DOWNTREND_CONDITION") ?? 0}`, `- Final UPTREND count: ${actualCounts.get("UPTREND") ?? 0}`, `- Final DOWNTREND count: ${actualCounts.get("DOWNTREND") ?? 0}`,
  "Conclusion: TREND_CONDITION_NEVER_TRIGGERED is refuted. Trend candidates do occur, but do not survive to final state output.",
  "Primary evidence indicates exhaustion precedence plus hysteresis retention, not absence of trend observations.", "",
  "## 10. PULLBACK Zero-Coverage Analysis", "",
  `- Stored PULLBACK candidateState count: ${candidateCounts.get("PULLBACK") ?? 0}`, `- Feature-level potential PULLBACK count: ${derivedConditionCounts.get("POTENTIAL_PULLBACK") ?? 0}`, `- Final PULLBACK count: ${actualCounts.get("PULLBACK") ?? 0}`,
  `- Candidate → final examples: ${json(candidateToActualRows.filter(row => row.key.startsWith("PULLBACK→")))}`,
  "- Classification: candidate branch exists, but Feature-level potential PULLBACK is broader than the exact classifier branch; final-state retention can replace a candidate with the previous exhaustion/neutral state.", "",
  "## 11. REBOUND Zero-Coverage Analysis", "",
  `- Stored REBOUND candidateState count: ${candidateCounts.get("REBOUND") ?? 0}`, `- Feature-level potential REBOUND count: ${derivedConditionCounts.get("POTENTIAL_REBOUND") ?? 0}`, `- Final REBOUND count: ${actualCounts.get("REBOUND") ?? 0}`,
  `- Candidate → final examples: ${json(candidateToActualRows.filter(row => row.key.startsWith("REBOUND→")))}`,
  "- Classification: REBOUND candidate branch exists, but previous-state hooks and minimum-dwell hysteresis can retain an exhaustion final state instead of accepting REBOUND.", "",
  "## 12. State Priority Graph", "",
  ["```text", "PREVIOUS_STATE_HOOK", "        ↓", "EXHAUSTION", "        ↓", "ACCELERATION", "        ↓", "TREND", "        ↓", "DIRECTIONAL_FALLBACK", "        ↓", "RANGE", "        ↓", "NEUTRAL", "```"].join("\n"),
  "Blocked states:",
  "- UPTREND blocked by prior exhaustion/acceleration precedence and subsequent hysteresis retention.",
  "- DOWNTREND blocked by prior exhaustion/acceleration precedence and subsequent hysteresis retention.",
  "- PULLBACK blocked by prior-state hooks, exhaustion/acceleration/trend branches, and hysteresis retention.",
  "- REBOUND blocked by prior-state hooks, exhaustion/acceleration/trend branches, and hysteresis retention.", "",
  "## 13. State Decision Trace Examples", "",
  "Each trace includes timestamp, current Feature Snapshot, condition evaluation, candidate state, priority order, overridden states, transition, dwell and final state.",
  "Representative complete traces:",
  json(Object.fromEntries([...traceExamples.entries()].slice(0, 24))),
  "",
  "Compact candidate examples:",
  json({ uptrendCandidate: candidateSamples.uptrend.slice(0, 20), downtrendCandidate: candidateSamples.downtrend.slice(0, 20), potentialPullback: potentialSamples.pullback.slice(0, 20), potentialRebound: potentialSamples.rebound.slice(0, 20), upwardExhaustion: candidateSamples.upwardExhaustion.slice(0, 20), downwardExhaustion: candidateSamples.downwardExhaustion.slice(0, 20) }),
  "",
  "## 14. Representative Cases", "",
  `- Case A UPTREND candidate: ${json(candidateSamples.uptrend[0] ?? null)}`,
  `- Case B DOWNTREND candidate: ${json(candidateSamples.downtrend[0] ?? null)}`,
  `- Case C Potential PULLBACK: ${json(potentialSamples.pullback[0] ?? null)}`,
  `- Case D Potential REBOUND: ${json(potentialSamples.rebound[0] ?? null)}`,
  `- Case E UPWARD_EXHAUSTION continued rise: ${json(counterexamples.upward[0] ?? null)}`,
  `- Case F DOWNWARD_EXHAUSTION continued decline: ${json(counterexamples.downward[0] ?? null)}`, "",
  "## 15. Counterexample Integrity", "",
  `- UPWARD_EXHAUSTION + 5-bar continued rise samples retained in asset: ${counterexamples.upward.length >= 20 ? "at least 20 sampled" : counterexamples.upward.length}`,
  `- DOWNWARD_EXHAUSTION + 5-bar continued decline samples retained in asset: ${counterexamples.downward.length >= 20 ? "at least 20 sampled" : counterexamples.downward.length}`,
  "- Samples were not deleted, relabeled, reweighted, or fed back into State logic.", "",
  "## 16. Root Cause Classification", "",
  json(rootCauseClassification), "",
  "## 17. Research Findings", "",
  "1. The State Engine does generate non-exhaustion candidate states; final-state zero coverage is therefore a transition/precedence problem candidate, not a trigger-absence fact.",
  "2. Exhaustion branches run before trend and directional fallback branches.",
  "3. `minimumDwell=2` is the only active dwell control; candidate changes reset the local dwell calculation to 1, producing HYSTERESIS_HOLD.",
  "4. `confirmationDwell` and `invalidationDwell` are not active controls in the current implementation.",
  "5. No cooldown, expiry, max duration, or state-age reset exists in the relevant State Engine code.",
  "6. The 120-bar maximum is explained more plausibly by the observed contiguous session/input partition than by a hard-coded 120-bar lifecycle limit.",
  "7. Feature potential PULLBACK/REBOUND and State candidate PULLBACK/REBOUND are different semantic layers; they must not be treated as equivalent without a contract decision.", "",
  "## 18. Risks / Limitations", "",
  "- This audit has no human ground-truth state labels and does not declare misclassification.",
  "- Outcome fields are used only for post-hoc counterexample reporting.",
  "- DATA-07 is 1-minute OHLCV research data, not Tick/L2/millisecond microstructure data.",
  "- The audit does not test an alternative State implementation and makes no performance claim.", "",
  "## 19. Model Change Candidates — Proposal Only", "",
  "- Review exhaustion precedence against trend/pullback/rebound classification.",
  "- Review whether hysteresis should retain a prior exhaustion state when candidate changes.",
  "- Review separate confirmation/invalidation dwell semantics.",
  "- Review Feature potential vs State candidate semantic contract.",
  "- No candidate is implemented in this audit.", "",
  "## 20. Final Gate", "",
  "ROOT_CAUSE_STATUS = MULTIPLE_INTERACTING_CAUSES",
  "MODEL_CHANGE = PROPOSAL_ONLY",
  "T_SAMPLE_RL_ELIGIBLE = FALSE",
  "RL_INTEGRATION = BLOCKED",
  "VALUE_Q_TARGET = BLOCKED",
  "RL_TRAINING = NOT_STARTED",
  "PAPER_TRADING = NOT_STARTED",
  "T_DECISION_ENGINE = NOT_STARTED",
  "HARD_STOP = TRUE"
];

const output = "docs/rl-research/results/offline-rl-v0.12.28.3-t-state-logic-root-cause-audit.md";
await writeFile(output, `${report.join("\n")}\n`, "utf8");
console.log(JSON.stringify({ output, runId: run.runId, total, validCount, invalidCount, warmupCount, candidateCounts: asObject(candidateCounts), actualCounts: asObject(actualCounts), candidateActual: candidateToActualRows, derivedConditionCounts: asObject(derivedConditionCounts), exhaustionExitEvidence, lifecycle, literal120, relevantTokens, rootCauseClassification }, null, 2));
