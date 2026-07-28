#!/usr/bin/env node
/**
 * Zijin Mining causal experiment: morning 2.5x-3.0x volume event followed by
 * a real-time stop-falling / rebound confirmation.
 *
 * Selection is limited to 2022-2024. 2025 is validation-only and 2026 stays
 * sealed. A signal may only read the current and earlier minutes; execution
 * always happens at the next available minute.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const [inputPath] = process.argv.slice(2);
if (!inputPath) {
  throw new Error("usage: node experiment-zijin-morning-volume-rebound.mjs SESSIONS.jsonl");
}

const CONFIGS = [
  {
    id: "unconfirmed-baseline",
    label: "仅低位偏离+2.5至3倍量",
    minimumDeviation: 0.35,
    minimumRebound: 0,
    minimumReboundTicks: 0,
    minimumLowAge: 0,
    lowLookback: 10,
    risingBars: 0,
    breakLookback: 0,
    minimumVwapSlope5: Number.NEGATIVE_INFINITY,
  },
  {
    id: "one-tick-rebound",
    label: "回升一跳且不再创新低",
    minimumDeviation: 0.35,
    minimumRebound: 0,
    minimumReboundTicks: 1,
    minimumLowAge: 1,
    lowLookback: 10,
    risingBars: 1,
    breakLookback: 0,
    minimumVwapSlope5: Number.NEGATIVE_INFINITY,
  },
  {
    id: "two-tick-rebound",
    label: "回升两跳且不再创新低",
    minimumDeviation: 0.35,
    minimumRebound: 0,
    minimumReboundTicks: 2,
    minimumLowAge: 1,
    lowLookback: 10,
    risingBars: 1,
    breakLookback: 0,
    minimumVwapSlope5: -0.15,
  },
  {
    id: "two-minute-repair",
    label: "连续两分钟修复",
    minimumDeviation: 0.35,
    minimumRebound: 0,
    minimumReboundTicks: 2,
    minimumLowAge: 2,
    lowLookback: 10,
    risingBars: 2,
    breakLookback: 0,
    minimumVwapSlope5: -0.12,
  },
  {
    id: "micro-structure-break",
    label: "突破三分钟微型结构",
    minimumDeviation: 0.35,
    minimumRebound: 0,
    minimumReboundTicks: 2,
    minimumLowAge: 2,
    lowLookback: 10,
    risingBars: 1,
    breakLookback: 3,
    minimumVwapSlope5: -0.12,
  },
];

const sessions = [];
const reader = createInterface({
  input: createReadStream(inputPath, "utf8"),
  crlfDelay: Infinity,
});
for await (const line of reader) {
  if (line.trim()) sessions.push(JSON.parse(line));
}

function pct(from, to) {
  return from > 0 ? (to - from) / from * 100 : 0;
}

function round(value) {
  return Number(value.toFixed(2));
}

function fiveMinuteWindow(time) {
  const value = Number(String(time).replace(":", ""));
  if (value <= 934) return "09:30-09:34";
  if (value <= 939) return "09:35-09:39";
  if (value <= 944) return "09:40-09:44";
  return "09:45-09:49";
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function cumulativeVwaps(points) {
  let amount = 0;
  let shares = 0;
  return points.map((point) => {
    const volume = Math.max(0, Number(point.volume) || 0);
    amount += Number(point.price) * volume;
    shares += volume;
    return shares > 0 ? amount / shares : Number(point.price);
  });
}

function volumeRatioAt(points, index, lookback = 20) {
  const history = points
    .slice(Math.max(0, index - lookback), index)
    .map((point) => Number(point.volume) || 0)
    .filter((volume) => volume > 0);
  const average = mean(history);
  return average > 0 ? (Number(points[index]?.volume) || 0) / average : 1;
}

function recentPeakVolumeRatio(points, index, armedMinutes = 10) {
  const ratios = [];
  for (let cursor = Math.max(1, index - armedMinutes); cursor <= index; cursor += 1) {
    ratios.push(volumeRatioAt(points, cursor));
  }
  return Math.max(...ratios, 1);
}

function orderCost(side, price, quantity) {
  const turnover = price * quantity;
  const commission = Math.max(5, turnover * 0.00025);
  const stampDuty = side === "SELL" ? turnover * 0.0005 : 0;
  return commission + stampDuty;
}

function positiveTCycle(entryRaw, exitRaw, quantity) {
  const entry = entryRaw * 1.0002;
  const exit = exitRaw * 0.9998;
  const gross = (exit - entry) * quantity;
  const fees = orderCost("BUY", entry, quantity) + orderCost("SELL", exit, quantity);
  return { entry, exit, gross, fees, net: gross - fees };
}

function isRising(points, index, bars) {
  if (bars === 0) return true;
  if (bars === 1) return Number(points[index].price) > Number(points[index - 1].price);
  return Number(points[index].price) > Number(points[index - 1].price)
    && Number(points[index - 1].price) >= Number(points[index - 2].price)
    && Number(points[index].price) > Number(points[index - 2].price);
}

function detect(points, vwaps, index, config) {
  if (index < 6 || index >= points.length - 1) return null;
  const time = String(points[index].time ?? "").replace(":", "").padStart(4, "0");
  if (time < "0930" || time > "0949") return null;

  const current = Number(points[index].price);
  const downwardDeviation = pct(current, vwaps[index]);
  const peakVolumeRatio = recentPeakVolumeRatio(points, index, 10);
  const localStart = Math.max(0, index - config.lowLookback);
  const localPrices = points.slice(localStart, index + 1).map((point) => Number(point.price));
  const localLow = Math.min(...localPrices);
  const localLowOffset = localPrices.lastIndexOf(localLow);
  const localLowIndex = localStart + localLowOffset;
  const lowAge = index - localLowIndex;
  const rebound = pct(localLow, current);
  const reboundTicks = (current - localLow) / 0.01;
  const vwapSlope5 = pct(vwaps[Math.max(0, index - 5)], vwaps[index]);
  const priorHigh = config.breakLookback > 0
    ? Math.max(...points.slice(index - config.breakLookback, index).map((point) => Number(point.price)))
    : Number.NEGATIVE_INFINITY;

  if (peakVolumeRatio < 2.5 || peakVolumeRatio >= 3.0) return null;
  if (downwardDeviation < config.minimumDeviation) return null;
  if (rebound < config.minimumRebound
    || reboundTicks + 0.001 < config.minimumReboundTicks
    || lowAge < config.minimumLowAge) return null;
  if (!isRising(points, index, config.risingBars)) return null;
  if (config.breakLookback > 0 && current <= priorHigh) return null;
  if (vwapSlope5 < config.minimumVwapSlope5) return null;

  return {
    signalIndex: index,
    signalTime: time,
    downwardDeviation,
    peakVolumeRatio,
    rebound,
    reboundTicks,
    lowAge,
    vwapSlope5,
  };
}

function replaySession(session, config) {
  const points = session.minutes ?? [];
  if (points.length < 9) return null;
  const vwaps = cumulativeVwaps(points);
  let signal = null;
  for (let index = 6; index < points.length - 1; index += 1) {
    signal = detect(points, vwaps, index, config);
    if (signal) break;
  }
  if (!signal) return null;

  const reference = Number(session.previousClose) || Number(points[0]?.price) || 10;
  const quantity = Math.max(300, Math.floor((90_000 / reference) / 100) * 100);
  const entryIndex = signal.signalIndex + 1;
  const maximumExitIndex = Math.min(points.length - 1, entryIndex + 20);
  let exitIndex = maximumExitIndex;
  let result = positiveTCycle(Number(points[entryIndex].price), Number(points[exitIndex].price), quantity);
  for (let cursor = entryIndex + 1; cursor <= maximumExitIndex; cursor += 1) {
    const projected = positiveTCycle(Number(points[entryIndex].price), Number(points[cursor].price), quantity);
    const netPct = projected.net / Math.max(1, projected.entry * quantity) * 100;
    if (netPct >= 0.64) {
      exitIndex = cursor;
      result = projected;
      break;
    }
  }

  const path = points.slice(entryIndex, exitIndex + 1).map((point) => Number(point.price));
  const entryRaw = Number(points[entryIndex].price);
  return {
    date: String(session.date),
    year: Number(String(session.date).slice(0, 4)),
    signalWindow: fiveMinuteWindow(signal.signalTime),
    entryTime: String(points[entryIndex].time),
    exitTime: String(points[exitIndex].time),
    holdMinutes: exitIndex - entryIndex,
    targetHit: exitIndex < maximumExitIndex,
    mfePct: pct(entryRaw, Math.max(...path)),
    maePct: pct(Math.min(...path), entryRaw),
    ...signal,
    ...result,
  };
}

function stats(rows) {
  const wins = rows.filter((row) => row.net > 0);
  const losses = rows.filter((row) => row.net <= 0);
  const totalGain = wins.reduce((sum, row) => sum + row.net, 0);
  const totalLoss = losses.reduce((sum, row) => sum + Math.abs(row.net), 0);
  return {
    trades: rows.length,
    wins: wins.length,
    winRate: rows.length ? round(wins.length / rows.length * 100) : 0,
    targetHits: rows.filter((row) => row.targetHit).length,
    gross: round(rows.reduce((sum, row) => sum + row.gross, 0)),
    fees: round(rows.reduce((sum, row) => sum + row.fees, 0)),
    net: round(rows.reduce((sum, row) => sum + row.net, 0)),
    averageNet: rows.length ? round(rows.reduce((sum, row) => sum + row.net, 0) / rows.length) : 0,
    profitFactor: totalLoss > 0 ? round(totalGain / totalLoss) : null,
    averageMfePct: rows.length ? round(mean(rows.map((row) => row.mfePct))) : 0,
    averageMaePct: rows.length ? round(mean(rows.map((row) => row.maePct))) : 0,
    averageHoldMinutes: rows.length ? round(mean(rows.map((row) => row.holdMinutes))) : 0,
  };
}

function byYear(rows) {
  return Object.fromEntries([2022, 2023, 2024, 2025].map((year) => [
    year,
    stats(rows.filter((row) => row.year === year)),
  ]));
}

function bySignalWindow(rows) {
  return Object.fromEntries(["09:30-09:34", "09:35-09:39", "09:40-09:44", "09:45-09:49"].map((window) => [
    window,
    stats(rows.filter((row) => row.signalWindow === window)),
  ]));
}

const results = CONFIGS.map((config) => {
  const allRows = sessions.map((session) => replaySession(session, config)).filter(Boolean);
  const research = allRows.filter((row) => row.year <= 2024);
  const validation = allRows.filter((row) => row.year === 2025);
  const frozen2026Count = allRows.filter((row) => row.year >= 2026).length;
  return {
    config,
    research2022To2024: stats(research),
    validation2025: stats(validation),
    researchBySignalWindow: bySignalWindow(research),
    validationBySignalWindow: bySignalWindow(validation),
    byYear2022To2025: byYear(allRows),
    frozen2026: {
      opened: false,
      matchingSessionCount: frozen2026Count,
      resultsWithheld: true,
    },
  };
});

console.log(JSON.stringify({
  protocol: {
    hypothesis: "09:30-09:49低于累计VWAP且出现2.5至3倍量后，实时止跌回升确认能否过滤下跌中继",
    causalSignal: true,
    signalReadsFuture: false,
    execution: "确认后的下一分钟，买卖两侧各计0.02%滑点",
    exit: "费用后0.64%止盈，否则持有20个交易分钟",
    fee: "佣金万2.5且每笔最低5元，卖出印花税万5",
    maximumTradesPerSession: 1,
    volumeEventArmedMinutes: 10,
    selectionPeriod: "2022-2024",
    validationPeriod: "2025",
    frozen2026UsedForSelection: false,
  },
  sessionCount: sessions.length,
  results,
}, null, 2));
