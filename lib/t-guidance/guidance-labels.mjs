export const GUIDANCE_VERSION = "1.0.0";

export const PRIMARY_LABELS = Object.freeze([
  "POSITIVE_T_WATCH",
  "COUNTER_T_WATCH",
  "WAIT_CONFIRMATION",
  "HOLD_OBSERVATION",
  "NO_CLEAR_T_OPPORTUNITY",
  "INVALID",
]);

export const ACTION_BIASES = Object.freeze(["WATCH_BUY", "WATCH_SELL", "WAIT", "HOLD", "NONE", "INVALID"]);

export const PRIMARY_LABEL_TEXT = Object.freeze({
  POSITIVE_T_WATCH: "关注买入",
  COUNTER_T_WATCH: "关注卖出",
  WAIT_CONFIRMATION: "等待确认",
  HOLD_OBSERVATION: "继续观察",
  NO_CLEAR_T_OPPORTUNITY: "暂不操作",
  INVALID: "数据不足",
});

export const ACTION_BIAS_TEXT = Object.freeze({
  WATCH_BUY: "关注低位机会",
  WATCH_SELL: "关注高位风险",
  WAIT: "等待结构确认",
  HOLD: "保持观察",
  NONE: "暂无明确倾向",
  INVALID: "暂不判断",
});

export const STRENGTH_BANDS = Object.freeze({ strong: "强", medium: "中", weak: "弱", unavailable: "待数据" });

export function strengthBand(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return "unavailable";
  if (value >= 70) return "strong";
  if (value >= 40) return "medium";
  return "weak";
}
