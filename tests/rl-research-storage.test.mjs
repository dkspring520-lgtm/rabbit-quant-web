import assert from "node:assert/strict";
import test from "node:test";
import { loadResearchObservations, saveResearchObservations } from "../lib/rl-research/index.mjs";

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("research observation storage keeps only non-executable research notes", () => {
  const store = storage();
  saveResearchObservations(store, "Alice", "601899", [
    { type: "research-observation", executable: false, time: "0935" },
    { type: "signal", executable: true, time: "0936" },
  ]);
  const rows = loadResearchObservations(store, "alice", "601899");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].time, "0935");
});
