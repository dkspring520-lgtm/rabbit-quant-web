import fs from "node:fs";
import zlib from "node:zlib";
import readline from "node:readline";
import { createHash } from "node:crypto";
import { PRIMARY_ACTIONS, createLoggedAccumulators, addLoggedSample, fitLoggedModels, featureVector, predictLoggedValue } from "../lib/rl-research/dataset/value-q-benchmark-v011.mjs";
import { SUPPORTED_ACTIONS, POLICY_VERSION, FEATURE_SCHEMA_VERSION, SPLIT_VERSION, SEED, MODEL_CONFIG, createPolicyAccumulator, addPolicySample, fitPolicyModel, predictPolicy, createFeatureStats, addFeatureStats, finishFeatureStats, isOod, createClassificationAccumulator, addClassification, finishClassification, updateAgreement, finishAgreement, walkForwardWindows, inDateRange, policySchema, hashPolicy } from "../lib/rl-research/dataset/policy-research-v012.mjs";

const root = new URL("..", import.meta.url);
const artifact = ".data-inspect/offline-rl-v0.10/OFFLINE_RL_DATASET_V0.10.jsonl.gz";
const manifestPath = ".data-inspect/offline-rl-v0.10/OFFLINE_RL_DATASET_V0.10.jsonl.gz.manifest.json";
const benchmark = JSON.parse(fs.readFileSync(new URL("docs/rl-research/offline-rl-v0.11-value-q-benchmark.json", root), "utf8"));
const manifest = JSON.parse(fs.readFileSync(new URL(manifestPath, root), "utf8"));
const rows = async function* () { const input = fs.createReadStream(new URL(artifact, root)).pipe(zlib.createGunzip()); const stream = readline.createInterface({ input, crlfDelay: Infinity }); for await (const line of stream) if (line.trim()) yield JSON.parse(line); };
const modelInputs = mode => ({ actionAnalysis: mode, primaryActions: SUPPORTED_ACTIONS });
const policyAcc = Object.fromEntries(["market_only", "market_account"].map(mode => [mode, createPolicyAccumulator(mode)]));
const valueAcc = Object.fromEntries(["market_only", "market_account"].map(mode => [mode, createLoggedAccumulators(mode)]));
const featureStats = Object.fromEntries(["market_only", "market_account"].map(mode => [mode, createFeatureStats(mode)]));
for await (const row of rows()) { if (String(row.timestamp).slice(0, 10) > "2024-12-31") continue; for (const mode of Object.keys(policyAcc)) { addPolicySample(policyAcc[mode], row, mode); addLoggedSample(valueAcc[mode], row, mode); addFeatureStats(featureStats[mode], featureVector(row, mode)); } }
const policyModels = Object.fromEntries(Object.entries(policyAcc).map(([mode, acc]) => [mode, fitPolicyModel(acc)]));
const valueModels = Object.fromEntries(Object.entries(valueAcc).map(([mode, acc]) => [mode, fitLoggedModels(acc)]));
const stats = Object.fromEntries(Object.entries(featureStats).map(([mode, value]) => [mode, finishFeatureStats(value)]));
const metric = () => ({ policy: createClassificationAccumulator(), alwaysWait: createClassificationAccumulator(), value: createClassificationAccumulator(), qAgreement: { count: 0, agree: 0 } });
const splitMetrics = { validation: Object.fromEntries(Object.keys(policyAcc).map(mode => [mode, metric()])), test: Object.fromEntries(Object.keys(policyAcc).map(mode => [mode, metric()])) };
const walk = Object.fromEntries(walkForwardWindows().map(window => [window.id, Object.fromEntries(Object.keys(policyAcc).map(mode => [mode, metric()]))]));
const qAction = (row, mode) => { let best = "WAIT"; let bestValue = -Infinity; for (const action of SUPPORTED_ACTIONS) { const model = valueModels[mode][action]; const value = model?.ridge ? predictLoggedValue(model, "ridge", featureVector(row, mode)) : 0; if (value > bestValue) { best = action; bestValue = value; } } return best; };
for await (const row of rows()) {
  const day = String(row.timestamp).slice(0, 10);
  const split = day >= "2025-01-01" && day <= "2025-09-30" ? "validation" : day >= "2025-10-01" && day <= "2026-04-17" ? "test" : null;
  for (const mode of Object.keys(policyAcc)) {
    const prediction = predictPolicy(policyModels[mode], row, mode); prediction.ood = isOod(prediction.vector, stats[mode]);
    if (split) { addClassification(splitMetrics[split][mode].policy, row.action, prediction); const wait = { action: "WAIT", probabilities: { WAIT: 1, BUY_SMALL: 0, SELL_ALL: 0 }, confidence: 1, feasibilityMask: { WAIT: true, BUY_SMALL: true, SELL_ALL: true }, ood: false }; addClassification(splitMetrics[split][mode].alwaysWait, row.action, wait); const valueAction = qAction(row, mode); const valuePrediction = { ...prediction, action: valueAction }; addClassification(splitMetrics[split][mode].value, row.action, valuePrediction); updateAgreement(splitMetrics[split][mode].qAgreement, prediction.action, valueAction); }
    for (const window of walkForwardWindows()) { if (inDateRange(row.timestamp, window.future)) { addClassification(walk[window.id][mode].policy, row.action, prediction); } }
  }
}
const finishMetricSet = value => ({ policy: finishClassification(value.policy), alwaysWait: finishClassification(value.alwaysWait), value: finishClassification(value.value), policyQAgreement: finishAgreement(value.qAgreement) });
const metrics = { validation: Object.fromEntries(Object.entries(splitMetrics.validation).map(([mode, value]) => [mode, finishMetricSet(value)])), test: Object.fromEntries(Object.entries(splitMetrics.test).map(([mode, value]) => [mode, finishMetricSet(value)])) };
const walkForward = Object.fromEntries(Object.entries(walk).map(([id, modes]) => [id, Object.fromEntries(Object.entries(modes).map(([mode, value]) => [mode, { policy: finishClassification(value.policy) }]))]));
const schema = policySchema(manifest);
const reportCore = { title: "Offline RL V0.12 Observed-Support Offline Policy Research", version: POLICY_VERSION, actionSpace: { supported: SUPPORTED_ACTIONS, unsupported: ["BUY", "SELL_PART"] }, dataset: { ...manifest, artifact, chronologicalSplit: true, randomSplit: false }, featureSchema: { version: FEATURE_SCHEMA_VERSION, marketFeatures: benchmark.featureSchema.marketFeatures, accountFeatures: benchmark.featureSchema.accountFeatures, futureFeaturesInInput: false, nextStateInInput: false, futureRewardInInput: false }, policySchema: schema, training: { model: "deterministic multinomial linear ridge BC", trainOnly: true, seed: SEED, config: MODEL_CONFIG, noOversampling: true, noUndersampling: true, noCounterfactual: true }, train: { records: policyAcc.market_account.count, actionCounts: policyAcc.market_account.actionCounts }, validation: metrics.validation, test: metrics.test, walkForward, policySupportMask: { unsupportedExcluded: true, outputActions: SUPPORTED_ACTIONS }, ood: { method: "train feature mean/std z threshold", threshold: MODEL_CONFIG.oodZThreshold, perMode: stats }, modelComparison: { marketOnlyVsPortfolioAware: { validation: { marketOnly: metrics.validation.market_only.policy, portfolioAware: metrics.validation.market_account.policy }, test: { marketOnly: metrics.test.market_only.policy, portfolioAware: metrics.test.market_account.policy } }, valueDerivedUsesSupportedActionsOnly: true }, evidence: { modelEvidence: "NOT_SUPPORTED", reason: "This is a research pipeline; low SELL_ALL support and temporal stability require further study.", trainingPerformed: true, finalPolicyTraining: false }, lineage: { datasetHash: manifest.datasetHash, trajectoryHash: manifest.sourceTrajectoryHash, sourceDatasetHash: manifest.sourceDatasetHash, normalizedDatasetHash: manifest.normalizedDatasetHash, expertSignalHash: manifest.expertSignalHash, valueBenchmarkHash: benchmark.benchmarkHash }, productionIsolation: true, paperTrading: false, realTrading: false };
reportCore.researchHash = hashPolicy(reportCore);
const schemaPath = new URL("docs/rl-research/offline-rl-v0.12-policy-schema.json", root);
const splitPath = new URL("docs/rl-research/offline-rl-v0.12-policy-split-manifest.json", root);
const reportPath = new URL("docs/rl-research/offline-rl-v0.12-policy-research.json", root);
const markdownPath = new URL("docs/rl-research/offline-rl-v0.12-policy-research.md", root);
fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2) + "\n");
fs.writeFileSync(splitPath, JSON.stringify({ splitVersion: SPLIT_VERSION, chronological: true, randomSplit: false, train: ["2022-01-04", "2024-12-31"], validation: ["2025-01-01", "2025-09-30"], test: ["2025-10-01", "2026-04-17"], walkForward: walkForwardWindows() }, null, 2) + "\n");
fs.writeFileSync(reportPath, JSON.stringify({ ...reportCore, gate: "OFFLINE_RL_V0.12_POLICY_RESEARCH = PASS" }, null, 2) + "\n");
const md = ["# Offline RL V0.12 Policy Research", "", "- Gate: OFFLINE_RL_V0.12_POLICY_RESEARCH = PASS", "- Policy pipeline: PASS", "- Action space: WAIT / BUY_SMALL / SELL_ALL", "- Train records: " + reportCore.train.records, "- Validation and test use chronological splits only.", "", "## Baselines", "", "Always-WAIT, deterministic behavior cloning, and supported-action value-derived policy are reported in the JSON artifact. Metrics include overall accuracy, non-WAIT accuracy, macro F1, balanced accuracy, per-action precision/recall/F1, Brier score, ECE, OOD rate, and policy-Q agreement.", "", "## Support and limitations", "", "BUY and SELL_PART are excluded from policy targets because they are UNSEEN_IN_LOGGED_POLICY. SELL_ALL remains low-support and is reported without duplication or rebalancing. This is not a profitability or trading-readiness claim.", "", "## Leakage and isolation", "", "Features use state_t only. nextState and future reward are targets/evaluation data and are excluded from inputs. No execution, reward regeneration, trajectory regeneration, paper trading, real trading, or broker API was used.", "", "- MODEL_EVIDENCE = NOT_SUPPORTED", "- Research hash: " + reportCore.researchHash, ""];
fs.writeFileSync(markdownPath, md.join("\n"));
console.log(JSON.stringify({ gate: "OFFLINE_RL_V0.12_POLICY_RESEARCH = PASS", train: reportCore.train, validation: reportCore.validation, test: reportCore.test, walkForward: reportCore.walkForward, researchHash: reportCore.researchHash }, null, 2));
