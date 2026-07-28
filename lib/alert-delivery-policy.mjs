const CANDIDATE_COOLDOWN_MS = 10 * 60_000;
const SAME_DIRECTION_DEDUPE_MS = 30_000;
const FORMAL_CONFLICT_GUARD_MS = 60_000;

const alertLevel = (alert) => {
  const value = String(alert?.level || "").toLowerCase();
  if (value === "formal" || value === "signal") return "signal";
  if (value === "risk") return "risk";
  return "candidate";
};

export function alertDirection(alert) {
  const action = alert?.payload?.action;
  const observation = alert?.payload?.observation;
  if (/卖/.test(String(action?.side || "")) || String(action?.direction || "") === "反T") return "sell";
  if (/买/.test(String(action?.side || "")) || String(action?.direction || "") === "正T") return "buy";
  if (String(observation?.direction || "") === "反T") return "sell";
  if (String(observation?.direction || "") === "正T") return "buy";
  const source = [
    alert?.rabbit,
    alert?.title,
    alert?.message,
  ].filter(Boolean).join(" ");
  if (/反T|卖出|卖回|高位/.test(source)) return "sell";
  if (/正T|买入|买回|低位/.test(source)) return "buy";
  return null;
}

const alertTime = (alert, fallback) => {
  const parsed = Date.parse(String(alert?.createdAt || ""));
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function resolveAlertDelivery({ previous = null, next, nowMs = Date.now() }) {
  if (!next || alertLevel(next) === "risk" || !previous) return { deliver: true, alert: next, reason: "allowed" };
  const previousDirection = alertDirection(previous);
  const nextDirection = alertDirection(next);
  if (!previousDirection || !nextDirection) return { deliver: true, alert: next, reason: "allowed" };

  const elapsed = Math.max(0, nowMs - alertTime(previous, nowMs));
  const previousLevel = alertLevel(previous);
  const nextLevel = alertLevel(next);

  if (previousDirection === nextDirection) {
    const dedupeWindow = nextLevel === "candidate" ? CANDIDATE_COOLDOWN_MS : SAME_DIRECTION_DEDUPE_MS;
    if (elapsed < dedupeWindow) return { deliver: false, alert: next, reason: "same-direction-deduplicated" };
    return { deliver: true, alert: next, reason: "allowed" };
  }

  if (nextLevel === "candidate" && elapsed < CANDIDATE_COOLDOWN_MS) {
    return { deliver: false, alert: next, reason: "opposite-candidate-suppressed" };
  }
  if (previousLevel === "signal" && nextLevel === "signal" && elapsed < FORMAL_CONFLICT_GUARD_MS) {
    const code = String(next.code || previous.code || "").replace(/\D/g, "").slice(0, 6);
    return {
      deliver: true,
      reason: "formal-conflict-converted-to-risk",
      alert: {
        ...next,
        code,
        level: "risk",
        rabbit: "both",
        title: `${String(next.title || previous.title || code).split(/[·•｜|]/)[0].trim()} · 方向冲突`,
        message: "一分钟内出现相反正式方向，已暂停买卖提醒；请以操盘台最新结构和持仓状态人工复核。",
        eventKey: `${String(next.eventKey || `conflict:${nowMs}`)}:direction-conflict`,
        payload: { ...(next.payload || {}), conflict: { previousDirection, nextDirection, elapsedMs: elapsed } },
      },
    };
  }
  return { deliver: true, alert: next, reason: "formal-overrides-candidate" };
}

export function conciseAlertSpeech({ text, level = "signal", direction = null, risk = false }) {
  const stockName = String(text || "").split(/[，,·•｜|]/)[0]?.trim() || "双兔助手";
  if (risk || level === "risk" || /风险|锁定|止损|方向冲突/.test(text)) return `${stockName}，风险提醒`;
  if (level === "candidate") {
    if (direction === "sell" || /反T|卖出|高位|顶部|冲高/.test(text)) return `${stockName}，高位观察`;
    if (direction === "buy" || /正T|买回|买入|低位|底部|回踩/.test(text)) return `${stockName}，低位观察`;
    return `${stockName}，候选观察`;
  }
  if (direction === "buy" || /买回|买入|正T/.test(text)) return `${stockName}，买点提醒`;
  if (direction === "sell" || /卖出|反T/.test(text)) return `${stockName}，卖点提醒`;
  if (/高位|顶部|冲高/.test(text)) return `${stockName}，高位提醒`;
  if (/低位|底部|回踩/.test(text)) return `${stockName}，低位提醒`;
  return `${stockName}，提醒`;
}

export const ALERT_DELIVERY_WINDOWS = Object.freeze({
  candidateCooldownMs: CANDIDATE_COOLDOWN_MS,
  sameDirectionMs: SAME_DIRECTION_DEDUPE_MS,
  formalConflictMs: FORMAL_CONFLICT_GUARD_MS,
});
