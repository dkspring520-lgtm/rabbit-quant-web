import { GUIDANCE_VERSION, strengthBand } from "./guidance-labels.mjs";
import { actionBiasText, primaryLabelText, stateLabel, strengthText } from "./guidance-format.mjs";

const VALID_OPPORTUNITIES = new Set(["POSITIVE_T_ENVIRONMENT", "COUNTER_T_ENVIRONMENT", "NEUTRAL", "INVALID"]);
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

function pushUnique(list, value) { if (value && !list.includes(value)) list.push(value); }
function candidateTransitionNote(state, candidateState) {
  if (!candidateState || !state || candidateState === state) return null;
  if (candidateState === "REBOUND") return "出现反弹迹象，但最终状态尚未完成切换";
  if (candidateState === "PULLBACK") return "出现回落迹象，但最终状态尚未完成切换";
  if (candidateState === "UPTREND") return "出现上行候选，但最终状态仍需确认";
  if (candidateState === "DOWNTREND") return "出现下行候选，但最终状态仍需确认";
  return `候选结构为${stateLabel(candidateState)}，最终状态仍为${stateLabel(state)}`;
}

function commonEvidence({ feature, state, reasons, warnings }) {
  const position = finite(feature?.position?.rangePosition);
  const decay = finite(feature?.momentum?.momentumDecay);
  const velocity = finite(feature?.momentum?.shortMomentum);
  const volumeTrend = feature?.volume?.volumeTrend;
  if (decay !== null && decay > 0) pushUnique(reasons, "动能边际减弱");
  if (position !== null && position < 0.34) pushUnique(reasons, "价格位于近期区间偏低位置");
  if (position !== null && position > 0.66) pushUnique(reasons, "价格位于近期区间偏高位置");
  if (volumeTrend === "CONTRACTING") pushUnique(reasons, "量能收缩，等待方向确认");
  if (volumeTrend === "EXPANDING") pushUnique(reasons, "量能放大，需观察价格是否继续响应");
  if (velocity === 0) pushUnique(warnings, "当前价格推进有限");
  const note = candidateTransitionNote(state?.state, state?.candidateState);
  if (note) pushUnique(warnings, note);
  if (state?.transition === "HYSTERESIS_HOLD") pushUnique(warnings, "状态仍处于保持阶段，不把候选变化当成反转确认");
}

function markerFor(label, timestamp, reasons, confirmation) {
  if (label === "POSITIVE_T_WATCH") return { kind: "positive-t-watch", label: "🟢 T", timestamp, title: "正T观察", detail: `${reasons.join("；")}；${confirmation}` };
  if (label === "COUNTER_T_WATCH") return { kind: "counter-t-watch", label: "🟠 T", timestamp, title: "反T观察", detail: `${reasons.join("；")}；${confirmation}` };
  if (label === "WAIT_CONFIRMATION") return { kind: "structure-change", label: "◆", timestamp, title: "结构变化", detail: `${reasons.join("；")}；${confirmation}` };
  return null;
}

export function buildHumanTGuidance({ timestamp = null, symbol = "", mode = "RESEARCH_OBSERVATION", feature = null, state = null, opportunity = null } = {}) {
  const reasons = []; const warnings = []; const confirmations = [];
  const stateValue = state?.state ?? null; const candidateState = state?.candidateState ?? null; const opportunityType = opportunity?.type ?? "INVALID";
  const valid = Boolean(feature?.validity === "VALID" && feature?.valid === true && state?.validity === "STATE_VALID" && opportunity?.valid === true && VALID_OPPORTUNITIES.has(opportunityType) && opportunityType !== "INVALID");
  let primaryLabel = "INVALID"; let actionBias = "INVALID";
  if (!valid) {
    primaryLabel = feature?.validity === "WARMUP" || state?.validity === "STATE_WARMUP" ? "WAIT_CONFIRMATION" : "INVALID";
    actionBias = primaryLabel === "WAIT_CONFIRMATION" ? "WAIT" : "INVALID";
    reasons.push(primaryLabel === "WAIT_CONFIRMATION" ? "CORE_SAFE 数据仍在准备" : "当前观察数据不足，暂不判断");
    warnings.push("辅助观察层不生成交易动作");
  } else if (opportunityType === "POSITIVE_T_ENVIRONMENT") {
    primaryLabel = "POSITIVE_T_WATCH"; actionBias = "WATCH_BUY";
    reasons.push("低位T环境出现");
    commonEvidence({ feature, state, reasons, warnings });
    confirmations.push("等待企稳或反弹结构进一步确认");
  } else if (opportunityType === "COUNTER_T_ENVIRONMENT") {
    primaryLabel = "COUNTER_T_WATCH"; actionBias = "WATCH_SELL";
    reasons.push("高位T环境出现");
    commonEvidence({ feature, state, reasons, warnings });
    confirmations.push("等待回落或高位失守结构进一步确认");
  } else if (stateValue === "TRANSITION" || stateValue === "WAIT_CONFIRMATION") {
    primaryLabel = "WAIT_CONFIRMATION"; actionBias = "WAIT";
    reasons.push("市场结构正在变化");
    commonEvidence({ feature, state, reasons, warnings });
    confirmations.push("等待状态稳定后再观察方向");
  } else {
    primaryLabel = "NO_CLEAR_T_OPPORTUNITY"; actionBias = "NONE";
    reasons.push("当前没有清晰T结构");
    commonEvidence({ feature, state, reasons, warnings });
    confirmations.push("继续观察价格、位置和动能变化");
  }
  if (!reasons.length) reasons.push("等待新的结构证据");
  if (!warnings.length) warnings.push("仅作人类观察，不代表买卖概率或收益预期");
  const rawScore = finite(opportunity?.score);
  const strength = valid && rawScore !== null ? Math.max(0, Math.min(100, rawScore)) : null;
  const guidance = {
    timestamp, symbol, mode, primaryLabel, primaryLabelText: primaryLabelText(primaryLabel), actionBias, actionBiasText: actionBiasText(actionBias), strength, strengthBand: strengthBand(strength), strengthText: strengthText(strength), reasons, warnings, confirmation: confirmations[0] ?? "等待确认", confirmations, state: stateValue, stateText: stateLabel(stateValue), candidateState, candidateStateText: stateLabel(candidateState), opportunity: opportunityType, opportunityScore: rawScore, chartMarker: valid ? markerFor(primaryLabel, timestamp, reasons, confirmations[0] ?? "等待确认") : null, provenance: { source: "T_FEATURE_STATE_OPPORTUNITY", featureVersion: "1.0.0", stateVersion: "1.0.0", opportunityVersion: "1.0.0", guidanceVersion: GUIDANCE_VERSION, lookahead: false, futureData: false }, researchOnly: true, rlEligible: false, executionAllowed: false, voiceAllowed: false };
  return guidance;
}

export function buildHumanTGuidanceSeries({ timestamps = [], features = [], states = [], opportunities = [], symbol = "", mode = "RESEARCH_OBSERVATION" } = {}) {
  return features.map((feature, index) => buildHumanTGuidance({ timestamp: timestamps[index] ?? feature?.timestamp ?? null, symbol, mode, feature, state: states[index] ?? null, opportunity: opportunities[index] ?? null }));
}

export function buildTGuidanceReminders(guidanceHistory = [], { max = 12 } = {}) {
  const reminders = []; let previous = null;
  for (const guidance of guidanceHistory) {
    const marker = guidance?.chartMarker;
    if (!marker || !guidance?.timestamp) { previous = guidance; continue; }
    const changed = !previous || previous.primaryLabel !== guidance.primaryLabel || previous.chartMarker?.kind !== marker.kind || previous.candidateState !== guidance.candidateState;
    if (changed) {
      reminders.push({ ...marker, guidanceLabel: guidance.primaryLabel, actionBias: guidance.actionBias, strength: guidance.strength, reasons: guidance.reasons, warnings: guidance.warnings, confirmation: guidance.confirmation, researchOnly: true, executionAllowed: false });
      if (reminders.length > max) reminders.shift();
    }
    previous = guidance;
  }
  return reminders;
}
