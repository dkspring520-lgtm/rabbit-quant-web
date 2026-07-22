#!/usr/bin/env node
/**
 * Causal Zijin experiment for symmetric VWAP reversion cycles.
 *
 * Entry: a 2.5x-3.0x volume event remains armed for ten minutes, price is at
 * least 0.35% away from cumulative VWAP, and one tick confirms a turn.
 * Execution: next minute.
 * Exit A: 0.64% after-cost target or 20 trading minutes.
 * Exit B: first confirmed VWAP recross, executed next minute, otherwise 14:50.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const [inputPath] = process.argv.slice(2);
if (!inputPath) throw new Error("usage: node experiment-zijin-volume-vwap-hold.mjs SESSIONS.jsonl");

const sessions = [];
const reader = createInterface({ input: createReadStream(inputPath, "utf8"), crlfDelay: Infinity });
for await (const line of reader) if (line.trim()) sessions.push(JSON.parse(line));

const experimentConfig = {
  deviationThresholdPct: Number(process.env.ZIJIN_DEVIATION_PCT ?? 0.35),
  minimumVolumeRatio: Number(process.env.ZIJIN_VOLUME_MIN ?? 2.5),
  maximumVolumeRatio: Number(process.env.ZIJIN_VOLUME_MAX ?? 3),
  regimeSlopeThresholdPct: Number(process.env.ZIJIN_REGIME_SLOPE_PCT ?? 0.02),
  turnTicks: Number(process.env.ZIJIN_TURN_TICKS ?? 1),
  maximumHoldMinutes: Number(process.env.ZIJIN_MAX_HOLD_MINUTES ?? 20),
  minimumProtectedNetPct: Number(process.env.ZIJIN_MIN_PROFIT_PCT ?? 0.30),
  maximumProtectedNetPct: Number(process.env.ZIJIN_MAX_PROFIT_PCT ?? 0.80),
  protectedGivebackPct: Number(process.env.ZIJIN_PROFIT_GIVEBACK_PCT ?? 0.12),
  signalStart: String(process.env.ZIJIN_SIGNAL_START ?? "0930"),
  signalEnd: String(process.env.ZIJIN_SIGNAL_END ?? "0949"),
  maximumCyclesPerDay: Number(process.env.ZIJIN_MAX_CYCLES ?? 1),
  cooldownMinutes: Number(process.env.ZIJIN_COOLDOWN_MINUTES ?? 5),
};

const pct = (from, to) => (from > 0 ? (to - from) / from * 100 : 0);
const round = (value) => Number(value.toFixed(2));
const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

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
  const history = points.slice(Math.max(0, index - lookback), index)
    .map((point) => Number(point.volume) || 0)
    .filter((value) => value > 0);
  const average = mean(history);
  return average > 0 ? (Number(points[index]?.volume) || 0) / average : 1;
}

function armedPeakVolumeRatio(points, index) {
  const ratios = [];
  for (let cursor = Math.max(1, index - 10); cursor <= index; cursor += 1) {
    ratios.push(volumeRatioAt(points, cursor));
  }
  return Math.max(...ratios, 1);
}

function orderCost(side, price, quantity) {
  const turnover = price * quantity;
  return Math.max(5, turnover * 0.00025) + (side === "SELL" ? turnover * 0.0005 : 0);
}

function cycleResult(direction, entryRaw, exitRaw, quantity) {
  const positive = direction === "POSITIVE_T";
  const entry = positive ? entryRaw * 1.0002 : entryRaw * 0.9998;
  const exit = positive ? exitRaw * 0.9998 : exitRaw * 1.0002;
  const gross = positive ? (exit - entry) * quantity : (entry - exit) * quantity;
  const fees = positive
    ? orderCost("BUY", entry, quantity) + orderCost("SELL", exit, quantity)
    : orderCost("SELL", entry, quantity) + orderCost("BUY", exit, quantity);
  return { entry, exit, gross, fees, net: gross - fees };
}

function detectEntry(points, vwaps, index, entryMode, dailyRegime) {
  if (index < 6 || index >= points.length - 1) return null;
  const time = String(points[index].time ?? "").replace(":", "").padStart(4, "0");
  if (time < experimentConfig.signalStart || time > experimentConfig.signalEnd) return null;

  const current = Number(points[index].price);
  const previous = Number(points[index - 1].price);
  const local = points.slice(Math.max(0, index - 10), index + 1).map((point) => Number(point.price));
  const low = Math.min(...local);
  const high = Math.max(...local);
  const lowAge = local.length - 1 - local.lastIndexOf(low);
  const highAge = local.length - 1 - local.lastIndexOf(high);
  const peakVolumeRatio = armedPeakVolumeRatio(points, index);
  if (peakVolumeRatio < experimentConfig.minimumVolumeRatio
    || peakVolumeRatio >= experimentConfig.maximumVolumeRatio) return null;

  const downwardDeviation = pct(current, vwaps[index]);
  const upwardDeviation = pct(vwaps[index], current);
  const reboundTicks = (current - low) / 0.01;
  const pullbackTicks = (high - current) / 0.01;
  const regimeEnd = Math.max(1, index - 3);
  const regimeStart = Math.max(0, regimeEnd - 8);
  const vwapRegimeSlope = pct(vwaps[regimeStart], vwaps[regimeEnd]);
  const sessionMove = pct(Number(points[0].price), current);
  const risingRegime = entryMode === "PRIOR_INTRADAY_REGIME"
    ? vwapRegimeSlope >= experimentConfig.regimeSlopeThresholdPct
    : entryMode === "DAILY5_REGIME"
      ? dailyRegime === "UP"
      : true;
  const fallingRegime = entryMode === "PRIOR_INTRADAY_REGIME"
    ? vwapRegimeSlope <= -experimentConfig.regimeSlopeThresholdPct
    : entryMode === "DAILY5_REGIME"
      ? dailyRegime === "DOWN"
      : true;

  if (downwardDeviation >= experimentConfig.deviationThresholdPct
    && lowAge >= 1
    && reboundTicks >= experimentConfig.turnTicks - 0.001
    && current > previous
    && risingRegime) {
    return { direction: "POSITIVE_T", signalIndex: index, signalTime: time, deviation: downwardDeviation, turnTicks: reboundTicks, peakVolumeRatio, vwapRegimeSlope, sessionMove, dailyRegime };
  }
  if (upwardDeviation >= experimentConfig.deviationThresholdPct
    && highAge >= 1
    && pullbackTicks >= experimentConfig.turnTicks - 0.001
    && current < previous
    && fallingRegime) {
    return { direction: "REVERSE_T", signalIndex: index, signalTime: time, deviation: upwardDeviation, turnTicks: pullbackTicks, peakVolumeRatio, vwapRegimeSlope, sessionMove, dailyRegime };
  }
  return null;
}

function lastIndexAtOrBefore(points, time) {
  let result = points.length - 1;
  for (let index = 0; index < points.length; index += 1) {
    const pointTime = String(points[index].time ?? "").replace(":", "").padStart(4, "0");
    if (pointTime > time) return Math.max(0, index - 1);
    result = index;
  }
  return result;
}

function target20Exit(points, entryIndex, direction, quantity) {
  const maximumExitIndex = Math.min(points.length - 1, entryIndex + experimentConfig.maximumHoldMinutes);
  let exitIndex = maximumExitIndex;
  let result = cycleResult(direction, Number(points[entryIndex].price), Number(points[exitIndex].price), quantity);
  for (let cursor = entryIndex + 1; cursor <= maximumExitIndex; cursor += 1) {
    const projected = cycleResult(direction, Number(points[entryIndex].price), Number(points[cursor].price), quantity);
    const netPct = projected.net / Math.max(1, projected.entry * quantity) * 100;
    if (netPct >= 0.64) {
      exitIndex = cursor;
      result = projected;
      return { exitIndex, exitReason: "TARGET_064", ...result };
    }
  }
  return { exitIndex, exitReason: "TIME_20", ...result };
}

function vwapRecrossExit(points, vwaps, entryIndex, direction, quantity) {
  const forcedIndex = lastIndexAtOrBefore(points, "1450");
  for (let cursor = entryIndex; cursor < forcedIndex; cursor += 1) {
    const price = Number(points[cursor].price);
    const crossed = direction === "POSITIVE_T" ? price >= vwaps[cursor] : price <= vwaps[cursor];
    if (!crossed) continue;
    const exitIndex = cursor + 1;
    return {
      exitIndex,
      exitReason: "VWAP_RECROSS",
      ...cycleResult(direction, Number(points[entryIndex].price), Number(points[exitIndex].price), quantity),
    };
  }
  return {
    exitIndex: forcedIndex,
    exitReason: "FORCED_1450",
    ...cycleResult(direction, Number(points[entryIndex].price), Number(points[forcedIndex].price), quantity),
  };
}

function vwapHybridExit(points, vwaps, entryIndex, direction, quantity) {
  const forcedIndex = Math.min(lastIndexAtOrBefore(points, "1450"), entryIndex + 45);
  const entryRaw = Number(points[entryIndex].price);
  for (let cursor = entryIndex; cursor < forcedIndex; cursor += 1) {
    const price = Number(points[cursor].price);
    const projected = cycleResult(direction, entryRaw, price, quantity);
    const netPct = projected.net / Math.max(1, projected.entry * quantity) * 100;
    const adversePct = direction === "POSITIVE_T" ? pct(price, entryRaw) : pct(entryRaw, price);
    const crossed = direction === "POSITIVE_T" ? price >= vwaps[cursor] : price <= vwaps[cursor];
    const reason = netPct >= 0.64
      ? "TARGET_064"
      : adversePct >= 0.60
        ? "STOP_060"
        : crossed
          ? "VWAP_RECROSS"
          : null;
    if (!reason) continue;
    const exitIndex = cursor + 1;
    return { exitIndex, exitReason: reason, ...cycleResult(direction, entryRaw, Number(points[exitIndex].price), quantity) };
  }
  return {
    exitIndex: forcedIndex,
    exitReason: forcedIndex >= lastIndexAtOrBefore(points, "1450") ? "FORCED_1450" : "TIME_45",
    ...cycleResult(direction, entryRaw, Number(points[forcedIndex].price), quantity),
  };
}

function trailingRangeExit(points, entryIndex, direction, quantity) {
  const maximumExitIndex = Math.min(
    lastIndexAtOrBefore(points, "1450"),
    entryIndex + experimentConfig.maximumHoldMinutes,
  );
  const entryRaw = Number(points[entryIndex].price);
  let protectedProfit = false;
  let bestNetPct = Number.NEGATIVE_INFINITY;

  for (let cursor = entryIndex + 1; cursor < maximumExitIndex; cursor += 1) {
    const projected = cycleResult(direction, entryRaw, Number(points[cursor].price), quantity);
    const netPct = projected.net / Math.max(1, projected.entry * quantity) * 100;
    bestNetPct = Math.max(bestNetPct, netPct);
    if (netPct >= experimentConfig.minimumProtectedNetPct) protectedProfit = true;

    const maximumReached = netPct >= experimentConfig.maximumProtectedNetPct;
    const protectedProfitLost = protectedProfit
      && bestNetPct - netPct >= experimentConfig.protectedGivebackPct;
    if (!maximumReached && !protectedProfitLost) continue;

    const exitIndex = cursor + 1;
    return {
      exitIndex,
      exitReason: maximumReached ? "MAX_PROFIT" : "PROFIT_TRAIL",
      bestNetPctBeforeExit: bestNetPct,
      ...cycleResult(direction, entryRaw, Number(points[exitIndex].price), quantity),
    };
  }

  return {
    exitIndex: maximumExitIndex,
    exitReason: "RANGE_TIME_EXIT",
    bestNetPctBeforeExit: Number.isFinite(bestNetPct) ? bestNetPct : 0,
    ...cycleResult(direction, entryRaw, Number(points[maximumExitIndex].price), quantity),
  };
}

function dailyRegimeForSession(sessionIndex) {
  const prior = sessions.slice(Math.max(0, sessionIndex - 5), sessionIndex);
  if (prior.length < 3) return "FLAT";
  const closes = prior.map((session) => Number(session.minutes?.at(-1)?.price) || Number(session.previousClose) || 0).filter((price) => price > 0);
  if (closes.length < 3) return "FLAT";
  const move = pct(closes[0], closes.at(-1));
  if (move >= 0.8) return "UP";
  if (move <= -0.8) return "DOWN";
  return "FLAT";
}

function replay(session, sessionIndex, entryMode, exitMode, startIndex = 6) {
  const points = session.minutes ?? [];
  if (points.length < 10) return null;
  const vwaps = cumulativeVwaps(points);
  const dailyRegime = dailyRegimeForSession(sessionIndex);
  let signal = null;
  for (let index = Math.max(6, startIndex); index < points.length - 1; index += 1) {
    signal = detectEntry(points, vwaps, index, entryMode, dailyRegime);
    if (signal) break;
  }
  if (!signal) return null;

  const reference = Number(session.previousClose) || Number(points[0].price) || 10;
  const quantity = Math.max(300, Math.floor((90_000 / reference) / 100) * 100);
  const entryIndex = signal.signalIndex + 1;
  const result = exitMode === "VWAP_RECROSS"
    ? vwapRecrossExit(points, vwaps, entryIndex, signal.direction, quantity)
    : exitMode === "VWAP_HYBRID"
      ? vwapHybridExit(points, vwaps, entryIndex, signal.direction, quantity)
      : exitMode === "TRAILING_RANGE"
        ? trailingRangeExit(points, entryIndex, signal.direction, quantity)
      : target20Exit(points, entryIndex, signal.direction, quantity);
  const path = points.slice(entryIndex, result.exitIndex + 1).map((point) => Number(point.price));
  const entryRaw = Number(points[entryIndex].price);
  const favorablePrice = signal.direction === "POSITIVE_T" ? Math.max(...path) : Math.min(...path);
  const adversePrice = signal.direction === "POSITIVE_T" ? Math.min(...path) : Math.max(...path);

  return {
    date: String(session.date),
    year: Number(String(session.date).slice(0, 4)),
    entryMode,
    exitMode,
    entryTime: String(points[entryIndex].time),
    exitTime: String(points[result.exitIndex].time),
    entryIndex,
    exitIndex: result.exitIndex,
    holdMinutes: result.exitIndex - entryIndex,
    mfePct: signal.direction === "POSITIVE_T" ? pct(entryRaw, favorablePrice) : pct(favorablePrice, entryRaw),
    maePct: signal.direction === "POSITIVE_T" ? pct(adversePrice, entryRaw) : pct(entryRaw, adversePrice),
    ...signal,
    ...result,
  };
}

function replaySession(session, sessionIndex, entryMode, exitMode) {
  const rows = [];
  let cursor = 6;
  while (rows.length < experimentConfig.maximumCyclesPerDay) {
    const row = replay(session, sessionIndex, entryMode, exitMode, cursor);
    if (!row) break;
    rows.push({ ...row, cycleNumber: rows.length + 1 });
    cursor = row.exitIndex + experimentConfig.cooldownMinutes;
    if (cursor >= (session.minutes?.length ?? 0) - 1) break;
  }
  return rows;
}

function stats(rows) {
  const wins = rows.filter((row) => row.net > 0);
  const losses = rows.filter((row) => row.net <= 0);
  const gains = wins.reduce((sum, row) => sum + row.net, 0);
  const loss = losses.reduce((sum, row) => sum + Math.abs(row.net), 0);
  return {
    trades: rows.length,
    wins: wins.length,
    winRate: rows.length ? round(wins.length / rows.length * 100) : 0,
    gross: round(rows.reduce((sum, row) => sum + row.gross, 0)),
    fees: round(rows.reduce((sum, row) => sum + row.fees, 0)),
    net: round(rows.reduce((sum, row) => sum + row.net, 0)),
    averageNet: rows.length ? round(rows.reduce((sum, row) => sum + row.net, 0) / rows.length) : 0,
    profitFactor: loss > 0 ? round(gains / loss) : null,
    averageHoldMinutes: rows.length ? round(mean(rows.map((row) => row.holdMinutes))) : 0,
    averageMfePct: rows.length ? round(mean(rows.map((row) => row.mfePct))) : 0,
    averageMaePct: rows.length ? round(mean(rows.map((row) => row.maePct))) : 0,
    forcedCloseCount: rows.filter((row) => row.exitReason === "FORCED_1450").length,
  };
}

function groups(rows, field, values) {
  return Object.fromEntries(values.map((value) => [value, stats(rows.filter((row) => row[field] === value))]));
}

function multiCycleAudit(rows) {
  const completed = rows.filter((row) => row.year <= 2025);
  const countsByDate = new Map();
  completed.forEach((row) => countsByDate.set(row.date, (countsByDate.get(row.date) ?? 0) + 1));
  return {
    secondOrLaterTrades: completed.filter((row) => row.cycleNumber >= 2).length,
    daysWithMultipleCycles: [...countsByDate.values()].filter((count) => count >= 2).length,
    byCycleNumber: groups(completed, "cycleNumber", [1, 2, 3]),
  };
}

function quantile(sorted, probability) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * probability)));
  return sorted[index];
}

function vwapDeviationDistribution() {
  const values = [];
  for (const session of sessions) {
    const year = Number(String(session.date).slice(0, 4));
    if (year > 2025) continue;
    const points = session.minutes ?? [];
    const vwaps = cumulativeVwaps(points);
    points.forEach((point, index) => {
      const time = String(point.time ?? "").replace(":", "").padStart(4, "0");
      if (time < "0935" || time > "1450" || (time > "1130" && time < "1300")) return;
      values.push(Math.abs(pct(vwaps[index], Number(point.price))));
    });
  }
  values.sort((left, right) => left - right);
  return {
    minuteSamples: values.length,
    p50: round(quantile(values, 0.5)),
    p75: round(quantile(values, 0.75)),
    p90: round(quantile(values, 0.9)),
    p95: round(quantile(values, 0.95)),
    p99: round(quantile(values, 0.99)),
    shareAtLeast075Pct: round(values.filter((value) => value >= 0.75).length / Math.max(1, values.length) * 100),
    shareAtLeast100Pct: round(values.filter((value) => value >= 1).length / Math.max(1, values.length) * 100),
    shareAtLeast150Pct: round(values.filter((value) => value >= 1.5).length / Math.max(1, values.length) * 100),
    shareAtLeast200Pct: round(values.filter((value) => value >= 2).length / Math.max(1, values.length) * 100),
  };
}

const results = ["TURN_ONLY", "PRIOR_INTRADAY_REGIME", "DAILY5_REGIME"].flatMap((entryMode) => ["TARGET20", "VWAP_RECROSS", "VWAP_HYBRID", "TRAILING_RANGE"].map((exitMode) => {
  const rows = sessions.flatMap((session, sessionIndex) => replaySession(session, sessionIndex, entryMode, exitMode));
  const research = rows.filter((row) => row.year <= 2024);
  const validation = rows.filter((row) => row.year === 2025);
  return {
    entryMode,
    exitMode,
    research2022To2024: stats(research),
    validation2025: stats(validation),
    researchByDirection: groups(research, "direction", ["POSITIVE_T", "REVERSE_T"]),
    validationByDirection: groups(validation, "direction", ["POSITIVE_T", "REVERSE_T"]),
    byYear2022To2025: groups(rows, "year", [2022, 2023, 2024, 2025]),
    multiCycleAudit: multiCycleAudit(rows),
    exitReasons: groups(rows.filter((row) => row.year <= 2025), "exitReason", ["TARGET_064", "TIME_20", "VWAP_RECROSS", "STOP_060", "TIME_45", "FORCED_1450", "MAX_PROFIT", "PROFIT_TRAIL", "RANGE_TIME_EXIT"]),
    frozen2026: { opened: false, matchingSessionCount: rows.filter((row) => row.year >= 2026).length, resultsWithheld: true },
  };
}));

console.log(JSON.stringify({
  protocol: {
    causalSignal: true,
    signalReadsFuture: false,
    symmetricDirections: true,
    signalWindow: "09:30-09:49",
    experimentConfig,
    volumeEvent: `${experimentConfig.minimumVolumeRatio}x-${Number.isFinite(experimentConfig.maximumVolumeRatio) ? experimentConfig.maximumVolumeRatio : "unlimited"}x armed for ten minutes`,
    regimeFilter: "either pre-pullback intraday VWAP slope or the five prior completed trading days, both causal",
    execution: "next minute with 0.02% per-side slippage",
    vwapExitExecution: "next minute after the recross is observed",
    forcedClose: "14:50 when VWAP is not recrossed",
    fee: "0.025% commission with minimum 5 CNY plus 0.05% sell stamp duty",
    frozen2026UsedForSelection: false,
  },
  sessionCount: sessions.length,
  descriptiveVwapDeviation2022To2025: vwapDeviationDistribution(),
  results,
}, null, 2));
