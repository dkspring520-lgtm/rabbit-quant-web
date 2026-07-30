import { normalizeQmtOrderFlow } from "./qmt-orderflow-confirmation.mjs";

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function cumulativeVolume(points, cutoff) {
  return (points ?? [])
    .filter(point => String(point?.time ?? "") <= cutoff)
    .reduce((sum, point) => sum + Math.max(0, finite(point?.volume) ?? 0), 0);
}

function buildRvolTime(points, historicalSessions, asOfDate) {
  const latestTime = String(points.at(-1)?.time ?? "");
  const currentVolume = latestTime ? cumulativeVolume(points, latestTime) : 0;
  const baselines = (historicalSessions ?? [])
    .filter(session => !asOfDate || String(session?.date ?? "") < asOfDate)
    .slice()
    .sort((left, right) => String(right?.date ?? "").localeCompare(String(left?.date ?? "")))
    .slice(0, 20)
    .map(session => cumulativeVolume(session?.minutes ?? [], latestTime))
    .filter(value => value > 0);
  const baseline = median(baselines);
  const available = currentVolume > 0 && baseline !== null && baselines.length >= 10;
  return {
    available,
    latestTime,
    currentVolume,
    baseline,
    sessions: baselines.length,
    value: available ? currentVolume / baseline : null,
  };
}

function buildCvd(points) {
  const rows = (points ?? []).map(point => {
    const flow = normalizeQmtOrderFlow(point);
    const buyNotional = finite(flow.activeBuyNotional);
    const sellNotional = finite(flow.activeSellNotional);
    const ddx = finite(flow.ddx);
    const buyActivity = finite(flow.activeBuyVolume);
    const sellActivity = finite(flow.activeSellVolume);
    const notionalAvailable = buyNotional !== null && sellNotional !== null && buyNotional + sellNotional > 0;
    const activityAvailable = buyActivity !== null && sellActivity !== null && buyActivity + sellActivity > 0;
    if (!notionalAvailable && ddx === null && !activityAvailable) return null;
    const net = notionalAvailable
      ? buyNotional - sellNotional
      : ddx !== null
        ? ddx
        : buyActivity - sellActivity;
    const gross = notionalAvailable
      ? buyNotional + sellNotional
      : activityAvailable
        ? buyActivity + sellActivity
        : Math.abs(ddx);
    return {
      time: point.time,
      price: finite(point.price),
      net,
      gross: Math.max(Math.abs(net), gross ?? 0),
      source: notionalAvailable || ddx !== null ? "notional" : "activity",
    };
  }).filter(Boolean);
  const recent = rows.slice(-5);
  const totalNet = rows.reduce((sum, row) => sum + row.net, 0);
  const totalGross = rows.reduce((sum, row) => sum + row.gross, 0);
  const recentNet = recent.reduce((sum, row) => sum + row.net, 0);
  const recentGross = recent.reduce((sum, row) => sum + row.gross, 0);
  const recentBalance = recentGross > 0 ? recentNet / recentGross : null;
  const persistence = recent.length
    ? recent.filter(row => recentNet >= 0 ? row.net > 0 : row.net < 0).length / recent.length
    : 0;
  return {
    available: rows.length >= 3 && recentGross > 0,
    samples: rows.length,
    unit: rows.every(row => row.source === "notional") ? "notional" : "mixed",
    totalNet,
    totalBalance: totalGross > 0 ? totalNet / totalGross : null,
    recentNet,
    recentBalance,
    persistence,
    recent,
  };
}

function buildAbsorption(cvd) {
  if (!cvd.available || cvd.recent.length < 3) {
    return { available:false, side:"none", score:0, priceChangePct:null, rangePosition:null };
  }
  const priced = cvd.recent.filter(row => row.price !== null);
  if (priced.length < 3) {
    return { available:false, side:"none", score:0, priceChangePct:null, rangePosition:null };
  }
  const first = priced[0].price;
  const last = priced.at(-1).price;
  const prices = priced.map(row => row.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const span = Math.max(high - low, first * .0001);
  const priceChangePct = (last - first) / Math.max(first, .01) * 100;
  const rangePosition = (last - low) / span;
  const imbalance = cvd.recentBalance ?? 0;
  const buyAbsorption = imbalance <= -.08 && priceChangePct >= -.08 && rangePosition >= .42;
  const sellAbsorption = imbalance >= .08 && priceChangePct <= .08 && rangePosition <= .58;
  const side = buyAbsorption ? "buy" : sellAbsorption ? "sell" : "none";
  const score = side === "none"
    ? 0
    : Math.round(clamp(Math.abs(imbalance) * 160 + (side === "buy" ? rangePosition : 1 - rangePosition) * 45, 0, 100));
  return { available:true, side, score, priceChangePct, rangePosition, imbalance };
}

function buildBook(liveL2) {
  const flow = normalizeQmtOrderFlow(liveL2 ?? {});
  const bid = finite(flow.bid1Volume);
  const ask = finite(flow.ask1Volume);
  const derived = bid !== null && ask !== null && bid + ask > 0 ? (bid - ask) / (bid + ask) : null;
  const imbalance = finite(flow.nearTouchImbalance) ?? derived;
  const micropriceEdgeBps = finite(flow.micropriceEdgeBps);
  const available = imbalance !== null || micropriceEdgeBps !== null;
  return { available, imbalance, micropriceEdgeBps, spreadBps:finite(flow.spreadBps) };
}

/**
 * Causal WEB4 microstructure evidence.
 * It consumes only the currently visible minute prefix and past sessions.
 * Missing L2 fields remain unavailable instead of being synthesized.
 */
export function evaluateWeb4Microstructure({
  points = [],
  historicalSessions = [],
  liveL2 = null,
  asOfDate = null,
  stale = false,
} = {}) {
  const ordered = (points ?? [])
    .filter(point => /^\d{4}$/.test(String(point?.time ?? "")) && finite(point?.price) !== null)
    .slice()
    .sort((left, right) => String(left.time).localeCompare(String(right.time)));
  const rvol = buildRvolTime(ordered, historicalSessions, asOfDate);
  const cvd = buildCvd(ordered);
  const absorption = buildAbsorption(cvd);
  const book = buildBook(liveL2 ?? ordered.at(-1));
  const available = cvd.available || book.available || rvol.available;
  if (stale) {
    return {
      available, stale:true, state:"waiting", score:0, label:"L2数据延迟",
      rvol, cvd, absorption, book, buyScore:0, sellScore:0,
      evidence:["实时订单流已过期，拒绝形成资金确认"],
    };
  }

  const rvolValue = rvol.value ?? 1;
  const rvolParticipation = rvol.available ? clamp((rvolValue - .7) / 1.1, 0, 1) : .35;
  const cvdBalance = cvd.recentBalance ?? 0;
  const bookBuy = book.available && ((book.imbalance ?? 0) >= .04 || (book.micropriceEdgeBps ?? 0) > 0);
  const bookSell = book.available && ((book.imbalance ?? 0) <= -.04 || (book.micropriceEdgeBps ?? 0) < 0);
  const buyParts = [
    cvd.available ? clamp((cvdBalance + .04) * 190, 0, 32) : 0,
    absorption.side === "buy" ? absorption.score * .30 : 0,
    bookBuy ? 22 : 0,
    rvolParticipation * 16,
  ];
  const sellParts = [
    cvd.available ? clamp((-cvdBalance + .04) * 190, 0, 32) : 0,
    absorption.side === "sell" ? absorption.score * .30 : 0,
    bookSell ? 22 : 0,
    rvolParticipation * 16,
  ];
  const buyScore = Math.round(clamp(buyParts.reduce((sum, value) => sum + value, 0)));
  const sellScore = Math.round(clamp(sellParts.reduce((sum, value) => sum + value, 0)));
  const supportingGroups = side => [
    cvd.available && (side === "buy" ? cvdBalance >= .05 : cvdBalance <= -.05),
    absorption.side === side,
    side === "buy" ? bookBuy : bookSell,
    rvol.available && rvolValue >= 1.15,
  ].filter(Boolean).length;
  const buyGroups = supportingGroups("buy");
  const sellGroups = supportingGroups("sell");
  const winner = buyScore >= sellScore ? "buy" : "sell";
  const score = Math.max(buyScore, sellScore);
  const groups = winner === "buy" ? buyGroups : sellGroups;
  const state = score >= 68 && groups >= 3
    ? `confirmed_${winner}`
    : absorption.side === "buy"
      ? "absorption_buy"
      : absorption.side === "sell"
        ? "absorption_sell"
        : "waiting";
  const label = state === "confirmed_buy"
    ? "订单流买方确认"
    : state === "confirmed_sell"
      ? "订单流卖方确认"
      : state === "absorption_buy"
        ? "卖压被承接"
        : state === "absorption_sell"
          ? "买盘被吸收"
          : available
            ? "订单流待持续"
            : "微观数据未采集";
  const evidence = [
    rvol.available ? `同时段量能 ${rvol.value.toFixed(2)}x` : `同时段量能基线不足（${rvol.sessions}/10日）`,
    cvd.available ? `近5分钟主动净额占比 ${(cvdBalance * 100).toFixed(1)}%` : "CVD逐笔方向数据不足",
    absorption.side === "buy" ? "主动卖出未能继续压低价格" : absorption.side === "sell" ? "主动买入未能继续推高价格" : "尚无明确吸收结构",
    book.available ? `近端盘口失衡 ${((book.imbalance ?? 0) * 100).toFixed(1)}%` : "十档盘口快照不足",
  ];
  return {
    available, stale:false, state, score, label, direction:winner === "buy" ? "正T" : "反T",
    buyScore, sellScore, buyGroups, sellGroups, rvol, cvd, absorption, book, evidence,
  };
}
