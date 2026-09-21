import test from "node:test";
import assert from "node:assert/strict";
import { isPreopenResetWindow, resetIntradayCaches } from "../lib/intraday-cache-reset.mjs";

test("reset only runs during 09:25 result window", () => {
  assert.equal(isPreopenResetWindow({ phase: "auction-result", time: "0925" }), true);
  assert.equal(isPreopenResetWindow({ phase: "auction-result", time: "0929" }), true);
  assert.equal(isPreopenResetWindow({ phase: "auction", time: "0925" }), false);
  assert.equal(isPreopenResetWindow({ phase: "auction-result", time: "0930" }), false);
});

test("reset removes current account chart and alert caches only", () => {
  const values = new Map([
    ["rabbit-chart-observations:jay cc:601899:2026-09-21", "old"],
    ["rabbit-formal-chart-actions:jay cc:601899:2026-09-21", "old"],
    ["rabbit-alert-history:jay cc", "old"],
    ["rabbit-chart-observations:jay cc:601899:2026-09-20", "history"],
    ["rabbit-cockpit-ui-state", "layout"],
  ]);
  const storage = { getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key) };
  const removed = resetIntradayCaches({ storage, accountName: "Jay CC", code: "601899", date: "2026-09-21" });
  assert.equal(removed.length, 3);
  assert.equal(values.get("rabbit-chart-observations:jay cc:601899:2026-09-20"), "history");
  assert.equal(values.get("rabbit-cockpit-ui-state"), "layout");
});

test("invalid scope does not remove anything", () => {
  const values = new Map([["x", "keep"]]);
  const storage = { getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key) };
  assert.deepEqual(resetIntradayCaches({ storage, accountName: "Jay", code: "601899", date: "20260921" }), []);
  assert.equal(values.get("x"), "keep");
});
