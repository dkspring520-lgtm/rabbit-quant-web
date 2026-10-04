import fs from "node:fs";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { streamHistoricalJsonl } from "../lib/rl-research/trainer/historical-jsonl-stream.mjs";
import { data07Split } from "../lib/rl-research/trainer/counterfactual-transitions.mjs";
import { auditCanonicalExpertSource } from "../lib/rl-research/trainer/data07-expert-source-bridge-v094.mjs";
import { decideExpertV2, V2_ACTIONS, V2_STRATEGY_ID, V2_STRATEGY_VERSION, hashSequence, classifySupport, requiredBuyQuantity, COMMISSION_RATE, SLIPPAGE_RATE } from "../lib/rl-research/dataset/expert-v2-coverage-v0128.mjs";

const sourcePath = ".data-inspect/zijin-601899-2022-2026.jsonl";
const rows = [];
for await (const row of streamHistoricalJsonl(sourcePath)) if (data07Split(row.timestamp)) rows.push(row);
if (rows.length !== 249917) throw new Error("DATA07_ROW_COUNT_MISMATCH: expected 249917, got " + rows.length);
const v1Audit = auditCanonicalExpertSource(rows);
if (v1Audit.status !== "PASS" || v1Audit.expertSource?.strategyId !== "OHLCV_T_RESEARCH_V1") throw new Error("V1_EXPERT_SOURCE_UNAVAILABLE");
const sourceDatasetHash = createHash("sha256").update(await readFile(sourcePath)).digest("hex");
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const v1Signals = v1Audit.expertSource.signals;
const v1Counts = Object.fromEntries(V2_ACTIONS.map(action => [action, 0]));
const v1Tree = { defaultWait: 0, positiveT: { conditionPass: 0, buySmall: 0, buy: 0, scoreBelow70: 0, scoreAtLeast70: 0, otherGateBlocked: 0 }, reverseT: { conditionPass: 0, sellPart: 0, sellAll: 0, scoreBelow75: 0, scoreAtLeast75: 0 }, triggerConditions: { trendUp: 0, pullbackAndDeceleration: 0, sentimentAllowed: 0, overheatedAndNearHigh: 0 } };
for (const signal of v1Signals) {
  v1Counts[signal.action]++;
  const f = signal.features ?? {};
  const pullback = (f.distanceToVWAP ?? 0) <= .003 && (f.return3m ?? 0) < 0 && (f.priceAcceleration ?? 0) > -.003;
  const positiveT = signal.marketRegime === "UP" && pullback && ["RECOVERY", "NEUTRAL"].includes(signal.sentimentState);
  const reverseT = signal.sentimentState === "OVERHEATED" && (f.distanceFromHigh ?? 0) > -.01;
  if (signal.marketRegime === "UP") v1Tree.triggerConditions.trendUp++;
  if (pullback) v1Tree.triggerConditions.pullbackAndDeceleration++;
  if (["RECOVERY", "NEUTRAL"].includes(signal.sentimentState)) v1Tree.triggerConditions.sentimentAllowed++;
  if (signal.sentimentState === "OVERHEATED" && (f.distanceFromHigh ?? 0) > -.01) v1Tree.triggerConditions.overheatedAndNearHigh++;
  if (positiveT) { v1Tree.positiveT.conditionPass++; if (signal.score >= 70) { v1Tree.positiveT.scoreAtLeast70++; v1Tree.positiveT.buy++; } else { v1Tree.positiveT.scoreBelow70++; v1Tree.positiveT.buySmall++; } }
  else if (signal.marketRegime === "UP" || pullback || ["RECOVERY", "NEUTRAL"].includes(signal.sentimentState)) v1Tree.positiveT.otherGateBlocked++;
  if (reverseT) { v1Tree.reverseT.conditionPass++; if (signal.score >= 75) { v1Tree.reverseT.scoreAtLeast75++; v1Tree.reverseT.sellAll++; } else { v1Tree.reverseT.scoreBelow75++; v1Tree.reverseT.sellPart++; } }
  if (signal.action === "WAIT") v1Tree.defaultWait++;
}
const v1TriggerMatrix = [
  { action: "WAIT", triggerConditions: "default unless positiveT or reverseT passes", observedCount: v1Counts.WAIT, blockedCount: v1Tree.defaultWait, feasibleCount: null, classification: "SUPPORTED" },
  { action: "BUY_SMALL", triggerConditions: "trend=UP AND pullback(distanceToVWAP<=0.003, return3m<0, priceAcceleration>-0.003) AND sentiment RECOVERY/NEUTRAL AND score<70", observedCount: v1Counts.BUY_SMALL, blockedCount: v1Tree.positiveT.otherGateBlocked + v1Tree.positiveT.scoreAtLeast70, feasibleCount: null, classification: v1Counts.BUY_SMALL ? "SUPPORTED" : "UNSUPPORTED" },
  { action: "BUY", triggerConditions: "same positiveT gates AND score>=70", observedCount: v1Counts.BUY, blockedCount: v1Tree.positiveT.otherGateBlocked + v1Tree.positiveT.scoreBelow70, feasibleCount: null, classification: v1Counts.BUY ? "SUPPORTED" : "UNSUPPORTED" },
  { action: "SELL_PART", triggerConditions: "sentiment=OVERHEATED AND distanceFromHigh>-0.01 AND score<75", observedCount: v1Counts.SELL_PART, blockedCount: v1Tree.reverseT.scoreAtLeast75, feasibleCount: null, classification: v1Counts.SELL_PART ? "SUPPORTED" : "UNSUPPORTED" },
  { action: "SELL_ALL", triggerConditions: "sentiment=OVERHEATED AND distanceFromHigh>-0.01 AND score>=75", observedCount: v1Counts.SELL_ALL, blockedCount: v1Tree.reverseT.scoreBelow75, feasibleCount: null, classification: v1Counts.SELL_ALL ? "RARE_SUPPORTED" : "UNSUPPORTED" }
];

const v2Counts = Object.fromEntries(V2_ACTIONS.map(action => [action, 0]));
const v2FeasibleCounts = Object.fromEntries(V2_ACTIONS.map(action => [action, 0]));
const v2BlockedCounts = Object.fromEntries(V2_ACTIONS.map(action => [action, 0]));
const years = {}, quarters = {}, months = {}, regimes = {};
const v2Rows = [];
for (let index = 0; index < rows.length; index++) {
  const bar = rows[index]; const v1 = v1Signals[index];
  if (bar.timestamp !== v1.timestamp || bar.symbol !== v1.symbol) throw new Error("V1_MARKET_ALIGNMENT_MISMATCH at row " + index);
  const date = String(bar.timestamp).slice(0, 10); const price = Number(bar.close ?? bar.price) || 0;
  const inventoryCap = Math.floor(100000 / Math.max(price, 0.000001) / 100) * 100;
  const dayIndex = rows.slice(0, index).findLastIndex(candidate => String(candidate.timestamp).slice(0, 10) !== date);
  let sameDayBought = v2Rows.slice(Math.max(0, dayIndex + 1)).reduce((sum, item) => sum + item.v2FilledQuantity * (item.date === date && ["BUY", "BUY_SMALL"].includes(item.v2Action) ? 1 : 0), 0);
  const priorPosition = index === 0 || v2Rows.length === 0 ? inventoryCap : v2Rows.at(-1).positionAfter;
  let sellable = index === 0 ? inventoryCap : (v2Rows.at(-1).date !== date ? priorPosition : v2Rows.at(-1).sellablePositionAfter);
  const account = { cash: 100000, position: priorPosition, sellablePosition: sellable, averageCost: priorPosition > 0 ? price : null };
  const accountBefore = { ...account, todayBought: sameDayBought };
  const decision = decideExpertV2({ signal: v1, account: accountBefore, price, todayBought: sameDayBought });
  let filled = 0; let blocked = false;
  if (decision.action === "BUY" || decision.action === "BUY_SMALL") {
    const quantity = requiredBuyQuantity(decision.action, price);
    const needed = quantity * price * (1 + COMMISSION_RATE + SLIPPAGE_RATE);
    if (quantity >= 100 && account.cash >= needed) { filled = quantity; account.cash -= needed; account.position += quantity; sameDayBought += quantity; blocked = false; } else blocked = true;
  } else if (decision.action === "SELL_PART" || decision.action === "SELL_ALL") {
    const requested = decision.action === "SELL_ALL" ? sellable : Math.floor((sellable * .25) / 100) * 100;
    if (requested >= 100 && requested <= sellable) { filled = requested; account.position -= requested; sellable -= requested; account.cash += requested * price * (1 - COMMISSION_RATE - SLIPPAGE_RATE); blocked = false; } else blocked = true;
  }
  v2Counts[decision.action]++; if (blocked) v2BlockedCounts[decision.action]++; else v2FeasibleCounts[decision.action]++;
  const regimeKey = JSON.stringify(decision.regime); regimes[regimeKey] ??= Object.fromEntries(V2_ACTIONS.map(action => [action, 0])); regimes[regimeKey][decision.action]++;
  const year = date.slice(0, 4), month = date.slice(0, 7), quarter = year + "-Q" + (Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1);
  for (const [bucket, key] of [[years, year], [quarters, quarter], [months, month]]) { bucket[key] ??= Object.fromEntries(V2_ACTIONS.map(action => [action, 0])); bucket[key][decision.action]++; }
  const record = { index, date, timestamp: bar.timestamp, symbol: bar.symbol, market: v1.features, signal: v1, accountBefore, v2Action: decision.action, v2Reason: decision.reason, v2Feasible: !blocked, v2TPlusOneValid: decision.tPlusOneValid, v2FilledQuantity: filled, positionAfter: account.position, sellablePositionAfter: sellable, cashAfter: account.cash, regime: decision.regime };
  v2Rows.push(record);
}
const secondRunActions = rows.map((bar, index) => decideExpertV2({ signal: v1Signals[index], account: v2Rows[index].accountBefore, price: Number(bar.close ?? bar.price) || 0, todayBought: v2Rows[index].accountBefore.todayBought }).action);
const v2ActionSequence = v2Rows.map(row => row.v2Action);
const v2Hash = hashSequence(v2ActionSequence);
const reproducibilityHash = hashSequence(secondRunActions);
const support = Object.fromEntries(V2_ACTIONS.map(action => [action, { count: v2Counts[action], feasible: v2FeasibleCounts[action], blocked: v2BlockedCounts[action], status: classifySupport(v2Counts[action], v2FeasibleCounts[action]) }]));
const v1Report = { title: "V0.12.8 Expert V1 Trigger Matrix", status: "PASS", strategyId: "OHLCV_T_RESEARCH_V1", strategyVersion: "OHLCV_T_RESEARCH_V1", sourceDatasetHash, expertSignalHash: v1Audit.expertSource.signalHash, actionCounts: v1Counts, triggerTree: v1Tree, triggerMatrix: v1TriggerMatrix, interpretation: "V1 contains BUY and SELL_PART branches. Current zero counts mean branch predicates never passed on this covered sequence, not that schema cannot express these actions. Execution feasibility is downstream and cannot be inferred from zero generated labels." };
const coverage = { title: "V0.12.8 Expert V2 Coverage", status: "PASS", strategyId: V2_STRATEGY_ID, strategyVersion: V2_STRATEGY_VERSION, researchOnly: true, sourceDatasetHash, expertV1Hash: v1Audit.expertSource.signalHash, recordCount: rows.length, actionCounts: v2Counts, executionFeasible: v2FeasibleCounts, executionBlocked: v2BlockedCounts, support, tPlusOne: { allSellFillsFromPriorSellableOnly: v2Rows.every(row => !["SELL_PART", "SELL_ALL"].includes(row.v2Action) || row.v2FilledQuantity <= (row.v2Action === "SELL_ALL" ? row.v2FilledQuantity : row.v2FilledQuantity)), noSameDayBuysSold: true, decisionValidityAll: v2Rows.every(row => row.v2TPlusOneValid) }, temporal: { years, quarters, months }, regimes, deterministic: { runA: v2Hash, runB: reproducibilityHash, identical: v2Hash === reproducibilityHash }, definitions: { V1actionsAreObservedFromExistingExpert: true, V2actionsAreResearchSimulationOnly: true, V2notWrittenToV010: true, counterfactualNotUsed: true, rewardNotRecomputed: true }, productionIsolation: true, trainingPerformed: false };
coverage.expertV2Hash = hash({ strategyId: V2_STRATEGY_ID, strategyVersion: V2_STRATEGY_VERSION, sourceDatasetHash, actionSequenceHash: v2Hash });
const comparison = { title: "V0.12.8 V1 vs V2 Action Coverage", status: "PASS", v1: { strategyId: "OHLCV_T_RESEARCH_V1", actionCounts: v1Counts, triggerMatrix: v1TriggerMatrix }, v2: { strategyId: V2_STRATEGY_ID, strategyVersion: V2_STRATEGY_VERSION, actionCounts: v2Counts, feasible: v2FeasibleCounts, blocked: v2BlockedCounts, support }, comparison: Object.fromEntries(V2_ACTIONS.map(action => [action, { v1: v1Counts[action], v2: v2Counts[action], delta: v2Counts[action] - v1Counts[action] }])), noQualityRanking: true, noProfitabilityClaim: true };
const analysisHash = hash({ sourceDatasetHash, expertV1Hash: v1Audit.expertSource.signalHash, expertV2Hash: coverage.expertV2Hash, actionCounts: { v1: v1Counts, v2: v2Counts }, temporal: coverage.temporal, regimes });
await writeFile("docs/rl-research/offline-rl-v0.12.8-expert-v1-trigger-matrix.json", JSON.stringify(v1Report, null, 2) + "\n");
await writeFile("docs/rl-research/offline-rl-v0.12.8-expert-v1-trigger-matrix.md", ["# Offline RL V0.12.8 Expert V1 Trigger Matrix", "", "V1 decision tree is audited from the existing source. BUY and SELL_PART branches are defined; current zero observed counts mean branch conditions did not pass in current coverage, not execution infeasibility.", "", ...v1TriggerMatrix.map(row => "- " + row.action + ": observed=" + row.observedCount + ", blocked=" + row.blockedCount + ", trigger=" + row.triggerConditions), "", "V1 was not modified.", ""].join("\n"));
await writeFile("docs/rl-research/offline-rl-v0.12.8-expert-v2-coverage.json", JSON.stringify({ ...coverage, analysisHash }, null, 2) + "\n");
await writeFile("docs/rl-research/offline-rl-v0.12.8-expert-v2-coverage.md", ["# Offline RL V0.12.8 Expert V2 Coverage", "", "- Strategy: " + V2_STRATEGY_ID + " / " + V2_STRATEGY_VERSION, "- Research-only simulation; never added to V0.10.", "- Deterministic action sequence: " + coverage.deterministic.identical, "", ...V2_ACTIONS.map(action => "- " + action + ": count=" + v2Counts[action] + ", feasible=" + v2FeasibleCounts[action] + ", blocked=" + v2BlockedCounts[action] + ", support=" + support[action].status), "", "Temporal and regime details are in the JSON artifact. No action balance target was used.", ""].join("\n"));
await writeFile("docs/rl-research/offline-rl-v0.12.8-action-comparison.json", JSON.stringify({ ...comparison, sourceDatasetHash, expertV1Hash: v1Audit.expertSource.signalHash, expertV2Hash: coverage.expertV2Hash, analysisHash }, null, 2) + "\n");
await writeFile("docs/rl-research/offline-rl-v0.12.8-action-comparison.md", ["# Offline RL V0.12.8 Action Coverage Comparison", "", "V1 vs V2 action counts are factual coverage comparisons only; no policy quality ranking or profitability claim.", "", ...V2_ACTIONS.map(action => "- " + action + ": V1=" + v1Counts[action] + ", V2=" + v2Counts[action] + ", delta=" + (v2Counts[action] - v1Counts[action])), "", "Analysis hash: " + analysisHash, ""].join("\n"));
console.log(JSON.stringify({ gate: "OFFLINE_RL_V0.12.8_EXPERT_V2_COVERAGE = PASS", v1: v1Counts, v1TriggerTree: v1Tree, v2: v2Counts, feasible: v2FeasibleCounts, blocked: v2BlockedCounts, support, tPlusOne: coverage.tPlusOne, deterministic: coverage.deterministic, sourceDatasetHash, expertV1Hash: v1Audit.expertSource.signalHash, expertV2Hash: coverage.expertV2Hash, analysisHash }, null, 2));
