#!/usr/bin/env node
/**
 * Search longer causal exits for the frozen high-coverage Zijin entry pool.
 * Selection: 2022-2023 research + 2024 calibration. 2025 is reported as an
 * untouched forward validation partition; 2026 is never loaded.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { PROFILES, runSmartTReplay } from "../lib/smart-t-engine.mjs";

const [inputPath] = process.argv.slice(2);
if (!inputPath) throw new Error("usage: node search-zijin-longer-payoff.mjs SESSIONS.jsonl");

const profile = Object.keys(PROFILES)[2];
const sessions = [];
const reader = createInterface({ input: createReadStream(inputPath, "utf8"), crlfDelay: Infinity });
for await (const line of reader) {
  if (!line.trim()) continue;
  const session = JSON.parse(line);
  if (Number(String(session.date).slice(0, 4)) <= 2025) sessions.push(session);
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
  minHoldMinutes: 2,
};

const profitStructures = [
  { targetNetPct: 0.15, maxTargetNetPct: 0.25, trailActivationPct: 0.15, trailRetracePct: 0.08, trailMinNetPct: 0.07 },
  { targetNetPct: 0.25, maxTargetNetPct: 0.40, trailActivationPct: 0.25, trailRetracePct: 0.10, trailMinNetPct: 0.11 },
  { targetNetPct: 0.35, maxTargetNetPct: 0.55, trailActivationPct: 0.35, trailRetracePct: 0.12, trailMinNetPct: 0.15 },
  { targetNetPct: 0.50, maxTargetNetPct: 0.75, trailActivationPct: 0.50, trailRetracePct: 0.16, trailMinNetPct: 0.22 },
];

const stopStructures = [
  { hardStopPct: 0.12, catastrophicStopPct: 0.18, softStopPct: 0.08, softStopMinutes: 3 },
  { hardStopPct: 0.20, catastrophicStopPct: 0.28, softStopPct: 0.12, softStopMinutes: 4 },
  { hardStopPct: 0.30, catastrophicStopPct: 0.42, softStopPct: 0.18, softStopMinutes: 5 },
];

const grid = [];
for (const profit of profitStructures) {
  for (const stop of stopStructures) {
    for (const timeExitMinutes of [32, 60, 100]) grid.push({ ...profit, ...stop, timeExitMinutes });
  }
}

const empty = () => ({ days: 0, cycles: 0, wins: 0, net: 0 });
function add(bucket, replay) {
  bucket.days += 1;
  bucket.cycles += replay.trades;
  bucket.wins += replay.wins;
  bucket.net += replay.net;
}
function finish(bucket) {
  return {
    ...bucket,
    cyclesPer100Days: Number((bucket.cycles / Math.max(1, bucket.days) * 100).toFixed(2)),
    winRate: Number((bucket.wins / Math.max(1, bucket.cycles) * 100).toFixed(2)),
    averageNet: Number((bucket.net / Math.max(1, bucket.cycles)).toFixed(2)),
    net: Number(bucket.net.toFixed(2)),
  };
}

function evaluate(exit) {
  const partitions = { research2022To2023: empty(), calibration2024: empty(), validation2025: empty() };
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
      profileOverrides: { ...entry, ...exit },
      volatilityMode: "fixed",
      previousClose: session.previousClose,
      randomValue: 0.5,
    });
    if (year <= 2023) add(partitions.research2022To2023, replay);
    else if (year === 2024) add(partitions.calibration2024, replay);
    else if (year === 2025) add(partitions.validation2025, replay);
  }
  return Object.fromEntries(Object.entries(partitions).map(([name, value]) => [name, finish(value)]));
}

const rows = grid.map((exit) => ({ exit, partitions: evaluate(exit) }));
for (const row of rows) {
  const { research2022To2023: research, calibration2024: calibration, validation2025: validation } = row.partitions;
  row.selectedWithout2025 = research.net > 0 && calibration.net > 0
    && research.winRate >= 50 && calibration.winRate >= 50;
  row.forwardPass = validation.net > 0 && validation.winRate >= 50;
  row.coveragePass = calibration.cyclesPer100Days >= 35 && validation.cyclesPer100Days >= 35;
}
rows.sort((left, right) => {
  if (left.selectedWithout2025 !== right.selectedWithout2025) return left.selectedWithout2025 ? -1 : 1;
  const leftSelectionNet = left.partitions.research2022To2023.net + left.partitions.calibration2024.net;
  const rightSelectionNet = right.partitions.research2022To2023.net + right.partitions.calibration2024.net;
  return rightSelectionNet - leftSelectionNet;
});

console.log(JSON.stringify({
  protocol: {
    causal: true,
    costsIncluded: true,
    frozenEntry: true,
    searchedExitCount: rows.length,
    selectionUses2025: false,
    holdout2026Opened: false,
  },
  selectedCount: rows.filter((row) => row.selectedWithout2025).length,
  selectedForwardPassCount: rows.filter((row) => row.selectedWithout2025 && row.forwardPass).length,
  coveragePassCount: rows.filter((row) => row.coveragePass).length,
  topBySelection: rows.slice(0, 12),
}, null, 2));
