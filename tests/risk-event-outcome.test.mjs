import test from "node:test";
import assert from "node:assert/strict";
import { riskEventOutcome, summarizeRiskOutcomes } from "../lib/risk-event-outcome.mjs";
const points = [{time:"0930",price:100},{time:"0931",price:100.1},{time:"0932",price:100.15}];
test("complete horizons separate gross and net returns", () => {
  const result = riskEventOutcome(points,0,2,0.2);
  assert.ok(Math.abs(result.gross-0.15)<1e-9);
  assert.ok(Math.abs(result.net+0.05)<1e-9);
  const summary = summarizeRiskOutcomes([result]);
  assert.equal(summary.grossPositiveRate,1);
  assert.equal(summary.longNetPositiveRate,0);
});
test("short tails and invalid prices are excluded rather than shortened", () => {
  assert.equal(riskEventOutcome(points,1,2,0.2).excluded,"incomplete");
  assert.equal(riskEventOutcome([points[0],{time:"0931",price:NaN},points[2]],0,2,0.2).excluded,"invalid-price");
});
test("missing, duplicate, reversed and lunch-crossing times are excluded", () => {
  for (const times of [["0930","0932"],["0930","0930"],["0931","0930"],["1130","1300"]]) assert.equal(riskEventOutcome(times.map(time=>({time,price:100})),0,1,0.2).excluded,"discontinuous");
});
test("excluded samples never enter rates and empty buckets stay null", () => {
  const summary=summarizeRiskOutcomes([riskEventOutcome(points,1,2,0.2)]);
  assert.equal(summary.n,0);
  assert.equal(summary.excluded.incomplete,1);
  assert.equal(summary.longNetMeanPct,null);
  assert.equal(summary.longNetPositiveRate,null);
});
