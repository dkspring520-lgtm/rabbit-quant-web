import test from "node:test";
import assert from "node:assert/strict";
import { clientPollingInterval, shouldRunClientPolling } from "../lib/client-polling-policy.mjs";

test("visible trading desk keeps the one-second active quote and five-second watchlist", () => {
  assert.equal(clientPollingInterval("activeQuote", true), 1_000);
  assert.equal(clientPollingInterval("watchlist", true), 5_000);
});

test("closed market data refreshes slowly without pretending to be realtime", () => {
  assert.equal(clientPollingInterval("activeQuote", false), 30_000);
  assert.equal(clientPollingInterval("watchlist", false), 30_000);
  assert.equal(clientPollingInterval("marketContext", false), 180_000);
  assert.equal(clientPollingInterval("eventRadar", false), 180_000);
});

test("browser polling stops while hidden because the control-plane remains responsible", () => {
  assert.equal(shouldRunClientPolling("visible"), true);
  assert.equal(shouldRunClientPolling("hidden"), false);
  assert.equal(shouldRunClientPolling("prerender"), false);
});

