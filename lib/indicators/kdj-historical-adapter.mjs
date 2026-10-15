import { normalizeMarketBars } from "../paper-trading/historical-data-adapter.mjs";

// Keep the audited legacy normalizer byte-for-byte unchanged. This opt-in
// adapter carries raw KDJ provenance alongside, never asserting completion.
export function normalizeKdjMarketBars(rows = [], options = {}) {
  const source = Array.isArray(rows) ? rows : [];
  const normalized = normalizeMarketBars(source, options);
  // Reuse legacy row admission to preserve its exact order, duplicate and
  // missing-row behavior without copying numeric/time normalization rules.
  const admittedRaw = source.filter(row => normalizeMarketBars([row], options).bars.length === 1);
  if (admittedRaw.length !== normalized.bars.length) throw new Error("LEGACY_ROW_ALIGNMENT_CHANGED");
  return { ...normalized, bars: normalized.bars.map((bar, index) => ({ ...bar,
    kdjInput: structuredClone(admittedRaw[index].kdjInput ?? admittedRaw[index]),
  })) };
}
