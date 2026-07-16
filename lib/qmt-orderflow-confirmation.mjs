const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function read(point, names) {
  for (const name of names) {
    const value = finite(point?.[name]);
    if (value !== null) return value;
  }
  return null;
}

export function normalizeQmtOrderFlow(point) {
  const activeBuyVolume = read(point, ["activeBuyVolume", "buyVolume", "buyVol"]);
  const activeSellVolume = read(point, ["activeSellVolume", "sellVolume", "sellVol"]);
  const ddx = read(point, ["ddx", "orderFlowDdx"]);
  const bid1Volume = read(point, ["bid1Volume", "bidVolume", "bid1Vol"]);
  const ask1Volume = read(point, ["ask1Volume", "askVolume", "ask1Vol"]);
  return { activeBuyVolume, activeSellVolume, ddx, bid1Volume, ask1Volume };
}

function ddxDirection(points, index) {
  const rows = points
    .slice(Math.max(0, index - 2), index + 1)
    .map((point) => normalizeQmtOrderFlow(point).ddx);
  if (rows.length < 3 || rows.some((value) => value === null)) return "unknown";
  if (rows[2] > rows[1] && rows[1] >= rows[0]) return "rising";
  if (rows[2] < rows[1] && rows[1] <= rows[0]) return "falling";
  return "flat";
}

/**
 * Clean-room order-flow confirmation inspired by common MiniQMT fields.
 * It only evaluates already received rows. Missing QMT fields are reported as
 * unavailable and never replaced with fabricated public-minute proxies.
 */
export function evaluateQmtOrderFlow(points, index, phase) {
  const current = points[index];
  const flow = normalizeQmtOrderFlow(current);
  const totalActive = (flow.activeBuyVolume ?? 0) + (flow.activeSellVolume ?? 0);
  const available = totalActive > 0
    && flow.ddx !== null
    && flow.bid1Volume !== null
    && flow.ask1Volume !== null
    && index >= 2;
  if (!available) {
    return { available: false, pass: true, score: 0, required: 3, reason: "QMT盘口未接入，不使用伪造订单流" };
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
    checks.push((high - price) / Math.max(price, 0.01) * 100 <= 0.30);
    checks.push(activeBuyRatio <= 0.38);
    checks.push(ddxTrend === "falling");
    checks.push(bookRatio <= 0.90);
  } else if (phase === "BUYBACK") {
    checks.push((high - price) / Math.max(high, 0.01) * 100 >= 0.50);
    checks.push(activeBuyRatio >= 0.55);
    checks.push(ddxTrend === "rising");
    checks.push(bookRatio >= 1.10);
  } else {
    checks.push((price - low) / Math.max(low, 0.01) * 100 >= 0.40);
    checks.push(activeBuyRatio >= 0.55);
    checks.push(ddxTrend === "rising");
    checks.push(bookRatio >= 1.10);
  }

  const score = checks.filter(Boolean).length;
  const pass = score >= 3;
  return {
    available: true,
    pass,
    score,
    required: 3,
    activeBuyRatio,
    bookRatio,
    ddxTrend,
    reason: `QMT盘口 ${score}/4：主动买占比 ${(activeBuyRatio * 100).toFixed(1)}%，DDX ${ddxTrend}，买卖一量比 ${bookRatio.toFixed(2)}`,
  };
}
