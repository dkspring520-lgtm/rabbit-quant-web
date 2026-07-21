import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/market-data/route.ts", import.meta.url), "utf8");

test("one-second quote mode does not download the full minute chart", () => {
  const start = route.indexOf('if (mode === "trial-quote")');
  const end = route.indexOf('if (mode === "trial-realtime")');
  assert.ok(start >= 0 && end > start);
  const quoteBranch = route.slice(start, end);
  assert.match(quoteBranch, /fromPublicQuote\(code\)/);
  assert.doesNotMatch(quoteBranch, /fromPublicMinutes\(code\)/);
  assert.match(quoteBranch, /minutes: \[\]/);
});

test("five-second chart mode still loads the complete current minute series", () => {
  const start = route.indexOf('if (mode === "trial-realtime")');
  const end = route.indexOf('const \[bars, quoteResult');
  assert.ok(start >= 0 && end > start);
  assert.match(route.slice(start, end), /fromPublicMinutes\(code\)/);
  assert.match(route.slice(start, end), /assessMarketDataQuality/);
});

test("realtime response exposes provider quality and source failover", () => {
  assert.match(route, /minuteProvider/);
  assert.match(route, /quoteFailures/);
  assert.match(route, /quality/);
  assert.match(route, /fallbackOrder/);
});
