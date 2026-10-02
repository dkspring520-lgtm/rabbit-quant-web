import assert from "node:assert/strict";
import test from "node:test";
import { causalMarketStates } from "../lib/rl-research/trainer/counterfactual-transitions.mjs";
import { buildScenarioAudit, SCENARIOS, sourceLineage } from "../lib/rl-research/trainer/behavior-support-v092.mjs";

const rows = [
  { symbol: "601899.SH", timestamp: "2025-10-09T10:00:00", price: 10, volume: 100 },
  { symbol: "601899.SH", timestamp: "2025-10-09T10:01:00", price: 10.2, volume: 100 },
  { symbol: "601899.SH", timestamp: "2025-10-10T10:00:00", price: 10.1, volume: 100 },
];
const states = [...causalMarketStates(rows)];

test("V0.9.2 preserves source, trajectory and state lineage separately", () => {
  const lineage = sourceLineage({ sourceHash: "DATA07", v091Snapshot: { snapshot: { datasetHash: "TRANSFORMED" } } });
  assert.equal(lineage.sourceDatasetHash, "DATA07");
  assert.equal(lineage.trajectoryDatasetHash, "TRANSFORMED");
  assert.notEqual(lineage.stateDatasetHash, lineage.sourceDatasetHash);
  assert.match(lineage.v091DatasetHashMeaning, /not a replacement/);
});

test("V0.9.2 audits all synthetic scenarios and action support", () => {
  const audits = buildScenarioAudit({ rows, states, sourceHash: "DATA07", v091Snapshot: { snapshot: { datasetHash: "V091" } } });
  assert.equal(audits.length, 3);
  assert.deepEqual(audits.map(a => a.scenario.scenarioId), [SCENARIOS[0].scenarioId, SCENARIOS[1].scenarioId, SCENARIOS[2].scenarioId]);
  for (const audit of audits) {
    assert.equal(audit.scenario.accountType, "SYNTHETIC_RESEARCH_PORTFOLIO");
    assert.equal(Object.keys(audit.support).length, 5);
    assert.equal(audit.executionContext.executionContextVersion, null);
    assert.ok(audit.executionContext.executionContextUnavailable > 0);
    assert.equal(audit.snapshot.identical, true);
  }
  const flat = audits[1].support;
  assert.equal(flat.BUY_SMALL.loggedExpertCount > 0, true);
  assert.equal(flat.BUY.loggedExpertCount, 0);
  assert.equal(flat.BUY.status, "UNSEEN_IN_LOGGED_POLICY");
  assert.equal(flat.SELL_PART.status, "COUNTERFACTUAL_ONLY");
  assert.equal(flat.SELL_ALL.status, "COUNTERFACTUAL_ONLY");
});

test("V0.9.2 T+1 audit rejects same-day sells and permits next-day sell", () => {
  const audit = buildScenarioAudit({ rows, states, sourceHash: "DATA07", v091Snapshot: {} })[1];
  assert.deepEqual(audit.tPlusOneAudit.sameDaySellStatuses, ["REJECTED", "REJECTED", "REJECTED", "REJECTED"]);
  assert.equal(audit.tPlusOneAudit.buySmallSellableAfter, 0);
  assert.equal(audit.tPlusOneAudit.buyFullSellableAfter, 0);
  assert.equal(audit.tPlusOneAudit.nextDaySellStatus, "FILLED");
});
