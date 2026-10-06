import { ACTION_BIAS_TEXT, PRIMARY_LABEL_TEXT, STRENGTH_BANDS, strengthBand } from "./guidance-labels.mjs";

const STATE_TEXT = Object.freeze({
  HIGH_LEVEL_EXHAUSTION: "高位动能衰减候选",
  LOW_LEVEL_EXHAUSTION: "低位企稳候选",
  NO_T_ENVIRONMENT: "无明确T结构",
  UPTREND: "上行观察",
  DOWNTREND: "下行观察",
  PULLBACK: "回落观察",
  REBOUND: "反弹观察",
  WAIT_CONFIRMATION: "等待确认",
  TRANSITION: "状态转换中",
  INVALID: "状态无效",
});

export function stateLabel(state) {
  return STATE_TEXT[state] ?? (state ? String(state) : "待数据");
}

export function primaryLabelText(label) { return PRIMARY_LABEL_TEXT[label] ?? "暂不操作"; }
export function actionBiasText(bias) { return ACTION_BIAS_TEXT[bias] ?? "暂无明确倾向"; }
export function strengthText(score) { return STRENGTH_BANDS[strengthBand(score)]; }

export function formatGuidanceForUi(guidance) {
  if (!guidance) return { primaryLabel: "数据不足", actionBias: "暂不判断", strength: "待数据" };
  return {
    primaryLabel: primaryLabelText(guidance.primaryLabel),
    actionBias: actionBiasText(guidance.actionBias),
    strength: strengthText(guidance.strength),
    state: stateLabel(guidance.state),
    candidateState: stateLabel(guidance.candidateState),
  };
}
