import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const collector = await readFile(new URL("../scripts/zijin_l2_collector.py", import.meta.url), "utf8");
const compose = await readFile(new URL("../compose.web.yml", import.meta.url), "utf8");

test("Zijin L2 supports authorized-node failover without hanging on a bad node", () => {
  assert.match(compose, /L2_NATS_URL: nats:\/\/quote5\.base32\.cn:4222/);
  assert.match(compose, /L2_NATS_URLS: nats:\/\/quote5\.base32\.cn:4222/);
  assert.match(collector, /"L2_NATS_URLS"/);
  assert.match(collector, /await asyncio\.wait_for\(/);
  assert.match(collector, /timeout=5/);
  assert.match(collector, /is_live_a_share_session\(\)/);
  assert.match(collector, /self\.failover_reason = "stale-feed"/);
  assert.match(collector, /node_index = \(node_index \+ 1\) % len\(self\.urls\)/);
});
