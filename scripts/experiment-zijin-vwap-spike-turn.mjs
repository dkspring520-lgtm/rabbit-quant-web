#!/usr/bin/env node
/**
 * Causal Zijin experiment:
 * large VWAP deviation + short straight impulse + confirmed turn.
 *
 * Signal formation reads only the current and earlier minutes. Execution is
 * placed at the next minute with slippage. A cycle takes 0.64% after-cost
 * profit when available, otherwise exits after 20 trading minutes.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const [inputPath] = process.argv.slice(2);
if (!inputPath) throw new Error("usage: node experiment-zijin-vwap-spike-turn.mjs SESSIONS.jsonl");

const configs = [
  { id: "deviation-080", deviation: 0.8, impulse: 0.45, reversal: 0.12 },
  { id: "deviation-100", deviation: 1.0, impulse: 0.55, reversal: 0.14 },
  { id: "deviation-120", deviation: 1.2, impulse: 0.65, reversal: 0.16 },
];
const sessions = [];
const reader = createInterface({ input: createReadStream(inputPath, "utf8"), crlfDelay: Infinity });
for await (const line of reader) if (line.trim()) sessions.push(JSON.parse(line));

function pct(from, to) {
  return from > 0 ? (to - from) / from * 100 : 0;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function cumulativeVwaps(points) {
  let amount = 0;
  let volume = 0;
  return points.map((point) => {
    const weight = Math.max(1, Number(point.volume) || 0);
    amount += Number(point.price) * weight;
    volume += weight;
    return amount / volume;
  });
}

function orderCost(side, price, quantity) {
  const turnover = price * quantity;
  return Math.max(5, turnover * 0.00025) + (side === "卖出" ? turnover * 0.0005 : 0);
}

function slip(price) {
  return price * 0.0002;
}

function cycleResult(direction, entryRaw, exitRaw, quantity) {
  const entry = direction === "正T" ? entryRaw + slip(entryRaw) : entryRaw - slip(entryRaw);
  const exit = direction === "正T" ? exitRaw - slip(exitRaw) : exitRaw + slip(exitRaw);
  const gross = direction === "正T" ? (exit - entry) * quantity : (entry - exit) * quantity;
  const fees = direction === "正T"
    ? orderCost("买入", entry, quantity) + orderCost("卖出", exit, quantity)
    : orderCost("卖出", entry, quantity) + orderCost("买入", exit, quantity);
  return { gross, fees, net: gross - fees, entry, exit };
}

function detect(points, vwaps, index, config) {
  if (index < 7 || index >= points.length - 1) return null;
  const current = Number(points[index].price);
  const previous = Number(points[index - 1].price);
  const window = points.slice(index - 6, index + 1).map((point) => Number(point.price));
  const high = Math.max(...window.slice(0, -1));
  const low = Math.min(...window.slice(0, -1));
  const highIndex = window.slice(0, -1).lastIndexOf(high);
  const lowIndex = window.slice(0, -1).lastIndexOf(low);
  const deviation = pct(vwaps[index], current);
  const rise = pct(window[0], high);
  const fall = pct(low, window[0]);
  const pullback = pct(current, high);
  const rebound = pct(low, current);
  const beforeHigh = window.slice(0, highIndex + 1);
  const beforeLow = window.slice(0, lowIndex + 1);
  const upSteps = beforeHigh.slice(1).filter((price, cursor) => price >= beforeHigh[cursor]).length;
  const downSteps = beforeLow.slice(1).filter((price, cursor) => price <= beforeLow[cursor]).length;
  const requiredSteps = 3;

  if (deviation >= config.deviation
    && rise >= config.impulse
    && highIndex >= 3
    && upSteps >= requiredSteps
    && pullback >= config.reversal
    && current < previous) {
    return { direction: "反T", deviation, impulse: rise, reversal: pullback };
  }
  if (deviation <= -config.deviation
    && fall >= config.impulse
    && lowIndex >= 3
    && downSteps >= requiredSteps
    && rebound >= config.reversal
    && current > previous) {
    return { direction: "正T", deviation, impulse: fall, reversal: rebound };
  }
  return null;
}

function replaySession(session, config) {
  const points = session.minutes ?? [];
  const vwaps = cumulativeVwaps(points);
  const reference = Number(session.previousClose) || Number(points[0]?.price) || 10;
  const quantity = Math.max(300, Math.floor((90_000 / reference) / 100) * 100);
  const trades = [];
  let cooldownUntil = -1;
  for (let index = 7; index < points.length - 1; index += 1) {
    if (index <= cooldownUntil) continue;
    const time = String(points[index].time ?? "").replace(":", "").padStart(4, "0");
    if (time < "0930" || time > "1439" || (time > "1130" && time < "1300")) continue;
    const signal = detect(points, vwaps, index, config);
    if (!signal) continue;
    const entryIndex = index + 1;
    const maximumExitIndex = Math.min(points.length - 1, entryIndex + 20);
    let exitIndex = maximumExitIndex;
    let result = cycleResult(signal.direction, Number(points[entryIndex].price), Number(points[exitIndex].price), quantity);
    for (let cursor = entryIndex + 1; cursor <= maximumExitIndex; cursor += 1) {
      const projected = cycleResult(signal.direction, Number(points[entryIndex].price), Number(points[cursor].price), quantity);
      const netPct = projected.net / Math.max(1, projected.entry * quantity) * 100;
      if (netPct >= 0.64) {
        exitIndex = cursor;
        result = projected;
        break;
      }
    }
    const entryTime = String(points[entryIndex].time ?? "").replace(":", "").padStart(4, "0");
    trades.push({
      date: session.date,
      direction: signal.direction,
      session: entryTime < "1200" ? "上午" : "下午",
      entryTime,
      exitTime: String(points[exitIndex].time ?? ""),
      hold: exitIndex - entryIndex,
      targetHit: exitIndex < maximumExitIndex,
      ...signal,
      ...result,
    });
    cooldownUntil = exitIndex + 19;
  }
  return trades;
}

function stats(rows) {
  const round = (value) => Number(value.toFixed(2));
  const wins = rows.filter((row) => row.net > 0);
  const losses = rows.filter((row) => row.net <= 0);
  const gains = wins.reduce((sum, row) => sum + row.net, 0);
  const loss = losses.reduce((sum, row) => sum + Math.abs(row.net), 0);
  return {
    trades: rows.length,
    wins: wins.length,
    winRate: rows.length ? round(wins.length / rows.length * 100) : 0,
    targetHits: rows.filter((row) => row.targetHit).length,
    gross: round(rows.reduce((sum, row) => sum + row.gross, 0)),
    fees: round(rows.reduce((sum, row) => sum + row.fees, 0)),
    net: round(rows.reduce((sum, row) => sum + row.net, 0)),
    averageNet: rows.length ? round(rows.reduce((sum, row) => sum + row.net, 0) / rows.length) : 0,
    profitFactor: loss ? round(gains / loss) : null,
    averageHold: rows.length ? round(mean(rows.map((row) => row.hold))) : 0,
  };
}

function grouped(rows, key) {
  return Object.fromEntries([...new Set(rows.map((row) => row[key]))].map((value) => [value, stats(rows.filter((row) => row[key] === value))]));
}

function report(rows) {
  return {
    overall: stats(rows),
    bySession: grouped(rows, "session"),
    byDirection: grouped(rows, "direction"),
    bySessionDirection: grouped(rows.map((row) => ({ ...row, sessionDirection: `${row.session} · ${row.direction}` })), "sessionDirection"),
  };
}

const results = configs.map((config) => {
  const all = sessions.flatMap((session) => replaySession(session, config));
  const research = all.filter((row) => Number(String(row.date).slice(0, 4)) <= 2024);
  const validation = all.filter((row) => String(row.date).startsWith("2025"));
  const frozen = all.filter((row) => Number(String(row.date).slice(0, 4)) >= 2026);
  return {
    config,
    research2022To2024: report(research),
    validation2025: report(validation),
    frozen2026AuditOnly: report(frozen),
  };
});

console.log(JSON.stringify({
  protocol: {
    causalSignal: true,
    signalReadsFuture: false,
    execution: "next minute with 0.02% per-side slippage",
    exit: "0.64% after-cost target or 20 trading minutes",
    fee: "0.025% commission with ¥5 minimum plus 0.05% sell stamp duty",
    frozen2026UsedForSelection: false,
  },
  results,
}, null, 2));
