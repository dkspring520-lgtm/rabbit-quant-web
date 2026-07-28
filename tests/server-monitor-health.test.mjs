import test from "node:test";
import assert from "node:assert/strict";
import { evaluateScannerHealth } from "../lib/server-monitor-health.mjs";

const now = Date.parse("2026-07-21T02:00:00.000Z");

test("scanner health stays quiet outside the trading window", () => {
  const health = evaluateScannerHealth({}, {
    now,
    serviceStartedAt: now - 600_000,
    intervalMs: 15_000,
    tradingWindow: false,
  });
  assert.equal(health.healthy, true);
  assert.equal(health.reason, "ok");
});

test("scanner health allows a startup grace period during trading", () => {
  const health = evaluateScannerHealth({}, {
    now,
    serviceStartedAt: now - 30_000,
    intervalMs: 15_000,
    tradingWindow: true,
  });
  assert.equal(health.healthy, true);
});

test("scanner health rejects a stale trading heartbeat", () => {
  const health = evaluateScannerHealth({ running: false, lastCompletedAt: new Date(now - 120_000).toISOString() }, {
    now,
    serviceStartedAt: now - 600_000,
    intervalMs: 15_000,
    tradingWindow: true,
  });
  assert.equal(health.healthy, false);
  assert.equal(health.reason, "scanner_heartbeat_stale");
});

test("scanner health rejects a scan that never finishes", () => {
  const health = evaluateScannerHealth({ running: true, lastStartedAt: new Date(now - 120_000).toISOString() }, {
    now,
    serviceStartedAt: now - 600_000,
    intervalMs: 15_000,
    tradingWindow: true,
  });
  assert.equal(health.healthy, false);
  assert.equal(health.reason, "scanner_run_timeout");
});
