import { createHash } from "node:crypto";

export const SHADOW_MODELS = Object.freeze({
  A: Object.freeze({
    id: "round10-positive-strict",
    label: "A · 少而精",
    sourceRound: 10,
    sessionStart: "0933",
    sessionEnd: "0944",
    maxSignalsPerDay: 1,
    side: "long",
    parameters: Object.freeze({ gapAbsPct: 0.6, repairPct: 0.16, confirmationVotesRequired: 1 }),
  }),
  B: Object.freeze({
    id: "round11-positive-coverage",
    label: "B · 覆盖优先",
    sourceRound: 11,
    sessionStart: "0933",
    sessionEnd: "1015",
    maxSignalsPerDay: 2,
    side: "long",
    parameters: Object.freeze({ maximumVwapDistancePct: 0.3, minimumPeerBreadth: 0.5, minimumVolumeRatio: 0.7, confirmationVotesRequired: 2 }),
  }),
  C: Object.freeze({
    id: "round12-reverse-relative-weakness",
    label: "C · 反T相对弱势",
    sourceRound: 12,
    sessionStart: "0933",
    sessionEnd: "1430",
    maxSignalsPerDay: 2,
    side: "short",
    parameters: Object.freeze({
      maximumIntradayPosition: 0.4412,
      minimumAlphaVwapPct: 0.3034,
      maximumReturn5Pct: -0.1104,
    }),
  }),
});

const COST_PCT = 0.12;
const STRESS_COST_PCT = 0.18;
const MIN_NET_TARGET_PCT = 0.64;
const MAX_NET_TARGET_PCT = 1.0;
const MAX_HOLD_MINUTES = 60;
const TRAILING_GIVEBACK_PCT = 0.15;
const STOP_NET_PCT = -0.45;

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentChange(current, base) {
  return Number.isFinite(current) && Number.isFinite(base) && base > 0
    ? (current / base - 1) * 100
    : 0;
}

function minuteNumber(time) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(2, 4));
}

function inSession(time, model) {
  return time >= model.sessionStart && time <= model.sessionEnd;
}

function rollingAverageAt(items, endIndex, window, minimumCount) {
  if (endIndex < 0) return 0;
  const values = items
    .slice(Math.max(0, endIndex - window + 1), endIndex + 1)
    .map((item) => Number(item.price))
    .filter(Number.isFinite);
  return values.length >= minimumCount ? average(values) : 0;
}

function visibleVwapBias(minutes, endIndex) {
  if (!Array.isArray(minutes) || endIndex < 0) return null;
  let weightedPrice = 0;
  let totalVolume = 0;
  let priceSum = 0;
  let count = 0;
  for (const item of minutes.slice(0, endIndex + 1)) {
    const price = Number(item.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const volume = Math.max(0, Number(item.volume) || 0);
    weightedPrice += price * volume;
    totalVolume += volume;
    priceSum += price;
    count += 1;
  }
  const current = Number(minutes[endIndex]?.price);
  if (!Number.isFinite(current) || !count) return null;
  const vwap = totalVolume > 0 ? weightedPrice / totalVolume : priceSum / count;
  return percentChange(current, vwap);
}

export function deriveShadowStatus(marketDate, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const today = `${parts.year}${parts.month}${parts.day}`;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return "closed";
  if (marketDate !== today) return minute < 9 * 60 + 30 ? "waiting" : "degraded";
  if (minute < 9 * 60 + 33) return "waiting";
  if (minute < 15 * 60) return "observing";
  return "closed";
}

export function computeVisibleFeatures({ minutes, index, previousClose, peers = [] }) {
  if (!Array.isArray(minutes) || index < 0 || index >= minutes.length) return null;
  const visible = minutes.slice(0, index + 1);
  const point = visible.at(-1);
  const open = visible[0]?.price;
  if (!point || !Number.isFinite(point.price) || !Number.isFinite(open) || open <= 0) return null;

  let weightedPrice = 0;
  let totalVolume = 0;
  let cumulativePrice = 0;
  const vwapSeries = visible.map((item, visibleIndex) => {
    const volume = Math.max(0, Number(item.volume) || 0);
    weightedPrice += item.price * volume;
    totalVolume += volume;
    cumulativePrice += item.price;
    return totalVolume > 0 ? weightedPrice / totalVolume : cumulativePrice / (visibleIndex + 1);
  });
  const vwap = vwapSeries.at(-1) || point.price;
  const price3 = visible[Math.max(0, visible.length - 4)]?.price ?? open;
  const price5 = visible[Math.max(0, visible.length - 6)]?.price ?? open;
  const ma5 = average(visible.slice(-5).map((item) => item.price));
  const priorMa5 = average(visible.slice(-10, -5).map((item) => item.price));
  const currentMa5Exact = rollingAverageAt(visible, visible.length - 1, 5, 3);
  const ma5ThreeMinutesAgo = rollingAverageAt(visible, visible.length - 4, 5, 3);
  const previousMa5 = rollingAverageAt(visible, visible.length - 2, 5, 3);
  const previousMa5ThreeMinutesAgo = rollingAverageAt(visible, visible.length - 5, 5, 3);
  const previousPrice = visible.at(-2)?.price ?? point.price;
  const previousPrice3 = visible[Math.max(0, visible.length - 5)]?.price ?? open;
  const priorVolumes = visible.slice(Math.max(0, visible.length - 21), -1).map((item) => Number(item.volume) || 0).filter((value) => value > 0);
  const volumeBase = median(priorVolumes) || average(priorVolumes) || Number(point.volume) || 1;

  const peerReturns = peers.flatMap((peer) => {
    const peerIndex = peer.minutes.findIndex((item) => item.time === point.time);
    if (peerIndex < 0) return [];
    const peerCurrent = peer.minutes[peerIndex]?.price;
    const peerPrior = peer.minutes[Math.max(0, peerIndex - 3)]?.price;
    if (!Number.isFinite(peerCurrent) || !Number.isFinite(peerPrior) || peerPrior <= 0) return [];
    return [percentChange(peerCurrent, peerPrior)];
  });
  const peerVwapBiases = peers.flatMap((peer) => {
    const peerIndex = peer.minutes.findIndex((item) => item.time === point.time);
    const value = visibleVwapBias(peer.minutes, peerIndex);
    return Number.isFinite(value) ? [value] : [];
  });
  const runningHigh = Math.max(...visible.map((item) => Number(item.high) || Number(item.price)).filter(Number.isFinite));
  const runningLow = Math.min(...visible.map((item) => Number(item.low) || Number(item.price)).filter(Number.isFinite));
  const range = runningHigh - runningLow;
  const intradayPosition = range > 0 ? (point.price - runningLow) / range : 0.5;
  const reboundFromLowPct = percentChange(point.price, runningLow);
  const currentMa5SlopeExact = ma5ThreeMinutesAgo > 0 ? percentChange(currentMa5Exact, ma5ThreeMinutesAgo) : 0;
  const previousMa5SlopeExact = previousMa5ThreeMinutesAgo > 0 ? percentChange(previousMa5, previousMa5ThreeMinutesAgo) : 0;
  const currentReturn3Pct = percentChange(point.price, price3);
  const previousReturn3Pct = percentChange(previousPrice, previousPrice3);
  const peerVwapBiasPct = peerVwapBiases.length ? average(peerVwapBiases) : 0;

  return {
    time: point.time,
    price: round(point.price),
    open: round(open),
    previousClose: Number.isFinite(previousClose) ? round(previousClose) : null,
    vwap: round(vwap),
    gapPct: round(percentChange(open, previousClose)),
    openDeviationPct: round(percentChange(point.price, open)),
    vwapBiasPct: round(percentChange(point.price, vwap)),
    vwapSlope5Pct: round(percentChange(vwap, vwapSeries[Math.max(0, vwapSeries.length - 6)] || vwap)),
    return3Pct: round(currentReturn3Pct),
    previousReturn3Pct: round(previousReturn3Pct),
    return5Pct: round(percentChange(point.price, price5)),
    ma5SlopePct: round(priorMa5 > 0 ? percentChange(ma5, priorMa5) : percentChange(point.price, ma5)),
    ma5Slope3Pct: round(currentMa5SlopeExact),
    previousMa5Slope3Pct: round(previousMa5SlopeExact),
    intradayPosition: round(intradayPosition),
    reboundFromLowPct: round(reboundFromLowPct),
    volumeRatio: round((Number(point.volume) || 0) / volumeBase),
    peerBreadth3: peerReturns.length ? round(peerReturns.filter((value) => value > 0).length / peerReturns.length) : 0,
    peerCoverage: round(peerReturns.length / Math.max(1, peers.length)),
    peerVwapBiasPct: round(peerVwapBiasPct),
    zijinAlphaVwapPct: round(percentChange(point.price, vwap) - peerVwapBiasPct),
    visibleMinuteCount: visible.length,
  };
}

function strictRound10(features) {
  const parameters = SHADOW_MODELS.A.parameters;
  const votes = [
    features.return3Pct > 0,
    features.ma5SlopePct > 0,
    features.vwapBiasPct >= 0,
  ];
  const passedVotes = votes.filter(Boolean).length;
  const failures = [];
  if (features.gapPct > -parameters.gapAbsPct) failures.push("低开幅度不足0.60%");
  if (features.openDeviationPct < parameters.repairPct) failures.push("尚未修复开盘价0.16%");
  if (passedVotes < parameters.confirmationVotesRequired) failures.push(`确认票不足${parameters.confirmationVotesRequired}票（当前${passedVotes}票）`);
  return { passed: failures.length === 0, failures, votes: passedVotes };
}

function coverageRound11(features) {
  const parameters = SHADOW_MODELS.B.parameters;
  const votes = [
    features.return3Pct > 0,
    features.ma5SlopePct > 0,
    features.vwapSlope5Pct >= 0,
    features.openDeviationPct > 0,
  ];
  const passedVotes = votes.filter(Boolean).length;
  const failures = [];
  if (Math.abs(features.vwapBiasPct) > parameters.maximumVwapDistancePct) failures.push("距VWAP超过0.30%");
  if (features.peerCoverage < 0.8) failures.push("同业覆盖不足80%");
  if (features.peerBreadth3 < parameters.minimumPeerBreadth) failures.push("同业转强不足50%");
  if (features.volumeRatio < parameters.minimumVolumeRatio) failures.push("分钟量比不足0.70");
  if (passedVotes < parameters.confirmationVotesRequired) failures.push(`转强确认不足${parameters.confirmationVotesRequired}票（当前${passedVotes}票）`);
  return { passed: failures.length === 0, failures, votes: passedVotes };
}

function reverseRound12(features) {
  const parameters = SHADOW_MODELS.C.parameters;
  const reverseTurn = (
    features.return3Pct < 0 && features.previousReturn3Pct >= 0
  ) || (
    features.ma5Slope3Pct < 0 && features.previousMa5Slope3Pct >= 0
  );
  const reverseLocation = features.vwapBiasPct >= 0.10
    || features.intradayPosition >= 0.65
    || features.reboundFromLowPct >= 0.60;
  const failures = [];
  if (!reverseTurn) failures.push("尚未出现实时转弱交叉");
  if (!reverseLocation) failures.push("尚未出现反T位置锚点");
  if (features.peerCoverage < 0.8) failures.push("同业实时覆盖不足80%");
  if (features.intradayPosition > parameters.maximumIntradayPosition) failures.push("日内位置高于44.12%");
  if (features.zijinAlphaVwapPct < parameters.minimumAlphaVwapPct) failures.push("相对同业VWAP优势不足0.3034%");
  if (features.return5Pct > parameters.maximumReturn5Pct) failures.push("5分钟回落不足0.1104%");
  return { passed: failures.length === 0, failures, votes: Math.max(0, 6 - failures.length) };
}

export function evaluateShadowCandidate(modelKey, features) {
  const model = SHADOW_MODELS[modelKey];
  if (!model || !features) return { passed: false, failures: ["模型或特征无效"], votes: 0 };
  if (!inSession(features.time, model)) return { passed: false, failures: ["不在固定观察窗口"], votes: 0 };
  if (modelKey === "A") return strictRound10(features);
  if (modelKey === "B") return coverageRound11(features);
  return reverseRound12(features);
}

function emptyModelState(model) {
  return {
    ...model,
    today: { candidates: 0, entries: 0, exits: 0, wins: 0, netPct: 0, lastDecision: "等待观察窗口", activeTrade: null },
    total: { candidateDays: 0, candidates: 0, resolvedTrades: 0, wins: 0, winRate: null, netPct: 0, stressNetPct: 0 },
    rejectionReasons: {},
  };
}

export function createShadowState(now = new Date().toISOString()) {
  return {
    schemaVersion: 2,
    experimentId: "zijin-round10-vs-round11-forward-shadow",
    stock: { code: "601899", name: "紫金矿业" },
    registeredAt: now,
    updatedAt: now,
    status: "waiting",
    affectsV4: false,
    sendsAlerts: false,
    usesFutureMinutes: false,
    fillPolicy: "minute-t-close decision; minute-t+1 price shadow fill",
    costPolicy: { baseRoundTripPct: COST_PCT, stressRoundTripPct: STRESS_COST_PCT },
    targetPolicy: { minimumNetPct: MIN_NET_TARGET_PCT, maximumNetPct: MAX_NET_TARGET_PCT, maximumHoldMinutes: MAX_HOLD_MINUTES },
    marketDate: null,
    lastProcessedMinute: null,
    source: { provider: null, sourceTimestamp: null, fetchedAt: null, error: null },
    models: Object.fromEntries(Object.entries(SHADOW_MODELS).map(([key, model]) => [key, emptyModelState(model)])),
    integrity: { eventCount: 0, lastHash: "GENESIS" },
  };
}

export function upgradeShadowState(value, now = new Date().toISOString()) {
  if (!value || typeof value !== "object") return createShadowState(now);
  const upgraded = { ...value, schemaVersion: 2, updatedAt: value.updatedAt || now };
  upgraded.models = { ...(value.models || {}) };
  for (const [key, config] of Object.entries(SHADOW_MODELS)) {
    if (!upgraded.models[key]) upgraded.models[key] = emptyModelState(config);
    else upgraded.models[key] = { ...upgraded.models[key], ...config };
  }
  upgraded.integrity ||= { eventCount: 0, lastHash: "GENESIS" };
  return upgraded;
}

function resetForDate(state, marketDate) {
  if (state.marketDate === marketDate) return state;
  state.marketDate = marketDate;
  state.lastProcessedMinute = null;
  for (const model of Object.values(state.models)) {
    model.today = { candidates: 0, entries: 0, exits: 0, wins: 0, netPct: 0, lastDecision: "等待观察窗口", activeTrade: null };
  }
  return state;
}

function incrementReason(model, reason) {
  model.rejectionReasons[reason] = (model.rejectionReasons[reason] || 0) + 1;
}

function closeTrade(model, point, reason) {
  const trade = model.today.activeTrade;
  const grossPct = trade.side === "short"
    ? -percentChange(point.price, trade.entryPrice)
    : percentChange(point.price, trade.entryPrice);
  const netPct = grossPct - COST_PCT;
  const stressNetPct = grossPct - STRESS_COST_PCT;
  const win = netPct > 0;
  const result = {
    event: "exit",
    model: trade.model,
    side: trade.side,
    time: point.time,
    price: round(point.price),
    reason,
    entryTime: trade.entryTime,
    entryPrice: trade.entryPrice,
    holdMinutes: minuteNumber(point.time) - minuteNumber(trade.entryTime),
    grossPct: round(grossPct),
    netPct: round(netPct),
    stressNetPct: round(stressNetPct),
    win,
  };
  model.today.activeTrade = null;
  model.today.exits += 1;
  model.today.wins += win ? 1 : 0;
  model.today.netPct = round(model.today.netPct + netPct);
  model.total.resolvedTrades += 1;
  model.total.wins += win ? 1 : 0;
  model.total.winRate = round(model.total.wins / model.total.resolvedTrades);
  model.total.netPct = round(model.total.netPct + netPct);
  model.total.stressNetPct = round(model.total.stressNetPct + stressNetPct);
  model.today.lastDecision = `${point.time} 影子平仓：${reason}`;
  return result;
}

export function processVisibleMinute(state, context) {
  const { marketDate, minutes, index, previousClose, peers = [] } = context;
  resetForDate(state, marketDate);
  const point = minutes[index];
  const features = computeVisibleFeatures({ minutes, index, previousClose, peers });
  if (!point || !features || state.lastProcessedMinute === point.time) return [];
  const events = [];

  for (const [modelKey, config] of Object.entries(SHADOW_MODELS)) {
    const model = state.models[modelKey];
    const trade = model.today.activeTrade;
    if (trade?.pendingEntry) {
      trade.pendingEntry = false;
      trade.entryTime = point.time;
      trade.entryPrice = round(point.price);
      trade.peakPrice = round(point.price);
      trade.troughPrice = round(point.price);
      trade.model = modelKey;
      trade.side = config.side;
      model.today.entries += 1;
      model.today.lastDecision = `${point.time} 下一分钟影子${config.side === "short" ? "先卖" : "买入"}`;
      events.push({ event: "entry", model: modelKey, side: config.side, time: point.time, price: trade.entryPrice, candidateTime: trade.candidateTime, features: trade.features });
      continue;
    }
    if (trade?.entryPrice) {
      trade.peakPrice = Math.max(trade.peakPrice, point.price);
      trade.troughPrice = Math.min(trade.troughPrice, point.price);
      const shortSide = trade.side === "short";
      const netPct = (shortSide ? -percentChange(point.price, trade.entryPrice) : percentChange(point.price, trade.entryPrice)) - COST_PCT;
      const bestNetPct = (shortSide ? -percentChange(trade.troughPrice, trade.entryPrice) : percentChange(trade.peakPrice, trade.entryPrice)) - COST_PCT;
      const givebackPct = shortSide ? percentChange(point.price, trade.troughPrice) : percentChange(trade.peakPrice, point.price);
      const held = minuteNumber(point.time) - minuteNumber(trade.entryTime);
      let exitReason = null;
      if (netPct >= MAX_NET_TARGET_PCT) exitReason = "达到1.00%最大净止盈";
      else if (bestNetPct >= MIN_NET_TARGET_PCT && givebackPct >= TRAILING_GIVEBACK_PCT) exitReason = "达到0.64%后回撤0.15%";
      else if (netPct <= STOP_NET_PCT) exitReason = "净亏损达到-0.45%";
      else if (held >= MAX_HOLD_MINUTES) exitReason = "持有达到60分钟";
      else if (point.time >= "1450") exitReason = "14:50影子恢复底仓";
      if (exitReason) events.push(closeTrade(model, point, exitReason));
      continue;
    }

    if (!inSession(point.time, config)) continue;
    if (model.today.candidates >= config.maxSignalsPerDay) continue;
    const decision = evaluateShadowCandidate(modelKey, features);
    if (decision.passed) {
      model.today.candidates += 1;
      model.total.candidates += 1;
      if (model.today.candidates === 1) model.total.candidateDays += 1;
      model.today.activeTrade = { pendingEntry: true, candidateTime: point.time, features };
      model.today.lastDecision = `${point.time} 候选成立，等待下一分钟影子成交`;
      events.push({ event: "candidate", model: modelKey, time: point.time, price: point.price, features, votes: decision.votes });
    } else {
      for (const reason of decision.failures) incrementReason(model, reason);
      model.today.lastDecision = `${point.time} 未通过：${decision.failures[0]}`;
    }
  }

  state.lastProcessedMinute = point.time;
  state.updatedAt = new Date().toISOString();
  state.status = point.time < "0933" ? "waiting" : point.time < "1500" ? "observing" : "closed";
  return events;
}

export function appendIntegrity(event, previousHash = "GENESIS") {
  const record = { ...event, previousHash };
  const hash = createHash("sha256").update(JSON.stringify(record)).digest("hex");
  return { ...record, hash };
}

export const SHADOW_CONSTANTS = Object.freeze({
  COST_PCT,
  STRESS_COST_PCT,
  MIN_NET_TARGET_PCT,
  MAX_NET_TARGET_PCT,
  MAX_HOLD_MINUTES,
});
