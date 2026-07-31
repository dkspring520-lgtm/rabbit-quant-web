#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { runSmartTReplay } from "../lib/smart-t-engine.mjs";

const [inputPath, profile = "灵敏档", volatilityMode = "fixed", profileOverridesArg = "{}"] = process.argv.slice(2);
if (!inputPath) throw new Error("usage: node benchmark-zijin-smart-t.mjs SESSIONS.jsonl [PROFILE] [VOLATILITY_MODE] [PROFILE_OVERRIDES_JSON]");
const profileOverrides = profileOverridesArg.startsWith("{")
  ? JSON.parse(profileOverridesArg)
  : Object.fromEntries(profileOverridesArg.split(",").filter(Boolean).map((entry) => {
    const [key, rawValue] = entry.split("=");
    const numericValue = Number(rawValue);
    return [key, Number.isFinite(numericValue) ? numericValue : rawValue];
  }));

function emptyMetrics() {
  const horizonBuckets = () => Object.fromEntries([5, 15, 30].map((minutes) => [minutes, {
    samples: 0,
    positive: 0,
    returnPct: 0,
    mfePct: 0,
    maePct: 0,
  }]));
  return {
    days: 0,
    tradeDays: 0,
    profitableDays: 0,
    losingDays: 0,
    cycles: 0,
    wins: 0,
    losses: 0,
    gross: 0,
    fees: 0,
    slippage: 0,
    net: 0,
    candidates: 0,
    observations: 0,
    pairedCandidateCycles: 0,
    pairedCandidateGrossPct: 0,
    pairedCandidateMfePct: 0,
    pairedCandidateMaePct: 0,
    pairedCandidateHoldingMinutes: 0,
    candidateHorizons: horizonBuckets(),
    candidateHorizonsByDirection: {},
    maxIntradayDrawdown: 0,
    byDirection: {},
  };
}

function addDirection(metrics, direction, net) {
  const key = direction || "未知";
  metrics.byDirection[key] ??= { cycles: 0, wins: 0, losses: 0, net: 0 };
  const bucket = metrics.byDirection[key];
  bucket.cycles += 1;
  bucket.wins += net > 0 ? 1 : 0;
  bucket.losses += net > 0 ? 0 : 1;
  bucket.net += net;
}

function addSession(metrics, result) {
  metrics.days += 1;
  metrics.tradeDays += result.trades > 0 ? 1 : 0;
  metrics.profitableDays += result.net > 0 ? 1 : 0;
  metrics.losingDays += result.net < 0 ? 1 : 0;
  metrics.cycles += result.trades;
  metrics.wins += result.wins;
  metrics.losses += result.trades - result.wins;
  metrics.gross += result.gross;
  metrics.fees += result.fees;
  metrics.slippage += result.executionCost;
  metrics.net += result.net;
  metrics.candidates += result.diagnostics?.candidates ?? 0;
  metrics.observations += result.observations?.length ?? 0;
  for (const cycle of result.candidateCycles ?? []) {
    metrics.pairedCandidateCycles += 1;
    metrics.pairedCandidateGrossPct += cycle.grossPct ?? 0;
    metrics.pairedCandidateMfePct += cycle.mfePct ?? 0;
    metrics.pairedCandidateMaePct += cycle.maePct ?? 0;
    metrics.pairedCandidateHoldingMinutes += cycle.holdingMinutes ?? 0;
  }
  for (const outcome of result.candidateOutcomes ?? []) {
    metrics.candidateHorizonsByDirection[outcome.direction] ??= Object.fromEntries([5, 15, 30].map((minutes) => [minutes, {
      samples: 0,
      positive: 0,
      returnPct: 0,
      mfePct: 0,
      maePct: 0,
    }]));
    for (const horizon of outcome.horizons ?? []) {
      if (!horizon.complete || !metrics.candidateHorizons[horizon.minutes]) continue;
      const bucket = metrics.candidateHorizons[horizon.minutes];
      const directionBucket = metrics.candidateHorizonsByDirection[outcome.direction][horizon.minutes];
      for (const target of [bucket, directionBucket]) {
        target.samples += 1;
        target.positive += horizon.returnPct > 0 ? 1 : 0;
        target.returnPct += horizon.returnPct ?? 0;
        target.mfePct += horizon.mfePct ?? 0;
        target.maePct += horizon.maePct ?? 0;
      }
    }
  }
  metrics.maxIntradayDrawdown = Math.max(metrics.maxIntradayDrawdown, result.maxDrawdown ?? 0);
  for (let index = 0; index < result.cycleNets.length; index += 1) {
    const cycleId = index + 1;
    const entry = result.actions.find((action) => action.cycleId === cycleId && action.meta?.phase === "entry");
    addDirection(metrics, entry?.direction, result.cycleNets[index]);
  }
}

function finalize(metrics) {
  const rounded = (value) => Number(value.toFixed(2));
  const finalizeHorizons = (horizons) => Object.fromEntries(Object.entries(horizons).map(([minutes, item]) => [minutes, {
    samples: item.samples,
    positiveRate: item.samples ? item.positive / item.samples : 0,
    averageReturnPct: item.samples ? rounded(item.returnPct / item.samples) : 0,
    averageMfePct: item.samples ? rounded(item.mfePct / item.samples) : 0,
    averageMaePct: item.samples ? rounded(item.maePct / item.samples) : 0,
  }]));
  return {
    ...metrics,
    tradeDayCoverage: metrics.days ? metrics.tradeDays / metrics.days : 0,
    cycleWinRate: metrics.cycles ? metrics.wins / metrics.cycles : 0,
    profitableDayRate: metrics.days ? metrics.profitableDays / metrics.days : 0,
    averageNetPerCycle: metrics.cycles ? rounded(metrics.net / metrics.cycles) : 0,
    pairedCandidateAverageGrossPct: metrics.pairedCandidateCycles ? rounded(metrics.pairedCandidateGrossPct / metrics.pairedCandidateCycles) : 0,
    pairedCandidateAverageMfePct: metrics.pairedCandidateCycles ? rounded(metrics.pairedCandidateMfePct / metrics.pairedCandidateCycles) : 0,
    pairedCandidateAverageMaePct: metrics.pairedCandidateCycles ? rounded(metrics.pairedCandidateMaePct / metrics.pairedCandidateCycles) : 0,
    pairedCandidateAverageHoldingMinutes: metrics.pairedCandidateCycles ? rounded(metrics.pairedCandidateHoldingMinutes / metrics.pairedCandidateCycles) : 0,
    candidateHorizons: finalizeHorizons(metrics.candidateHorizons),
    candidateHorizonsByDirection: Object.fromEntries(Object.entries(metrics.candidateHorizonsByDirection).map(([direction, horizons]) => [direction, finalizeHorizons(horizons)])),
    gross: rounded(metrics.gross),
    fees: rounded(metrics.fees),
    slippage: rounded(metrics.slippage),
    net: rounded(metrics.net),
    byDirection: Object.fromEntries(Object.entries(metrics.byDirection).map(([key, item]) => [key, {
      ...item,
      winRate: item.cycles ? item.wins / item.cycles : 0,
      net: rounded(item.net),
      averageNet: item.cycles ? rounded(item.net / item.cycles) : 0,
    }])),
  };
}

const overall = emptyMetrics();
const selection = emptyMetrics();
const holdout = emptyMetrics();
const byYear = {};
const reader = createInterface({ input: createReadStream(inputPath, "utf8"), crlfDelay: Infinity });

for await (const line of reader) {
  if (!line.trim()) continue;
  const session = JSON.parse(line);
  const referencePrice = Number(session.previousClose) || Number(session.minutes?.[0]?.price) || 10;
  const shares = Math.max(300, Math.floor((90_000 / referencePrice) / 100) * 100);
  const result = runSmartTReplay(session.minutes, {
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
    volatilityMode,
    previousClose: session.previousClose,
    randomValue: 0.5,
  });
  const year = String(session.date).slice(0, 4);
  byYear[year] ??= emptyMetrics();
  addSession(overall, result);
  addSession(byYear[year], result);
  addSession(year === "2026" ? holdout : selection, result);
}

console.log(JSON.stringify({
  profile,
  profileOverrides,
  volatilityMode,
  methodology: {
    causal: true,
    futureMinutesRead: false,
    execution: "signal minute t uses only t and earlier; fills follow engine execution rules",
    costs: "commission 0.025%, minimum ¥5, stamp tax, 0.02% two-sided slippage",
    maxFormalCyclesPerStockDay: 1,
    candidateOutcome: "research-only fixed 5/15/30-minute endpoints plus MFE/MAE; incomplete tail windows stay open and outcomes never feed the signal",
  },
  selection2022To2025: finalize(selection),
  holdout2026ThroughApril17: finalize(holdout),
  overall: finalize(overall),
  byYear: Object.fromEntries(Object.entries(byYear).map(([year, metrics]) => [year, finalize(metrics)])),
}, null, 2));
