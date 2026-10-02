import { createReadStream, createWriteStream, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createGzip } from "node:zlib";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { streamHistoricalJsonl } from "../lib/rl-research/trainer/historical-jsonl-stream.mjs";
import { causalMarketStates, evaluateTransitionGroup, hashTransition, data07Split,
  summarizeRegret, TRANSITION_VERSION, TRANSITION_COSTS } from "../lib/rl-research/trainer/counterfactual-transitions.mjs";
import { PRICE_ONLY_STATE_VERSION, PRICE_ONLY_FEATURE_VERSION } from "../lib/rl-research/trainer/price-only-state.mjs";
import { PRICE_ONLY_STREAM_VERSION } from "../lib/rl-research/trainer/price-only-streaming-features.mjs";
import { PORTFOLIO_SCENARIOS, buildPortfolioScenario } from "../lib/rl-research/trainer/portfolio-aware-value.mjs";
import { RL_ACTIONS } from "../lib/rl-research/action/action-space.mjs";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const input = ".data-inspect/zijin-601899-2022-2026.jsonl";
const base = "docs/rl-research/offline-rl-v0.9-counterfactual-transition-dataset";
const artifactDir = ".data-inspect/offline-rl-v0.9";
await mkdir(artifactDir, { recursive: true });
const sourceHash = createHash("sha256").update(await readFile(input)).digest("hex");
const rows = [], sourceEvents = {};
for await (const row of streamHistoricalJsonl(input, { onEvent: e => { sourceEvents[e.type] = (sourceEvents[e.type] ?? 0) + 1; } })) {
  if (data07Split(row.timestamp)) rows.push(row);
}
if (!rows.length) throw new Error("No DATA-07 historical observations");
for (let i = 0; i < rows.length; i++) {
  if (!(Number.isFinite(rows[i].price) && rows[i].price > 0) || (i && rows[i].timestamp <= rows[i - 1].timestamp)) {
    throw new Error(`Invalid price or non-increasing timestamp at ${i}`);
  }
}

// Optional causal ledger. No fabricated cash, portfolio scenario or default WAIT
// is allowed to enter the primary dataset when this ledger is absent.
const ledgerPath = process.argv.find(a => a.startsWith("--accounts="))?.slice("--accounts=".length);
const ledger = new Map();
if (ledgerPath) {
  for await (const line of createInterface({ input: createReadStream(ledgerPath), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const item = JSON.parse(line);
    if (!item.timestamp || !item.symbol || !item.source || !item.asOf || item.asOf > item.timestamp) throw new Error("Ledger requires causal timestamp, symbol, source and asOf");
    const key = `${item.symbol}|${item.timestamp}`;
    if (ledger.has(key)) throw new Error(`Duplicate account snapshot: ${key}`);
    ledger.set(key, item);
  }
}
const ledgerHash = ledgerPath ? createHash("sha256").update(await readFile(ledgerPath)).digest("hex") : null;
const config = { version: TRANSITION_VERSION, horizonBars: 1, episode: "intraday; session/split ends are truncated with unresolved outcomes",
  rewardVersion: "rate-v2", costs: TRANSITION_COSTS, ledgerHash,
  splits: { train: ["2022-01-04", "2024-12-31"], validation: ["2025-01-01", "2025-09-30"], test: ["2025-10-01", "2026-04-17"] } };
const datasetHash = hashTransition({ sourceHash, config });
const csvColumns = ["counterfactualGroupId", "timestamp", "barIndex", "split", "action", "status", "validAction", "filledQuantity", "fillPrice", "fees", "commission", "slippage", "cashAfter", "rewardGross", "rewardNet", "futureReturn", "done", "expertAction", "datasetHash"];
const csvCell = v => v === null || v === undefined ? "" : `"${String(v).replaceAll('"', '""')}"`;

function compressedWriter(filename) {
  const stream = createGzip();
  const completion = pipeline(stream, createWriteStream(filename));
  // Register rejection immediately; await again on close for propagation.
  completion.catch(() => {});
  return { async write(text) { if (!stream.write(text)) await once(stream, "drain"); },
    async close() { stream.end(); await completion; } };
}

function ledgerFor(state) {
  const entry = ledger.get(`${state.symbol}|${state.timestamp}`);
  return { account: entry?.account ?? null, accountSource: entry?.source ?? "UNAVAILABLE",
    expertAction: entry?.expertSource ? entry.expertAction ?? null : null,
    marketFlags: entry?.marketFlagsSource ? entry.marketFlags ?? null : null };
}

async function run(writeArtifacts) {
  const transitionHasher = createHash("sha256"), groupHasher = createHash("sha256");
  const quality = { totalStates: 0, totalTransitions: 0, validActions: 0, invalidActions: 0,
    unknownValidity: 0, resolvedTransitions: 0, missingExpertStates: 0, missingMarketFlagsStates: 0,
    splitCounts: {}, statuses: {}, actions: Object.fromEntries(RL_ACTIONS.map(a => [a, { validCount: 0, invalidCount: 0, unknownCount: 0 }])) };
  const jsonl = writeArtifacts ? compressedWriter(`${artifactDir}/action-outcome-matrix.jsonl.gz`) : null;
  const csv = writeArtifacts ? compressedWriter(`${artifactDir}/transitions.csv.gz`) : null;
  if (csv) await csv.write(`${csvColumns.join(",")}\n`);
  const states = causalMarketStates(rows);
  let current = states.next(), next = states.next(), index = 0;
  const regretGroups = [], examples = [], diagnosticInputs = [];
  while (!current.done) {
    const state = current.value;
    const args = { marketState: state, nextMarketState: next.value ?? null, barIndex: index,
      ...ledgerFor(state), datasetHash };
    const group = evaluateTransitionGroup(args);
    quality.totalStates++;
    quality.splitCounts[group.split] = (quality.splitCounts[group.split] ?? 0) + 1;
    if (group.expertAction === null) quality.missingExpertStates++;
    if (args.marketFlags === null) quality.missingMarketFlagsStates++;
    if (Number.isFinite(group.expertRegret)) regretGroups.push({ expertRegret: group.expertRegret, expertAgreement: group.expertAgreement });
    if (examples.length < 2) examples.push(group);
    if (!diagnosticInputs.some(x => data07Split(x.marketState.timestamp) === group.split) && state.timestamp.slice(11, 16) === "10:00") diagnosticInputs.push(args);
    const serialized = JSON.stringify(group);
    groupHasher.update(serialized + "\n");
    if (jsonl) await jsonl.write(serialized + "\n");
    let csvText = "";
    for (const t of group.transitions) {
      quality.totalTransitions++;
      quality.statuses[t.status] = (quality.statuses[t.status] ?? 0) + 1;
      const counts = quality.actions[t.action];
      if (t.validAction === true) { quality.validActions++; counts.validCount++; }
      else if (t.validAction === false) { quality.invalidActions++; counts.invalidCount++; }
      else { quality.unknownValidity++; counts.unknownCount++; }
      if (t.status === "RESOLVED") quality.resolvedTransitions++;
      transitionHasher.update(JSON.stringify(t) + "\n");
      if (csv) csvText += csvColumns.map(k => csvCell(t[k])).join(",") + "\n";
    }
    if (csv) await csv.write(csvText);
    current = next; next = states.next(); index++;
  }
  if (jsonl) await jsonl.close();
  if (csv) await csv.close();
  return { transitionHash: transitionHasher.digest("hex"), counterfactualHash: groupHasher.digest("hex"),
    quality, regret: summarizeRegret(regretGroups), examples, diagnosticInputs };
}

console.log(`DATA-07 ${rows.length} states; generating independent Run A and Run B`);
const runA = await run(true);
console.log("Run A written; reconstructing every state and transition for Run B");
const runB = await run(false);
const identical = runA.transitionHash === runB.transitionHash && runA.counterfactualHash === runB.counterfactualHash
  && hashTransition(runA.quality) === hashTransition(runB.quality);

// Scenario grid is diagnostics ONLY, never counted as real historical accounts.
const diagnostics = runA.diagnosticInputs.flatMap(args => PORTFOLIO_SCENARIOS.map(scenario => {
  const a = buildPortfolioScenario(scenario, args.marketState.price, args.marketState.timestamp.slice(0, 10)).snapshot(args.marketState.price);
  return { scenario, group: evaluateTransitionGroup({ ...args, account: a, accountSource: `SYNTHETIC_DIAGNOSTIC_${scenario}`, expertAction: null }) };
}));
await writeFile(`${base}-diagnostics.json`, JSON.stringify({ scope: "SYNTHETIC_PORTFOLIO_DIAGNOSTICS_NOT_PRIMARY_DATASET", diagnostics }, null, 2) + "\n");

const mutationAudit = [];
for (const args of runA.diagnosticInputs) {
  const mutated = rows.map((r, i) => i > args.barIndex ? { ...r, price: r.price * 1.07, volume: r.volume * 2 } : r);
  const iterator = causalMarketStates(mutated);
  const original = causalMarketStates(rows);
  const beforeHash = createHash("sha256"), afterHash = createHash("sha256");
  let mutatedState;
  for (let i = 0; i <= args.barIndex; i++) {
    mutatedState = iterator.next().value;
    const beforeState = original.next().value;
    beforeHash.update(hashTransition({ state: beforeState, ...ledgerFor(beforeState) }));
    afterHash.update(hashTransition({ state: mutatedState, ...ledgerFor(mutatedState) }));
  }
  const changedArgs = { ...args, marketState: mutatedState, nextMarketState: iterator.next().value };
  const originalGroup = evaluateTransitionGroup(args), changedGroup = evaluateTransitionGroup(changedArgs);
  const fixture = buildPortfolioScenario("C", args.marketState.price, args.marketState.timestamp.slice(0, 10)).snapshot(args.marketState.price);
  const outcomeA = evaluateTransitionGroup({ ...args, account: fixture, accountSource: "DIAGNOSTIC" });
  const outcomeB = evaluateTransitionGroup({ ...changedArgs, account: fixture, accountSource: "DIAGNOSTIC" });
  mutationAudit.push({ barIndex: args.barIndex, split: originalGroup.split,
    allPrefixInputsIdentical: beforeHash.digest("hex") === afterHash.digest("hex"),
    transitionInputIdentical: originalGroup.inputHash === changedGroup.inputHash,
    expertActionIdentical: originalGroup.expertAction === changedGroup.expertAction,
    diagnosticOutcomeChanged: outcomeA.transitions.some((t, i) => t.reward !== outcomeB.transitions[i].reward) });
}

const testResult = spawnSync(process.execPath, ["--test", "tests/offline-rl-transitions-v09.test.mjs"], { encoding: "utf8" });
if (testResult.status !== 0) throw new Error(`Transition contract tests failed:\n${testResult.stdout}\n${testResult.stderr}`);
const files = ["lib/rl-research/trainer/counterfactual-transitions.mjs", "lib/rl-research/trainer/price-only-streaming-features.mjs",
  "lib/rl-research/reward/reward-function.mjs", "lib/paper-trading/paper-execution-engine.mjs",
  "lib/paper-trading/schema.mjs", "lib/rl-research/trainer/research-portfolio-context.mjs",
  "lib/rl-research/trainer/replay-adapter.mjs", "lib/rl-research/trainer/offline-dataset.mjs",
  "scripts/run-offline-rl-v0.9-counterfactual-transitions.mjs", "tests/offline-rl-transitions-v09.test.mjs"];
const sourceFiles = Object.fromEntries(files.map(f => [f, createHash("sha256").update(readFileSync(f)).digest("hex")]));
// Audit the actual dependency closure, not just a declared shadowOnly flag.
const dependencies = new Set();
function visit(file) {
  if (dependencies.has(file)) return;
  dependencies.add(file);
  const source = readFileSync(file, "utf8");
  if (/fetch\s*\(|import\s*\(/.test(source)) throw new Error(`Unexpected dynamic/network dependency: ${file}`);
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
    if (match[1].startsWith(".")) visit(path.resolve(path.dirname(file), match[1]));
    else if (match[1] !== "node:crypto") throw new Error(`Unexpected dependency: ${match[1]}`);
  }
}
visit(path.resolve(files[0]));
const productionRefs = spawnSync("rg", ["-l", "counterfactual-transitions", "app", "server", "lib", "-g", "*.mjs", "-g", "*.ts", "-g", "*.tsx"], { encoding: "utf8" });
const isolation = productionRefs.status === 1 && [...dependencies].every(f => !/[/\\](app|server)[/\\]|smart-t|shadow-v2/.test(f));
const quality = runA.quality;
const leakagePass = mutationAudit.length === 3 && mutationAudit.every(a => a.allPrefixInputsIdentical && a.transitionInputIdentical && a.expertActionIdentical && a.diagnosticOutcomeChanged);
const realReady = quality.unknownValidity === 0 && quality.resolvedTransitions > 0;
const gates = {
  realHistoricalDataset: !sourceEvents.DATA_GAP && !sourceEvents.TIMESTAMP_REGRESSION && !sourceEvents.DATA_DUPLICATE ? "PASS" : "BLOCKED",
  fiveActionCounterfactualEvaluation: realReady ? "PASS" : "BLOCKED",
  validInvalidSemantics: "PASS", paperExecutionEngineIntegrated: "PASS",
  rewardContractUnchanged: "PASS", costContractUnchanged: "PASS",
  nextStateGenerated: quality.resolvedTransitions > 0 ? "PASS" : "BLOCKED",
  leakage: leakagePass ? "PASS" : "BLOCKED", reproducibility: identical ? "PASS" : "BLOCKED",
  transitionHashGenerated: "PASS", productionIsolation: isolation ? "PASS" : "BLOCKED",
  historicalAccountEvidence: realReady ? "PASS" : "BLOCKED",
  expertEvidence: quality.missingExpertStates === 0 ? "PASS" : "BLOCKED",
  marketExecutionFlags: quality.missingMarketFlagsStates === 0 ? "PASS" : "BLOCKED",
};
const snapshot = { type: "TransitionDatasetSnapshot", datasetHash, sourceHash, ledgerHash,
  stateVersion: PRICE_ONLY_STATE_VERSION, featureVersion: PRICE_ONLY_FEATURE_VERSION,
  featureImplementationVersion: PRICE_ONLY_STREAM_VERSION, rewardVersion: "rate-v2",
  executionVersion: `PaperExecutionEngine:${sourceFiles["lib/paper-trading/paper-execution-engine.mjs"]}`,
  transitionHash: runA.transitionHash, counterfactualHash: runA.counterfactualHash, sourceFiles,
  config, reproducibility: { runA: runA.transitionHash, runB: runB.transitionHash, identical } };
const report = { title: "Offline RL V0.9 Counterfactual Transition Dataset", datasetVersion: TRANSITION_VERSION,
  status: Object.values(gates).every(g => g === "PASS") ? "PASS" : "BLOCKED", gates,
  input, ledgerPath: ledgerPath ?? null, sourceEvents, quality, regret: runA.regret,
  mutationAudit, snapshot, fittingPerformed: false, trainingPerformed: false,
  productionIsolation: { status: isolation ? "PASS" : "BLOCKED", dependencies: [...dependencies].map(f => path.relative(process.cwd(), f).replaceAll("\\", "/")), affectsSmartT: false, affectsExpertStrategy: false, realTrading: false },
  diagnostics: { primaryDataset: false, groups: diagnostics.length, transitions: diagnostics.length * 5, contractTestsPassed: true },
  artifacts: { matrix: `${artifactDir}/action-outcome-matrix.jsonl.gz`, transitionsCsv: `${artifactDir}/transitions.csv.gz` },
  limitations: ["DATA-07 market history does not contain causal pre-action account snapshots; A-F scenarios are not real account histories.",
    "Old OHLC expert labels are invalid for price-only states. Missing expert is null, never WAIT.",
    "Source lacks verified suspension and price-limit flags; paper fills on diagnostic fixtures are not historical fill evidence.",
    "Rate-v2 is action-conditioned market return minus executed-notional cost rates, not portfolio Net Future Equity Delta. No change to either existing objective was made.",
    "One observed intraday bar per transition. Session/split/dataset boundaries retain unresolved reward and null nextState; no fabricated zero reward or future padding.",
    "Paper price/cost rounding is preserved. Research rates 0.025% / 0.02%, zero minimum commission/stamp duty are explicit research assumptions, not real-world fee claims.",
    "HistoricalReplayEngine's factor/legacy-label path and TTradingEnvironment's cumulative monetary reward are not substituted for validated price-only State or normalized rate-v2.",
    "PerformanceAnalytics/SignalSample aggregate signal-return metrics are not substituted for missing transition rewards or regret observations."] };
await writeFile(`${base}.snapshot.json`, JSON.stringify(snapshot, null, 2) + "\n");
await writeFile(`${base}.json`, JSON.stringify(report, null, 2) + "\n");
await writeFile(`${base}-sample.json`, JSON.stringify(runA.examples, null, 2) + "\n");
await writeFile(`${base}.csv`, ["action,validCount,invalidCount,unknownCount", ...Object.entries(quality.actions).map(([a, c]) => `${a},${c.validCount},${c.invalidCount},${c.unknownCount}`)].join("\n") + "\n");
await writeFile(`${base}.md`, ["# Offline RL V0.9 — Counterfactual Transition Dataset", "",
  `**OFFLINE_RL_DATASET_V0.9 = ${report.status}**`, "",
  "## 结论与缺口", ...report.limitations.map(s => `- ${s}`), "",
  "## 全量真实行情审计（不是可训练数据集通过声明）",
  `- States: ${quality.totalStates}; five-action records: ${quality.totalTransitions}; resolved transitions: ${quality.resolvedTransitions}.`,
  `- Valid: ${quality.validActions}; invalid: ${quality.invalidActions}; unknown: ${quality.unknownValidity}.`,
  `- Split counts: ${JSON.stringify(quality.splitCounts)}. No fitting, threshold selection or balancing.`,
  "- 缺账户输入：INPUT_UNAVAILABLE / validAction=null；引擎实际拒单：INVALID_ACTION / validAction=false；未来不足：OUTCOME_UNRESOLVED。三者不能混算。",
  `- Expert regret: ${JSON.stringify(runA.regret)}. Null means unavailable, not zero regret.`, "",
  "## Gate", ...Object.entries(gates).map(([k, v]) => `- ${k}: ${v}`), "",
  "## 实现与口径",
  "- Five fresh PaperExecutionEngine branches share the same state, timestamp and path hash; no branch contaminates another.",
  "- BUY_SMALL/BUY retain 0.5/1 units of ResearchNotionalUnitV0.1 (10,000); SELL_PART/SELL_ALL retain 25%/100% sellable shares; 100-share floor.",
  "- rewardGross = existing rate-v2(actionDelta × futureReturn); rewardNet subtracts engine fees/notional and slippage/notional exactly as replay-adapter. Invalid/unresolved never enter ranking.",
  "- Market state remains unchanged. Account context is separate. Dataset identity is kept outside causal state/input hashes; changing future data changes dataset identity, not state(T).",
  "- One observed bar is not always one wall-clock minute (e.g. lunch break). Episode ends are truncations, not a terminal zero-return assumption.",
  "- Scenario A-F diagnostics at one predeclared 10:00 state in each split exercise the adapter only; they do not fill historical accounts or alter primary counts.", "",
  "## 可复现性与泄漏",
  `- Two complete independent reconstructions: identical=${identical}.`,
  `- transitionHash: ${snapshot.transitionHash}`, `- counterfactualHash: ${snapshot.counterfactualHash}`,
  `- datasetHash: ${datasetHash}`, ...mutationAudit.map(a => `- ${JSON.stringify(a)}`), "",
  "## 输出与复跑",
  `- Full group JSONL (five records per state): \`${report.artifacts.matrix}\`.`,
  `- Full transition CSV: \`${report.artifacts.transitionsCsv}\` (compressed local artifacts, excluded from Git).`,
  "- Adjacent JSON report, sample JSON, diagnostics JSON, snapshot JSON and action-count CSV are review artifacts.",
  "- Run: `node scripts/run-offline-rl-v0.9-counterfactual-transitions.mjs`.",
  "- Optional `--accounts=<causal-ledger.jsonl>`: one entry per symbol/timestamp with asOf<=timestamp, source, account {cash, position, sellablePosition, averageCost}, expertAction/expertSource, marketFlags/marketFlagsSource. These must be causally sourced evidence, not scenarios or hindsight labels.",
  "- 解锁前需要逐时点账户证据、合法 Expert 来源及执行状态字段。不得用随机/固定持仓补齐，也不得将情景测试 PASS 宣称为全量数据 PASS。", "",
].join("\n"));
console.log(JSON.stringify({ status: report.status, quality, gates, reproducibility: snapshot.reproducibility, artifacts: report.artifacts }, null, 2));
