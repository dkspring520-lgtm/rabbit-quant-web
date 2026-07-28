export function evaluateScannerHealth(scanState = {}, {
  now = Date.now(),
  serviceStartedAt = now,
  intervalMs = 15_000,
  tradingWindow = false,
} = {}) {
  const staleAfterMs = Math.max(90_000, Number(intervalMs || 0) * 6);
  const startupGrace = now - Number(serviceStartedAt || now) < staleAfterMs;
  const startedAt = Date.parse(scanState.lastStartedAt || "");
  const completedAt = Date.parse(scanState.lastCompletedAt || "");
  const runningTooLong = Boolean(
    tradingWindow && scanState.running && Number.isFinite(startedAt) && now - startedAt > staleAfterMs,
  );
  const heartbeatStale = Boolean(
    tradingWindow
      && !scanState.running
      && !startupGrace
      && (!Number.isFinite(completedAt) || now - completedAt > staleAfterMs),
  );
  const healthy = !runningTooLong && !heartbeatStale;
  return {
    healthy,
    reason: runningTooLong ? "scanner_run_timeout" : heartbeatStale ? "scanner_heartbeat_stale" : "ok",
    staleAfterMs,
    heartbeatAgeMs: Number.isFinite(completedAt) ? Math.max(0, now - completedAt) : null,
    runningAgeMs: Number.isFinite(startedAt) && scanState.running ? Math.max(0, now - startedAt) : null,
  };
}
