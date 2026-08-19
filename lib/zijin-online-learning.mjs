import { createHash } from "node:crypto";

export const ZIJIN_ONLINE_LEARNING_VERSION = "2026.08.19-shadow";

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const average = values => {
  const available = values.map(finite).filter(value => value !== null);
  return available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null;
};
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function hashEvidence(value) {
  return createHash("sha256").update(stableValue(value)).digest("hex");
}

function timestampDate(value) {
  const match = String(value || "").match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function isCurrentMarketDate(payload, marketDate, timestampPath = "sourceTimestamp") {
  const timestamp = payload?.[timestampPath];
  return timestampDate(timestamp) === marketDate;
}

function factor(signal, available, note) {
  if (!available || signal === null) return { state: "pending", score: null, note };
  const normalized = clamp(signal, -1, 1);
  return {
    state: normalized >= 0.15 ? "confirmed" : normalized <= -0.15 ? "否决" : "pending",
    score: Math.round(50 + normalized * 50),
    note,
  };
}

function trailingDirection(minutes, windowSize, asOfLabel) {
  if (!Array.isArray(minutes) || minutes.length <= windowSize) return null;
  const end = finite(minutes.at(-1)?.price);
  const start = finite(minutes.at(-(windowSize + 1))?.price);
  if (end === null || start === null || start <= 0) return null;
  const changePct = ((end / start) - 1) * 100;
  const state = changePct > 0.12 ? "up" : changePct < -0.12 ? "down" : "range";
  return {
    state,
    label: state === "up" ? "偏强" : state === "down" ? "偏弱" : "震荡",
    confidence: clamp(0.45 + Math.abs(changePct) / 3, 0.45, 0.82),
    evidence: `${asOfLabel}前${windowSize}分钟实盘变化 ${changePct >= 0 ? "+" : ""}${round(changePct, 2)}%，不是未来概率。`,
  };
}

function eventSummary(eventRadar) {
  const stock = Array.isArray(eventRadar?.stocks)
    ? eventRadar.stocks.find(item => item?.code === "601899")
    : null;
  const items = Array.isArray(stock?.items) ? stock.items : [];
  const official = items.filter(item => item?.official === true);
  const leads = items.filter(item => item?.official !== true);
  return { stock, items, official, leads };
}

export function createZijinOnlineLearningObservations({
  marketDate,
  collectedAt = new Date().toISOString(),
  marketContext = null,
  eventRadar = null,
  marketData = null,
  l2 = null,
  errors = [],
} = {}) {
  const currentMarketData = isCurrentMarketDate(marketData, marketDate) ? marketData : null;
  const currentL2 = timestampDate(l2?.lastExchangeTime) === marketDate ? l2 : null;
  const contextItems = Array.isArray(marketContext?.items)
    ? marketContext.items.filter(item => timestampDate(item?.sourceTimestamp) === marketDate)
    : [];
  const byId = id => contextItems.find(item => item?.id === id) || null;
  const changes = ids => ids.map(id => finite(byId(id)?.changePercent)).filter(value => value !== null);
  const goldChange = average(changes(["hf_GC", "nf_AU0", "sh518880"]));
  const copperChange = average(changes(["hf_CAD", "nf_CU0"]));
  const peerChange = average(changes(["hk02899", "sh512400"]));
  const marketChange = average(changes(["sh000001", "sh000300"]));

  const minutes = Array.isArray(currentMarketData?.minutes)
    ? currentMarketData.minutes.filter(item => finite(item?.price) !== null)
    : [];
  const quote = currentMarketData?.quote || null;
  const price = finite(quote?.price) ?? finite(minutes.at(-1)?.price);
  const open = finite(quote?.open) ?? finite(minutes[0]?.price);
  const previousClose = finite(quote?.previousClose);
  const vwap = finite(minutes.at(-1)?.averagePrice);
  const dayChange = finite(quote?.changePercent) ?? (
    price !== null && previousClose !== null && previousClose > 0 ? ((price / previousClose) - 1) * 100 : null
  );
  const openMove = price !== null && open !== null && open > 0 ? ((price / open) - 1) * 100 : null;
  const vwapBias = price !== null && vwap !== null && vwap > 0 ? ((price / vwap) - 1) * 100 : null;

  const volumes = minutes.map(item => Math.max(0, finite(item?.volume) || 0));
  const baselineVolume = average(volumes.slice(0, -5));
  const recentVolume = average(volumes.slice(-5));
  const recentVolumeRatio = baselineVolume && recentVolume !== null ? recentVolume / baselineVolume : null;
  const volumeSignal = recentVolumeRatio === null || openMove === null
    ? null
    : clamp((recentVolumeRatio - 1) * Math.sign(openMove || dayChange || 0), -1, 1);

  const l2Ready = currentL2?.status?.connected === true && currentL2?.status?.stale !== true;
  const activeBuyRatio = finite(currentL2?.flow?.activeBuyRatio60s);
  const bookImbalance = finite(currentL2?.book?.nearTouchImbalance);
  const ofiSignal = l2Ready ? average([
    activeBuyRatio === null ? null : (activeBuyRatio - 0.5) * 4,
    bookImbalance === null ? null : bookImbalance * 2,
  ]) : null;

  const goldSignal = goldChange === null ? null : clamp(goldChange / 1.2, -1, 1);
  const copperSignal = copperChange === null ? null : clamp(copperChange / 1.2, -1, 1);
  const peerSignal = peerChange === null ? null : clamp(peerChange / 1.5, -1, 1);
  const marketSignal = marketChange === null ? null : clamp(marketChange / 1.5, -1, 1);
  const vwapSignal = vwapBias === null ? null : clamp(vwapBias / 0.8, -1, 1);
  const momentumSignal = openMove === null ? null : clamp(openMove / 1.5, -1, 1);
  const daySignal = dayChange === null ? null : clamp(dayChange / 2, -1, 1);

  const weightedSignals = [
    [daySignal, 0.2], [vwapSignal, 0.18], [momentumSignal, 0.16], [copperSignal, 0.14],
    [goldSignal, 0.1], [peerSignal, 0.1], [marketSignal, 0.06], [ofiSignal, 0.06],
  ].filter(([signal]) => signal !== null);
  const weight = weightedSignals.reduce((sum, [, itemWeight]) => sum + itemWeight, 0);
  const composite = weight && currentMarketData
    ? weightedSignals.reduce((sum, [signal, itemWeight]) => sum + signal * itemWeight, 0) / weight
    : null;
  const directionState = composite === null ? "pending" : composite >= 0.2 ? "up" : composite <= -0.2 ? "down" : "range";
  const lastMinuteTime = String(minutes.at(-1)?.time || "");
  const observationPhase = lastMinuteTime >= "1457" ? "收盘" : lastMinuteTime ? `截至${lastMinuteTime.slice(0, 2)}:${lastMinuteTime.slice(2)}` : "当日";
  const directionLabel = directionState === "up" ? `${observationPhase}偏强` : directionState === "down" ? `${observationPhase}偏弱` : directionState === "range" ? `${observationPhase}震荡` : "待验证";

  const events = eventSummary(eventRadar);
  const sources = [
    { id: "market-data", label: "紫金行情", available: Boolean(currentMarketData), tier: 1 },
    { id: "market-context", label: "商品/大盘/港股", available: contextItems.length > 0, tier: 1 },
    { id: "event-radar", label: "公告与财经线索", available: Boolean(events.stock), tier: 1 },
    { id: "l2", label: "L2盘口", available: l2Ready, tier: 1 },
  ];
  const readySources = sources.filter(source => source.available).length;
  const normalizedErrors = [...new Set(errors.filter(item => typeof item === "string" && item.trim()).map(item => item.trim()))].slice(0, 8);
  if (marketData && !currentMarketData) normalizedErrors.push("紫金行情日期与作业日不一致");
  if (l2 && !currentL2) normalizedErrors.push("L2快照非当日数据");

  const factors = {
    gold: factor(goldSignal, goldChange !== null, goldChange === null ? "黄金数据缺失" : `黄金组合 ${goldChange >= 0 ? "+" : ""}${round(goldChange, 2)}%`),
    copper: factor(copperSignal, copperChange !== null, copperChange === null ? "铜价数据缺失" : `铜价组合 ${copperChange >= 0 ? "+" : ""}${round(copperChange, 2)}%`),
    peer: factor(peerSignal, peerChange !== null, peerChange === null ? "港股/板块数据缺失" : `港股与有色 ${peerChange >= 0 ? "+" : ""}${round(peerChange, 2)}%`),
    vwap: factor(vwapSignal, vwapBias !== null, vwapBias === null ? "VWAP数据缺失" : `收盘偏离VWAP ${vwapBias >= 0 ? "+" : ""}${round(vwapBias, 2)}%`),
    volume: factor(volumeSignal, volumeSignal !== null, recentVolumeRatio === null ? "分钟量数据不足" : `末5分钟量比 ${round(recentVolumeRatio, 2)}`),
    momentum: factor(momentumSignal, openMove !== null, openMove === null ? "分时动量数据缺失" : `相对开盘 ${openMove >= 0 ? "+" : ""}${round(openMove, 2)}%`),
    ofi: factor(ofiSignal, l2Ready && ofiSignal !== null, l2Ready ? `60秒主动买入 ${activeBuyRatio === null ? "—" : `${Math.round(activeBuyRatio * 100)}%`}，近档失衡 ${bookImbalance === null ? "—" : round(bookImbalance, 2)}` : "L2未连接或已过期"),
  };

  const findings = [
    `联网证据 ${readySources}/${sources.length}：${sources.filter(source => source.available).map(source => source.label).join("、") || "暂无可用源"}。`,
    events.items.length ? `近72小时发现 ${events.official.length} 条法定公告、${events.leads.length} 条公开财经线索。` : "近72小时未发现可核验的紫金事件。",
  ];
  if (dayChange !== null) findings.push(`紫金当日 ${dayChange >= 0 ? "+" : ""}${round(dayChange, 2)}%，相对VWAP ${vwapBias === null ? "—" : `${vwapBias >= 0 ? "+" : ""}${round(vwapBias, 2)}%`}。`);
  if (marketChange !== null) findings.push(`A股大盘组合 ${marketChange >= 0 ? "+" : ""}${round(marketChange, 2)}%，仅作环境证据。`);
  if (l2Ready) findings.push(`L2收市快照：主动买入 ${activeBuyRatio === null ? "—" : `${Math.round(activeBuyRatio * 100)}%`}，近档失衡 ${bookImbalance === null ? "—" : round(bookImbalance, 2)}。`);

  const candidateRules = events.items.slice(0, 3).map(item => ({
    title: String(item.title || "紫金事件线索").slice(0, 80),
    direction: "正T/反T待量价验证",
    source: item.official === true ? `一级·${item.source || "法定披露"}` : `三级线索·${item.source || "公开资讯"}`,
    rule: item.official === true
      ? "事件只有与商品、价格和成交量同步确认后，才进入影子样本。"
      : "公开线索必须回溯一级来源，未核验前不改变任何策略。",
  }));

  const horizons = {};
  for (const windowSize of [5, 15, 30, 60]) {
    const result = trailingDirection(minutes, windowSize, observationPhase);
    if (result) horizons[`${windowSize}m`] = result;
  }
  horizons.nextDay = { state: "pending", label: "待验证", evidence: "次日方向只做前瞻标注，等下一交易日后回填。" };

  const evidenceBody = {
    version: ZIJIN_ONLINE_LEARNING_VERSION,
    marketDate,
    collectedAt,
    sources,
    events: events.items.map(item => ({ id: item.id, publishedAt: item.publishedAt, official: Boolean(item.official), source: item.source })),
    market: { dayChange, openMove, vwapBias, goldChange, copperChange, peerChange, marketChange },
    l2: { ready: l2Ready, lastExchangeTime: currentL2?.lastExchangeTime || null, activeBuyRatio, bookImbalance },
  };

  return {
    schemaVersion: 1,
    learningVersion: ZIJIN_ONLINE_LEARNING_VERSION,
    marketDate,
    collectedAt,
    status: "shadow-only",
    direction: {
      state: directionState,
      label: directionLabel,
      confidence: composite === null ? null : round(clamp(0.45 + Math.abs(composite) * 0.35 + (readySources / sources.length) * 0.1, 0.45, 0.86)),
      probabilities: null,
      reason: composite === null ? "当日紫金行情不完整，不下方向结论。" : "这是收市后的因子共振分类，不是未来收益概率。",
      invalidatedBy: normalizedErrors.slice(0, 4),
    },
    horizons,
    factors,
    findings: findings.slice(0, 6),
    candidateRules,
    onlineLearning: {
      status: readySources === sources.length && normalizedErrors.length === 0 ? "complete" : readySources > 0 ? "partial" : "unavailable",
      readySources,
      totalSources: sources.length,
      officialEvents: events.official.length,
      leadEvents: events.leads.length,
      collectedAt,
      sources,
      errors: normalizedErrors,
      affectsFormalStrategy: false,
      canTrade: false,
    },
    integrity: {
      source: "event-radar+market-context+market-data+zijin-l2-orderflow",
      evidenceHash: hashEvidence(evidenceBody),
    },
  };
}
