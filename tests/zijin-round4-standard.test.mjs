import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scriptUrl = new URL("../scripts/zijin_round4_standard.py", import.meta.url);

test("round four ledger is append-only and rejects 2026 selection trials", async () => {
  const source = await readFile(scriptUrl, "utf8");
  assert.match(source, /path\.open\("a"/);
  assert.match(source, /os\.fsync/);
  assert.match(source, /duplicate trialId/);
  assert.match(source, /2026 is sealed and cannot be used by a selection trial/);
  assert.match(source, /trial factors differ from the preregistered hypothesis/);
});

test("round four implements CSCV PBO and Deflated Sharpe controls", async () => {
  const source = await readFile(scriptUrl, "utf8");
  assert.match(source, /def probability_of_backtest_overfitting/);
  assert.match(source, /itertools\.combinations/);
  assert.match(source, /"method": "CSCV"/);
  assert.match(source, /def deflated_sharpe_probability/);
  assert.match(source, /expectedMaximumSharpe/);
  assert.match(source, /def calculate_multiple_testing_controls/);
  assert.match(source, /complete trialPeriodReturns matrix/);
  assert.match(source, /valid selectedTrialIndex from the complete trial matrix/);
  assert.match(source, /selected_returns = trial_period_returns\[selected_trial_index\]/);
  assert.match(source, /all_trial_sharpes = \[annualized_sharpe\(row\)/);
  assert.doesNotMatch(source, /summary\.get\("pbo"/);
  assert.doesNotMatch(source, /summary\.get\("deflatedSharpeProbability"/);
  assert.doesNotMatch(source, /summary\.get\("selectedReturns"/);
});

test("round four evaluation cannot promote directly to V4 or shadow trading", async () => {
  const source = await readFile(scriptUrl, "utf8");
  assert.match(source, /"final-2026-blind" if passed else "research-rejected"/);
  assert.match(source, /beatsAllBaselines/);
  assert.match(source, /门槛未通过时不得读取2026数据/);
  assert.doesNotMatch(source, /nextStage.*shadow-observation/);
});
