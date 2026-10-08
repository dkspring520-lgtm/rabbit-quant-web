import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/research/zijin-l2-orderflow/route.ts", import.meta.url), "utf8");

test("L2 route derives freshness from live evidence", () => {
  assert.match(route, /COLLECTOR_HEARTBEAT_MAX_AGE_SECONDS = 15/);
  assert.match(route, /FEED_MAX_AGE_SECONDS = 15/);
  assert.match(route, /Object\.values\(messageCounts\)\.some/);
  assert.match(route, /feedAgeSeconds <= FEED_MAX_AGE_SECONDS/);
  assert.match(route, /payload\.status\?\.stale === true/);
  assert.match(route, /!collectorAlive \|\| !transportConnected \|\| !authorized \|\| !feedFresh \|\| !hasMessages \|\| explicitlyStale/);
});

test("legacy omitted stale field is not automatically stale", () => {
  assert.doesNotMatch(route, /const feedStale = payload\.status\?\.stale !== false/);
});
