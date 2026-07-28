import test from "node:test";
import assert from "node:assert/strict";
import { advanceScannerWatchdog } from "../lib/scanner-watchdog.mjs";

test("scanner watchdog restarts only after two consecutive unhealthy checks", () => {
  const first = advanceScannerWatchdog(0, { healthy: false, reason: "scanner_heartbeat_stale" });
  const second = advanceScannerWatchdog(first.failures, { healthy: false, reason: "scanner_heartbeat_stale" });
  assert.equal(first.restart, false);
  assert.equal(second.restart, true);
  assert.equal(second.reason, "scanner_heartbeat_stale");
});

test("scanner watchdog clears its failure streak after recovery", () => {
  assert.deepEqual(advanceScannerWatchdog(1, { healthy: true }), { failures: 0, restart: false, reason: "ok" });
});
