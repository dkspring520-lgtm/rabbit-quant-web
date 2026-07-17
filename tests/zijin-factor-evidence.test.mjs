import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const evidenceUrl = new URL("../public/research/zijin-factor-evidence.json", import.meta.url);
const progressUrl = new URL("../public/research/zijin-training-progress.json", import.meta.url);

test("Zijin historical evidence is causal, isolated and split before blind testing", async () => {
  const evidence = JSON.parse(await readFile(evidenceUrl, "utf8"));
  assert.equal(evidence.stock.marketCode, "601899.SH");
  assert.equal(evidence.affectsV4, false);
  assert.equal(evidence.methodology.causal, true);
  assert.equal(evidence.methodology.training, "2022-2024");
  assert.equal(evidence.methodology.validation, "2025");
  assert.match(evidence.methodology.blindTest, /^2026/);
  assert.equal(evidence.selectedModel.selectedOn, "training-only");
  assert.equal(evidence.dataset.tradingDays, 1037);
  assert.equal(evidence.dataset.minuteRows, 249917);
  assert.ok(evidence.results.training.trades > 0);
  assert.ok(evidence.results.validation.trades > 0);
  assert.ok(evidence.results.blindTest.trades > 0);
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
  assert.equal(progress.status, "completed");
  assert.equal(progress.stage, "completed");
  assert.equal(progress.progress, 100);
  assert.equal(progress.processedCandidates, progress.totalCandidates);
  assert.ok(progress.totalCandidates > 0);
  assert.ok(progress.latest.trainingTrades > 0);
  assert.ok(progress.latest.validationTrades > 0);
  assert.ok(progress.latest.blindTrades > 0);
  assert.equal(progress.latest.passedValidationGate, false);
});
