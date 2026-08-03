#!/usr/bin/env node
/**
 * Search bounded-loss exits for the frozen high-coverage Zijin formal engine.
 *
 * The entry engine remains unchanged. Every exit is evaluated minute by minute
 * with the same costs/slippage as production replay. 2022-2023 and 2024 select;
 * 2025 is a forward report only and 2026 is never opened.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { PROFILES, runSmartTReplay } from "../lib/smart-t-engine.mjs";

const [inputPath] = process.argv.slice(2);
if (!inputPath) throw new Error("usage: node search-zijin-tight-payoff.mjs SESSIONS.jsonl");

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
  minHoldMinutes: 1,
};

const profitStructures = [
  { targetNetPct: 0.08, maxTargetNetPct: 0.12, trailActivationPct: 0.08, trailRetracePct: 0.03, trailMinNetPct: 0.04 },
  { targetNetPct: 0.12, maxTargetNetPct: 0.18, trailActivationPct: 0.12, trailRetracePct: 0.04, trailMinNetPct: 0.06 },
  { targetNetPct: 0.18, maxTargetNetPct: 0.25, trailActivationPct: 0.18, trailRetracePct: 0.06, trailMinNetPct: 0.08 },
  { targetNetPct: 0.25, maxTargetNetPct: 0.35, trailActivationPct: 0.25, trailRetracePct: 0.08, trailMinNetPct: 0.12 },
];

const stopStructures = [
  { hardStopPct: 0.06, catastrophicStopPct: 0.10, softStopPct: 0.04, softStopMinutes: 2 },
  { hardStopPct: 0.08, catastrophicStopPct: 0.12, softStopPct: 0.05, softStopMinutes: 2 },
  { hardStopPct: 0.10, catastrophicStopPct: 0.16, softStopPct: 0.06, softStopMinutes: 3 },
  { hardStopPct: 0.14, catastrophicStopPct: 0.20, softStopPct: 0.08, softStopMinutes: 3 },
];

const grid = [];
for (const profit of profitStructures) {
  for (const stop of stopStructures) {
    for (const timeExitMinutes of [6, 10, 14]) {
      grid.push({ ...profit, ...stop, timeExitMinutes });
    }
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
  return Object.fromEntries(Object.entries(partitions).map(([name, bucket]) => [name, finish(bucket)]));
}

const rows = grid.map((exit) => ({ exit, partitions: evaluate(exit) }));
for (const row of rows) {
  const research = row.partitions.research2022To2023;
  const calibration = row.partitions.calibration2024;
  const validation = row.partitions.validation2025;
  row.selectionCoveragePass = [research, calibration].every((part) => part.cyclesPer100Days >= 32 && part.cyclesPer100Days <= 50);
  row.selectedWithout2025 = row.selectionCoveragePass
    && research.net > 0 && calibration.net > 0
    && research.winRate >= 50 && calibration.winRate >= 50;
  row.forwardPass = validation.cyclesPer100Days >= 32 && validation.cyclesPer100Days <= 50
    && validation.net > 0 && validation.winRate >= 50;
}
rows.sort((left, right) => {
  if (left.selectedWithout2025 !== right.selectedWithout2025) return left.selectedWithout2025 ? -1 : 1;
  if (left.selectionCoveragePass !== right.selectionCoveragePass) return left.selectionCoveragePass ? -1 : 1;
  const leftNet = left.partitions.research2022To2023.net + left.partitions.calibration2024.net;
  const rightNet = right.partitions.research2022To2023.net + right.partitions.calibration2024.net;
  return rightNet - leftNet;
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
  selectionCoveragePassCount: rows.filter((row) => row.selectionCoveragePass).length,
  topBySelection: rows.slice(0, 16),
}, null, 2));
