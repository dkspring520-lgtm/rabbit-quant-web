#!/usr/bin/env node
/** Export realistic next-minute execution labels for every causal candidate. */

import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { PROFILES, runSmartTReplay } from "../lib/smart-t-engine.mjs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("usage: node export-zijin-candidate-execution-labels.mjs SESSIONS.jsonl OUTPUT.jsonl");
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
};

const configurations = [];
for (const maxHoldMinutes of [30, 60, 90, 120]) {
  for (const hardStopPct of [0.40, 0.60, 0.80]) {
    for (const takeProfitPct of [0.25, 0.40, 0.60, 0.80]) {
      configurations.push({ maxHoldMinutes, hardStopPct, takeProfitPct });
    }
  }
}

function marketMinute(time) {
  const text = String(time ?? "").padStart(4, "0");
  const hours = Number(text.slice(0, 2));
  const minutes = Number(text.slice(2, 4));
  if (hours < 12) return (hours - 9) * 60 + minutes - 30;
  return 120 + (hours - 13) * 60 + minutes;
}

function roundLot(shares) {
  return Math.max(0, Math.floor(shares / 100) * 100);
}

function commission(turnover) {
  return Math.max(5, turnover * 0.00025);
}

function execute(side, quote, quantity) {
  const price = side === "buy" ? quote * 1.0002 : quote * 0.9998;
  const turnover = price * quantity;
  const fees = commission(turnover) + (side === "sell" ? turnover * 0.0005 : 0);
  return { price, turnover, fees };
}

function directionMove(direction, current, entry) {
  return direction === "正T"
    ? (current - entry) / entry * 100
    : (entry - current) / entry * 100;
}

function labelCandidate(points, candidateIndex, direction, quantity, config) {
  const entryPoint = points[candidateIndex + 1];
  if (!entryPoint || String(entryPoint.time) >= "1450") return null;
  const entrySide = direction === "正T" ? "buy" : "sell";
  const exitSide = direction === "正T" ? "sell" : "buy";
  const entry = execute(entrySide, Number(entryPoint.price), quantity);
  const entryMinute = marketMinute(entryPoint.time);
  let exitPoint = entryPoint;
  let reason = "expiry";
  for (let index = candidateIndex + 2; index < points.length; index += 1) {
    const point = points[index];
    if (!Number.isFinite(Number(point.price))) continue;
    const hold = marketMinute(point.time) - entryMinute;
    const move = directionMove(direction, Number(point.price), Number(entryPoint.price));
    exitPoint = point;
    if (move <= -config.hardStopPct) {
      reason = "hard-stop";
      break;
    }
    if (move >= config.takeProfitPct) {
      reason = "take-profit";
      break;
    }
    if (hold >= config.maxHoldMinutes) {
      reason = "expiry";
      break;
    }
    if (String(point.time) >= "1450") {
      reason = "force-close";
      break;
    }
  }
  const exit = execute(exitSide, Number(exitPoint.price), quantity);
  const gross = direction === "正T"
    ? exit.turnover - entry.turnover
    : entry.turnover - exit.turnover;
  const fees = entry.fees + exit.fees;
  return {
    entryTime: entryPoint.time,
    entryPrice: entry.price,
    exitTime: exitPoint.time,
    exitPrice: exit.price,
    holdMinutes: Math.max(0, marketMinute(exitPoint.time) - entryMinute),
    reason,
    gross: Number(gross.toFixed(4)),
    fees: Number(fees.toFixed(4)),
    net: Number((gross - fees).toFixed(4)),
    win: gross - fees > 0 ? 1 : 0,
  };
}

function key(config) {
  return `h${config.maxHoldMinutes}_s${String(config.hardStopPct).replace(".", "p")}_t${String(config.takeProfitPct).replace(".", "p")}`;
}

const reader = createInterface({ input: createReadStream(inputPath, "utf8"), crlfDelay: Infinity });
const output = createWriteStream(outputPath, "utf8");
let days = 0;
let candidates = 0;
let labels = 0;

for await (const line of reader) {
  if (!line.trim()) continue;
  const session = JSON.parse(line);
  const year = Number(String(session.date).slice(0, 4));
  if (year > 2025) continue;
  const points = (session.minutes ?? []).filter((point) => Number.isFinite(Number(point.price)));
  if (!points.length) continue;
  const indexByTime = new Map(points.map((point, index) => [point.time, index]));
  const referencePrice = Number(session.previousClose) || Number(points[0].price) || 10;
  const quantity = Math.max(300, roundLot(90_000 / referencePrice));
  const replay = runSmartTReplay(points, {
    capital: 200_000,
    baseShares: quantity,
    sellable: quantity,
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
  for (const observation of replay.observations ?? []) {
    if (observation.stage !== "candidate") continue;
    if (observation.direction !== "正T" && observation.direction !== "反T") continue;
    const index = indexByTime.get(observation.time);
    if (!Number.isInteger(index)) continue;
    const outcomes = {};
    for (const config of configurations) {
      const outcome = labelCandidate(points, index, observation.direction, quantity, config);
      if (outcome) outcomes[key(config)] = outcome;
    }
    if (!Object.keys(outcomes).length) continue;
    const row = {
      schemaVersion: 1,
      causalCandidate: true,
      nextMinuteExecution: true,
      date: String(session.date),
      year,
      time: observation.time,
      direction: observation.direction,
      quantity,
      outcomes,
    };
    if (!output.write(`${JSON.stringify(row)}\n`)) await once(output, "drain");
    candidates += 1;
    labels += Object.keys(outcomes).length;
  }
}

output.end();
await once(output, "finish");
console.error(JSON.stringify({
  days,
  candidates,
  candidateEventsPer100Days: Number((candidates / Math.max(1, days) * 100).toFixed(2)),
  labels,
  configurations: configurations.length,
  outputPath,
}));
