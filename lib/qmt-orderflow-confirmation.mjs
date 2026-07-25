const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function read(point, names) {
  for (const name of names) {
    const value = finite(point?.[name]);
    if (value !== null) return value;
  }
  return null;
}

export function normalizeQmtOrderFlow(point) {
  const source = point?.l2 ?? point?.orderFlow ?? point;
  const flow = source?.flow ?? source;
  const book = source?.book ?? source;
  const status = source?.status ?? point?.l2Status ?? {};
  return {
    activeBuyVolume: read(flow, ["activeBuyVolume", "activeBuyNotional60s", "buyVolume", "buyVol"]),
    activeSellVolume: read(flow, ["activeSellVolume", "activeSellNotional60s", "sellVolume", "sellVol"]),
    ddx: read(flow, ["ddx", "netActiveNotional60s", "orderFlowDdx"]),
    bid1Volume: read(book, ["bid1Volume", "bidVolume", "bid1Vol"]),
    ask1Volume: read(book, ["ask1Volume", "askVolume", "ask1Vol"]),
    status,
  };
}

function ddxDirection(points, index) {
  const rows = points.slice(Math.max(0, index - 2), index + 1)
    .map((point) => normalizeQmtOrderFlow(point).ddx);
  if (rows.length < 3 || rows.some((value) => value === null)) return "unknown";
  if (rows[2] > rows[1] && rows[1] >= rows[0]) return "rising";
  if (rows[2] < rows[1] && rows[1] <= rows[0]) return "falling";
  return "flat";
}

/** L2 is confirmation/veto only. Missing is neutral; stale connected data is rejected. */
export function evaluateQmtOrderFlow(points, index, phase) {
  const current = points[index];
  const flow = normalizeQmtOrderFlow(current);
  const integrityBlocked = flow.status?.connected === true
    && (flow.status?.authorized === false || flow.status?.stale === true);
  if (integrityBlocked) {
    return { available: true, pass: false, score: 0, required: 3, integrityBlocked: true, reason: "L2 行情已连接但数据失效或无权限，拒绝触发" };
  }

  const totalActive = (flow.activeBuyVolume ?? 0) + (flow.activeSellVolume ?? 0);
  const available = totalActive > 0 && flow.ddx !== null
    && flow.bid1Volume !== null && flow.ask1Volume !== null && index >= 2;
  if (!available) {
    return { available: false, pass: true, score: 0, required: 3, reason: "L2/QMT 盘口未接入，不使用伪造订单流" };
  }

  const prefix = points.slice(0, index + 1).map((point) => Number(point.price)).filter(Number.isFinite);
  const price = Number(current.price);
  const high = Math.max(...prefix);
  const low = Math.min(...prefix);
  const activeBuyRatio = flow.activeBuyVolume / totalActive;
  const bookRatio = flow.ask1Volume > 0 ? flow.bid1Volume / flow.ask1Volume : Number.POSITIVE_INFINITY;
  const ddxTrend = ddxDirection(points, index);
  const checks = [];
  if (phase === "SELL_FIRST") {
    checks.push((high - price) / Math.max(price, 0.01) * 100 <= 0.30, activeBuyRatio <= 0.38,
      ddxTrend === "falling", bookRatio <= 0.90);
  } else if (phase === "BUYBACK") {
    checks.push((high - price) / Math.max(high, 0.01) * 100 >= 0.50, activeBuyRatio >= 0.55,
      ddxTrend === "rising", bookRatio >= 1.10);
  } else {
    checks.push((price - low) / Math.max(low, 0.01) * 100 >= 0.40, activeBuyRatio >= 0.55,
      ddxTrend === "rising", bookRatio >= 1.10);
  }
  const score = checks.filter(Boolean).length;
  return {
    available: true, pass: score >= 3, score, required: 3, activeBuyRatio, bookRatio, ddxTrend,
    reason: `L2/QMT 盘口 ${score}/4：主动买占比 ${(activeBuyRatio * 100).toFixed(1)}%，净主动额 ${ddxTrend}，买卖盘量比 ${bookRatio.toFixed(2)}`,
  };
}
