const activePollingLoops = new Map();
const inFlightRequests = new Map();

function requestKey(input, init = {}) {
  const method = String(init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return "";
  const value = typeof input === "string" ? input : input?.url;
  return value ? `${method}:${value}` : "";
}

function mergeSignals(primary, timeoutSignal) {
  if (!primary) return timeoutSignal;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([primary, timeoutSignal]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (primary.aborted || timeoutSignal.aborted) abort();
  else {
    primary.addEventListener("abort", abort, { once: true });
    timeoutSignal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

export function clientFetch(input, init = {}, { timeoutMs = 12_000, key } = {}) {
  const dedupeKey = key ?? requestKey(input, init);
  if (dedupeKey && inFlightRequests.has(dedupeKey)) return inFlightRequests.get(dedupeKey);

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const request = fetch(input, {
    ...init,
    signal: mergeSignals(init.signal, controller.signal),
  }).finally(() => {
    globalThis.clearTimeout(timeout);
    if (dedupeKey && inFlightRequests.get(dedupeKey) === request) inFlightRequests.delete(dedupeKey);
  });
  if (dedupeKey) inFlightRequests.set(dedupeKey, request);
  return request;
}

export function startClientPolling({ key, intervalMs, run, enabled = () => true, runImmediately = true }) {
  activePollingLoops.get(key)?.();
  let stopped = false;
  let running = false;
  let timer;

  const tick = async () => {
    if (stopped || running || !enabled()) return;
    running = true;
    try {
      await run();
    } catch {
      // A single stale or aborted refresh must not create an unhandled
      // rejection or permanently wedge the next polling tick.
    } finally {
      running = false;
    }
  };
  const onVisibility = () => {
    if (enabled()) void tick();
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    globalThis.clearInterval(timer);
    globalThis.document?.removeEventListener("visibilitychange", onVisibility);
    if (activePollingLoops.get(key) === stop) activePollingLoops.delete(key);
  };

  timer = globalThis.setInterval(() => void tick(), intervalMs);
  globalThis.document?.addEventListener("visibilitychange", onVisibility);
  activePollingLoops.set(key, stop);
  if (runImmediately) void tick();
  return stop;
}

export function resetClientPollingForTests() {
  for (const stop of activePollingLoops.values()) stop();
  activePollingLoops.clear();
  inFlightRequests.clear();
}
