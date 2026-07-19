import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scriptUrl = new URL("../scripts/train-zijin-round2-walk-forward.py", import.meta.url);
const resultUrl = new URL("../public/research/zijin-round2-walk-forward.json", import.meta.url);

test("Zijin round two uses quarterly causal walk-forward folds and never opens 2026", async () => {
  const source = await readFile(scriptUrl, "utf8");
  assert.match(source, /2024Q1/);
  assert.match(source, /2025Q4/);
  assert.match(source, /regexp_replace\(CAST\(trade_date AS VARCHAR\), '\[\^0-9\]'/);
  assert.match(source, /normalized > "20251231"/);
  assert.match(source, /code IN \(\{placeholders\}\)/);
  assert.match(source, /ALLOWED_CODES = \(peer\.TARGET_CODE/);
  assert.match(source, /2026 完全不加载、不选参、不验证/);
  assert.match(source, /samples\["date"\] < start/);
  assert.match(source, /下一分钟开盘价/);
  assert.match(source, /同柱止损优先/);
  assert.match(source, /TARGET_WIN_RATE = 0\.65/);
  assert.match(source, /"foldCoverage"/);
});

test("Zijin round two stays isolated from Smart-T V4 and publishes independent evidence", async () => {
  const source = await readFile(scriptUrl, "utf8");
  assert.match(source, /"affectsV4": False/);
  assert.match(source, /zijin-round2-walk-forward\.json/);
  assert.match(source, /zijin-round2-progress\.json/);
  assert.match(source, /bootstrap95LowerPct/);
  assert.match(source, /MIN_POSITIVE_FOLDS = 6/);
});

test("published round-two evidence contains eight covered causal folds and zero 2026 rows", async () => {
  const result = JSON.parse(await readFile(resultUrl, "utf8"));
  assert.equal(result.affectsV4, false);
  assert.equal(result.dataset.loaded2026Rows, 0);
  assert.equal(result.folds.length, 8);
  assert.equal(result.gates.foldCoverage.actual, 8);
  assert.equal(result.gates.foldCoverage.passed, true);
  assert.ok(result.folds.every((fold) => fold.validationCandidates > 0));
  assert.ok(result.folds.every((fold) => fold.causalBoundaryPassed));
  assert.ok(result.folds.every((fold) => fold.trainingEnd < fold.validationStart));
  assert.equal(result.methodology.earliestFill, "下一分钟开盘价");
  assert.equal(result.methodology.sameBarConflict, "同柱止损优先");
  assert.deepEqual(result.methodology.netProfitZonePct, [0.64, 1]);
});
