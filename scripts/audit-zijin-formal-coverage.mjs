#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { FORMAL_CLOSURE_FLOOR, PROFILES, runSmartTReplay } from "../lib/smart-t-engine.mjs";
import {
  addClosureReplayResult,
  createClosureDiagnosticsBucket,
  finalizeClosureDiagnosticsBucket,
} from "../lib/zijin-closure-diagnostics.mjs";

const [
  inputPath,
  profile = "灵敏档",
  volatilityMode = "fixed",
  profileOverridesArg = "{}",
  outputPath = null,
] = process.argv.slice(2);

if (!inputPath) {
  throw new Error("usage: node audit-zijin-formal-coverage.mjs SESSIONS.jsonl [PROFILE] [VOLATILITY_MODE] [PROFILE_OVERRIDES_JSON] [OUTPUT_JSON]");
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

const partitions = {
  training2022To2024: createClosureDiagnosticsBucket(),
  validation2025: createClosureDiagnosticsBucket(),
  holdout2026: createClosureDiagnosticsBucket(),
  overall: createClosureDiagnosticsBucket(),
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

  addClosureReplayResult(partitions.overall, result);
  if (year <= "2024") addClosureReplayResult(partitions.training2022To2024, result);
  else if (year === "2025") addClosureReplayResult(partitions.validation2025, result);
  else if (year === "2026") addClosureReplayResult(partitions.holdout2026, result);
}

const report = {
  schemaVersion: 1,
  mode: "research-only",
  affectsV4: false,
  profile,
  volatilityMode,
  profileOverrides,
  target: {
    cycleClosureRate: FORMAL_CLOSURE_FLOOR,
    cyclesPer100Days: FORMAL_CLOSURE_FLOOR * 100,
    description: "每100个评估股票日，至少形成25个扣费正式闭环",
  },
  partitions: Object.fromEntries(Object.entries(partitions)
    .map(([name, bucket]) => [name, finalizeClosureDiagnosticsBucket(bucket, { closureFloor: FORMAL_CLOSURE_FLOOR })])),
};

if (outputPath) await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
