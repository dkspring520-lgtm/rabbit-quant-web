import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientPollingInterval, passiveWatchlistItems, shouldRunClientPolling } from "../lib/client-polling-policy.mjs";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

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
  assert.match(page, /if\(inFlight\|\|!shouldRunClientPolling\(document\.visibilityState\)\)return;/);
  assert.match(page, /document\.addEventListener\('visibilitychange',onVisibility\)/);
});

test("the large trading desk clock does not force a full render every second", () => {
  assert.match(page, /window\.setInterval\(update,15_000\)/);
});

test("the active stock uses the one-second feed instead of a duplicate watchlist request", () => {
  const stocks = [{ code:"601899" }, { code:"601012" }, { code:"603993" }];
  assert.deepEqual(passiveWatchlistItems(stocks, "601899"), [stocks[1], stocks[2]]);
  assert.deepEqual(passiveWatchlistItems(stocks, ""), stocks);
  assert.match(page, /passiveWatchlistItems\(stockList,stock\?\.code\)/);
  assert.match(page, /setMarketQuotes\(current=>\(\{\.\.\.current,\[data\.quote\.code\]:data\.quote\}\)\)/);
  assert.match(page, /setMarketSnapshots\(current=>\(\{\.\.\.current,\[data\.quote\.code\]:data\}\)\)/);
});
