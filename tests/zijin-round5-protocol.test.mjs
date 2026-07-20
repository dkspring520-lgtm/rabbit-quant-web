import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const protocol = JSON.parse(await readFile(new URL("../scripts/zijin-round5-protocol.json", import.meta.url), "utf8"));
const runner = await readFile(new URL("../scripts/run_zijin_round4_experiments.py", import.meta.url), "utf8");
const scheduler = await readFile(new URL("../scripts/zijin-auto-trainer.py", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("round five preregisters two regime-specific hypotheses without opening 2026", () => {
  assert.equal(protocol.round, 5);
  assert.equal(protocol.status, "preregistered");
  assert.equal(protocol.independentHypothesisCount, 2);
  assert.equal(protocol.dataPolicy.selectionEnd, "2025-12-31");
  assert.equal(protocol.dataPolicy.sealedFinalBlindPeriod.allowParameterSelection, false);
  assert.equal(protocol.affectsV4, false);
  assert.equal(protocol.automaticPromotion, false);
  assert.deepEqual(protocol.hypotheses.map((item) => item.id), [
    "range-vwap-confirmation",
    "trend-pullback-continuation",
  ]);
});

test("round five controls factor count and preregisters every parameter search", () => {
  for (const hypothesis of protocol.hypotheses) {
    assert.ok(hypothesis.features.length >= 8);
    assert.ok(hypothesis.features.length <= 12);
    assert.equal(new Set(hypothesis.features).size, hypothesis.features.length);
    assert.equal(Object.values(hypothesis.parameterGrid).reduce((count, values) => count * values.length, 1), 8);
  }
  assert.equal(protocol.promotionGates.minimumOutOfSampleWinRate, 0.65);
  assert.equal(protocol.multipleTesting.probabilityOfBacktestOverfitting.maximum, 0.2);
  assert.equal(protocol.multipleTesting.deflatedSharpe.minimumProbability, 0.95);
});

test("runner implements the two frozen regime gates causally", () => {
  assert.match(runner, /range-vwap-confirmation/);
  assert.match(runner, /trend-pullback-continuation/);
  assert.match(runner, /minuteOfDay.*9 \* 60 \+ 35/s);
  assert.match(runner, /vwapSlope5Pct/);
  assert.match(runner, /ma10SlopePct/);
  assert.match(runner, /return3Pct/);
  assert.match(runner, /minute_t_plus_1_open|minute t\+1 open/);
  assert.match(runner, /except FileNotFoundError/);
  assert.match(runner, /ZIJIN_SOURCE_COMMIT/);
  assert.match(runner, /def audit_path\(path: Path\)/);
  assert.match(runner, /except ValueError/);
  assert.match(runner, /return resolved\.as_posix\(\)/);
});

test("automatic scheduler advances to the latest preregistered protocol instead of retuning round five", () => {
  assert.match(scheduler, /zijin-round11-protocol\.json/);
  assert.match(scheduler, /if unchanged and not args\.force/);
  assert.match(scheduler, /safe_experiment_id/);
  assert.match(scheduler, /automaticPromotion": False/);
});

test("research dashboard exposes the honest round five result without changing V4", () => {
  assert.match(page, /zijin-round5-report\.json/);
  assert.match(page, /第五轮 · 先分环境再选点/);
  assert.match(page, /样本不足/);
  assert.match(page, /真实失败也保留/);
  assert.match(page, /V4 保持不变/);
  assert.match(page, /2026 继续封存/);
});
