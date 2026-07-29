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
    activeBuyVolume: read(flow, ["activeBuyVolume60s", "activeBuyVolume", "activeBuyNotional60s", "buyVolume", "buyVol"]),
    activeSellVolume: read(flow, ["activeSellVolume60s", "activeSellVolume", "activeSellNotional60s", "sellVolume", "sellVol"]),
    activeBuyRatio: read(flow, ["activeBuyRatio60s", "activeBuyRatio"]),
    ddx: read(flow, ["ddx", "netActiveNotional60s", "orderFlowDdx"]),
    bigOrderNet: read(flow, ["bigOrderNetNotional60s", "bigOrderNet", "largeOrderNet"]),
    bigBuyNotional: read(flow, ["bigBuyNotional60s", "bigBuyNotional"]),
    bigSellNotional: read(flow, ["bigSellNotional60s", "bigSellNotional"]),
    buySweepStreak: read(flow, ["buySweepStreak60s", "buySweepStreak"]),
    sellSweepStreak: read(flow, ["sellSweepStreak60s", "sellSweepStreak"]),
    transactionCount: read(flow, ["transactionCount60s", "transactionCount"]),
    bid1Volume: read(book, ["bid1Volume", "bidVolume", "bid1Vol"]),
    ask1Volume: read(book, ["ask1Volume", "askVolume", "ask1Vol"]),
    nearTouchImbalance: read(book, ["nearTouchImbalance", "depthImbalance"]),
    spreadBps: read(book, ["spreadBps"]),
    micropriceEdgeBps: read(book, ["micropriceEdgeBps", "micropriceBiasBps"]),
    atr: read(source?.volatility ?? point?.volatility ?? {}, ["atr14", "atr"]),
    atrPct: read(source?.volatility ?? point?.volatility ?? {}, ["atrPct14", "atrPct"]),
    atrSamples: read(source?.volatility ?? point?.volatility ?? {}, ["samples", "atrSamples"]),
    atrReady: (source?.volatility ?? point?.volatility ?? {})?.ready === true,
    status,
  };
}

function persistentFlow(points, index, wantsBuy) {
  const recent = points.slice(Math.max(0, index - 2), index + 1)
    .map((point) => normalizeQmtOrderFlow(point));
  const aligned = recent.filter((row) => {
    const total = (row.activeBuyVolume ?? 0) + (row.activeSellVolume ?? 0);
    if (total <= 0) return false;
    const ratio = row.activeBuyRatio ?? row.activeBuyVolume / total;
    return wantsBuy ? ratio >= 0.52 : ratio <= 0.48;
  }).length;
  const current = recent.at(-1);
  const sweepStreak = wantsBuy ? current?.buySweepStreak : current?.sellSweepStreak;
  return {
    pass: aligned >= 2 || (sweepStreak ?? 0) >= 2,
    aligned,
    samples: recent.length,
    sweepStreak: sweepStreak ?? 0,
  };
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
  const available = totalActive > 0
    && flow.bid1Volume !== null && flow.ask1Volume !== null;
  if (!available) {
    return {
      available: false, pass: true, score: 0, required: 3,
      reason: "L2/QMT 盘口未接入，不使用伪造订单流",
    };
  }

  const activeBuyRatio = flow.activeBuyRatio ?? flow.activeBuyVolume / totalActive;
  const bookRatio = flow.ask1Volume > 0 ? flow.bid1Volume / flow.ask1Volume : Number.POSITIVE_INFINITY;
  const depthImbalance = flow.nearTouchImbalance ?? (bookRatio - 1) / Math.max(bookRatio + 1, 0.01);
  const marketQualityBlocked = (flow.transactionCount !== null && flow.transactionCount < 3)
    || (flow.spreadBps !== null && flow.spreadBps > 18);
  const wantsBuy = phase !== "SELL_FIRST";
  const bigFlowAligned = flow.bigOrderNet === null
    || (wantsBuy ? flow.bigOrderNet >= 0 : flow.bigOrderNet <= 0);
  const aggression = wantsBuy
    ? activeBuyRatio >= 0.53 && bigFlowAligned
    : activeBuyRatio <= 0.47 && bigFlowAligned;
  const persistence = persistentFlow(points, index, wantsBuy);
  const book = wantsBuy
    ? depthImbalance >= 0.04 || (flow.micropriceEdgeBps !== null && flow.micropriceEdgeBps > 0)
    : depthImbalance <= -0.04 || (flow.micropriceEdgeBps !== null && flow.micropriceEdgeBps < 0);
  // Location and reversal structure are already independent formal V4 gates.
  // L2 contributes only three non-duplicated groups: aggression, persistence,
  // and near-touch book pressure. Two groups must agree; spread/quality can veto.
  const checks = [aggression, persistence.pass, book];
  const score = checks.filter(Boolean).length;
  return {
    available: true, pass: score >= 2 && !marketQualityBlocked, score, required: 2,
    activeBuyRatio, bookRatio, depthImbalance, persistence, marketQualityBlocked,
    reason: `L2/QMT ${score}/3：主动买占比 ${(activeBuyRatio * 100).toFixed(1)}%，同向持续 ${persistence.aligned}/${persistence.samples}，近端深度差 ${(depthImbalance * 100).toFixed(1)}%${marketQualityBlocked ? "；流动性/价差异常" : ""}`,
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
