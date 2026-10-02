import assert from "node:assert/strict";
import test from "node:test";
import { causalMarketStates } from "../lib/rl-research/trainer/counterfactual-transitions.mjs";
import { SCENARIOS } from "../lib/rl-research/trainer/behavior-support-v092.mjs";
import { assessExpertActionSource, buildExpertLineageAudit, EXPERT_ACTION_SOURCE_UNAVAILABLE, SYNTHETIC_FIXED_SCHEDULE_BASELINE } from "../lib/rl-research/trainer/expert-trajectory-lineage-v0931.mjs";

const rows = [
  { symbol: "601899.SH", timestamp: "2025-10-09T10:00:00", price: 10, volume: 100 },
  { symbol: "601899.SH", timestamp: "2025-10-09T10:01:00", price: 10.2, volume: 100 },
  { symbol: "2025-10-10T10:00:00", timestamp: "2025-10-10T10:00:00", price: 10.1, volume: 100 },
];
const states = [...causalMarketStates(rows)];

test("synthetic fixed schedule is not Expert source", () => {
  const audit = buildExpertLineageAudit({ rows, states, sourceDatasetHash: "source", trajectoryDatasetHash: "trajectory", scenario: SCENARIOS[0] });
  assert.equal(audit.baseline.name, SYNTHETIC_FIXED_SCHEDULE_BASELINE);
  assert.equal(audit.baseline.observedExpertBehavior, false);
  assert.equal(audit.observedExpert.status, EXPERT_ACTION_SOURCE_UNAVAILABLE);
  assert.notEqual(audit.baseline.hash, audit.observedExpert.hash);
  assert.equal(audit.observedExpert.actionCounts.BUY_SMALL, 0);
});

test("expert source requires complete existing OHLCV inputs and never falls back", () => {
  const audit = assessExpertActionSource(rows);
  assert.equal(audit.status, EXPERT_ACTION_SOURCE_UNAVAILABLE);
  assert.equal(audit.missingCounts.open, 3);
  assert.equal(audit.missingCounts.high, 3);
  assert.equal(audit.missingCounts.low, 3);
  assert.equal(audit.missingCounts.amount, 3);
  assert.match(audit.reason, /no fallback/i);
});

test("expert lineage records market plus explicit unavailable account state", () => {
  const audit = buildExpertLineageAudit({ rows, states, sourceDatasetHash: "source", trajectoryDatasetHash: "trajectory", scenario: SCENARIOS[0] });
  const record = audit.observedExpert.records[0];
  assert.ok(record.state.marketState);
  assert.equal(record.state.accountState, null);
  assert.equal(record.expertAction, null);
  assert.equal(record.observedExpertBehavior, false);
  assert.equal(audit.trainingEligibility, "BLOCKED");
});

test("real source cannot be claimed without all causal OHLCV fields", () => {
  const complete = rows.map(row => ({ ...row, open: 10, high: 10.3, low: 9.9, amount: 1000 }));
  const source = assessExpertActionSource(complete);
  assert.equal(source.status, "AVAILABLE");
  assert.equal(source.source.strategyId, "OHLCV_T_RESEARCH_V1");
  assert.equal(source.legacySignalCount, complete.length);
});
