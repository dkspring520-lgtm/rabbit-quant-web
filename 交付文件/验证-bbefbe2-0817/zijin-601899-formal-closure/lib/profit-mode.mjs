export const PROFIT_MODES = Object.freeze({
  standard: Object.freeze({
    id: "standard",
    label: "标准价差",
    description: "扣费净收益达到 0.64% 后启动利润保护，1.00% 锁定。",
    replayOptions: Object.freeze({}),
  }),
  "zijin-small-spread": Object.freeze({
    id: "zijin-small-spread",
    label: "紫金小价差",
    description: "每股价差至少 ¥0.10，扣费后至少 ¥30；盈利继续扩大时移动止盈。",
    replayOptions: Object.freeze({
      profileOverrides: Object.freeze({
        candidateNetPct: 0.12,
        targetNetPct: 0.12,
        maxTargetNetPct: 0.30,
        trailActivationPct: 0.12,
        trailRetracePct: 0.05,
        trailMinNetPct: 0.06,
      }),
      minimumNetProfitAmount: 30,
      minimumGrossSpreadAmount: 0.10,
    }),
  }),
});

export function normalizeProfitMode(value) {
  return value === "zijin-small-spread" ? value : "standard";
}

export function smartTProfitModeOptions(code, mode) {
  if (String(code) !== "601899" || normalizeProfitMode(mode) !== "zijin-small-spread") return {};
  return {
    ...PROFIT_MODES["zijin-small-spread"].replayOptions,
    profileOverrides: { ...PROFIT_MODES["zijin-small-spread"].replayOptions.profileOverrides },
  };
}

export function profitModeSummary(code, mode) {
  return String(code) === "601899" && normalizeProfitMode(mode) === "zijin-small-spread"
    ? PROFIT_MODES["zijin-small-spread"]
    : PROFIT_MODES.standard;
}
