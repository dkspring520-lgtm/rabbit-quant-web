#!/usr/bin/env node
/**
 * Export an entry-time-only ledger for every formal Smart-T cycle.
 *
 * The ledger is intended for walk-forward diagnostics.  Every explanatory
 * feature is copied from the entry action (or from data already known at the
 * opening); the realised cycle net and exit fields are labels, never inputs.
 */

import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { PROFILES, runSmartTReplay } from "../lib/smart-t-engine.mjs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("usage: node export-zijin-formal-cycle-ledger.mjs SESSIONS.jsonl OUTPUT.jsonl");
}

const profile = Object.keys(PROFILES)[2];
const profileOverrides = {
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

function exitClass(reason = "") {
  if (reason.includes("止盈") || reason.includes("profit")) return "take-profit";
  if (reason.includes("止损") || reason.includes("stop")) return "stop";
  if (reason.includes("时间") || reason.includes("time")) return "time-exit";
  if (reason.includes("14:50") || reason.includes("强制") || reason.includes("force")) return "force-close";
  return "other";
}

function finite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function scalarEntryMeta(meta = {}) {
  const result = {};
  for (const [key, value] of Object.entries(meta)) {
    if (["string", "number", "boolean"].includes(typeof value) || value == null) {
      result[key] = value;
    }
  }
  return result;
}

const reader = createInterface({ input: createReadStream(inputPath, "utf8"), crlfDelay: Infinity });
const output = createWriteStream(outputPath, "utf8");
let days = 0;
let cycles = 0;
let wins = 0;
let net = 0;

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
    profile,
    profileOverrides,
    volatilityMode: "fixed",
    previousClose: session.previousClose,
    randomValue: 0.5,
  });
  days += 1;
  for (let index = 0; index < replay.cycleNets.length; index += 1) {
    const cycleId = index + 1;
    const entry = replay.actions.find((action) => action.cycleId === cycleId && action.meta?.phase === "entry");
    const exit = replay.actions.find((action) => action.cycleId === cycleId && action.meta?.phase === "exit");
    if (!entry || !exit) continue;
    const cycleNet = Number(replay.cycleNets[index]) || 0;
    const openingPrice = finite(session.minutes?.[0]?.price);
    const previousClose = finite(session.previousClose);
    const openingGapPct = previousClose > 0 && openingPrice != null
      ? (openingPrice - previousClose) / previousClose * 100
      : null;
    const row = {
      schemaVersion: 1,
      causalEntryFeatures: true,
      date: String(session.date),
      year: Number(String(session.date).slice(0, 4)),
      cycleId,
      direction: entry.direction,
      entryTime: entry.time,
      entryPrice: entry.price,
      quantity: entry.quantity,
      previousClose,
      openingPrice,
      openingGapPct,
      entry: scalarEntryMeta(entry.meta),
      label: {
        net: cycleNet,
        win: cycleNet > 0,
        exitTime: exit.time,
        exitPrice: exit.price,
        exitClass: exitClass(exit.reason),
        holdMinutes: finite(exit.meta?.hold),
        projectedNetPct: finite(exit.meta?.projectedNetPct),
        bestMovePct: finite(exit.meta?.bestMove),
      },
    };
    output.write(`${JSON.stringify(row)}\n`);
    cycles += 1;
    wins += cycleNet > 0 ? 1 : 0;
    net += cycleNet;
  }
}

await new Promise((resolve, reject) => {
  output.on("error", reject);
  output.end(resolve);
});

console.log(JSON.stringify({
  profile,
  days,
  cycles,
  cyclesPer100Days: Number((cycles / Math.max(1, days) * 100).toFixed(2)),
  wins,
  winRate: Number((wins / Math.max(1, cycles) * 100).toFixed(2)),
  net: Number(net.toFixed(2)),
  outputPath,
}, null, 2));
