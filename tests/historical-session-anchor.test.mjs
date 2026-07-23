import assert from "node:assert/strict";
import test from "node:test";
import { resolveHistoricalPreviousClose } from "../lib/historical-session-anchor.mjs";

test("historical replay keeps the previous close embedded in the session", () => {
  assert.equal(resolveHistoricalPreviousClose(
    { date: "20260717", previousClose: 39.93 },
    [{ date: "2026-07-16", close: 39.80 }],
  ), 39.93);
});

test("historical replay derives the latest daily close strictly before its date", () => {
  assert.equal(resolveHistoricalPreviousClose(
    { date: "20260717", previousClose: null },
    [
      { date: "2026-07-15", close: 41.20 },
      { date: "2026-07-16", close: 39.93 },
      { date: "2026-07-17", close: 37.82 },
      { date: "2026-07-22", close: 38.25 },
    ],
  ), 39.93);
});

test("historical replay never borrows a future close when no prior bar exists", () => {
  assert.equal(resolveHistoricalPreviousClose(
    { date: "20260717", previousClose: null },
    [
      { date: "2026-07-17", close: 37.82 },
      { date: "2026-07-22", close: 38.25 },
    ],
  ), null);
});
