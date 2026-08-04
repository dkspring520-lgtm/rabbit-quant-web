import { membershipPlan } from "./membership-plans.mjs";

export const FREE_WATCHLIST_LIMIT = 2;
export const MEMBER_WATCHLIST_LIMIT = 5;
export const ADMIN_WATCHLIST_LIMIT = 30;

export function watchlistLimitForRole(role, membershipActive = false, membershipPlanId = null) {
  if (role === "admin") return ADMIN_WATCHLIST_LIMIT;
  if (!membershipActive) return FREE_WATCHLIST_LIMIT;
  return membershipPlan(membershipPlanId)?.watchlistLimit ?? MEMBER_WATCHLIST_LIMIT;
}

export function enforceWatchlistLimit(items, role, membershipActive = false, membershipPlanId = null) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, watchlistLimitForRole(role, membershipActive, membershipPlanId));
}
