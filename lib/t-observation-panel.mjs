const ACTIONS = Object.freeze({
  WATCH_BUY: { key: "WATCH_BUY", label: "WATCH_BUY", text: "偏强观察", tone: "watch-buy" },
  WATCH_SELL: { key: "WATCH_SELL", label: "WATCH_SELL", text: "偏弱观察", tone: "watch-sell" },
  WAIT_CONFIRMATION: { key: "WAIT_CONFIRMATION", label: "WAIT_CONFIRMATION", text: "等待确认", tone: "wait" },
  NO_ACTION: { key: "NO_ACTION", label: "NO_ACTION", text: "暂无动作", tone: "none" },
});

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeObservationAction(guidance = null) {
  const raw = stringValue(guidance?.actionBias).toUpperCase();
  if (raw === "WATCH_BUY") return ACTIONS.WATCH_BUY;
  if (raw === "WATCH_SELL") return ACTIONS.WATCH_SELL;
  if (raw === "WAIT" || raw === "WAIT_CONFIRMATION" || stringValue(guidance?.primaryLabel).includes("WAIT_CONFIRMATION")) return ACTIONS.WAIT_CONFIRMATION;
  return ACTIONS.NO_ACTION;
}

export function observationStateKey(guidance = null, state = null) {
  return stringValue(guidance?.state) || stringValue(state?.state) || "";
}

export function normalizeResearchState(value) {
  const state = stringValue(value).toUpperCase();
  if (state === "HIGH_LEVEL_EXHAUSTION") return "UPWARD_EXHAUSTION";
  if (state === "LOW_LEVEL_EXHAUSTION") return "DOWNWARD_EXHAUSTION";
  if (state === "NO_T_ENVIRONMENT") return "NEUTRAL";
  return state;
}

export function observationMainMessage(guidance = null, state = null) {
  const action = normalizeObservationAction(guidance);
  const normalizedState = normalizeResearchState(observationStateKey(guidance, state));
  if (action.key === "WAIT_CONFIRMATION") return normalizedState && normalizedState !== "TRANSITION" ? "结构正在变化，先等确认再判断。" : "当前结构还不完整，先等确认。";
  if (action.key === "WATCH_BUY") return "当前偏强观察，等待回撤与结构确认。";
  if (action.key === "WATCH_SELL") return "当前偏弱观察，等待转弱与结构确认。";
  return "当前没有清晰动作，继续观察。";
}

export function observationNextStep(guidance = null, state = null) {
  const action = normalizeObservationAction(guidance);
  const candidate = stringValue(guidance?.candidateState);
  const finalState = observationStateKey(guidance, state);
  if (action.key === "WAIT_CONFIRMATION") return candidate && finalState && candidate !== finalState ? "等待结构确认" : "继续观察";
  if (action.key === "WATCH_BUY") return "等待回撤确认";
  if (action.key === "WATCH_SELL") return "等待转弱确认";
  return "暂无动作，继续观察";
}

export function observationReasons(guidance = null, limit = 3) {
  const reasons = Array.isArray(guidance?.reasons) ? guidance.reasons.map(stringValue).filter(Boolean) : [];
  return reasons.slice(0, limit);
}

function clockFromTimestamp(value) {
  const text = String(value ?? "");
  const iso = text.match(/(?:T|\s)(\d{2}):(\d{2})/);
  if (iso) return iso[1] + iso[2];
  const compact = text.replace(/\D/g, "");
  return compact.length >= 4 ? compact.slice(-4) : "";
}

export function observationContext(timestamp) {
  const time = clockFromTimestamp(timestamp);
  if (!/^\d{4}$/.test(time)) return { key: "UNAVAILABLE", label: "暂无上下文", available: false };
  if (time === "0930") return { key: "OPENING_DISCOVERY", label: "开盘发现", available: true };
  if (time < "1000") return { key: "MORNING_HIGH_ACTIVITY", label: "早盘高活跃", available: true };
  if (time < "1100") return { key: "MORNING_STABLE", label: "上午稳定", available: true };
  if (time <= "1130") return { key: "PRE_LUNCH", label: "午前", available: true };
  if (time < "1305") return { key: "AFTERNOON_REOPEN", label: "午后重开", available: true };
  if (time < "1450") return { key: "AFTERNOON_STABLE", label: "午后稳定", available: true };
  return { key: "CLOSING_ACTIVITY", label: "尾盘活跃", available: true };
}

export function researchContextForState(state) {
  const normalized = normalizeResearchState(state);
  if (normalized === "REBOUND") return { key: "REBOUND", label: "阶段性差异", message: "历史研究：该结构曾出现阶段性差异，近期稳定性有限。", cautions: ["样本外稳定性偏弱"] };
  if (normalized === "DOWNWARD_EXHAUSTION") return { key: "DOWNWARD_EXHAUSTION", label: "后期漂移", message: "历史研究：曾有明显样本支持，但后期出现方向反转。", cautions: ["主要漂移窗口：2025H2–2026H1", "样本外方向已反转"] };
  return { key: "NONE", label: "仅作背景", message: "历史研究：当前结构暂无对应的稳定结论。", cautions: [] };
}

export function guidanceTimeline(history = [], limit = 6) {
  const rows = Array.isArray(history) ? history : [];
  return rows.slice(-limit).reverse().map((item, index) => {
    const action = normalizeObservationAction(item);
    const reasons = observationReasons(item, 1);
    const eventType = item?.state && item?.candidateState && item.state !== item.candidateState ? "候选变化" : action.label;
    return { key: String(item?.timestamp ?? "") + "-" + index, timestamp: item?.timestamp ?? null, eventType, action, reason: reasons[0] || stringValue(item?.confirmation) || "结构观察更新" };
  });
}

export function formatObservationTime(value) {
  const time = clockFromTimestamp(value);
  return /^\d{4}$/.test(time) ? time.slice(0, 2) + ":" + time.slice(2) : "--:--";
}
