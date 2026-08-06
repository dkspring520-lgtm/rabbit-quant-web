#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { FORMAL_CLOSURE_FLOOR, PROFILES, runSmartTReplay } from "../lib/smart-t-engine.mjs";

const [
  inputPath,
  profile = "灵敏档",
  volatilityMode = "fixed",
  profileOverridesArg = "{}",
] = process.argv.slice(2);

if (!inputPath) {
  throw new Error("usage: node audit-zijin-formal-coverage.mjs SESSIONS.jsonl [PROFILE] [VOLATILITY_MODE] [PROFILE_OVERRIDES_JSON]");
}

const profileOverrides = profileOverridesArg.startsWith("{")
  ? JSON.parse(profileOverridesArg)
  : Object.fromEntries(profileOverridesArg.split(",").filter(Boolean).map((entry) => {
    const [key, rawValue] = entry.split("=");
    const numericValue = Number(rawValue);
    return [key, Number.isFinite(numericValue) ? numericValue : rawValue];
  }));
const selectedProfile = PROFILES?.[profile];
if (!selectedProfile) throw new Error(`unknown profile: ${profile}`);
// Some replay controls deliberately stay opt-in rather than becoming a
// production-profile default.  Keep the audit strict for typos while allowing
// the current, versioned experiment to exercise those engine controls.
const EXPERIMENT_OVERRIDE_KEYS = new Set([
  "adaptiveTimeExit",
  "adaptiveMaxHoldMinutes",
  "adaptiveExitPivotBufferPct",
  "adaptiveExitMomentumPct",
  "obviousDirectionalErrorGate",
  "adaptiveExitMinSupportVotes",
  "adaptiveProtectIntactLoss",
  "sameDirectionWaveLock",
  "sameDirectionWaveMinGapMinutes",
  "sameDirectionWaveResetPct",
]);
const unknownOverrideKeys = Object.keys(profileOverrides)
  .filter((key) => !(key in selectedProfile) && !EXPERIMENT_OVERRIDE_KEYS.has(key));
if (unknownOverrideKeys.length > 0) {
  throw new Error(`unknown profile override(s): ${unknownOverrideKeys.join(", ")}`);
}

function emptyBucket() {
  return {
    days: 0,
    tradeDays: 0,
    cycles: 0,
    wins: 0,
    net: 0,
    gross: 0,
    fees: 0,
    executionCost: 0,
    slices: {
      direction: {},
      hour: {},
      regime: {},
      exit: {},
      trendRiskVotes: {},
    },
  };
}

function addSlice(target, key, net) {
  const bucket = target[key] ?? { cycles: 0, wins: 0, net: 0 };
  bucket.cycles += 1;
  bucket.wins += net > 0 ? 1 : 0;
  bucket.net += net;
  target[key] = bucket;
}

function exitClass(reason = "") {
  if (reason.includes("止盈") || reason.includes("profit")) return "take-profit";
  if (reason.includes("止损") || reason.includes("stop")) return "stop";
  if (reason.includes("时间") || reason.includes("time")) return "time-exit";
  if (reason.includes("14:50") || reason.includes("强制") || reason.includes("force")) return "force-close";
  return "other";
}

function addResult(bucket, result) {
  bucket.days += 1;
  bucket.tradeDays += result.trades > 0 ? 1 : 0;
  bucket.cycles += result.trades;
  bucket.wins += result.wins;
  bucket.net += result.net;
  bucket.gross += result.gross;
  bucket.fees += result.fees;
  bucket.executionCost += result.executionCost;

  for (let index = 0; index < result.cycleNets.length; index += 1) {
    const cycleId = index + 1;
    const net = result.cycleNets[index];
    const entry = result.actions.find((action) => action.cycleId === cycleId && action.meta?.phase === "entry");
    const exit = result.actions.find((action) => action.cycleId === cycleId && action.meta?.phase === "exit");
    addSlice(bucket.slices.direction, entry?.direction ?? "unknown", net);
    addSlice(bucket.slices.hour, entry?.time?.slice(0, 2) ?? "unknown", net);
    addSlice(bucket.slices.regime, entry?.meta?.regime ?? "unknown", net);
    addSlice(bucket.slices.trendRiskVotes, String(entry?.meta?.trendRiskVotes ?? "unknown"), net);
    addSlice(bucket.slices.exit, exitClass(exit?.reason), net);
  }
}

function finalizeSlice(slice) {
  return Object.fromEntries(Object.entries(slice)
    .map(([key, value]) => [key, {
      ...value,
      winRate: value.cycles ? value.wins / value.cycles : 0,
      averageNet: value.cycles ? Number((value.net / value.cycles).toFixed(2)) : 0,
      net: Number(value.net.toFixed(2)),
    }])
    .sort((left, right) => right[1].cycles - left[1].cycles));
}

function finalize(bucket) {
  return {
    ...bucket,
    net: Number(bucket.net.toFixed(2)),
    gross: Number(bucket.gross.toFixed(2)),
    fees: Number(bucket.fees.toFixed(2)),
    executionCost: Number(bucket.executionCost.toFixed(2)),
    cyclesPer100Days: bucket.days ? Number((bucket.cycles / bucket.days * 100).toFixed(2)) : 0,
    cycleClosureRate: bucket.days ? bucket.cycles / bucket.days : 0,
    meetsClosureFloor: bucket.days > 0 && bucket.cycles / bucket.days >= FORMAL_CLOSURE_FLOOR,
    tradeDayCoverage: bucket.days ? bucket.tradeDays / bucket.days : 0,
    winRate: bucket.cycles ? bucket.wins / bucket.cycles : 0,
    averageNetPerCycle: bucket.cycles ? Number((bucket.net / bucket.cycles).toFixed(2)) : 0,
    slices: Object.fromEntries(Object.entries(bucket.slices)
      .map(([name, slice]) => [name, finalizeSlice(slice)])),
  };
}

const partitions = {
  training2022To2024: emptyBucket(),
  validation2025: emptyBucket(),
  holdout2026: emptyBucket(),
  overall: emptyBucket(),
};

const reader = createInterface({
  input: createReadStream(inputPath, "utf8"),
  crlfDelay: Infinity,
});

for await (const line of reader) {
  if (!line.trim()) continue;
  const session = JSON.parse(line);
  const year = String(session.date).slice(0, 4);
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

  addResult(partitions.overall, result);
  if (year <= "2024") addResult(partitions.training2022To2024, result);
  else if (year === "2025") addResult(partitions.validation2025, result);
  else if (year === "2026") addResult(partitions.holdout2026, result);
}

console.log(JSON.stringify({
  profile,
  volatilityMode,
  profileOverrides,
  target: {
    cycleClosureRate: FORMAL_CLOSURE_FLOOR,
    cyclesPer100Days: FORMAL_CLOSURE_FLOOR * 100,
    description: "每100个评估股票日，至少形成25个扣费正式闭环",
  },
  partitions: Object.fromEntries(Object.entries(partitions)
    .map(([name, bucket]) => [name, finalize(bucket)])),
}, null, 2));
