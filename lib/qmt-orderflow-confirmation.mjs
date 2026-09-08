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

function readActivity(flow, volumeNames, notionalNames) {
  const volume = read(flow, volumeNames);
  if (volume !== null && volume > 0) return volume;
  const notional = read(flow, notionalNames);
  if (notional !== null && notional > 0) return notional;
  return volume ?? notional;
}

function readTopPrice(book, names, ladderNames) {
  const direct = read(book, names);
  if (direct !== null) return direct;
  for (const name of ladderNames) {
    const value = finite(Array.isArray(book?.[name]) ? book[name][0] : null);
    if (value !== null) return value;
  }
  return null;
}

export function normalizeQmtOrderFlow(point) {
  const source = point?.l2 ?? point?.orderFlow ?? point;
  const flow = source?.flow ?? source;
  const book = source?.book ?? source;
  const status = source?.status ?? point?.l2Status ?? {};
  const bid1Price = readTopPrice(book, ["bid1Price", "bidPrice"], ["bidPrices"]);
  const ask1Price = readTopPrice(book, ["ask1Price", "askPrice"], ["askPrices"]);
  const bid1Volume = read(book, ["bid1Volume", "bidVolume", "bid1Vol"]);
  const ask1Volume = read(book, ["ask1Volume", "askVolume", "ask1Vol"]);
  const depthTotal = (bid1Volume ?? 0) + (ask1Volume ?? 0);
  const calculatedMicroprice = bid1Price !== null && ask1Price !== null && depthTotal > 0
    ? (ask1Price * bid1Volume + bid1Price * ask1Volume) / depthTotal
    : null;
  const suppliedMicroprice = read(book, ["microprice"]);
  const microprice = suppliedMicroprice ?? calculatedMicroprice;
  const midpoint = bid1Price !== null && ask1Price !== null ? (bid1Price + ask1Price) / 2 : null;
  const calculatedMicropriceEdgeBps = microprice !== null && midpoint > 0
    ? (microprice / midpoint - 1) * 10_000
    : null;
  return {
    // Older retained minutes can contain a zero volume placeholder together
    // with genuine buy/sell notional. Prefer positive volume, otherwise retain
    // the real notional as the activity weight instead of declaring L2 absent.
    activeBuyVolume: readActivity(
      flow,
      ["activeBuyVolume60s", "activeBuyVolume", "buyVolume", "buyVol"],
      ["activeBuyNotional60s", "activeBuyNotional"],
    ),
    activeSellVolume: readActivity(
      flow,
      ["activeSellVolume60s", "activeSellVolume", "sellVolume", "sellVol"],
      ["activeSellNotional60s", "activeSellNotional"],
    ),
    activeBuyRatio: read(flow, ["activeBuyRatio60s", "activeBuyRatio"]),
    activeBuyNotional: read(flow, ["activeBuyNotional60s", "activeBuyNotional"]),
    activeSellNotional: read(flow, ["activeSellNotional60s", "activeSellNotional"]),
    ddx: read(flow, ["ddx", "netActiveNotional60s", "netActiveNotional", "orderFlowDdx"]),
    bigOrderNet: read(flow, ["bigOrderNetNotional60s", "bigOrderNetNotional", "bigOrderNet", "largeOrderNet"]),
    bigBuyNotional: read(flow, ["bigBuyNotional60s", "bigBuyNotional"]),
    bigSellNotional: read(flow, ["bigSellNotional60s", "bigSellNotional"]),
    buySweepStreak: read(flow, ["buySweepStreak60s", "buySweepStreak"]),
    sellSweepStreak: read(flow, ["sellSweepStreak60s", "sellSweepStreak"]),
    icebergBuyStrength: read(flow, ["icebergBuyStrength", "buyIcebergStrength", "icebergBuyScore"]),
    icebergSellStrength: read(flow, ["icebergSellStrength", "sellIcebergStrength", "icebergSellScore"]),
    transactionCount: read(flow, ["transactionCount60s", "transactionCount"]),
    bid1Price,
    ask1Price,
    bid1Volume,
    ask1Volume,
    bidVolumes: Array.isArray(book?.bidVolumes) ? book.bidVolumes : (bid1Volume !== null ? [bid1Volume] : null),
    askVolumes: Array.isArray(book?.askVolumes) ? book.askVolumes : (ask1Volume !== null ? [ask1Volume] : null),
    bidPrices: Array.isArray(book?.bidPrices) ? book.bidPrices : (bid1Price !== null ? [bid1Price] : null),
    askPrices: Array.isArray(book?.askPrices) ? book.askPrices : (ask1Price !== null ? [ask1Price] : null),
    nearTouchImbalance: read(book, ["nearTouchImbalance", "depthImbalance"]),
    spreadBps: read(book, ["spreadBps"]),
    microprice,
    micropriceEdgeBps: read(book, ["micropriceEdgeBps", "micropriceBiasBps"]) ?? calculatedMicropriceEdgeBps,
    atr: read(source?.volatility ?? point?.volatility ?? {}, ["atr14", "atr"]),
    atrPct: read(source?.volatility ?? point?.volatility ?? {}, ["atrPct14", "atrPct"]),
    atrSamples: read(source?.volatility ?? point?.volatility ?? {}, ["samples", "atrSamples"]),
    atrReady: (source?.volatility ?? point?.volatility ?? {})?.ready === true,
    status,
  };
}

export function evaluateOrderBookImbalance(l2Snapshot, recentHistory) {
  if (!l2Snapshot) {
    return {
      obi: 0,
      depthRatio: 1.0,
      totalBidDepth: 0,
      totalAskDepth: 0,
      spoofingRisk: "NONE",
      largeOrderCancellation: false,
      cancellationSide: null,
      available: false,
    };
  }
  const flow = normalizeQmtOrderFlow(l2Snapshot);
  const bids = Array.isArray(flow.bidVolumes) ? flow.bidVolumes : (flow.bid1Volume !== null ? [flow.bid1Volume] : []);
  const asks = Array.isArray(flow.askVolumes) ? flow.askVolumes : (flow.ask1Volume !== null ? [flow.ask1Volume] : []);

  const totalBid = bids.slice(0, 5).reduce((acc, v) => acc + (Number(v) || 0), 0);
  const totalAsk = asks.slice(0, 5).reduce((acc, v) => acc + (Number(v) || 0), 0);
  const sum = totalBid + totalAsk;

  if (sum === 0) {
    return {
      obi: 0,
      depthRatio: 1.0,
      totalBidDepth: 0,
      totalAskDepth: 0,
      spoofingRisk: "NONE",
      largeOrderCancellation: false,
      cancellationSide: null,
      available: true,
    };
  }

  const obi = (totalBid - totalAsk) / sum;
  const depthRatio = totalAsk > 0 ? totalBid / totalAsk : Number.POSITIVE_INFINITY;

  // Aggregate active volume across the last 3 minutes if recent history is supplied
  let activeBuyVol = 0;
  let activeSellVol = 0;

  if (Array.isArray(recentHistory) && recentHistory.length > 0) {
    const recent3 = recentHistory.slice(-3);
    for (const item of recent3) {
      const f = normalizeQmtOrderFlow(item);
      activeBuyVol += Number(f.activeBuyVolume ?? f.activeBuyNotional ?? 0);
      activeSellVol += Number(f.activeSellVolume ?? f.activeSellNotional ?? 0);
    }
  } else {
    activeBuyVol = Number(flow.activeBuyVolume ?? flow.activeBuyNotional ?? 0);
    activeSellVol = Number(flow.activeSellVolume ?? flow.activeSellNotional ?? 0);
  }

  const totalActive = activeBuyVol + activeSellVol;
  let spoofingRisk = "NONE";

  if (totalActive > 0) {
    const buyRatio = activeBuyVol / totalActive;
    const sellRatio = activeSellVol / totalActive;
    // 诱多陷阱 (Bull Trap): OBI > 0.4 且近 3 分钟主动卖单金额/量占比 > 65% (sellRatio > 0.65)
    if (obi > 0.4 && sellRatio > 0.65) {
      spoofingRisk = "BULL_TRAP";
    } else if (obi < -0.4 && buyRatio > 0.65) {
      // 诱空陷阱 (Bear Trap): OBI < -0.4 且近 3 分钟主动买单金额/量占比 > 65%
      spoofingRisk = "BEAR_TRAP";
    }
  }

  // Large order cancellation anomaly monitoring
  let largeOrderCancellation = false;
  let cancellationSide = null;
  if (Array.isArray(recentHistory) && recentHistory.length >= 2) {
    const prevPoint = recentHistory[recentHistory.length - 2];
    const prevFlow = normalizeQmtOrderFlow(prevPoint);
    const prevBids = (Array.isArray(prevFlow.bidVolumes) ? prevFlow.bidVolumes : (prevFlow.bid1Volume !== null ? [prevFlow.bid1Volume] : [])).slice(0, 5);
    const prevAsks = (Array.isArray(prevFlow.askVolumes) ? prevFlow.askVolumes : (prevFlow.ask1Volume !== null ? [prevFlow.ask1Volume] : [])).slice(0, 5);
    const prevBidDepth = prevBids.reduce((acc, v) => acc + (Number(v) || 0), 0);
    const prevAskDepth = prevAsks.reduce((acc, v) => acc + (Number(v) || 0), 0);

    const currBuyVol = Number(flow.activeBuyVolume ?? 0);
    const currSellVol = Number(flow.activeSellVolume ?? 0);

    const bidDrop = prevBidDepth - totalBid;
    const askDrop = prevAskDepth - totalAsk;

    if (prevBidDepth > 0 && bidDrop > prevBidDepth * 0.35 && bidDrop > currSellVol * 1.5) {
      largeOrderCancellation = true;
      cancellationSide = "BID_CANCEL";
    } else if (prevAskDepth > 0 && askDrop > prevAskDepth * 0.35 && askDrop > currBuyVol * 1.5) {
      largeOrderCancellation = true;
      cancellationSide = "ASK_CANCEL";
    }
  }

  return {
    obi,
    depthRatio,
    totalBidDepth: totalBid,
    totalAskDepth: totalAsk,
    spoofingRisk,
    largeOrderCancellation,
    cancellationSide,
    available: true,
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

/**
 * Shadow-only L2/order-flow evaluator. `pass` describes alignment for
 * diagnostics and research; it is never a formal strategy confirmation or
 * veto. Missing data stays neutral and stale data is marked unusable.
 */
export function evaluateQmtOrderFlow(points, index, phase) {
  const current = points[index];
  const flow = normalizeQmtOrderFlow(current);
  const integrityBlocked = flow.status?.connected === true
    && (flow.status?.authorized === false || flow.status?.stale === true);
  if (integrityBlocked) {
    return {
      available: true, pass: false, score: 0, required: 3, integrityBlocked: true,
      reason: "L2 已连接但数据过期或无权限，仅标记影子观察不可用",
    };
  }

  const totalActive = (flow.activeBuyVolume ?? 0) + (flow.activeSellVolume ?? 0);
  // Retained minute snapshots always contain genuine transaction flow, while
  // matching ten-level book snapshots are not guaranteed for older minutes.
  // Missing book data is neutral; do not throw away the real transaction flow.
  const available = totalActive > 0;
  const bookAvailable = flow.bid1Volume !== null && flow.ask1Volume !== null;
  if (!available) {
    return {
      available: false, bookAvailable: false, pass: true, score: 0, required: 0,
      reason: "L2/QMT 盘口未接入，不使用伪造订单流",
    };
  }

  const activeBuyRatio = flow.activeBuyRatio ?? flow.activeBuyVolume / totalActive;
  const bookRatio = bookAvailable
    ? flow.ask1Volume > 0 ? flow.bid1Volume / flow.ask1Volume : Number.POSITIVE_INFINITY
    : null;
  const depthImbalance = flow.nearTouchImbalance
    ?? (bookRatio === null ? null : (bookRatio - 1) / Math.max(bookRatio + 1, 0.01));
  const marketQualityBlocked = (flow.transactionCount !== null && flow.transactionCount < 3)
    || (flow.spreadBps !== null && flow.spreadBps > 18);
  const wantsBuy = phase !== "SELL_FIRST";
  const bigFlowAligned = flow.bigOrderNet === null
    || (wantsBuy ? flow.bigOrderNet >= 0 : flow.bigOrderNet <= 0);
  const aggression = wantsBuy
    ? activeBuyRatio >= 0.53 && bigFlowAligned
    : activeBuyRatio <= 0.47 && bigFlowAligned;
  const persistence = persistentFlow(points, index, wantsBuy);
  const book = !bookAvailable ? null : wantsBuy
    ? depthImbalance >= 0.04 || (flow.micropriceEdgeBps !== null && flow.micropriceEdgeBps > 0)
    : depthImbalance <= -0.04 || (flow.micropriceEdgeBps !== null && flow.micropriceEdgeBps < 0);
  // Location and reversal structure are already independent formal V4 gates.
  // L2 contributes only three non-duplicated groups: aggression, persistence,
  // and near-touch book pressure. Two groups must agree; spread/quality can veto.
  const checks = bookAvailable
    ? [aggression, persistence.pass, book]
    : [aggression, persistence.pass];
  const score = checks.filter(Boolean).length;
  return {
    available: true, bookAvailable, pass: score >= 2 && !marketQualityBlocked, score, required: 2,
    activeBuyRatio, bookRatio, depthImbalance, persistence, marketQualityBlocked,
    reason: `L2/QMT ${score}/${bookAvailable ? 3 : 2}：主动买占比 ${(activeBuyRatio * 100).toFixed(1)}%，同向持续 ${persistence.aligned}/${persistence.samples}${bookAvailable ? `，近端深度差 ${(depthImbalance * 100).toFixed(1)}%` : "，历史盘口快照缺失（中性）"}${marketQualityBlocked ? "；流动性/价差异常" : ""}`,
  };
}

/** Research-only summary used by the Zijin agent; it never creates an order. */
export function summarizeZijinOrderFlow(point) {
  const flow = normalizeQmtOrderFlow(point);
  const total = (flow.activeBuyVolume ?? 0) + (flow.activeSellVolume ?? 0);
  const available = total > 0
    && flow.status?.authorized !== false && flow.status?.stale !== true;
  if (!available) {
    return { available: false, stance: "neutral", score: 0, reason: "L2 前瞻订单流仍在采集" };
  }
  const activeBuyRatio = flow.activeBuyRatio ?? flow.activeBuyVolume / total;
  const bookAvailable = flow.bid1Volume !== null && flow.ask1Volume !== null;
  const bookRatio = bookAvailable
    ? flow.ask1Volume > 0 ? flow.bid1Volume / flow.ask1Volume : Number.POSITIVE_INFINITY
    : null;
  const depthImbalance = flow.nearTouchImbalance
    ?? (bookRatio === null ? null : (bookRatio - 1) / Math.max(bookRatio + 1, 0.01));
  const buyVotes = [
    activeBuyRatio >= 0.55,
    flow.ddx !== null && flow.ddx > 0,
    bookAvailable && depthImbalance >= 0.08,
    flow.bigOrderNet !== null && flow.bigOrderNet > 0,
    bookAvailable && flow.micropriceEdgeBps !== null && flow.micropriceEdgeBps > 0,
  ].filter(Boolean).length;
  const sellVotes = [
    activeBuyRatio <= 0.45,
    flow.ddx !== null && flow.ddx < 0,
    bookAvailable && depthImbalance <= -0.08,
    flow.bigOrderNet !== null && flow.bigOrderNet < 0,
    bookAvailable && flow.micropriceEdgeBps !== null && flow.micropriceEdgeBps < 0,
  ].filter(Boolean).length;
  const required = bookAvailable ? 3 : 2;
  const stance = buyVotes >= required ? "buy" : sellVotes >= required ? "sell" : "neutral";
  return {
    available: true, bookAvailable, required, stance, score: Math.max(buyVotes, sellVotes), buyVotes, sellVotes,
    activeBuyRatio, depthImbalance, bookRatio,
    reason: `L2 订单流：买方 ${buyVotes}/5，卖方 ${sellVotes}/5，主动买占比 ${(activeBuyRatio * 100).toFixed(1)}%`,
  };
}
