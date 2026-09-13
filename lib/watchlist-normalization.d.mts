export type WatchlistEntry = { code?: string; name?: string; [key: string]: unknown };
export function normalizeWatchlistEntries<T extends WatchlistEntry>(entries: T[], canonicalNames?: Record<string, string>): Array<T & { code: string; name: string }>;
