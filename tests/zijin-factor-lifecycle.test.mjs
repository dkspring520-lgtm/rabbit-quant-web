import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildZijinFactorDailyRun,
  createZijinFactorRegistry,
  hashZijinFactorLedgerRecord,
  normalizeZijinFactorRegistry,
} from "../lib/zijin-factor-lifecycle.mjs";

const compose = await readFile(new URL("../compose.web.yml", import.meta.url), "utf8");
const dailyScript = await readFile(new URL("../scripts/zijin-factor-daily.mjs", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/research/zijin-factor-lifecycle/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/authenticated-app.tsx", import.meta.url), "utf8");

test("registry keeps the two current factor combinations shadow-only", () => {
  const registry = createZijinFactorRegistry({ generatedAt: "2026-08-04T00:00:00.000Z" });
  assert.equal(registry.stock.code, "601899");
  assert.equal(registry.formalStrategy.writeEnabled, false);
  assert.equal(registry.formalStrategy.factorWritesAllowed, false);
  assert.deepEqual(registry.pools.formal, []);
  assert.deepEqual(registry.pools.shadow, ["zijin_peer_momentum", "ashare_vwap_volume"]);
  assert.equal(registry.factors.length, 2);
  assert.ok(registry.factors.every(factor => factor.pool === "shadow" && factor.affectsFormalStrategy === false && factor.sendsAlerts === false));
});

test("normalization cannot turn a persisted factor into a formal write", () => {
  const normalized = normalizeZijinFactorRegistry({
    formalStrategy: { writeEnabled: true, factorWritesAllowed: true },
    scheduler: { shadowOnly: false },
    factors: [{ id: "unsafe", pool: "formal", affectsFormalStrategy: true, sendsAlerts: true }],
  });
  assert.equal(normalized.formalStrategy.writeEnabled, false);
  assert.equal(normalized.formalStrategy.factorWritesAllowed, false);
  assert.equal(normalized.scheduler.shadowOnly, true);
  assert.equal(normalized.factors[0].affectsFormalStrategy, false);
  assert.equal(normalized.factors[0].sendsAlerts, false);
});

test("daily run records shadow decisions and deterministic chained integrity", () => {
  const registry = createZijinFactorRegistry();
  const run = buildZijinFactorDailyRun({
    registry,
    marketDate: "2026-08-04",
    scheduledAt: "2026-08-04T07:20:00.000Z",
    shadowState: { integrity: { eventCount: 12 }, meta: { source: "runtime" } },
  });
  assert.equal(run.status, "completed");
  assert.equal(run.mode, "shadow-only");
  assert.equal(run.summary.total, 2);
  assert.equal(run.summary.formal, 0);
  assert.equal(run.summary.shadowEvents, 12);
  assert.ok(run.factors.every(factor => factor.decision === "continue-shadow" && factor.eligibleForFormal === false));
  const first = hashZijinFactorLedgerRecord(run);
  assert.equal(first, hashZijinFactorLedgerRecord(run));
  assert.notEqual(first, hashZijinFactorLedgerRecord(run, "different-previous-hash"));
});

test("daily scheduler and main-site read-only display are wired", () => {
  assert.match(compose, /factor-daily:/);
  assert.match(compose, /entrypoint: \["node"\]/);
  assert.match(compose, /scripts\/zijin-factor-daily\.mjs/);
  assert.match(compose, /ZIJIN_FACTOR_DAILY_STATE_PATH/);
  assert.match(compose, /ZIJIN_FACTOR_DAILY_LEDGER_PATH/);
  assert.match(dailyScript, /--daemon/);
  assert.match(dailyScript, /shadow-only scheduler active/);
  assert.match(route, /formalStrategyWriteEnabled: false/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.match(page, /\/api\/research\/zijin-factor-lifecycle/);
  assert.match(page, /ZijinFactorLifecyclePanel/);
  assert.match(page, /不自动进入 V4/);
});
