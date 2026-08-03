#!/usr/bin/env node
/**
 * Causal exit-structure search for the already selected high-coverage entry.
 *
 * 2022-2023 is research, 2024 is calibration and 2025 is untouched forward
 * validation.  2026 is deliberately not loaded.  The search exists to repair
 * payoff asymmetry without silently lowering the formal-cycle definition.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { PROFILES, runSmartTReplay } from "../lib/smart-t-engine.mjs";

const [inputPath] = process.argv.slice(2);
if (!inputPath) throw new Error("usage: node search-zijin-exit-structure.mjs SESSIONS.jsonl");

const profile = "灵敏档";
if (!PROFILES[profile]) throw new Error("sensitive Smart-T profile is unavailable");

const sessions = [];
const reader = createInterface({ input: createReadStream(inputPath, "utf8"), crlfDelay: Infinity });
for await (const line of reader) {
  if (!line.trim()) continue;
  const session = JSON.parse(line);
  const year = Number(String(session.date).slice(0, 4));
  if (year <= 2025) sessions.push(session);
}

const entry = {
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
  minHoldMinutes: 1,
};

const profitStructures = [
  { maxTargetNetPct: 0.18, trailActivationPct: 0.10, trailRetracePct: 0.04, trailMinNetPct: 0.04 },
  { maxTargetNetPct: 0.24, trailActivationPct: 0.16, trailRetracePct: 0.06, trailMinNetPct: 0.06 },
  { maxTargetNetPct: 0.30, trailActivationPct: 0.20, trailRetracePct: 0.08, trailMinNetPct: 0.08 },
  { maxTargetNetPct: 0.36, trailActivationPct: 0.24, trailRetracePct: 0.10, trailMinNetPct: 0.10 },
];

const exitGrid = [];
for (const profit of profitStructures) {
  for (const stopPct of [0.10, 0.14, 0.18]) {
    for (const timeExitMinutes of [16, 24, 32]) {
      exitGrid.push({
        targetNetPct: profit.trailActivationPct,
        ...profit,
        hardStopPct: stopPct,
        catastrophicStopPct: stopPct,
        softStopPct: Math.max(0.06, stopPct - 0.04),
        softStopMinutes: 3,
        timeExitMinutes,
      });
    }
  }
}

function empty() {
  return { days: 0, cycles: 0, wins: 0, net: 0, gross: 0, fees: 0, executionCost: 0 };
}

function add(bucket, replay) {
  bucket.days += 1;
  bucket.cycles += replay.trades;
  bucket.wins += replay.wins;
  bucket.net += replay.net;
  bucket.gross += replay.gross;
  bucket.fees += replay.fees;
  bucket.executionCost += replay.executionCost;
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

function evaluate(profileOverrides) {
  const partitions = {
    research2022To2023: empty(),
    calibration2024: empty(),
    validation2025: empty(),
  };
  for (const session of sessions) {
    const year = Number(String(session.date).slice(0, 4));
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
      profile,
      profileOverrides,
      volatilityMode: "fixed",
      previousClose: session.previousClose,
      randomValue: 0.5,
    });
    if (year <= 2023) add(partitions.research2022To2023, replay);
    else if (year === 2024) add(partitions.calibration2024, replay);
    else if (year === 2025) add(partitions.validation2025, replay);
  }
  return Object.fromEntries(Object.entries(partitions).map(([key, value]) => [key, finish(value)]));
}

const rows = exitGrid.map((exit) => {
  const profileOverrides = { ...entry, ...exit };
  const partitions = evaluate(profileOverrides);
  const calibration = partitions.calibration2024;
  const validation = partitions.validation2025;
  const coveragePass = calibration.cyclesPer100Days >= 35
    && validation.cyclesPer100Days >= 35;
  const qualityPass = calibration.winRate >= 50
    && validation.winRate >= 50
    && calibration.net > 0
    && validation.net > 0;
  return { profileOverrides, coveragePass, qualityPass, partitions };
});

rows.sort((left, right) => {
  if (left.qualityPass !== right.qualityPass) return left.qualityPass ? -1 : 1;
  if (left.coveragePass !== right.coveragePass) return left.coveragePass ? -1 : 1;
  const leftForward = left.partitions.validation2025;
  const rightForward = right.partitions.validation2025;
  if (leftForward.net !== rightForward.net) return rightForward.net - leftForward.net;
  return rightForward.winRate - leftForward.winRate;
});

console.log(JSON.stringify({
  protocol: {
    causal: true,
    costsIncluded: true,
    entryFrozen: true,
    searchedExitCount: rows.length,
    partitions: ["2022-2023 research", "2024 calibration", "2025 forward validation"],
    holdout2026Opened: false,
  },
  qualityPassCount: rows.filter((row) => row.qualityPass).length,
  coveragePassCount: rows.filter((row) => row.coveragePass).length,
  top: rows.slice(0, 12),
}, null, 2));
