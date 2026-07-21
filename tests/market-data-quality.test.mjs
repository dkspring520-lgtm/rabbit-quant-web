import test from "node:test";
import assert from "node:assert/strict";
import { assessMarketDataQuality } from "../lib/market-data-quality.mjs";

function points(count, start = 9 * 60 + 30) {
  return Array.from({ length: count }, (_, index) => {
    const minute = start + index;
    return { time: `${String(Math.floor(minute / 60)).padStart(2, "0")}${String(minute % 60).padStart(2, "0")}`, price: 10 + index / 100, volume: 1000 };
  });
}

test("fresh Tencent quote and continuous minutes can produce a live signal", () => {
  const now = new Date("2026-07-21T01:40:30.000Z"); // 09:40:30 Shanghai
  const quality = assessMarketDataQuality({ provider: "tencent-public", sourceTimestamp: "2026-07-21T09:40:20+08:00", fetchedAt: now.toISOString(), minutes: points(11), requestedRealtime: true, now });
  assert.equal(quality.status, "live");
  assert.equal(quality.signalEligible, true);
  assert.equal(quality.minuteLag, 0);
});

test("stale quote is displayed but blocked from signal generation", () => {
  const now = new Date("2026-07-21T01:40:30.000Z");
  const quality = assessMarketDataQuality({ provider: "tencent-public", sourceTimestamp: "2026-07-21T09:35:00+08:00", fetchedAt: now.toISOString(), minutes: points(11), requestedRealtime: true, now });
  assert.equal(quality.status, "blocked");
  assert.equal(quality.signalEligible, false);
  assert.match(quality.reasons.join(" "), /延迟/);
});

test("fallback provider is explicit while fresh fallback data remains degraded", () => {
  const now = new Date("2026-07-21T01:40:30.000Z");
  const quality = assessMarketDataQuality({ provider: "sina-public", sourceTimestamp: "2026-07-21T09:40:25+08:00", fetchedAt: now.toISOString(), minutes: points(11), requestedRealtime: true, quoteFailures: ["腾讯行情不可用"], now });
  assert.equal(quality.status, "degraded");
  assert.equal(quality.signalEligible, true);
  assert.equal(quality.fallbackUsed, true);
  assert.match(quality.reasons.join(" "), /降级/);
});

test("closed market data never creates realtime signals", () => {
  const now = new Date("2026-07-21T16:30:00.000Z"); // 00:30 Shanghai
  const quality = assessMarketDataQuality({ provider: "tencent-public", sourceTimestamp: "2026-07-21T15:00:00+08:00", fetchedAt: now.toISOString(), minutes: points(20), requestedRealtime: true, now });
  assert.equal(quality.status, "closed");
  assert.equal(quality.signalEligible, false);
});
