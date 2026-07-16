const POSITION_VERSION = 1;
const LEGACY_MIGRATION_SOURCE = "rabbit-prefs.baseShares";

function normalizeCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

function legacyStockCode(legacy) {
  const stock = legacy?.stock;
  if (stock && typeof stock === "object") return normalizeCode(stock.code);
  const text = String(stock ?? "").trim();
  const sixDigitCode = text.match(/\d{6}/)?.[0];
  return normalizeCode(sixDigitCode ?? text.split(/\s+/)[0]);
}

function emptyPosition(code) {
  return {
    v: POSITION_VERSION,
    code: normalizeCode(code),
    plannedBase: 0,
    openingShares: 0,
    sellable: 0,
    needsConfirmation: false,
    updatedAt: null,
  };
}

/** Build the account-and-stock scoped local-storage key. */
export function stockPositionKey(account, code) {
  const accountLower = String(account ?? "").trim().toLowerCase();
  return `rabbit-position:${accountLower}:${normalizeCode(code)}`;
}

/**
 * Normalize persisted or user-entered position data.
 * The stock code is supplied by the caller and cannot be overridden by stale data.
 */
export function normalizeStockPosition(raw, code) {
  const normalized = emptyPosition(code);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return normalized;

  normalized.plannedBase = nonNegativeInteger(raw.plannedBase);
  normalized.openingShares = nonNegativeInteger(raw.openingShares);
  normalized.sellable = Math.min(
    normalized.openingShares,
    nonNegativeInteger(raw.sellable),
  );
  normalized.updatedAt = typeof raw.updatedAt === "string" && raw.updatedAt.trim()
    ? raw.updatedAt
    : null;

  const isLegacyMigration = raw.migratedFrom === LEGACY_MIGRATION_SOURCE;
  normalized.needsConfirmation = raw.needsConfirmation === true
    || (raw.needsConfirmation == null && isLegacyMigration);

  if (typeof raw.migratedFrom === "string" && raw.migratedFrom.trim()) {
    normalized.migratedFrom = raw.migratedFrom;
  }

  // Older builds treated the global baseShares preference as real, sellable
  // inventory. Repair those persisted records on read: the old value is only a
  // planned target until the user confirms the actual opening position.
  if (isLegacyMigration && normalized.needsConfirmation) {
    normalized.openingShares = 0;
    normalized.sellable = 0;
  }
  return normalized;
}

/**
 * Import the old global baseShares setting only when the caller has proved the
 * preferences really came from persisted legacy storage. The old value is a
 * planning hint, never proof that shares are currently held or sellable.
 */
export function migrateLegacyPosition(legacy, code, allowMigration = false) {
  const normalizedCode = normalizeCode(code);
  if (!allowMigration || !normalizedCode || normalizedCode !== legacyStockCode(legacy)) {
    return emptyPosition(normalizedCode);
  }

  const shares = nonNegativeInteger(legacy?.baseShares);
  if (shares === 0) return emptyPosition(normalizedCode);

  return {
    v: POSITION_VERSION,
    code: normalizedCode,
    plannedBase: shares,
    openingShares: 0,
    sellable: 0,
    needsConfirmation: true,
    updatedAt: null,
    migratedFrom: LEGACY_MIGRATION_SOURCE,
  };
}

/** Load a saved position, falling back safely to the one-time legacy model. */
export function loadStockPosition(
  storage,
  account,
  code,
  legacy = null,
  allowLegacyMigration = false,
) {
  try {
    const serialized = storage?.getItem?.(stockPositionKey(account, code));
    if (typeof serialized === "string" && serialized.trim()) {
      return normalizeStockPosition(JSON.parse(serialized), code);
    }
  } catch {
    // Unavailable storage and malformed JSON both use the safe migration path.
  }
  return migrateLegacyPosition(legacy, code, allowLegacyMigration);
}

/**
 * Persist a normalized stock position. The normalized value is returned even
 * when storage is unavailable, allowing the UI to keep its in-memory state.
 */
export function saveStockPosition(storage, account, position, now = new Date().toISOString()) {
  const normalized = normalizeStockPosition(position, position?.code);
  const saved = {
    ...normalized,
    updatedAt: typeof now === "string" && now.trim() ? now : new Date().toISOString(),
  };
  try {
    storage?.setItem?.(stockPositionKey(account, saved.code), JSON.stringify(saved));
  } catch {
    // Browser privacy modes can reject local storage; callers still get `saved`.
  }
  return saved;
}

/**
 * Persist a position after an explicit user confirmation. This is deliberately
 * separate from saveStockPosition because the UI also performs automatic
 * persistence, which must never turn an unverified legacy hint into inventory.
 */
export function confirmStockPosition(
  storage,
  account,
  position,
  now = new Date().toISOString(),
) {
  const normalized = normalizeStockPosition({
    ...position,
    migratedFrom: undefined,
    needsConfirmation: false,
  }, position?.code);
  const confirmed = {
    ...normalized,
    needsConfirmation: false,
    updatedAt: typeof now === "string" && now.trim() ? now : new Date().toISOString(),
  };
  try {
    storage?.setItem?.(
      stockPositionKey(account, confirmed.code),
      JSON.stringify(confirmed),
    );
  } catch {
    // Browser privacy modes can reject local storage; callers still get state.
  }
  return confirmed;
}
