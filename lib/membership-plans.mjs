export const MEMBERSHIP_PLANS = Object.freeze({
  day: Object.freeze({ id: "day", label: "24 小时测试天卡", priceYuan: 4.9, durationDays: 1, prefix: "D" }),
  monthly: Object.freeze({ id: "monthly", label: "普通会员月卡", priceYuan: 99, durationDays: 31, prefix: "M" }),
  yearly: Object.freeze({ id: "yearly", label: "年 V 会员", priceYuan: 298, durationDays: 366, prefix: "Y" }),
});

export function membershipPlan(planId) {
  return MEMBERSHIP_PLANS[String(planId ?? "").trim().toLowerCase()] ?? null;
}

export function listMembershipPlans() {
  return Object.values(MEMBERSHIP_PLANS);
}
