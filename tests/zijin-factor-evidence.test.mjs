import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const evidenceUrl = new URL("../public/research/zijin-factor-evidence.json", import.meta.url);
const progressUrl = new URL("../public/research/zijin-training-progress.json", import.meta.url);
const patternUrl = new URL("../public/research/zijin-pattern-discovery.json", import.meta.url);
const peerPatternUrl = new URL("../public/research/zijin-peer-pattern-discovery.json", import.meta.url);
const externalReadinessUrl = new URL("../public/research/zijin-external-factor-readiness.json", import.meta.url);
const round2RegimeAuditUrl = new URL("../public/research/zijin-round2-regime-audit.json", import.meta.url);
const composeUrl = new URL("../compose.web.yml", import.meta.url);
const trainingStateSyncUrl = new URL("../scripts/sync-zijin-training-state.mjs", import.meta.url);
const automationStateUrl = new URL("../public/research/zijin-automation-status.json", import.meta.url);
const automationStateSyncUrl = new URL("../scripts/sync-zijin-automation-state.mjs", import.meta.url);
const trainingProgressApiUrl = new URL("../app/api/research/zijin-training-progress/route.ts", import.meta.url);

test("Zijin historical evidence is causal, isolated and split before blind testing", async () => {
  const evidence = JSON.parse(await readFile(evidenceUrl, "utf8"));
  assert.equal(evidence.stock.marketCode, "601899.SH");
  assert.equal(evidence.stock.name, "紫金矿业");
  assert.equal(evidence.affectsV4, false);
  assert.equal(evidence.methodology.causal, true);
  assert.equal(evidence.methodology.training, "2022-2024");
  assert.equal(evidence.methodology.validation, "2025");
  assert.match(evidence.methodology.blindTest, /^2026/);
  assert.equal(evidence.selectedModel.selectedOn, "training-only");
  assert.equal(evidence.dataset.tradingDays, 1037);
  assert.equal(evidence.dataset.minuteRows, 249917);
  assert.equal(evidence.methodology.searchProfile, "full");
  assert.ok(evidence.results.training.trades > 0);
  assert.ok(evidence.results.validation.trades > 0);
  assert.ok(evidence.results.blindTest.trades > 0);
});

test("Zijin stage-three external factors refuse to train before real data is ready", async () => {
  const readiness = JSON.parse(await readFile(externalReadinessUrl, "utf8"));
  assert.equal(readiness.stock.code, "601899");
  assert.equal(readiness.stock.name, "紫金矿业");
  assert.equal(readiness.stage, 3);
  assert.equal(readiness.status, "awaiting-external-history");
  assert.equal(readiness.affectsV4, false);
  assert.equal(readiness.causal, true);
  assert.equal(readiness.pipeline.asOfJoin, "source_timestamp <= target_timestamp");
  assert.equal(readiness.pipeline.futureRowsUsed, 0);
  assert.equal(readiness.pipeline.trainingStarted, false);
  assert.equal(readiness.pipeline.winRateAvailable, false);
  assert.equal(readiness.coverage.externalSourcesReady, 0);
  assert.equal(readiness.coverage.liveSourcesReachable, 5);
  assert.equal(readiness.coverage.trainingReady, false);
  assert.equal(readiness.requiredSources.length, 5);
  assert.ok(readiness.requiredSources.every(source => source.status === "missing"));
  assert.ok(readiness.requiredSources.every(source => source.liveStatus === "reachable"));
  assert.equal(readiness.liveProbe.status, "reachable");
});

test("Zijin round-two regime audit keeps 2026 sealed and refuses negative expectancy", async () => {
  const audit = JSON.parse(await readFile(round2RegimeAuditUrl, "utf8"));
  assert.equal(audit.stock.code, "601899");
  assert.equal(audit.stock.name, "紫金矿业");
  assert.equal(audit.stage, 4);
  assert.equal(audit.affectsV4, false);
  assert.equal(audit.methodology.training, "2022-2024");
  assert.equal(audit.methodology.validation, "2025");
  assert.equal(audit.methodology.blindTest, "2026 sealed");
  assert.equal(audit.methodology.selectionUsesBlindTest, false);
  assert.equal(audit.methodology.earliestFill, "下一分钟开盘价");
  assert.equal(audit.methodology.targetValidationWinRate, 0.65);
  assert.equal(audit.externalReadiness.trainingReady, false);
  assert.equal(audit.qualifiedRegimes, 0);
  assert.equal(audit.status, "blocked");
  assert.ok(audit.regimes.length >= 5);
  assert.ok(audit.regimes.every(regime => regime.passedValidationGate === false));
  assert.ok(audit.regimes.some(regime => regime.validation.trades > 0));
});

test("a failed factor audit is not promoted into Smart-T V4", async () => {
  const evidence = JSON.parse(await readFile(evidenceUrl, "utf8"));
  assert.equal(evidence.selectedModel.passedTrainingGate, false);
  assert.equal(evidence.selectedModel.passedValidationGate, false);
  assert.equal(evidence.selectedModel.status, "未通过研究门槛");
  assert.ok(evidence.results.validation.averageNetPct < 0);
  assert.ok(evidence.results.blindTest.averageNetPct < 0);
});

test("Zijin training progress reports real completed work and all audit stages", async () => {
  const progress = JSON.parse(await readFile(progressUrl, "utf8"));
  assert.equal(progress.stock.code, "601899");
  assert.equal(progress.stock.name, "紫金矿业");
  assert.equal(progress.status, "completed");
  assert.equal(progress.stage, "completed");
  assert.equal(progress.message, "本轮因果训练、样本外验证与盲测已完成");
  assert.equal(progress.progress, 100);
  assert.equal(progress.processedCandidates, progress.totalCandidates);
  assert.ok(progress.totalCandidates > 0);
  assert.ok(progress.latest.trainingTrades > 0);
  assert.ok(progress.latest.validationTrades > 0);
  assert.ok(progress.latest.blindTrades > 0);
  assert.equal(progress.latest.passedValidationGate, false);
});

test("production preserves and dynamically serves the latest Zijin training state", async () => {
  const compose = await readFile(composeUrl, "utf8");
  const syncScript = await readFile(trainingStateSyncUrl, "utf8");
  const automationSyncScript = await readFile(automationStateSyncUrl, "utf8");
  const apiRoute = await readFile(trainingProgressApiUrl, "utf8");
  assert.match(compose, /\/opt\/rabbit-quant-state:\/training-state/);
  assert.match(compose, /ZIJIN_TRAINING_STATE_PATH: \/training-state\/zijin-training-progress\.json/);
  assert.match(compose, /sync-zijin-training-state\.mjs/);
  assert.match(compose, /ZIJIN_AUTOMATION_STATE_PATH: \/training-state\/zijin-automation-status\.json/);
  assert.match(compose, /sync-zijin-automation-state\.mjs/);
  assert.match(syncScript, /stock\?\.code === "601899"/);
  assert.match(syncScript, /keep newer runtime state/);
  assert.match(syncScript, /updatedAt\(current\) > updatedAt\(progress\)/);
  assert.match(syncScript, /copyFile\(source, target\)/);
  assert.match(apiRoute, /ZIJIN_TRAINING_STATE_PATH/);
  assert.match(apiRoute, /ZIJIN_AUTOMATION_STATE_PATH/);
  assert.match(apiRoute, /automationStale/);
  assert.match(apiRoute, /"Cache-Control": "no-store/);
  assert.match(apiRoute, /Date\.now\(\) - updatedAt > 10 \* 60 \* 1000/);
  assert.match(automationSyncScript, /scheduler\?\.mode === "change-driven"/);
  assert.match(automationSyncScript, /keep newer runtime state/);
  const automation = JSON.parse(await readFile(automationStateUrl, "utf8"));
  assert.equal(automation.stock.code, "601899");
  assert.equal(automation.scheduler.mode, "change-driven");
  assert.equal(automation.input.sealed2026, true);
  assert.equal(automation.rabbits.official.status, "blocked");
  assert.equal(automation.lastRun.qualifiedHypotheses, 0);
});

test("Zijin pattern discovery rejects unstable price-volume rules without future leakage", async () => {
  const pattern = JSON.parse(await readFile(patternUrl, "utf8"));
  assert.equal(pattern.stock.marketCode, "601899.SH");
  assert.equal(pattern.stock.name, "紫金矿业");
  assert.equal(pattern.affectsV4, false);
  assert.equal(pattern.dataset.minuteRows, 249917);
  assert.equal(pattern.dataset.tradingDays, 1037);
  assert.equal(pattern.dataset.labeledScenarios, 31567);
  assert.equal(pattern.methodology.causalFeatures, true);
  assert.equal(pattern.methodology.futureUse, "仅作为结果标签");
  assert.equal(pattern.methodology.training, "2022-2024");
  assert.equal(pattern.methodology.validation, "2025");
  assert.match(pattern.methodology.blindTest, /^2026/);
  assert.equal(pattern.methodology.candidateCooldownMinutes, 5);
  assert.equal(pattern.methodology.maxTradesPerDay, 2);
  assert.equal(pattern.acceptedRuleCount.positive, 0);
  assert.equal(pattern.acceptedRuleCount.reverse, 0);
  assert.equal(pattern.conclusion.status, "no-stable-price-volume-rule");
  assert.equal(pattern.conclusion.deployment, "研究结果不自动进入Smart-T V4");
  assert.ok(pattern.conclusion.nextRequiredFactors.includes("国际金价与铜价"));
  assert.equal(pattern.sequenceAudit.validation.trades, 0);
  assert.equal(pattern.sequenceAudit.blindTest.trades, 0);
});

test("Zijin peer and prior-day research stays causal and isolated from V4", async () => {
  const pattern = JSON.parse(await readFile(peerPatternUrl, "utf8"));
  assert.equal(pattern.stock.marketCode, "601899.SH");
  assert.equal(pattern.stock.name, "紫金矿业");
  assert.equal(pattern.affectsV4, false);
  assert.equal(pattern.dataset.stockCount, 7);
  assert.equal(pattern.dataset.minuteRows, 1749419);
  assert.equal(pattern.dataset.tradingDays, 1037);
  assert.equal(pattern.dataset.meanPeerCoverage, 1);
  assert.equal(pattern.methodology.causalFeatures, true);
  assert.equal(pattern.methodology.earliestFill, "下一分钟开盘价");
  assert.equal(pattern.methodology.futureUse, "仅作为结果标签");
  assert.equal(pattern.methodology.selectionUsesBlindTest, false);
  assert.ok(pattern.methodology.peerFeatures.includes("zijinAlphaVwapPct"));
  assert.ok(pattern.methodology.dailyContextFeatures.includes("rolling20ReturnPct"));
  assert.equal(pattern.conclusion.deployment, "研究结果不自动进入Smart-T V4");
});

test("Zijin public research JSON does not regress to mojibake copy", async () => {
  const files = [
    evidenceUrl,
    progressUrl,
    patternUrl,
    peerPatternUrl,
    externalReadinessUrl,
    round2RegimeAuditUrl,
  ];
  const mojibake = /绱|鏈|鍥|鐩|璁|闂|鍙|鍏|锛|鈥||||/;

  for (const file of files) {
    const text = await readFile(file, "utf8");
    assert.doesNotMatch(text, mojibake, file.pathname);
  }
});
