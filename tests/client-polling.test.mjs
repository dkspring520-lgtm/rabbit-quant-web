import assert from "node:assert/strict";
import test from "node:test";
import { clientFetch, resetClientPollingForTests } from "../lib/client-polling.mjs";

test.afterEach(() => {
  resetClientPollingForTests();
});

test("client requests deduplicate concurrent GETs", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let release;
  globalThis.fetch = () => {
    calls += 1;
    return new Promise(resolve => { release = resolve; });
  };
  try {
    const first = clientFetch("/api/market-data?code=601899");
    const second = clientFetch("/api/market-data?code=601899");
    assert.strictEqual(first, second);
    release({ ok: true });
    await Promise.all([first, second]);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("client requests abort after the configured timeout", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  try {
    await assert.rejects(
      clientFetch("/api/market-data?code=601899", {}, { timeoutMs: 5 }),
      /aborted/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
