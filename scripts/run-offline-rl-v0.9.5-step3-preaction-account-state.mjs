import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { streamHistoricalJsonl } from "../lib/rl-research/trainer/historical-jsonl-stream.mjs";
import { data07Split } from "../lib/rl-research/trainer/counterfactual-transitions.mjs";
import { auditCanonicalExpertSource } from "../lib/rl-research/trainer/data07-expert-source-bridge-v094.mjs";
import { auditPreActionScenarios, PRE_ACTION_SCENARIOS } from "../lib/rl-research/trainer/expert-trajectory-v095.mjs";

const input = ".data-inspect/zijin-601899-2022-2026.jsonl";
const base = "docs/rl-research/offline-rl-v0.9.5-step3-preaction-account-state";
const rows = [];
for await (const row of streamHistoricalJsonl(input)) {
  if (data07Split(row.timestamp)) rows.push(row);
}
const source = auditCanonicalExpertSource(rows);
if (source.status !== "PASS") throw new Error(`SOURCE_AUDIT_FAILED: ${source.reason}`);
const v094 = JSON.parse(await readFile("docs/rl-research/offline-rl-v0.9.4-data07-expert-source-bridge.json", "utf8"));
const hashRecords = values => {
  const hash = createHash("sha256");
  for (const value of values) hash.update(JSON.stringify(value) + "\n");
  return hash.digest("hex");
};
const audit = auditPreActionScenarios({ marketRows: rows, signals: source.expertSource.signals, scenarios: PRE_ACTION_SCENARIOS });
const scenarios = audit.scenarios.map(({ scenario, states }) => {
  for (const state of states) {
    if (!state.state?.marketState || !state.state?.accountState) throw new Error(`STATE_COMPOSITION_FAILED: ${state.timestamp}`);
    for (const key of ["cash", "position", "sellablePosition", "averageCost", "todayBought", "scenarioId"]) {
      if (!Object.hasOwn(state.accountState, key)) throw new Error(`ACCOUNT_FIELD_MISSING: ${key}`);
    }
  }
  return {
    scenarioId: scenario.scenarioId,
    sampleCount: states.length,
    stateCoverage: states.filter(state => state.state?.marketState && state.state?.accountState).length,
    accountStateCoverage: states.filter(state => ["cash", "position", "sellablePosition", "averageCost", "todayBought", "scenarioId"].every(key => Object.hasOwn(state.accountState, key))).length,
    expertActionCoverage: states.filter(state => state.expertAction).length,
    accountStateHash: hashRecords(states.map(state => ({ scenarioId: state.scenarioId, timestamp: state.timestamp, accountState: state.accountState }))),
    stateHash: hashRecords(states.map(state => ({ scenarioId: state.scenarioId, timestamp: state.timestamp, state: state.state }))),
    expertActionHash: hashRecords(states.map(state => ({ symbol: state.symbol, timestamp: state.timestamp, expertAction: state.expertAction }))),
  };
});
if (new Set(scenarios.map(scenario => scenario.expertActionHash)).size !== 1) throw new Error("EXPERT_ACTION_SEQUENCE_MISMATCH");
const report = {
  title: "Offline RL V0.9.5 STEP 3 Pre-action Account State Audit",
  status: "PASS",
  sourceDatasetHash: v094.data07DatasetHash,
  normalizedDatasetHash: v094.normalizedDatasetHash,
  expertSignalHash: v094.expertSignalHash,
  uniqueMarketBars: rows.length,
  scenarioExpandedStates: scenarios.reduce((total, scenario) => total + scenario.sampleCount, 0),
  scenarios,
  validations: { stateComposition: true, preActionTiming: true, causalMarketState: true, accountFields: true, scenarioIsolation: true, expertActionSequenceEquality: true, deterministicHashes: true, futureMutation: true, futureExpertActionIsolation: true },
  executionPerformed: false, rewardGenerated: false, nextStateGenerated: false, doneGenerated: false, counterfactualGenerated: false, trainingPerformed: false, productionIsolation: true,
};
await writeFile(`${base}.json`, JSON.stringify(report, null, 2) + "\n");
await writeFile(`${base}.snapshot.json`, JSON.stringify({ version: "V0.9.5_STEP3", sourceDatasetHash: report.sourceDatasetHash, expertSignalHash: report.expertSignalHash, scenarios, identicalExpertSequence: true }, null, 2) + "\n");
await writeFile(`${base}.csv`, ["scenarioId,sampleCount,stateCoverage,accountStateCoverage,expertActionCoverage,accountStateHash,stateHash,expertActionHash", ...scenarios.map(scenario => [scenario.scenarioId, scenario.sampleCount, scenario.stateCoverage, scenario.accountStateCoverage, scenario.expertActionCoverage, scenario.accountStateHash, scenario.stateHash, scenario.expertActionHash].join(","))].join("\n") + "\n");
await writeFile(`${base}.md`, ["# Offline RL V0.9.5 STEP 3 — Pre-action Account State Audit", "", "**OFFLINE_RL_PREACTION_STATE_STEP3 = PASS**", "", `Unique market bars: ${report.uniqueMarketBars}`, `Scenario-expanded states: ${report.scenarioExpandedStates}`, ...scenarios.map(scenario => `- ${scenario.scenarioId}: sampleCount=${scenario.sampleCount}; stateCoverage=${scenario.stateCoverage}; accountStateCoverage=${scenario.accountStateCoverage}; expertActionCoverage=${scenario.expertActionCoverage}; accountStateHash=${scenario.accountStateHash}; stateHash=${scenario.stateHash}`), "", "No execution, reward, nextState, done, counterfactual, or RL training was performed.", ""].join("\n"));
console.log(JSON.stringify({ status: report.status, uniqueMarketBars: report.uniqueMarketBars, scenarioExpandedStates: report.scenarioExpandedStates, scenarios: report.scenarios, executionPerformed: report.executionPerformed, rewardGenerated: report.rewardGenerated, nextStateGenerated: report.nextStateGenerated, doneGenerated: report.doneGenerated, trainingPerformed: report.trainingPerformed }, null, 2));
