import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const report = JSON.parse(await readFile(new URL("../public/research/zijin-round9-report.json", import.meta.url), "utf8"));

test("round nine report is a completed causal audit with 2026 sealed", () => {
  assert.equal(report.status, "research-rejected");
  assert.equal(report.reads2026, false);
  assert.equal(report.dataset.loaded2026Rows, 0);
  assert.equal(report.finalBlind.opened, false);
  assert.equal(report.affectsV4, false);
  assert.equal(report.ledger.verified, true);
  assert.equal(report.ledger.runRecords, 256);
});

test("round nine keeps all four independent hypotheses and honest failures", () => {
  assert.equal(report.hypotheses.length, 4);
  assert.deepEqual(report.qualifiedHypothesisIds, []);
  const trades = Object.fromEntries(report.hypotheses.map((item) => [
    item.hypothesisId,
    item.outerQuarters.reduce((sum, quarter) => sum + quarter.trades, 0),
  ]));
  assert.deepEqual(trades, {
    "opening-gap-repair-confirmed": 136,
    "vwap-reversion-confirmed": 943,
    "upside-exhaustion-confirmed": 316,
    "peer-divergence-repair": 303,
  });
  for (const hypothesis of report.hypotheses) {
    assert.equal(hypothesis.evaluation.passedRollingOutOfSample, false);
  }
});

test("the closest opening model is not misrepresented as deployable", () => {
  const opening = report.hypotheses.find((item) => item.hypothesisId === "opening-gap-repair-confirmed");
  assert.ok(opening);
  assert.ok(opening.evaluation.metrics.meanNetPct > 0);
  assert.ok(opening.evaluation.metrics.meanStressNetPct < 0);
  assert.ok(opening.outOfSampleWinRate < 0.65);
});
