#!/usr/bin/env node
/** Search causal retrace-and-turn entries for Zijin candidate signals. */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const [sessionsPath, featuresPath] = process.argv.slice(2);
if (!sessionsPath || !featuresPath) {
  throw new Error("usage: node search-zijin-confirmed-entry.mjs SESSIONS.jsonl FEATURES.jsonl");
}

async function readJsonLines(path, predicate = () => true) {
  const rows = [];
  const reader = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (predicate(row)) rows.push(row);
  }
  return rows;
}

const sessions = await readJsonLines(
  sessionsPath,
  (row) => Number(String(row.date).slice(0, 4)) <= 2025,
);
const featureRows = await readJsonLines(featuresPath);
const candidatesByDate = new Map();
for (const row of featureRows) {
  const date = String(row.date);
  if (!candidatesByDate.has(date)) candidatesByDate.set(date, []);
  candidatesByDate.get(date).push(row);
}
for (const rows of candidatesByDate.values()) {
  rows.sort((left, right) => String(left.time).localeCompare(String(right.time)) || Number(right.score) - Number(left.score));
}

function marketMinute(time) {
  const text = String(time ?? "").padStart(4, "0");
  const hours = Number(text.slice(0, 2));
  const minutes = Number(text.slice(2, 4));
  if (hours < 12) return (hours - 9) * 60 + minutes - 30;
  return 120 + (hours - 13) * 60 + minutes;
}

function commission(turnover) {
  return Math.max(5, turnover * 0.00025);
}

function execute(side, quote, quantity) {
  const price = side === "buy" ? quote * 1.0002 : quote * 0.9998;
  const turnover = price * quantity;
  return {
    price,
    turnover,
    fees: commission(turnover) + (side === "sell" ? turnover * 0.0005 : 0),
  };
}

function isPositiveT(direction) {
  return String(direction) === "正T";
}

function directionMove(direction, current, entry) {
  return isPositiveT(direction)
    ? (current - entry) / entry * 100
    : (entry - current) / entry * 100;
}

function findConfirmedEntry(points, signalIndex, direction, config) {
  const signalPrice = Number(points[signalIndex]?.price);
  if (!Number.isFinite(signalPrice)) return null;
  const signalMinute = marketMinute(points[signalIndex].time);
  let armed = false;
  for (let index = signalIndex + 1; index < points.length; index += 1) {
    const point = points[index];
    const currentMinute = marketMinute(point.time);
    if (currentMinute - signalMinute > config.waitMinutes || String(point.time) >= "1448") break;
    const price = Number(point.price);
    const previous = Number(points[index - 1]?.price);
    if (!Number.isFinite(price) || !Number.isFinite(previous)) continue;
    const favorable = isPositiveT(direction)
      ? price <= signalPrice * (1 - config.retracePct / 100)
      : price >= signalPrice * (1 + config.retracePct / 100);
    if (favorable) armed = true;
    const confirmed = isPositiveT(direction)
      ? price >= previous * (1 + config.confirmPct / 100)
      : price <= previous * (1 - config.confirmPct / 100);
    if (armed && confirmed) {
      const entryIndex = index + 1;
      if (entryIndex < points.length && String(points[entryIndex].time) < "1450") return entryIndex;
      return null;
    }
  }
  return null;
}

function closeTrade(points, entryIndex, direction, quantity, config) {
  const entrySide = isPositiveT(direction) ? "buy" : "sell";
  const exitSide = isPositiveT(direction) ? "sell" : "buy";
  const entryQuote = Number(points[entryIndex].price);
  const entry = execute(entrySide, entryQuote, quantity);
  const entryMinute = marketMinute(points[entryIndex].time);
  let exitIndex = entryIndex;
  let reason = "expiry";
  for (let index = entryIndex + 1; index < points.length; index += 1) {
    const point = points[index];
    if (!Number.isFinite(Number(point.price))) continue;
    const hold = marketMinute(point.time) - entryMinute;
    const move = directionMove(direction, Number(point.price), entryQuote);
    exitIndex = index;
    if (move <= -config.stopPct) {
      reason = "stop";
      break;
    }
    if (move >= config.targetPct) {
      reason = "target";
      break;
    }
    if (hold >= config.holdMinutes || String(point.time) >= "1450") {
      reason = String(point.time) >= "1450" ? "force-close" : "expiry";
      break;
    }
  }
  const exit = execute(exitSide, Number(points[exitIndex].price), quantity);
  const gross = isPositiveT(direction)
    ? exit.turnover - entry.turnover
    : entry.turnover - exit.turnover;
  const net = gross - entry.fees - exit.fees;
  return { entryIndex, exitIndex, net, reason };
}

const entryConfigs = [];
for (const minScore of [3, 4, 5]) {
  for (const retracePct of [0, 0.05, 0.10, 0.15, 0.20]) {
    for (const confirmPct of [0.02, 0.05, 0.08]) {
      for (const waitMinutes of [3, 5, 8]) {
        entryConfigs.push({ minScore, retracePct, confirmPct, waitMinutes });
      }
    }
  }
}
const exitConfigs = [
  { stopPct: 0.40, targetPct: 0.40, holdMinutes: 30 },
  { stopPct: 0.40, targetPct: 0.60, holdMinutes: 30 },
  { stopPct: 0.60, targetPct: 0.40, holdMinutes: 30 },
  { stopPct: 0.60, targetPct: 0.60, holdMinutes: 30 },
  { stopPct: 0.80, targetPct: 0.40, holdMinutes: 60 },
  { stopPct: 0.80, targetPct: 0.60, holdMinutes: 60 },
];

function empty() {
  return { days: 0, cycles: 0, wins: 0, net: 0, stops: 0 };
}

function finish(bucket) {
  return {
    ...bucket,
    cyclesPer100Days: Number((bucket.cycles / Math.max(1, bucket.days) * 100).toFixed(2)),
    winRate: Number((bucket.wins / Math.max(1, bucket.cycles) * 100).toFixed(2)),
    net: Number(bucket.net.toFixed(2)),
    averageNet: Number((bucket.net / Math.max(1, bucket.cycles)).toFixed(2)),
  };
}

function evaluate(config) {
  const parts = { research2022To2023: empty(), calibration2024: empty(), validation2025: empty() };
  for (const session of sessions) {
    const year = Number(String(session.date).slice(0, 4));
    const bucket = year <= 2023 ? parts.research2022To2023 : year === 2024 ? parts.calibration2024 : parts.validation2025;
    bucket.days += 1;
    const points = (session.minutes ?? []).filter((point) => Number.isFinite(Number(point.price)));
    if (!points.length) continue;
    const indexByTime = new Map(points.map((point, index) => [String(point.time), index]));
    const referencePrice = Number(session.previousClose) || Number(points[0].price) || 10;
    const quantity = Math.max(300, Math.floor((90_000 / referencePrice) / 100) * 100);
    let lastExitIndex = -1;
    let dayCycles = 0;
    for (const candidate of candidatesByDate.get(String(session.date)) ?? []) {
      if (Number(candidate.score) < config.minScore) continue;
      const signalIndex = indexByTime.get(String(candidate.time));
      if (!Number.isInteger(signalIndex) || signalIndex <= lastExitIndex) continue;
      const entryIndex = findConfirmedEntry(points, signalIndex, candidate.direction, config);
      if (!Number.isInteger(entryIndex) || entryIndex <= lastExitIndex) continue;
      const trade = closeTrade(points, entryIndex, candidate.direction, quantity, config);
      bucket.cycles += 1;
      bucket.wins += trade.net > 0 ? 1 : 0;
      bucket.net += trade.net;
      bucket.stops += trade.reason === "stop" ? 1 : 0;
      lastExitIndex = trade.exitIndex;
      dayCycles += 1;
      if (dayCycles >= 2) break;
    }
  }
  return Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, finish(value)]));
}

const rows = [];
for (const entryConfig of entryConfigs) {
  for (const exitConfig of exitConfigs) {
    const config = { ...entryConfig, ...exitConfig };
    const partitions = evaluate(config);
    const research = partitions.research2022To2023;
    const calibration = partitions.calibration2024;
    const validation = partitions.validation2025;
    const coveragePass = [research, calibration].every(
      (part) => part.cyclesPer100Days >= 32 && part.cyclesPer100Days <= 50,
    );
    const selectedWithout2025 = coveragePass
      && research.winRate >= 50 && calibration.winRate >= 50
      && research.net > 0 && calibration.net > 0;
    const forwardPass = selectedWithout2025
      && validation.cyclesPer100Days >= 32 && validation.cyclesPer100Days <= 50
      && validation.winRate >= 50 && validation.net > 0;
    rows.push({ config, selectedWithout2025, forwardPass, partitions });
  }
}

rows.sort((left, right) => {
  if (left.selectedWithout2025 !== right.selectedWithout2025) return left.selectedWithout2025 ? -1 : 1;
  const leftCoverage = [left.partitions.research2022To2023, left.partitions.calibration2024]
    .reduce((sum, part) => sum + Math.abs(part.cyclesPer100Days - 40), 0);
  const rightCoverage = [right.partitions.research2022To2023, right.partitions.calibration2024]
    .reduce((sum, part) => sum + Math.abs(part.cyclesPer100Days - 40), 0);
  if (leftCoverage !== rightCoverage) return leftCoverage - rightCoverage;
  return (right.partitions.research2022To2023.net + right.partitions.calibration2024.net)
    - (left.partitions.research2022To2023.net + left.partitions.calibration2024.net);
});

console.log(JSON.stringify({
  protocol: {
    causal: true,
    candidateTimeUsesKnownDataOnly: true,
    retraceAndTurnObservedBeforeEntry: true,
    entryExecutesNextMinuteWithAdverseSlippage: true,
    costsIncluded: true,
    selectionUses2025: false,
    holdout2026Opened: false,
    maximumCyclesPerDay: 2,
    configurations: rows.length,
  },
  selectedCount: rows.filter((row) => row.selectedWithout2025).length,
  selectedForwardPassCount: rows.filter((row) => row.forwardPass).length,
  top: rows.slice(0, 24),
}, null, 2));
