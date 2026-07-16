const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const TRADING_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: SHANGHAI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const INVALID_STATUSES = new Set([
  "invalid",
  "inactive",
  "void",
  "voided",
  "cancelled",
  "canceled",
  "rejected",
  "无效",
  "失效",
  "已失效",
  "作废",
  "已作废",
  "撤销",
  "已撤销",
]);

function isCalendarDate(value) {
  if (!TRADING_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function normalizedTradingDate(value) {
  if (typeof value === "string" && TRADING_DATE_PATTERN.test(value.trim())) {
    const date = value.trim();
    if (!isCalendarDate(date)) throw new RangeError("Invalid trading date");
    return date;
  }
  return tradeLedgerDate(value);
}

function normalizeSide(value) {
  const side = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (side === "买入" || side === "买" || side === "buy" || side === "b") {
    return "买入";
  }
  if (side === "卖出" || side === "卖" || side === "sell" || side === "s") {
    return "卖出";
  }
  return null;
}

function positiveNumber(value) {
  if (typeof value === "boolean" || value == null) return null;
  const prepared = typeof value === "string"
    ? value.trim().replace(/[,，\s]/g, "")
    : value;
  if (prepared === "") return null;
  const number = Number(prepared);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegativeShares(value) {
  const number = positiveNumber(value);
  return number === null ? 0 : Math.floor(number);
}

function isInvalidStatus(status) {
  return INVALID_STATUSES.has(status.trim().toLowerCase());
}

/** Return the calendar date at the supplied instant in the Shanghai time zone. */
export function tradeLedgerDate(value = new Date()) {
  if (typeof value === "string" && TRADING_DATE_PATTERN.test(value.trim())) {
    const date = value.trim();
    if (!isCalendarDate(date)) throw new RangeError("Invalid date");
    return date;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid date");

  const parts = Object.fromEntries(
    SHANGHAI_DATE_FORMATTER.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Build a Shanghai-date, account and stock scoped local-storage key. */
export function tradeLedgerKey(account, code, tradingDate = tradeLedgerDate()) {
  const date = normalizedTradingDate(tradingDate);
  const normalizedAccount = String(account ?? "").trim().toLowerCase();
  const normalizedCode = String(code ?? "").trim().toUpperCase();
  return `rabbit-trade-ledger:${date}:${normalizedAccount}:${normalizedCode}`;
}

/**
 * Normalize persisted manual trades for one trading date.
 *
 * Malformed rows, rows from another date and duplicate ids are discarded. A
 * structurally valid invalidated row is retained so the UI can keep its audit
 * trail; summarizeTradeLedger excludes it from every position calculation.
 */
export function normalizeTradeLedgerRows(raw, tradingDate = tradeLedgerDate()) {
  if (!Array.isArray(raw)) return [];
  const expectedDate = normalizedTradingDate(tradingDate);
  const ids = new Set();
  const normalized = [];

  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;

    const id = typeof row.id === "string" ? row.id.trim() : "";
    const rowDate = typeof row.tradingDate === "string"
      ? row.tradingDate.trim()
      : "";
    const side = normalizeSide(row.side);
    const price = positiveNumber(row.price);
    const quantity = positiveNumber(row.quantity);
    const status = typeof row.status === "string" ? row.status.trim() : "";

    if (!id
      || ids.has(id)
      || !isCalendarDate(rowDate)
      || rowDate !== expectedDate
      || !side
      || price === null
      || quantity === null
      || !Number.isInteger(quantity)
      || !status) {
      continue;
    }

    ids.add(id);
    normalized.push({
      ...row,
      id,
      tradingDate: rowDate,
      side,
      price,
      quantity,
      status,
    });
  }

  return normalized;
}

/** Summarize effective trades without hiding negative inventory. */
export function summarizeTradeLedger(
  raw,
  position = {},
  tradingDate = tradeLedgerDate(),
) {
  const rows = normalizeTradeLedgerRows(raw, tradingDate);
  const effectiveRows = rows.filter((row) => !isInvalidStatus(row.status));
  let bought = 0;
  let sold = 0;

  for (const row of effectiveRows) {
    if (row.side === "买入") bought += row.quantity;
    else sold += row.quantity;
  }

  const openingShares = nonNegativeShares(position?.openingShares);
  const plannedBase = nonNegativeShares(position?.plannedBase);
  const sellable = nonNegativeShares(position?.sellable);
  const rawCurrentShares = openingShares + bought - sold;

  return {
    rows,
    validCount: effectiveRows.length,
    bought,
    sold,
    rawCurrentShares,
    currentShares: rawCurrentShares,
    remainingSellable: Math.max(0, sellable - sold),
    targetGap: rawCurrentShares - plannedBase,
    oversold: rawCurrentShares < 0 || sold > sellable,
  };
}
