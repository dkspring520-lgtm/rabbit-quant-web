export type StockPosition = {
  v: 1;
  code: string;
  plannedBase: number;
  openingShares: number;
  sellable: number;
  needsConfirmation: boolean;
  updatedAt: string | null;
  migratedFrom?: string;
};

export type LegacyPositionPreferences = {
  stock?: string | { code?: string } | null;
  baseShares?: number | string | null;
} | null;

export type StorageLike = {
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
} | null;

export function stockPositionKey(account: unknown, code: unknown): string;
export function normalizeStockPosition(raw: unknown, code: unknown): StockPosition;
export function migrateLegacyPosition(legacy: LegacyPositionPreferences, code: unknown, allowMigration?: boolean): StockPosition;
export function loadStockPosition(storage: StorageLike, account: unknown, code: unknown, legacy?: LegacyPositionPreferences, allowLegacyMigration?: boolean): StockPosition;
export function saveStockPosition(storage: StorageLike, account: unknown, position: Partial<StockPosition> & { code?: unknown }, now?: string): StockPosition;
export function confirmStockPosition(storage: StorageLike, account: unknown, position: Partial<StockPosition> & { code?: unknown }, now?: string): StockPosition;
