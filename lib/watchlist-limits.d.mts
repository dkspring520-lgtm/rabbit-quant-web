export const FREE_WATCHLIST_LIMIT: number;
export const MEMBER_WATCHLIST_LIMIT: number;
export const ADMIN_WATCHLIST_LIMIT: number;
export function watchlistLimitForRole(role: string, membershipActive?: boolean, membershipPlanId?: string|null): number;
export function enforceWatchlistLimit<T>(items: T[], role: string, membershipActive?: boolean, membershipPlanId?: string|null): T[];
