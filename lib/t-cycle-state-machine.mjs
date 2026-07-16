export function createTCycleState() {
  return { phase: "READY", pending: null, cycles: 0, lastExitMinute: null };
}

export function refreshTCycleState(state, nowMinute, cooldownMinutes) {
  if (state.phase !== "COOLDOWN") return state;
  if (state.lastExitMinute === null || nowMinute - state.lastExitMinute < cooldownMinutes) return state;
  return { ...state, phase: "READY" };
}

export function openTCycle(state, order) {
  if (state.phase !== "READY") return { ok: false, state, reason: "已有未闭环做T，禁止重复开腿" };
  if (!Number.isInteger(order.quantity) || order.quantity < 100 || order.quantity % 100 !== 0) {
    return { ok: false, state, reason: "数量必须是至少100股的整手" };
  }
  if (order.direction === "SELL_FIRST" && order.sellable < order.quantity) {
    return { ok: false, state, reason: "昨日可卖底仓不足" };
  }
  if (order.direction === "BUY_FIRST" && order.cash < order.price * order.quantity) {
    return { ok: false, state, reason: "可用资金不足" };
  }
  const expectedSide = order.direction === "SELL_FIRST" ? "BUY" : "SELL";
  const phase = order.direction === "SELL_FIRST" ? "WAIT_BUYBACK" : "WAIT_SELL";
  return {
    ok: true,
    state: {
      ...state,
      phase,
      pending: {
        direction: order.direction,
        entryPrice: order.price,
        quantity: order.quantity,
        entryMinute: order.minute,
        expectedSide,
      },
    },
  };
}

export function closeTCycle(state, order) {
  if (!state.pending) return { ok: false, state, reason: "当前没有待闭环做T" };
  if (order.side !== state.pending.expectedSide) {
    return { ok: false, state, reason: `闭环顺序错误，当前只允许 ${state.pending.expectedSide}` };
  }
  if (state.pending.direction === "SELL_FIRST" && !order.forced && order.price >= state.pending.entryPrice) {
    return { ok: false, state, reason: "买回价未低于先卖价，等待或由风控强制恢复底仓" };
  }
  return {
    ok: true,
    state: {
      phase: "COOLDOWN",
      pending: null,
      cycles: state.cycles + 1,
      lastExitMinute: order.minute,
    },
  };
}
