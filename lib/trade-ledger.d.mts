export type TradeLedgerSide = "买入" | "卖出";

export type TradeLedgerRow = {
  [key: string]: unknown;
  id: string;
  tradingDate: string;
  side: TradeLedgerSide;
  price: number;
  quantity: number;
  status: string;
  time?: string;
  cycle?: string;
  fee?: string;
  result?: string;
};

export type TradeLedgerPositionInput = {
  openingShares?: unknown;
  plannedBase?: unknown;
  sellable?: unknown;
} | null;

export type TradeLedgerSummary = {
  rows: TradeLedgerRow[];
  validCount: number;
  bought: number;
  sold: number;
  rawCurrentShares: number;
  currentShares: number;
  remainingSellable: number;
  targetGap: number;
  oversold: boolean;
};

export function tradeLedgerDate(value?: Date | string | number): string;
export function tradeLedgerKey(
  account: unknown,
  code: unknown,
  tradingDate?: Date | string | number,
): string;
export function normalizeTradeLedgerRows(
  raw: unknown,
  tradingDate?: Date | string | number,
): TradeLedgerRow[];
export function summarizeTradeLedger(
  raw: unknown,
  position?: TradeLedgerPositionInput,
  tradingDate?: Date | string | number,
): TradeLedgerSummary;
