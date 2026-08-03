#!/usr/bin/env node
/**
 * Small deterministic Pareto search for Zijin formal-cycle coverage.
 *
 * The search never reads 2026.  It reports 2022-2023 as research, 2024 as
 * calibration and 2025 as forward validation.  A configuration is only
 * considered deployable when both 2024 and 2025 remain net-positive after
 * costs; reaching a coverage target alone is not sufficient.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { PROFILES, runSmartTReplay } from "../lib/smart-t-engine.mjs";

const [inputPath] = process.argv.slice(2);
if (!inputPath) throw new Error("usage: node search-zijin-pareto.mjs SESSIONS.jsonl");

const profile = Object.keys(PROFILES)[1];
if (!profile) throw new Error("balanced Smart-T profile is unavailable");

const sessions = [];
const reader = createInterface({ input: createReadStream(inputPath, "utf8"), crlfDelay: Infinity });
for await (const line of reader) {
  if (!line.trim()) continue;
  const session = JSON.parse(line);
  const year = Number(String(session.date).slice(0, 4));
  if (year <= 2025) sessions.push(session);
}

const entryGrid = [];
for (const maxCycles of [2, 3, 4]) {
  for (const deviation of [0.35, 0.45, 0.55]) {
    for (const reversal of [0.10, 0.16]) {
      for (const candidateNetPct of [0.18, 0.25]) {
        entryGrid.push({ maxCycles, deviation, reversal, candidateNetPct });
      }
    }
  }
}

const exitGrid = [
  {
    targetNetPct: 0.12,
    maxTargetNetPct: 0.18,
    trailActivationPct: 0.10,
    trailRetracePct: 0.04,
    trailMinNetPct: 0.06,
    hardStopPct: 0.24,
    catastrophicStopPct: 0.39,
    softStopPct: 0.14,
    softStopMinutes: 6,
    timeExitMinutes: 16,
  },
  {
    targetNetPct: 0.18,
    maxTargetNetPct: 0.28,
    trailActivationPct: 0.15,
    trailRetracePct: 0.06,
    trailMinNetPct: 0.10,
    hardStopPct: 0.32,
    catastrophicStopPct: 0.48,
    softStopPct: 0.18,
    softStopMinutes: 8,
    timeExitMinutes: 20,
  },
];

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

const common = {
  score: 4,
  cooldown: 3,
  minHoldMinutes: 1,
  minRewardRisk: 1.05,
  maxBuyTrendRiskVotes: 1,
  maxSellTrendRiskVotes: 1,
  minBuyExecutionConfirmationVotes: 2,
  minSellExecutionConfirmationVotes: 2,
  candidateFlipMinutes: 7,
  enableSellExhaustionVolumeRegime: 0,
  minBuyVolumeRatio: 0.70,
  minSellVolumeRatio: 0.80,
  minMomentum3: 0.08,
};

const results = [];
for (const entry of entryGrid) {
  for (const exit of exitGrid) {
    const profileOverrides = { ...common, ...entry, ...exit };
    const partitions = evaluate(profileOverrides);
    const calibration = partitions.calibration2024;
    const validation = partitions.validation2025;
    const deployable = calibration.net > 0
      && validation.net > 0
      && calibration.winRate >= 50
      && validation.winRate >= 50;
    results.push({ profileOverrides, deployable, partitions });
  }
}

const ranked = results.sort((left, right) => {
  if (left.deployable !== right.deployable) return left.deployable ? -1 : 1;
  const leftValidation = left.partitions.validation2025;
  const rightValidation = right.partitions.validation2025;
  const leftCoverageScore = -Math.abs(leftValidation.cyclesPer100Days - 40);
  const rightCoverageScore = -Math.abs(rightValidation.cyclesPer100Days - 40);
  if (leftValidation.net !== rightValidation.net) return rightValidation.net - leftValidation.net;
  if (leftValidation.winRate !== rightValidation.winRate) return rightValidation.winRate - leftValidation.winRate;
  return rightCoverageScore - leftCoverageScore;
});

const nearCoverage = [...results]
  .sort((left, right) => Math.abs(left.partitions.validation2025.cyclesPer100Days - 40)
    - Math.abs(right.partitions.validation2025.cyclesPer100Days - 40))
  .slice(0, 10);

console.log(JSON.stringify({
  protocol: {
    causal: true,
    costsIncluded: true,
    selectionPeriods: ["2022-2023 research", "2024 calibration", "2025 forward validation"],
    holdout2026Opened: false,
    targetCyclesPer100Days: 40,
    candidateCount: results.length,
  },
  deployableCount: results.filter((row) => row.deployable).length,
  topByValidationNet: ranked.slice(0, 10),
  nearestToCoverageTarget: nearCoverage,
}, null, 2));
