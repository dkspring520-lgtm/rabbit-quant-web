import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const compose = await readFile(new URL("../compose.web.yml", import.meta.url), "utf8");
const dockerfile = await readFile(new URL("../Dockerfile.trainer", import.meta.url), "utf8");
const supervisor = await readFile(new URL("../scripts/zijin-trainer-supervisor.py", import.meta.url), "utf8");
const healthcheck = await readFile(new URL("../scripts/zijin-trainer-healthcheck.py", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/research/zijin-training-progress/route.ts", import.meta.url), "utf8");

test("production runs Zijin research in an isolated restartable container", () => {
  assert.match(compose, /trainer:/);
  assert.match(compose, /dockerfile: Dockerfile\.trainer/);
  assert.match(compose, /container_name: rabbit-quant-zijin-trainer/);
  assert.match(compose, /restart: unless-stopped/);
  assert.match(compose, /\/opt\/rabbit-quant-research:\/training-data:ro/);
  assert.match(compose, /\/opt\/rabbit-quant-state:\/training-state/);
  assert.match(compose, /\/opt\/rabbit-quant-training-runtime:\/training-runtime/);
  assert.match(compose, /ZIJIN_IDLE_HEARTBEAT_SECONDS:/);
  assert.match(dockerfile, /FROM python:3\.12-slim/);
  assert.match(dockerfile, /requirements\.trainer\.txt/);
});

test("trainer supervisor turns stale heartbeat into a Docker restart and an audit alert", () => {
  assert.match(supervisor, /scheduler_health/);
  assert.match(supervisor, /heartbeat-timeout/);
  assert.match(supervisor, /exit-for-docker-restart/);
  assert.match(supervisor, /os\.fsync/);
  assert.match(supervisor, /raise SystemExit\(75\)/);
  assert.match(healthcheck, /raise SystemExit\(0 if healthy else 1\)/);
  assert.match(route, /ZIJIN_TRAINER_ALERTS_PATH/);
  assert.match(route, /trainerAlert/);
});
