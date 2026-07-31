import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const collector = await readFile(new URL("../scripts/zijin_l2_collector.py", import.meta.url), "utf8");
const compose = await readFile(new URL("../compose.web.yml", import.meta.url), "utf8");

test("Zijin L2 rotates through verified nodes when the active live feed becomes stale", () => {
  assert.match(compose, /L2_NATS_URLS: nats:\/\/quote6[^,\n]+,nats:\/\/quote2[^,\n]+,nats:\/\/quote1[^,\n]+,nats:\/\/quote5[^\n]+/);
  assert.match(collector, /is_live_a_share_session\(\)/);
  assert.match(collector, /self\.failover_reason = "stale-feed"/);
  assert.match(collector, /node_index = \(node_index \+ 1\) % len\(self\.urls\)/);
});
