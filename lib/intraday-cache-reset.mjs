export const RESETTABLE_PREFIXES = Object.freeze([
  "rabbit-chart-observations:",
  "rabbit-formal-chart-actions:",
  "rabbit-alert-history:",
]);

export function isPreopenResetWindow({ phase, time } = {}) {
  return phase === "auction-result" && /^092[5-9]$/.test(String(time ?? ""));
}

export function resetIntradayCaches({ storage, accountName, code, date } = {}) {
  if (!storage || !accountName || !code || !/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ""))) return [];
  const account = String(accountName).toLowerCase();
  const targets = [
    `rabbit-chart-observations:${account}:${code}:${date}`,
    `rabbit-formal-chart-actions:${account}:${code}:${date}`,
    `rabbit-alert-history:${account}`,
  ];
  const removed = [];
  for (const key of targets) {
    try {
      if (storage.getItem(key) !== null) {
        storage.removeItem(key);
        removed.push(key);
      }
    } catch {}
  }
  return removed;
}
