const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
};

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
    activeBuyRatio: read(flow, ["activeBuyRatio60s", "activeBuyRatio"]),
    ddx: read(flow, ["ddx", "netActiveNotional60s", "orderFlowDdx"]),
    bigOrderNet: read(flow, ["bigOrderNetNotional60s", "bigOrderNet", "largeOrderNet"]),
    transactionCount: read(flow, ["transactionCount60s", "transactionCount"]),
    bid1Volume: read(book, ["bid1Volume", "bidVolume", "bid1Vol"]),
    ask1Volume: read(book, ["ask1Volume", "askVolume", "ask1Vol"]),
    nearTouchImbalance: read(book, ["nearTouchImbalance", "depthImbalance"]),
    spreadBps: read(book, ["spreadBps"]),
    micropriceEdgeBps: read(book, ["micropriceEdgeBps", "micropriceBiasBps"]),
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
    return {
      available: true, pass: false, score: 0, required: 3, integrityBlocked: true,
      reason: "L2 已连接但数据过期或无权限，拒绝触发",
    };
  }

  const totalActive = (flow.activeBuyVolume ?? 0) + (flow.activeSellVolume ?? 0);
  const available = totalActive > 0 && flow.ddx !== null
    && flow.bid1Volume !== null && flow.ask1Volume !== null && index >= 2;
  if (!available) {
    return {
      available: false, pass: true, score: 0, required: 3,
      reason: "L2/QMT 盘口未接入，不使用伪造订单流",
    };
  }

  const prefix = points.slice(0, index + 1).map((point) => Number(point.price)).filter(Number.isFinite);
  const price = Number(current.price);
  const high = Math.max(...prefix);
  const low = Math.min(...prefix);
  const activeBuyRatio = flow.activeBuyRatio ?? flow.activeBuyVolume / totalActive;
  const bookRatio = flow.ask1Volume > 0 ? flow.bid1Volume / flow.ask1Volume : Number.POSITIVE_INFINITY;
  const depthImbalance = flow.nearTouchImbalance ?? (bookRatio - 1) / Math.max(bookRatio + 1, 0.01);
  const ddxTrend = ddxDirection(points, index);
  const marketQualityBlocked = (flow.transactionCount !== null && flow.transactionCount < 3)
    || (flow.spreadBps !== null && flow.spreadBps > 18);
  const checks = [];
  if (phase === "SELL_FIRST") {
    checks.push(
      (high - price) / Math.max(price, 0.01) * 100 <= 0.30,
      activeBuyRatio <= 0.42 && (flow.bigOrderNet === null || flow.bigOrderNet <= 0),
      ddxTrend === "falling",
      depthImbalance <= -0.05 && (flow.micropriceEdgeBps === null || flow.micropriceEdgeBps <= 0),
    );
  } else if (phase === "BUYBACK") {
    checks.push(
      (high - price) / Math.max(high, 0.01) * 100 >= 0.50,
      activeBuyRatio >= 0.53 && (flow.bigOrderNet === null || flow.bigOrderNet >= 0),
      ddxTrend === "rising",
      depthImbalance >= 0.05 && (flow.micropriceEdgeBps === null || flow.micropriceEdgeBps >= 0),
    );
  } else {
    checks.push(
      (price - low) / Math.max(low, 0.01) * 100 >= 0.40,
      activeBuyRatio >= 0.53 && (flow.bigOrderNet === null || flow.bigOrderNet >= 0),
      ddxTrend === "rising",
      depthImbalance >= 0.05 && (flow.micropriceEdgeBps === null || flow.micropriceEdgeBps >= 0),
    );
  }
  const score = checks.filter(Boolean).length;
  return {
    available: true, pass: score >= 3 && !marketQualityBlocked, score, required: 3,
    activeBuyRatio, bookRatio, depthImbalance, ddxTrend, marketQualityBlocked,
    reason: `L2/QMT ${score}/4：主动买占比 ${(activeBuyRatio * 100).toFixed(1)}%，净主动额${ddxTrend}，近端深度差 ${(depthImbalance * 100).toFixed(1)}%${marketQualityBlocked ? "；流动性/价差异常" : ""}`,
  };
}

/** Research-only summary used by the Zijin agent; it never creates an order. */
export function summarizeZijinOrderFlow(point) {
  const flow = normalizeQmtOrderFlow(point);
  const total = (flow.activeBuyVolume ?? 0) + (flow.activeSellVolume ?? 0);
  const available = total > 0 && flow.ddx !== null
    && flow.bid1Volume !== null && flow.ask1Volume !== null
    && flow.status?.authorized !== false && flow.status?.stale !== true;
  if (!available) {
    return { available: false, stance: "neutral", score: 0, reason: "L2 前瞻订单流仍在采集" };
  }
  const activeBuyRatio = flow.activeBuyRatio ?? flow.activeBuyVolume / total;
  const bookRatio = flow.ask1Volume > 0 ? flow.bid1Volume / flow.ask1Volume : Number.POSITIVE_INFINITY;
  const depthImbalance = flow.nearTouchImbalance ?? (bookRatio - 1) / Math.max(bookRatio + 1, 0.01);
  const buyVotes = [
    activeBuyRatio >= 0.55,
    flow.ddx > 0,
    depthImbalance >= 0.08,
    flow.bigOrderNet !== null && flow.bigOrderNet > 0,
    flow.micropriceEdgeBps !== null && flow.micropriceEdgeBps > 0,
  ].filter(Boolean).length;
  const sellVotes = [
    activeBuyRatio <= 0.45,
    flow.ddx < 0,
    depthImbalance <= -0.08,
    flow.bigOrderNet !== null && flow.bigOrderNet < 0,
    flow.micropriceEdgeBps !== null && flow.micropriceEdgeBps < 0,
  ].filter(Boolean).length;
  const stance = buyVotes >= 3 ? "buy" : sellVotes >= 3 ? "sell" : "neutral";
  return {
    available: true, stance, score: Math.max(buyVotes, sellVotes), buyVotes, sellVotes,
    activeBuyRatio, depthImbalance, bookRatio,
    reason: `L2 订单流：买方 ${buyVotes}/5，卖方 ${sellVotes}/5，主动买占比 ${(activeBuyRatio * 100).toFixed(1)}%`,
  };
}
