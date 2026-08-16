import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REFERENCE_DATA_BOOTSTRAP_DELAY_MS, clientPollingInterval, isFastMarketDataPhase, passiveWatchlistItems, shouldRunClientPolling, shouldRunTradingDeskPolling } from "../lib/client-polling-policy.mjs";

const page = readFileSync(new URL("../app/authenticated-app.tsx", import.meta.url), "utf8");
const l2Route = readFileSync(new URL("../app/api/research/zijin-l2-orderflow/route.ts", import.meta.url), "utf8");

test("visible trading desk keeps a one-second lightweight quote and five-second charts", () => {
  assert.equal(clientPollingInterval("activeQuote", true), 1_000);
  assert.equal(clientPollingInterval("activeChart", true), 5_000);
  assert.equal(clientPollingInterval("watchlist", true), 5_000);
  assert.match(page, /mode=trial-quote/);
  assert.match(page, /clientPollingInterval\("activeChart",marketDataActive\)/);
});

test("call auction refreshes market data quickly without enabling execution", () => {
  assert.equal(isFastMarketDataPhase({ phase:"preauction", live:false }), false);
  assert.equal(isFastMarketDataPhase({ phase:"auction", live:false }), true);
  assert.equal(isFastMarketDataPhase({ phase:"auction-result", live:false }), true);
  assert.equal(isFastMarketDataPhase({ phase:"morning", live:true }), true);
  assert.equal(isFastMarketDataPhase({ phase:"lunch", live:false }), false);
  assert.match(page, /marketDataActive\?300:60_000/);
  assert.match(page, /clientPollingInterval\("activeQuote",marketDataActive\)/);
  assert.match(page, /clientPollingInterval\("watchlist",marketDataActive\)/);
});

test("closed market data refreshes slowly without pretending to be realtime", () => {
  assert.equal(clientPollingInterval("activeQuote", false), 30_000);
  assert.equal(clientPollingInterval("activeChart", false), 30_000);
  assert.equal(clientPollingInterval("watchlist", false), 30_000);
  assert.equal(clientPollingInterval("referenceData", false), 300_000);
  assert.equal(clientPollingInterval("deskSnapshot", false), 180_000);
});

test("historical reference payload is not downloaded at the live quote frequency", () => {
  assert.equal(REFERENCE_DATA_BOOTSTRAP_DELAY_MS, 1_500);
  assert.equal(clientPollingInterval("referenceData", true), 300_000);
  assert.equal(clientPollingInterval("deskSnapshot", true), 60_000);
  assert.match(page, /window\.setTimeout\(start,REFERENCE_DATA_BOOTSTRAP_DELAY_MS\)/);
  assert.match(page, /clientPollingInterval\("referenceData",marketDataActive\)/);
  assert.match(page, /clientPollingInterval\("deskSnapshot",marketDataActive\)/);
  assert.match(page, /market: "0"/);
  assert.match(page, /params\.set\("change",String\(latestChange\)\)/);
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

test("high-frequency desk polling only runs on the visible trading desk", () => {
  assert.equal(shouldRunTradingDeskPolling("操盘台", "visible"), true);
  assert.equal(shouldRunTradingDeskPolling("首页", "visible"), false);
  assert.equal(shouldRunTradingDeskPolling("智能训练", "visible"), false);
  assert.equal(shouldRunTradingDeskPolling("操盘台", "hidden"), false);
  assert.match(page, /shouldRunTradingDeskPolling\(activeView,document\.visibilityState\)/);
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

test("live quote and L2 fallback recover quickly from a stalled request", () => {
  assert.match(page, /timeoutMs:1_800,key:`trading-desk-quote:\$\{stock\.code\}`/);
  assert.match(page, /timeoutMs:1_500,key:"zijin-l2-orderflow-poll"/);
});

test("L2 stream backfills minute history once and then sends incremental snapshots", () => {
  assert.match(l2Route, /let initialSnapshot = true/);
  assert.match(l2Route, /initialSnapshot[\s\S]*?recentMinutes: \[\]/);
  assert.match(l2Route, /lastSnapshotAt >= 2_500/);
});
