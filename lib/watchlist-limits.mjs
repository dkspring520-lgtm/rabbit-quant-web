export const FREE_WATCHLIST_LIMIT = 2;
export const MEMBER_WATCHLIST_LIMIT = 5;
export const ADMIN_WATCHLIST_LIMIT = 30;

export function watchlistLimitForRole(role, membershipActive = false) {
  if (role === "admin") return ADMIN_WATCHLIST_LIMIT;
  return membershipActive ? MEMBER_WATCHLIST_LIMIT : FREE_WATCHLIST_LIMIT;
}

export function enforceWatchlistLimit(items, role, membershipActive = false) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, watchlistLimitForRole(role, membershipActive));
}
