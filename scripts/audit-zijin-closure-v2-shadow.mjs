#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

import { normalizeQmtOrderFlow } from "../lib/qmt-orderflow-confirmation.mjs";
import { FORMAL_CLOSURE_FLOOR, runSmartTReplay } from "../lib/smart-t-engine.mjs";
import {
  addClosureReplayResult,
  createClosureDiagnosticsBucket,
  finalizeClosureDiagnosticsBucket,
} from "../lib/zijin-closure-diagnostics.mjs";
import {
  resolveBacktestStrategyExperiment,
  resolveResearchStrategyExperiment,
} from "../lib/zijin-strategy-experiments.mjs";

const [inputPath, outputPath = null] = process.argv.slice(2);
if (!inputPath) {
  throw new Error("usage: node audit-zijin-closure-v2-shadow.mjs SESSIONS.jsonl [OUTPUT_JSON]");
}

const CAPITAL = 200_000;
const FEE_RATE_PCT = 0.025;
const SLIPPAGE_PCT = 0.02;
const experiments = Object.freeze({
  baseline: resolveBacktestStrategyExperiment("601899", "closure-first"),
  shadow: resolveResearchStrategyExperiment("601899", "closure-v2-shadow"),
});
const partitionNames = ["training2022To2024", "validation2025", "holdout2026", "overall"];
const buckets = Object.fromEntries(Object.keys(experiments).map((experimentName) => [
  experimentName,
  Object.fromEntries(partitionNames.map((partitionName) => [
    partitionName,
    createClosureDiagnosticsBucket(),
  ])),
]));
const performanceBuckets = Object.fromEntries(Object.keys(experiments).map((experimentName) => [
  experimentName,
  Object.fromEntries(partitionNames.map((partitionName) => [partitionName, {
    cycles: 0,
    wins: 0,
    winningNet: 0,
    losingNet: 0,
    equity: CAPITAL,
    peakEquity: CAPITAL,
    maxDrawdownAmount: 0,
    maxDrawdownRate: 0,
  }]))
]));
const inputCoverage = {
  sessions: 0,
  marketSectorConfirmedSessions: 0,
  explicitDirectionPermissionSessions: 0,
  l2Sessions: 0,
  minutes: 0,
  l2Minutes: 0,
};

function partitionForYear(year) {
  if (year <= "2024") return "training2022To2024";
  if (year === "2025") return "validation2025";
  return "holdout2026";
}

function roundLot(value) {
  return Math.max(0, Math.floor(Number(value) / 100) * 100);
}

function estimateRoundTripCost(price, quantity) {
  const turnover = Number(price) * Number(quantity);
  const commission = Math.max(5, turnover * FEE_RATE_PCT / 100);
  const stampTax = turnover * 0.0005;
  const slippage = turnover * SLIPPAGE_PCT / 100 * 2;
  return commission * 2 + stampTax + slippage;
}

function shadowMinimumNetProfitAmount(price, shares) {
  const normalQuantity = roundLot(shares / 3);
  const coverageMultiple = Math.max(2, Number(experiments.shadow.executionPolicy?.minimumCostCoverageMultiple) || 2);
  return estimateRoundTripCost(price, normalQuantity) * (coverageMultiple - 1);
}

function normalizeDirection(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (["up", "uptrend", "bull", "bullish", "多", "强多"].includes(text)) return "up";
  if (["down", "downtrend", "bear", "bearish", "空", "强空"].includes(text)) return "down";
  if (["range", "sideways", "neutral", "震荡", "中性"].includes(text)) return "range";
  return null;
}

function resolveExternalDirectionPermission(session) {
  if (session.directionPermission && typeof session.directionPermission === "object") {
    return { ...session.directionPermission, mode: "formal-guard" };
  }
  const market = normalizeDirection(session.marketRegime ?? session.market?.regime);
  const sector = normalizeDirection(session.sectorDirection ?? session.sector?.direction);
  if (!market || !sector) return null;
  const aligned = market === sector ? market : null;
  return {
    enabled: true,
    mode: "formal-guard",
    status: aligned ? "confirmed" : "blocked",
    allowedDirections: aligned === "up" ? ["正T"] : aligned === "down" ? ["反T"] : aligned === "range" ? ["正T", "反T"] : [],
    expiresAt: "1500",
    reason: aligned ? `大盘与板块方向一致：${aligned}` : "大盘与板块方向冲突",
  };
}

function recordInputCoverage(session) {
  inputCoverage.sessions += 1;
  const market = normalizeDirection(session.marketRegime ?? session.market?.regime);
  const sector = normalizeDirection(session.sectorDirection ?? session.sector?.direction);
  if (market && sector) inputCoverage.marketSectorConfirmedSessions += 1;
  if (session.directionPermission && typeof session.directionPermission === "object") {
    inputCoverage.explicitDirectionPermissionSessions += 1;
  }
  let sessionHasL2 = false;
  for (const minute of session.minutes ?? []) {
    inputCoverage.minutes += 1;
    const flow = normalizeQmtOrderFlow(minute);
    const active = (flow.activeBuyVolume ?? 0) + (flow.activeSellVolume ?? 0);
    if (active > 0) {
      inputCoverage.l2Minutes += 1;
      sessionHasL2 = true;
    }
  }
  if (sessionHasL2) inputCoverage.l2Sessions += 1;
}

function addPerformanceResult(target, result) {
  const sessionStartEquity = target.equity;
  for (const replayEquity of result.curve) {
    const equity = sessionStartEquity + (Number(replayEquity) - CAPITAL);
    target.peakEquity = Math.max(target.peakEquity, equity);
    const drawdownAmount = target.peakEquity - equity;
    const drawdownRate = target.peakEquity > 0 ? drawdownAmount / target.peakEquity : 0;
    target.maxDrawdownAmount = Math.max(target.maxDrawdownAmount, drawdownAmount);
    target.maxDrawdownRate = Math.max(target.maxDrawdownRate, drawdownRate);
  }
  target.equity = sessionStartEquity + result.net;
  target.cycles += result.trades;
  target.wins += result.wins;
  for (const net of result.cycleNets) {
    if (net > 0) target.winningNet += net;
    else if (net < 0) target.losingNet += net;
  }
}

function finalizePerformance(value) {
  return {
    afterCostNet: Number((value.equity - CAPITAL).toFixed(2)),
    profitFactor: value.losingNet < 0
      ? Number((value.winningNet / Math.abs(value.losingNet)).toFixed(3))
      : value.winningNet > 0 ? Number.POSITIVE_INFINITY : 0,
    maxDrawdownAmount: Number(value.maxDrawdownAmount.toFixed(2)),
    maxDrawdownRate: Number(value.maxDrawdownRate.toFixed(6)),
    winRate: value.cycles ? value.wins / value.cycles : 0,
  };
}

const reader = createInterface({
  input: createReadStream(inputPath, "utf8"),
  crlfDelay: Infinity,
});

for await (const line of reader) {
  if (!line.trim()) continue;
  const session = JSON.parse(line);
  recordInputCoverage(session);
  const partitionName = partitionForYear(String(session.date).slice(0, 4));
  const referencePrice = Number(session.previousClose) || Number(session.minutes?.[0]?.price) || 10;
  const shares = Math.max(300, Math.floor((90_000 / referencePrice) / 100) * 100);
  const directionPermission = resolveExternalDirectionPermission(session);

  for (const [experimentName, experiment] of Object.entries(experiments)) {
    const isShadow = experimentName === "shadow";
    const result = runSmartTReplay(session.minutes, {
      capital: CAPITAL,
      baseShares: shares,
      sellable: shares,
      feeRate: FEE_RATE_PCT,
      slippage: SLIPPAGE_PCT,
      minCommission: true,
      slippageMode: "percent",
      forceCloseTime: "1450",
      profile: experiment.profile,
      profileOverrides: experiment.profileOverrides,
      positionSizeMode: "fixed",
      minimumNetProfitAmount: isShadow ? shadowMinimumNetProfitAmount(referencePrice, shares) : 0,
      volatilityMode: experiment.volatilityMode,
      previousClose: session.previousClose,
      randomValue: 0.5,
      directionPermission: isShadow ? directionPermission : null,
    });
    addClosureReplayResult(buckets[experimentName][partitionName], result);
    addClosureReplayResult(buckets[experimentName].overall, result);
    addPerformanceResult(performanceBuckets[experimentName][partitionName], result);
    addPerformanceResult(performanceBuckets[experimentName].overall, result);
  }
}

const results = Object.fromEntries(Object.entries(buckets).map(([experimentName, partitions]) => [
  experimentName,
  Object.fromEntries(Object.entries(partitions).map(([partitionName, bucket]) => [partitionName, {
    ...finalizeClosureDiagnosticsBucket(bucket, { closureFloor: FORMAL_CLOSURE_FLOOR }),
    ...finalizePerformance(performanceBuckets[experimentName][partitionName]),
  }])),
]));

const comparisons = Object.fromEntries(partitionNames.map((partitionName) => {
  const baseline = results.baseline[partitionName];
  const shadow = results.shadow[partitionName];
  return [partitionName, {
    afterCostNetDelta: Number((shadow.afterCostNet - baseline.afterCostNet).toFixed(2)),
    profitFactorDelta: Number((shadow.profitFactor - baseline.profitFactor).toFixed(3)),
    maxDrawdownRateDelta: Number((shadow.maxDrawdownRate - baseline.maxDrawdownRate).toFixed(6)),
    winRateDelta: shadow.winRate - baseline.winRate,
    improvesAfterCostNet: shadow.afterCostNet >= baseline.afterCostNet,
    improvesProfitFactor: shadow.profitFactor >= baseline.profitFactor,
    improvesMaxDrawdown: shadow.maxDrawdownRate <= baseline.maxDrawdownRate,
  }];
}));
const evaluationPartitions = ["training2022To2024", "validation2025", "holdout2026"];
const researchCriteriaMet = evaluationPartitions.every((partitionName) => {
  const comparison = comparisons[partitionName];
  const shadow = results.shadow[partitionName];
  return comparison.improvesAfterCostNet
    && comparison.improvesProfitFactor
    && comparison.improvesMaxDrawdown
    && shadow.afterCostNet > 0;
});
const externalConfirmationCoverageComplete = inputCoverage.sessions > 0
  && inputCoverage.marketSectorConfirmedSessions === inputCoverage.sessions
  && inputCoverage.l2Sessions === inputCoverage.sessions;

const report = {
  schemaVersion: 2,
  mode: "research-only-shadow",
  affectsProduction: false,
  productionStrategy: experiments.baseline.id,
  shadowStrategy: experiments.shadow.id,
  methodology: {
    selection: "Candidate parameters are selected on 2022-2024 training data by after-cost net, profit factor, and max drawdown; win rate is secondary.",
    validation: "The frozen candidate is then evaluated on 2025 validation and 2026 holdout data.",
    costs: "Commission 0.025%, minimum CNY 5, stamp tax, and fixed 0.02% two-sided slippage. Formal entries must estimate gross spread of at least 2x round-trip cost.",
    positionSizing: "Fixed normal size only; weak signals remain observations and do not receive reduced sizing.",
    directionQuality: "Afternoon reverse-T is disabled. Causal regime/VWAP gates are always active; market, sector, and L2 confirmations are enforced when supplied by the replay input.",
    causal: true,
  },
  inputCoverage: {
    ...inputCoverage,
    marketSectorSessionRate: inputCoverage.sessions ? inputCoverage.marketSectorConfirmedSessions / inputCoverage.sessions : 0,
    l2SessionRate: inputCoverage.sessions ? inputCoverage.l2Sessions / inputCoverage.sessions : 0,
    l2MinuteRate: inputCoverage.minutes ? inputCoverage.l2Minutes / inputCoverage.minutes : 0,
    externalConfirmationCoverageComplete,
  },
  promotion: {
    eligible: false,
    researchCriteriaMet,
    decision: "keep-shadow-only",
    rule: "Shadow research cannot auto-promote. Positive after-cost net, improved profit factor, lower max drawdown in every partition, and complete market/sector/L2 coverage are required before manual review.",
    blockedByExternalDataCoverage: !externalConfirmationCoverageComplete,
  },
  comparisons,
  results,
};

if (outputPath) await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
