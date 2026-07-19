export const MEMBER_WATCHLIST_LIMIT = 5;
export const ADMIN_WATCHLIST_LIMIT = 30;

export function watchlistLimitForRole(role) {
  return role === "admin" ? ADMIN_WATCHLIST_LIMIT : MEMBER_WATCHLIST_LIMIT;
}

export function enforceWatchlistLimit(items, role) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, watchlistLimitForRole(role));
}
