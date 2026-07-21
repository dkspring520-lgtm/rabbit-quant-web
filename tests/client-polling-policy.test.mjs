import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientPollingInterval, passiveWatchlistItems, shouldRunClientPolling } from "../lib/client-polling-policy.mjs";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("visible trading desk keeps a one-second lightweight quote and five-second charts", () => {
  assert.equal(clientPollingInterval("activeQuote", true), 1_000);
  assert.equal(clientPollingInterval("activeChart", true), 5_000);
  assert.equal(clientPollingInterval("watchlist", true), 5_000);
  assert.match(page, /mode=trial-quote/);
  assert.match(page, /clientPollingInterval\("activeChart",marketSession\.live\)/);
});

test("closed market data refreshes slowly without pretending to be realtime", () => {
  assert.equal(clientPollingInterval("activeQuote", false), 30_000);
  assert.equal(clientPollingInterval("activeChart", false), 30_000);
  assert.equal(clientPollingInterval("watchlist", false), 30_000);
  assert.equal(clientPollingInterval("referenceData", false), 300_000);
  assert.equal(clientPollingInterval("deskSnapshot", false), 180_000);
});

test("historical reference payload is not downloaded at the live quote frequency", () => {
  assert.equal(clientPollingInterval("referenceData", true), 300_000);
  assert.equal(clientPollingInterval("deskSnapshot", true), 60_000);
  assert.match(page, /clientPollingInterval\("referenceData", marketSession\.live\)/);
  assert.match(page, /clientPollingInterval\("deskSnapshot",marketSession\.live\)/);
  assert.doesNotMatch(page, /fetch\(`\/api\/market-context/);
  assert.doesNotMatch(page, /fetch\(`\/api\/event-radar/);
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
  assert.match(page, /minutes:current\.minutes, bars:current\.bars, intradaySessions:current\.intradaySessions/);
});
