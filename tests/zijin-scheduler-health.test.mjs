import assert from "node:assert/strict";
import test from "node:test";
import { evaluateZijinSchedulerHealth } from "../lib/zijin-scheduler-health.mjs";

const now = Date.parse("2026-07-20T00:00:00Z");

test("running scheduler is healthy only while heartbeat is fresh", () => {
  const healthy = evaluateZijinSchedulerHealth({
    enabled: true,
    status: "running",
    heartbeatAt: "2026-07-19T23:59:30Z",
    nextCheckAt: "2026-07-20T00:30:00Z",
    staleAfterSeconds: 120,
  }, now);
  assert.equal(healthy.status, "running");

  const stale = evaluateZijinSchedulerHealth({
    enabled: true,
    status: "running",
    heartbeatAt: "2026-07-19T23:50:00Z",
    nextCheckAt: "2026-07-20T00:30:00Z",
    staleAfterSeconds: 120,
  }, now);
  assert.equal(stale.status, "offline");
  assert.equal(stale.label, "训练心跳超时");
});

test("idle scheduler becomes offline when it misses its next scheduled check", () => {
  const waiting = evaluateZijinSchedulerHealth({
    enabled: true,
    status: "idle",
    heartbeatAt: "2026-07-19T23:55:00Z",
    nextCheckAt: "2026-07-20T00:05:00Z",
    staleAfterSeconds: 120,
  }, now);
  assert.equal(waiting.status, "waiting");

  const offline = evaluateZijinSchedulerHealth({
    enabled: true,
    status: "idle",
    heartbeatAt: "2026-07-19T22:00:00Z",
    nextCheckAt: "2026-07-19T22:30:00Z",
    staleAfterSeconds: 120,
  }, now);
  assert.equal(offline.status, "offline");
  assert.equal(offline.label, "自动调度器离线");
  assert.ok(offline.overdueSeconds > 0);
});

test("failed and disabled schedulers are reported explicitly", () => {
  assert.equal(evaluateZijinSchedulerHealth({ enabled: false }, now).status, "disabled");
  assert.equal(evaluateZijinSchedulerHealth({ enabled: true, status: "failed", reason: "boom" }, now).status, "failed");
});
