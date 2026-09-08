/**
 * Presentation-only contract between the formal T engine and the Double Rabbit
 * order-flow radar.  It deliberately has no ability to create, veto, delay,
 * resize, or redirect a formal action.  Consumers may render this alongside a
 * formal signal, but must continue to execute from the formal engine itself.
 */
export const ORDER_FLOW_FORMAL_LINK_CONTRACT = Object.freeze({
  version: "2026.09-shadow-display-v1",
  displayOnly: true,
  affectsFormal: false,
  canCreateSignal: false,
  canBlockFormal: false,
  canModifyFormalDirection: false,
  canModifyFormalScore: false,
  canEnableExecution: false,
});

const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
  ? Number(value)
  : null;

function directionOf(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s_-]/g, "");
  if (["正t", "positivet", "positive", "buy", "long", "buyfirst", "买入"].includes(normalized)) return "正T";
  if (["反t", "reverset", "reverse", "sell", "short", "sellfirst", "卖出"].includes(normalized)) return "反T";
  return null;
}

function actionSideOf(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s_-]/g, "");
  if (["buy", "买", "买入", "买回", "buyback"].includes(normalized)) return "buy";
  if (["sell", "卖", "卖出"].includes(normalized)) return "sell";
  return null;
}

function actionDirectionOf(value) {
  const side = actionSideOf(value);
  return side === "buy" ? "正T" : side === "sell" ? "反T" : null;
}

function formalDirectionOf(signal) {
  // A formal cycle's direction and its immediate action can differ on the
  // closing leg (for example, `反T 买回`).  The display comparison is about
  // the current buy/sell action, so a supplied side wins over cycle direction.
  return actionDirectionOf(signal?.side ?? signal?.comparisonSide)
    ?? directionOf(signal?.direction)
    ?? directionOf(signal?.side)
    ?? directionOf(signal?.action)
    ?? directionOf(signal?.mode);
}

function timeOf(value) {
  const digits = String(value ?? "").replace(/\D/g, "").slice(-4);
  if (!/^\d{4}$/.test(digits)) return null;
  const hour = Number(digits.slice(0, 2));
  const minute = Number(digits.slice(2));
  return hour >= 9 && hour <= 15 && minute >= 0 && minute < 60 ? digits : null;
}

function minuteGap(left, right) {
  const toMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(2));
  return left && right ? Math.abs(toMinutes(left) - toMinutes(right)) : null;
}

function shadowDirectionOf(radar) {
  const stance = String(radar?.scores?.stance ?? radar?.stance ?? "").trim();
  if (/低吸|正T|买/.test(stance) && !/止盈|反T|卖/.test(stance)) return "正T";
  if (/止盈|反T|卖/.test(stance) && !/低吸|正T|买/.test(stance)) return "反T";

  // A renderer may pass a compact radar without its stance. Only infer a
  // direction at the same conservative threshold used by the radar itself;
  // a close pair remains neutral rather than pretending to have a view.
  const lowBuy = finite(radar?.scores?.lowBuy ?? radar?.lowBuy);
  const takeProfit = finite(radar?.scores?.takeProfit ?? radar?.takeProfit);
  if (lowBuy !== null && lowBuy >= 70 && lowBuy >= (takeProfit ?? 0) + 15) return "正T";
  if (takeProfit !== null && takeProfit >= 70 && takeProfit >= (lowBuy ?? 0) + 15) return "反T";
  return null;
}

function snapshotFormalSignal(signal) {
  const side = actionSideOf(signal?.side ?? signal?.comparisonSide);
  return Object.freeze({
    // Keep both fields so renderers can say "反T 买回" correctly while the
    // relation below compares the immediate buy/sell side.
    direction: directionOf(signal?.direction)
      ?? directionOf(signal?.mode)
      ?? actionDirectionOf(signal?.side)
      ?? null,
    comparisonDirection: formalDirectionOf(signal),
    side,
    status: typeof signal?.status === "string" ? signal.status : null,
    action: typeof signal?.action === "string" ? signal.action : null,
    score: finite(signal?.score ?? signal?.confidence),
    time: timeOf(signal?.time ?? signal?.asOfTime),
  });
}

function snapshotRadar(radar, direction) {
  const scores = radar?.scores ?? radar ?? {};
  return Object.freeze({
    available: radar?.available === true,
    direction,
    stance: typeof scores?.stance === "string" ? scores.stance : null,
    lowBuyScore: finite(scores?.lowBuy),
    takeProfitScore: finite(scores?.takeProfit),
    deltaThreeMinute: finite(radar?.delta?.threeMinute),
    divergence: typeof radar?.divergence?.label === "string" ? radar.divergence.label : null,
    absorption: typeof radar?.absorption?.label === "string" ? radar.absorption.label : null,
    reason: typeof radar?.reason === "string" ? radar.reason : null,
    time: timeOf(radar?.asOfTime),
  });
}

function scoreLabel(radar) {
  const buy = radar.lowBuyScore === null ? "--" : `${Math.round(radar.lowBuyScore)}分`;
  const sell = radar.takeProfitScore === null ? "--" : `${Math.round(radar.takeProfitScore)}分`;
  return `正T ${buy} · 反T ${sell}`;
}

/**
 * Relate the display-only order-flow radar to a formal signal.
 *
 * The formal signal is read once into an immutable snapshot and never changed.
 * The returned `relation` is only language/tone for the UI:
 * - aligned: shadow flow points in the formal direction
 * - conflict: shadow flow points the other way
 * - neutral: radar is live but does not have a directional view
 * - order-flow-unavailable: no current usable radar
 * - no-formal-signal: radar must not invent one
 */
export function relateOrderFlowShadowToFormalSignal({ formalSignal = null, orderFlowRadar = null, radar = null } = {}) {
  const formal = snapshotFormalSignal(formalSignal);
  const shadowDirection = shadowDirectionOf(orderFlowRadar ?? radar);
  const shadow = snapshotRadar(orderFlowRadar ?? radar, shadowDirection);
  const formalDirection = formal.comparisonDirection;
  const timeGapMinutes = minuteGap(formal.time, shadow.time);
  const base = {
    ...ORDER_FLOW_FORMAL_LINK_CONTRACT,
    formal,
    shadow,
    formalDirection,
    shadowDirection,
    timeGapMinutes,
    scoreLabel: scoreLabel(shadow),
    disclaimer: "订单流只作影子质量观察，不触发、不拦截、不改写正式信号或执行。",
  };

  if (!formalDirection) {
    return Object.freeze({
      ...base,
      relation: "no-formal-signal",
      state: "waiting",
      tone: "muted",
      label: "等待正式信号",
      detail: shadow.available
        ? `订单流影子 ${scoreLabel(shadow)}；尚无正式信号，不能单独生成买卖。`
        : "尚无正式信号；订单流也未就绪。",
    });
  }

  if (!shadow.available) {
    return Object.freeze({
      ...base,
      relation: "order-flow-unavailable",
      state: "unavailable",
      tone: "muted",
      label: "订单流待数据",
      detail: `正式${formalDirection}保持原判断；${shadow.reason ?? "当前没有可用L2订单流"}。`,
    });
  }

  // The radar describes the current L2 minute.  A formal action can remain
  // visible briefly after it occurred, therefore never call an older action
  // "same direction" or "in conflict" with a later flow snapshot.
  if (timeGapMinutes !== null && timeGapMinutes > 2) {
    return Object.freeze({
      ...base,
      relation: "time-misaligned",
      state: "waiting",
      tone: "muted",
      label: "分时不同步",
      detail: `正式动作 ${formal.time}，订单流快照 ${shadow.time}（相差 ${timeGapMinutes} 分钟）。仅显示当前影子行为，不作同向或分歧判断。`,
    });
  }

  if (!shadowDirection) {
    return Object.freeze({
      ...base,
      relation: "neutral",
      state: "neutral",
      tone: "neutral",
      label: "影子中性",
      detail: `正式${formalDirection}保持原判断；订单流 ${scoreLabel(shadow)}，暂未形成方向性观察。`,
    });
  }

  if (shadowDirection === formalDirection) {
    return Object.freeze({
      ...base,
      relation: "aligned",
      state: "aligned",
      tone: "support",
      label: "影子同向",
      detail: `正式${formalDirection}与订单流影子同向（${scoreLabel(shadow)}）。仅增加可读性，不提高正式信号等级。`,
    });
  }

  return Object.freeze({
    ...base,
    relation: "conflict",
    state: "divergent",
    tone: "caution",
    label: "影子分歧",
    detail: `正式${formalDirection}与订单流影子${shadowDirection}分歧（${scoreLabel(shadow)}）。请人工复核；正式信号不被锁定或改向。`,
  });
}
