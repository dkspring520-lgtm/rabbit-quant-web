import test from "node:test";
import assert from "node:assert/strict";
import {
  compactChartObservations,
  fulfilledWatchlistSnapshots,
  isRecentCausalEvent,
  isVwapDisplacementObservation,
  selectLatestAlertableObservation,
} from "../lib/live-monitor-alerts.mjs";

test("repeated same-direction observations are compacted into one causal episode", () => {
  const first = { time:"0942", direction:"正T", stage:"candidate", score:62, executable:false };
  const second = { time:"0958", direction:"正T", stage:"candidate", score:64, executable:false };
  assert.deepEqual(compactChartObservations([first, second], 30), [second]);
});

test("opposite directions and separate episodes remain visible", () => {
  const rebound = { time:"0942", direction:"正T", stage:"candidate", executable:false };
  const fade = { time:"0950", direction:"反T", stage:"candidate", executable:false };
  const laterRebound = { time:"1020", direction:"正T", stage:"candidate", executable:false };
  assert.deepEqual(compactChartObservations([rebound, fade, laterRebound], 30), [rebound, fade, laterRebound]);
});

test("a confirmed point is not replaced by a weaker repeat observation", () => {
  const confirmed = { time:"0942", direction:"正T", pivotAssessment:"confirmed", executable:false };
  const watch = { time:"0950", direction:"正T", stage:"watch", executable:false };
  assert.deepEqual(compactChartObservations([confirmed, watch], 30), [confirmed]);
});

test("live alerts tolerate a short polling delay without reading future data", () => {
  assert.equal(isRecentCausalEvent("10:03", "1001", 3), true);
  assert.equal(isRecentCausalEvent("10:05", "1001", 3), false);
  assert.equal(isRecentCausalEvent("09:59", "1001", 3), false);
});

test("VWAP displacement and qualified candidates are alertable while ordinary watch notes stay quiet", () => {
  const ordinary = { time:"0933", stage:"watch", reason:"等待开盘结构" };
  const displaced = { time:"0943", stage:"watch", reason:"向下偏离 VWAP 0.58%；先预警、不执行" };
  const candidate = { time:"1001", stage:"candidate", reason:"转强候选" };
  assert.equal(isVwapDisplacementObservation(displaced), true);
  assert.equal(selectLatestAlertableObservation([ordinary, displaced]), displaced);
  assert.equal(selectLatestAlertableObservation([ordinary, displaced, candidate]), candidate);
});

test("one failed stock feed does not discard successful watchlist snapshots", () => {
  const first = { quote:{ code:"601899" } };
  const second = { quote:{ code:"601012" } };
  const snapshots = fulfilledWatchlistSnapshots([
    { status:"fulfilled", value:first },
    { status:"rejected", reason:new Error("temporary outage") },
    { status:"fulfilled", value:second },
  ]);
  assert.deepEqual(snapshots, [first, second]);
});
