export function advanceScannerWatchdog(previousFailures = 0, scannerHealth = {}) {
  if (scannerHealth.healthy !== false) return { failures: 0, restart: false, reason: "ok" };
  const failures = Math.max(0, Number(previousFailures) || 0) + 1;
  return {
    failures,
    restart: failures >= 2,
    reason: scannerHealth.reason || "scanner_unhealthy",
  };
}
