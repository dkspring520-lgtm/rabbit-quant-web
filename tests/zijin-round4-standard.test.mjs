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
  assert.match(source, /def verify_ledger/);
  assert.match(source, /previousRecordHash/);
  assert.match(source, /recordHash/);
  assert.match(source, /ledger hash chain is broken/);
  assert.match(source, /ledger record hash mismatch/);
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
  assert.match(source, /all_trial_sharpes = \[annualized_sharpe\(row, periods_per_year\)/);
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
  assert.match(source, /def open_final_blind_once/);
  assert.match(source, /2026 final blind has already been opened once/);
  assert.match(source, /state_path\.open\("x"/);
});

test("round four executor runs four separate hypotheses and exact baselines", async () => {
  const executor = await readFile(new URL("../scripts/run_zijin_round4_experiments.py", import.meta.url), "utf8");
  const v4Baseline = await readFile(new URL("../scripts/round4-v4-baseline.mjs", import.meta.url), "utf8");
  assert.match(executor, /def run_hypothesis/);
  assert.match(executor, /for index, hypothesis in enumerate\(protocol\["hypotheses"\]\)/);
  assert.match(executor, /standard\.append_trial/);
  assert.match(executor, /choose_training_config/);
  assert.match(executor, /trialPeriodReturns/);
  assert.match(executor, /"no-trade"/);
  assert.match(executor, /"simple-vwap"/);
  assert.match(executor, /"smart-t-v4"/);
  assert.match(executor, /reads2026.*False/);
  assert.match(executor, /to_pickle\(samples_path\)/);
  assert.match(executor, /"failed" if stage == "failed"/);
  assert.match(executor, /np\.isfinite\(price\)/);
  assert.match(executor, /volume if np\.isfinite\(volume\) else 0\.0/);
  assert.match(v4Baseline, /runSmartTReplay/);
  assert.match(v4Baseline, /cycleNetPcts/);
});
