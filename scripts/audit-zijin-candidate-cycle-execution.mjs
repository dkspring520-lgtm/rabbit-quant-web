#!/usr/bin/env node
/**
 * Causal execution audit for the Smart-T candidate event stream.
 *
 * Candidate markers are emitted by the replay using only data available at
 * the marker minute.  This audit consumes those markers online and, unlike
 * the research-only candidate pairing view, never drops an unmatched entry:
 * every opened leg must exit by an opposite marker, target, stop, expiry or
 * the 14:50 force-close.  Executions use adverse slippage and real A-share
 * commission/stamp-duty assumptions.
 *
 * Parameter selection uses 2022-2023 research and 2024 calibration only.
 * 2025 is an untouched forward report.  2026 is never loaded.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { PROFILES, runSmartTReplay } from "../lib/smart-t-engine.mjs";

const [inputPath] = process.argv.slice(2);
if (!inputPath) {
  throw new Error("usage: node audit-zijin-candidate-cycle-execution.mjs SESSIONS.jsonl");
}

const profile = Object.keys(PROFILES)[2];
const entryOverrides = {
  maxCycles: 4,
  cooldown: 3,
  deviation: 0.35,
  reversal: 0.10,
  candidateNetPct: 0.17,
  minRewardRisk: 1.05,
  maxBuyTrendRiskVotes: 1,
  maxSellTrendRiskVotes: 1,
  enableMatureSellReversalRiskOverride: 1,
  matureSellReversalMinPivotAge: 2,
  minBuyExecutionConfirmationVotes: 2,
  minSellExecutionConfirmationVotes: 2,
  candidateFlipMinutes: 7,
  enableSellExhaustionVolumeRegime: 0,
  targetNetPct: 0.10,
  maxTargetNetPct: 0.15,
  trailActivationPct: 0.10,
  trailRetracePct: 0.04,
  trailMinNetPct: 0.06,
  hardStopPct: 0.24,
  catastrophicStopPct: 0.39,
  softStopPct: 0.14,
  softStopMinutes: 6,
  timeExitMinutes: 16,
  minHoldMinutes: 1,
};

const sessions = [];
const reader = createInterface({ input: createReadStream(inputPath, "utf8"), crlfDelay: Infinity });
for await (const line of reader) {
  if (!line.trim()) continue;
  const session = JSON.parse(line);
  if (Number(String(session.date).slice(0, 4)) <= 2025) sessions.push(session);
}

function marketMinute(time) {
  const text = String(time ?? "").padStart(4, "0");
  const hours = Number(text.slice(0, 2));
  const minutes = Number(text.slice(2, 4));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 12) return (hours - 9) * 60 + minutes - 30;
  return 120 + (hours - 13) * 60 + minutes;
}

function pct(numerator, denominator) {
  return denominator > 0 ? (numerator - denominator) / denominator * 100 : 0;
}

function roundLot(shares) {
  return Math.max(0, Math.floor(shares / 100) * 100);
}

function commission(turnover) {
  return Math.max(5, turnover * 0.00025);
}

function execution(side, quotedPrice, quantity) {
  const slippageRate = 0.0002;
  const price = side === "buy"
    ? quotedPrice * (1 + slippageRate)
    : quotedPrice * (1 - slippageRate);
  const turnover = price * quantity;
  const fee = commission(turnover) + (side === "sell" ? turnover * 0.0005 : 0);
  return { side, price, turnover, fee };
}

function candidateReplay(session) {
  const referencePrice = Number(session.previousClose) || Number(session.minutes?.[0]?.price) || 10;
  const shares = Math.max(300, roundLot(90_000 / referencePrice));
  const replay = runSmartTReplay(session.minutes, {
    capital: 200_000,
    baseShares: shares,
    sellable: shares,
    feeRate: 0.025,
    slippage: 0.02,
    minCommission: true,
    slippageMode: "percent",
    forceCloseTime: "1450",
    profile,
    profileOverrides: entryOverrides,
    volatilityMode: "fixed",
    previousClose: session.previousClose,
    randomValue: 0.5,
  });
  const byTime = new Map();
  for (const observation of replay.observations) {
    if (observation?.stage !== "candidate") continue;
    if (!Number.isFinite(Number(observation.price))) continue;
    if (observation.direction !== "正T" && observation.direction !== "反T") continue;
    const list = byTime.get(observation.time) ?? [];
    list.push(observation);
    byTime.set(observation.time, list);
  }
  return { shares, candidatesByTime: byTime };
}

const prepared = sessions.map((session) => ({ session, ...candidateReplay(session) }));

const grid = [];
for (const maxHoldMinutes of [30, 60, 90, 120]) {
  for (const hardStopPct of [0.25, 0.40, 0.60, 0.80]) {
    for (const takeProfitPct of [0.25, 0.40, 0.60, Number.POSITIVE_INFINITY]) {
      for (const maxDailyCycles of [1, 2, 3]) {
        grid.push({ maxHoldMinutes, hardStopPct, takeProfitPct, maxDailyCycles, minHoldMinutes: 3 });
      }
    }
  }
}

function closeTrade(open, point, reason) {
  const secondSide = open.direction === "正T" ? "sell" : "buy";
  const exit = execution(secondSide, Number(point.price), open.quantity);
  const gross = open.direction === "正T"
    ? exit.turnover - open.first.turnover
    : open.first.turnover - exit.turnover;
  const fees = open.first.fee + exit.fee;
  return {
    direction: open.direction,
    entryTime: open.time,
    entryPrice: open.first.price,
    exitTime: point.time,
    exitPrice: exit.price,
    holdingMinutes: Math.max(0, marketMinute(point.time) - open.minute),
    gross,
    fees,
    net: gross - fees,
    reason,
  };
}

function simulateDay(preparedSession, config) {
  const { session, shares, candidatesByTime } = preparedSession;
  const points = session.minutes.filter((point) => Number.isFinite(Number(point.price)));
  const cycles = [];
  let open = null;
  let ignoredCandidates = 0;
  for (const point of points) {
    const minute = marketMinute(point.time);
    if (minute == null) continue;
    if (open) {
      const rawMove = open.direction === "正T"
        ? pct(Number(point.price), open.signalPrice)
        : pct(open.signalPrice, Number(point.price));
      const hold = minute - open.minute;
      let reason = null;
      if (rawMove <= -config.hardStopPct) reason = "hard-stop";
      else if (rawMove >= config.takeProfitPct) reason = "take-profit";
      else if (hold >= config.maxHoldMinutes) reason = "expiry";
      else if (String(point.time) >= "1450") reason = "force-close";
      if (reason) {
        cycles.push(closeTrade(open, point, reason));
        open = null;
      }
    }

    const candidates = candidatesByTime.get(point.time) ?? [];
    for (const candidate of candidates) {
      if (open) {
        const hold = minute - open.minute;
        if (candidate.direction !== open.direction && hold >= config.minHoldMinutes) {
          cycles.push(closeTrade(open, point, "opposite-candidate"));
          open = null;
        } else {
          ignoredCandidates += 1;
        }
        continue;
      }
      // An opposite candidate that just closed a leg is not reused as a new
      // entry in the same minute.  This avoids cost-free instantaneous flips.
      if (cycles.at(-1)?.exitTime === point.time) {
        ignoredCandidates += 1;
        continue;
      }
      if (cycles.length >= config.maxDailyCycles || String(point.time) >= "1450") {
        ignoredCandidates += 1;
        continue;
      }
      const firstSide = candidate.direction === "正T" ? "buy" : "sell";
      const first = execution(firstSide, Number(point.price), shares);
      open = {
        direction: candidate.direction,
        time: point.time,
        minute,
        signalPrice: Number(point.price),
        quantity: shares,
        first,
      };
    }
  }

  if (open && points.length) {
    const eligible = points.filter((point) => String(point.time) <= "1450");
    const finalPoint = eligible.at(-1) ?? points.at(-1);
    cycles.push(closeTrade(open, finalPoint, "end-of-data-force-close"));
    open = null;
  }
  return { cycles, ignoredCandidates };
}

function empty() {
  return {
    days: 0,
    cycles: 0,
    wins: 0,
    gross: 0,
    fees: 0,
    net: 0,
    ignoredCandidates: 0,
    exits: {},
  };
}

function add(bucket, result) {
  bucket.days += 1;
  bucket.ignoredCandidates += result.ignoredCandidates;
  for (const cycle of result.cycles) {
    bucket.cycles += 1;
    bucket.wins += cycle.net > 0 ? 1 : 0;
    bucket.gross += cycle.gross;
    bucket.fees += cycle.fees;
    bucket.net += cycle.net;
    bucket.exits[cycle.reason] = (bucket.exits[cycle.reason] ?? 0) + 1;
  }
}

function finish(bucket) {
  return {
    ...bucket,
    cyclesPer100Days: Number((bucket.cycles / Math.max(1, bucket.days) * 100).toFixed(2)),
    winRate: Number((bucket.wins / Math.max(1, bucket.cycles) * 100).toFixed(2)),
    averageNet: Number((bucket.net / Math.max(1, bucket.cycles)).toFixed(2)),
    gross: Number(bucket.gross.toFixed(2)),
    fees: Number(bucket.fees.toFixed(2)),
    net: Number(bucket.net.toFixed(2)),
  };
}

function evaluate(config) {
  const partitions = { research2022To2023: empty(), calibration2024: empty(), validation2025: empty() };
  for (const item of prepared) {
    const year = Number(String(item.session.date).slice(0, 4));
    const result = simulateDay(item, config);
    if (year <= 2023) add(partitions.research2022To2023, result);
    else if (year === 2024) add(partitions.calibration2024, result);
    else if (year === 2025) add(partitions.validation2025, result);
  }
  return Object.fromEntries(Object.entries(partitions).map(([name, value]) => [name, finish(value)]));
}

const rows = grid.map((config) => ({ config, partitions: evaluate(config) }));
for (const row of rows) {
  const research = row.partitions.research2022To2023;
  const calibration = row.partitions.calibration2024;
  const validation = row.partitions.validation2025;
  row.selectedWithout2025 = research.cyclesPer100Days >= 35
    && calibration.cyclesPer100Days >= 35
    && research.winRate >= 50
    && calibration.winRate >= 50
    && research.net > 0
    && calibration.net > 0;
  row.forwardPass = validation.cyclesPer100Days >= 35
    && validation.winRate >= 50
    && validation.net > 0;
}
rows.sort((left, right) => {
  if (left.selectedWithout2025 !== right.selectedWithout2025) return left.selectedWithout2025 ? -1 : 1;
  const leftScore = left.partitions.research2022To2023.net + left.partitions.calibration2024.net;
  const rightScore = right.partitions.research2022To2023.net + right.partitions.calibration2024.net;
  return rightScore - leftScore;
});

const candidateCount = prepared.reduce(
  (sum, item) => sum + [...item.candidatesByTime.values()].reduce((inner, items) => inner + items.length, 0),
  0,
);

console.log(JSON.stringify({
  protocol: {
    causalCandidateEvents: true,
    unmatchedEntriesCounted: true,
    adverseSlippagePctPerSide: 0.02,
    commissionPctPerSide: 0.025,
    minimumCommission: 5,
    sellStampDutyPct: 0.05,
    forceCloseTime: "1450",
    parameterSelectionUses2025: false,
    holdout2026Opened: false,
    searchedConfigurations: rows.length,
  },
  preparedDays: prepared.length,
  candidateCount,
  candidateEventsPer100Days: Number((candidateCount / Math.max(1, prepared.length) * 100).toFixed(2)),
  selectedCount: rows.filter((row) => row.selectedWithout2025).length,
  selectedForwardPassCount: rows.filter((row) => row.selectedWithout2025 && row.forwardPass).length,
  topBySelection: rows.slice(0, 15),
}, null, 2));
