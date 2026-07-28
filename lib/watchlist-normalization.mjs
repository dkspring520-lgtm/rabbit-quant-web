export function normalizeWatchlistEntries(entries, canonicalNames = {}) {
  const unique = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const code = String(entry?.code ?? "").trim();
    if (!/^\d{6}$/.test(code) || unique.has(code)) continue;
    unique.set(code, {
      ...entry,
      code,
      name: canonicalNames[code] ?? (String(entry?.name ?? "").trim() || code),
    });
  }
  return [...unique.values()];
}
