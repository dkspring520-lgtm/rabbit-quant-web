#!/usr/bin/env node
/** Diagnose causal Zijin V4 trades without changing production thresholds. */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { runSmartTReplay } from "../lib/smart-t-engine.mjs";

const [inputPath] = process.argv.slice(2);
if (!inputPath) throw new Error("usage: node diagnose-zijin-v4-history.mjs SESSIONS.jsonl");

const rows = [];
const observationRows = [];
const reader = createInterface({ input: createReadStream(inputPath, "utf8"), crlfDelay: Infinity });

function timeBucket(time) {
  const normalized = String(time ?? "").replace(":", "").padStart(4, "0");
  const windows = [
    ["0930", "0949", "09:30-09:49"],
    ["0950", "1009", "09:50-10:09"],
    ["1010", "1029", "10:10-10:29"],
    ["1030", "1049", "10:30-10:49"],
    ["1050", "1109", "10:50-11:09"],
    ["1110", "1129", "11:10-11:29"],
    ["1130", "1130", "11:30收盘点"],
    ["1300", "1319", "13:00-13:19"],
    ["1320", "1339", "13:20-13:39"],
    ["1340", "1359", "13:40-13:59"],
    ["1400", "1419", "14:00-14:19"],
    ["1420", "1439", "14:20-14:39"],
    ["1440", "1500", "14:40-15:00"],
  ];
  return windows.find(([start, end]) => normalized >= start && normalized <= end)?.[2] ?? "其他";
}

function partitionForDate(date) {
  const year = Number(String(date).slice(0, 4));
  return year <= 2024 ? "research2022To2024" : year === 2025 ? "validation2025" : "frozen2026";
}

function percent(from, to) {
  return from > 0 ? (to - from) / from * 100 : 0;
}

function volumeRatioAt(points, index, lookback = 20) {
  const history = points
    .slice(Math.max(0, index - lookback), index)
    .map((point) => Number(point.volume) || 0)
    .filter((value) => value > 0);
  const average = history.length ? history.reduce((sum, value) => sum + value, 0) / history.length : 0;
  return average > 0 ? (Number(points[index]?.volume) || 0) / average : 1;
}

function recentVolumeContext(points, index) {
  const ratios = [];
  for (let cursor = Math.max(0, index - 5); cursor <= index; cursor += 1) ratios.push(volumeRatioAt(points, cursor));
  const peakRatio = Math.max(...ratios);
  return {
    peakRatio,
    label: peakRatio >= 3 ? "近5分钟≥3倍巨量" : peakRatio >= 1.8 ? "近5分钟1.8-3倍量" : "近5分钟无倍量",
  };
}

function ratioBucket(value) {
  if (value < 0.8) return "<0.8";
  if (value < 1.2) return "0.8-1.2";
  if (value < 1.8) return "1.2-1.8";
  return ">=1.8";
}

function exitKind(meta = {}) {
  if (meta.takeProfit) return "1%上限止盈";
  if (meta.trailingProfit) return "0.64%-1%回撤保护";
  if (meta.stop) return "止损";
  if (meta.timeExit) return "时间退出";
  if (meta.forceExit) return "尾盘强制";
  return "其他";
}

for await (const line of reader) {
  if (!line.trim()) continue;
  const session = JSON.parse(line);
  const referencePrice = Number(session.previousClose) || Number(session.minutes?.[0]?.price) || 10;
  const shares = Math.max(300, Math.floor((90_000 / referencePrice) / 100) * 100);
  const replay = runSmartTReplay(session.minutes, {
    capital: 200_000,
    baseShares: shares,
    sellable: shares,
    feeRate: 0.025,
    slippage: 0.02,
    minCommission: true,
    slippageMode: "percent",
    forceCloseTime: "1450",
    profile: "灵敏档",
    previousClose: session.previousClose,
    randomValue: 0.5,
  });
  const partition = partitionForDate(session.date);
  for (const observation of replay.observations ?? []) {
    const observationTime = String(observation.time ?? "").replace(":", "").padStart(4, "0");
    const observationIndex = session.minutes.findIndex((point) => String(point.time ?? "").replace(":", "").padStart(4, "0") === observationTime);
    if (observationIndex < 0 || observationIndex >= session.minutes.length - 1) continue;
    const future = session.minutes.slice(observationIndex + 1, observationIndex + 21);
    if (!future.length) continue;
    const entryPrice = Number(future[0].price) || Number(observation.price);
    const futureHigh = Math.max(...future.map((point) => Number(point.price)));
    const futureLow = Math.min(...future.map((point) => Number(point.price)));
    const volumeContext = recentVolumeContext(session.minutes, observationIndex);
    const tradingSession = observationTime < "1200" ? "上午" : "下午";
    const favorable = observation.direction === "正T"
      ? percent(entryPrice, futureHigh)
      : percent(futureLow, entryPrice);
    const adverse = observation.direction === "正T"
      ? Math.max(0, percent(futureLow, entryPrice))
      : Math.max(0, percent(entryPrice, futureHigh));
    observationRows.push({
      date: session.date,
      partition,
      timeBucket: timeBucket(observation.time),
      direction: observation.direction,
      timeDirection: `${timeBucket(observation.time)} · ${observation.direction}`,
      tradingSession,
      volumeContext: volumeContext.label,
      sessionVolumeDirection: `${tradingSession} · ${volumeContext.label} · ${observation.direction}`,
      stage: observation.stage ?? "watch",
      executable: Boolean(observation.executable),
      favorable,
      adverse,
      target075Hit: favorable >= 0.75,
    });
  }
  if (!replay.trades) continue;
  const entry = replay.actions.find((action) => action.meta?.phase === "entry");
  const exit = replay.actions.find((action) => action.meta?.phase === "exit");
  if (!entry || !exit) continue;
  const entryTime = String(entry.time ?? "").replace(":", "").padStart(4, "0");
  const entryIndex = session.minutes.findIndex((point) => String(point.time ?? "").replace(":", "").padStart(4, "0") === entryTime);
  const volumeContext = recentVolumeContext(session.minutes, Math.max(0, entryIndex));
  const tradingSession = entryTime < "1200" ? "上午" : "下午";
  rows.push({
    date: session.date,
    partition,
    net: replay.net,
    direction: entry.direction,
    entryTime: entry.time,
    timeBucket: timeBucket(entry.time),
    timeDirection: `${timeBucket(entry.time)} · ${entry.direction}`,
    tradingSession,
    volumeContext: volumeContext.label,
    sessionVolumeDirection: `${tradingSession} · ${volumeContext.label} · ${entry.direction}`,
    regime: entry.meta?.regime ?? "unknown",
    cyclePreference: entry.meta?.cyclePreference ?? "range",
    cycleAlignment: entry.meta?.cyclePreference === "range"
      ? "range"
      : (entry.direction === "正T" && entry.meta?.cyclePreference === "uptrend")
        || (entry.direction === "反T" && entry.meta?.cyclePreference === "downtrend")
        ? "aligned"
        : "counter",
    ratioBucket: ratioBucket(Number(entry.meta?.ratio) || 0),
    opening: entry.meta?.opening ? "opening" : "ordinary",
    exitKind: exitKind(exit.meta),
    hold: Number(exit.meta?.hold) || 0,
  });
}

function observationStats(source) {
  const round = (value) => Number(value.toFixed(2));
  const candidates = source.filter((row) => row.stage === "candidate");
  const targetHits = source.filter((row) => row.target075Hit);
  return {
    displayedObservations: source.length,
    qualifiedCandidates: candidates.length,
    executableAtSignal: source.filter((row) => row.executable).length,
    target075Hits: targetHits.length,
    target075HitRate: source.length ? round(targetHits.length / source.length * 100) : 0,
    averageMfe20: source.length ? round(source.reduce((sum, row) => sum + row.favorable, 0) / source.length) : 0,
    averageMae20: source.length ? round(source.reduce((sum, row) => sum + row.adverse, 0) / source.length) : 0,
  };
}

function groupedObservations(source, field) {
  const values = [...new Set(source.map((row) => row[field]))];
  return Object.fromEntries(values.map((value) => [value, observationStats(source.filter((row) => row[field] === value))]));
}

function stats(source) {
  const wins = source.filter((row) => row.net > 0);
  const losses = source.filter((row) => row.net <= 0);
  const positive = wins.reduce((sum, row) => sum + row.net, 0);
  const negative = losses.reduce((sum, row) => sum + Math.abs(row.net), 0);
  const round = (value) => Number(value.toFixed(2));
  return {
    trades: source.length,
    wins: wins.length,
    winRate: source.length ? round(wins.length / source.length * 100) : 0,
    net: round(source.reduce((sum, row) => sum + row.net, 0)),
    averageNet: source.length ? round(source.reduce((sum, row) => sum + row.net, 0) / source.length) : 0,
    profitFactor: negative ? round(positive / negative) : null,
    averageHold: source.length ? round(source.reduce((sum, row) => sum + row.hold, 0) / source.length) : 0,
  };
}

function grouped(source, field) {
  const values = [...new Set(source.map((row) => row[field]))];
  return Object.fromEntries(values.map((value) => [value, stats(source.filter((row) => row[field] === value))]));
}

function partitionReport(partition) {
  const source = rows.filter((row) => row.partition === partition);
  const observations = observationRows.filter((row) => row.partition === partition);
  return {
    overall: stats(source),
    observationOverall: observationStats(observations),
    byObservationTime: groupedObservations(observations, "timeBucket"),
    byObservationTimeDirection: groupedObservations(observations, "timeDirection"),
    byObservationVolumeContext: groupedObservations(observations, "volumeContext"),
    byObservationSessionVolumeDirection: groupedObservations(observations, "sessionVolumeDirection"),
    byDirection: grouped(source, "direction"),
    byEntryTime: grouped(source, "timeBucket"),
    byEntryTimeDirection: grouped(source, "timeDirection"),
    byVolumeContext: grouped(source, "volumeContext"),
    bySessionVolumeDirection: grouped(source, "sessionVolumeDirection"),
    byCycleAlignment: grouped(source, "cycleAlignment"),
    byVolumeRatio: grouped(source, "ratioBucket"),
    byOpening: grouped(source, "opening"),
    byExit: grouped(source, "exitKind"),
  };
}

console.log(JSON.stringify({
  protocol: {
    causalDecision: true,
    futureMinutesReadByDecision: false,
    postSignalEvaluationHorizon: "next 20 trading minutes",
    observationTargetGrossPct: 0.75,
    thresholdsChanged: false,
    frozen2026UsedForSelection: false,
  },
  research2022To2024: partitionReport("research2022To2024"),
  validation2025: partitionReport("validation2025"),
  frozen2026AuditOnly: partitionReport("frozen2026"),
}, null, 2));
