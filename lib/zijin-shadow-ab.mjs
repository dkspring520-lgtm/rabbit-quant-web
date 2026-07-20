import { createHash } from "node:crypto";

export const SHADOW_MODELS = Object.freeze({
  A: Object.freeze({
    id: "round10-positive-strict",
    label: "A · 少而精",
    sourceRound: 10,
    sessionStart: "0933",
    sessionEnd: "0944",
    maxSignalsPerDay: 1,
    parameters: Object.freeze({ gapAbsPct: 0.6, repairPct: 0.16, confirmationVotesRequired: 1 }),
  }),
  B: Object.freeze({
    id: "round11-positive-coverage",
    label: "B · 覆盖优先",
    sourceRound: 11,
    sessionStart: "0933",
    sessionEnd: "1015",
    maxSignalsPerDay: 2,
    parameters: Object.freeze({ maximumVwapDistancePct: 0.3, minimumPeerBreadth: 0.5, minimumVolumeRatio: 0.7, confirmationVotesRequired: 2 }),
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
  const ma5 = average(visible.slice(-5).map((item) => item.price));
  const priorMa5 = average(visible.slice(-10, -5).map((item) => item.price));
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
    return3Pct: round(percentChange(point.price, price3)),
    ma5SlopePct: round(priorMa5 > 0 ? percentChange(ma5, priorMa5) : percentChange(point.price, ma5)),
    volumeRatio: round((Number(point.volume) || 0) / volumeBase),
    peerBreadth3: peerReturns.length ? round(peerReturns.filter((value) => value > 0).length / peerReturns.length) : 0,
    peerCoverage: round(peerReturns.length / Math.max(1, peers.length)),
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

export function evaluateShadowCandidate(modelKey, features) {
  const model = SHADOW_MODELS[modelKey];
  if (!model || !features) return { passed: false, failures: ["模型或特征无效"], votes: 0 };
  if (!inSession(features.time, model)) return { passed: false, failures: ["不在固定观察窗口"], votes: 0 };
  return modelKey === "A" ? strictRound10(features) : coverageRound11(features);
}

export function createShadowState(now = new Date().toISOString()) {
  return {
    schemaVersion: 1,
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
    models: Object.fromEntries(Object.entries(SHADOW_MODELS).map(([key, model]) => [key, {
      ...model,
      today: { candidates: 0, entries: 0, exits: 0, wins: 0, netPct: 0, lastDecision: "等待观察窗口", activeTrade: null },
      total: { candidateDays: 0, candidates: 0, resolvedTrades: 0, wins: 0, winRate: null, netPct: 0, stressNetPct: 0 },
      rejectionReasons: {},
    }])),
    integrity: { eventCount: 0, lastHash: "GENESIS" },
  };
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
  const grossPct = percentChange(point.price, trade.entryPrice);
  const netPct = grossPct - COST_PCT;
  const stressNetPct = grossPct - STRESS_COST_PCT;
  const win = netPct > 0;
  const result = {
    event: "exit",
    model: trade.model,
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
      trade.model = modelKey;
      model.today.entries += 1;
      model.today.lastDecision = `${point.time} 下一分钟影子买入`;
      events.push({ event: "entry", model: modelKey, time: point.time, price: trade.entryPrice, candidateTime: trade.candidateTime, features: trade.features });
      continue;
    }
    if (trade?.entryPrice) {
      trade.peakPrice = Math.max(trade.peakPrice, point.price);
      const netPct = percentChange(point.price, trade.entryPrice) - COST_PCT;
      const peakNetPct = percentChange(trade.peakPrice, trade.entryPrice) - COST_PCT;
      const givebackPct = percentChange(trade.peakPrice, point.price);
      const held = minuteNumber(point.time) - minuteNumber(trade.entryTime);
      let exitReason = null;
      if (netPct >= MAX_NET_TARGET_PCT) exitReason = "达到1.00%最大净止盈";
      else if (peakNetPct >= MIN_NET_TARGET_PCT && givebackPct >= TRAILING_GIVEBACK_PCT) exitReason = "达到0.64%后回撤0.15%";
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
  state.status = point.time < "0933" ? "waiting" : point.time <= "1500" ? "observing" : "closed";
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
