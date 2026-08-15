#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { runSmartTReplay } from "../lib/smart-t-engine.mjs";
import { resolveResearchStrategyExperiment } from "../lib/zijin-strategy-experiments.mjs";

const [inputPath] = process.argv.slice(2);
if (!inputPath) {
  throw new Error("usage: node search-zijin-closure-v2-shadow.mjs SESSIONS.jsonl");
}

const CAPITAL = 200_000;
const FEE_RATE_PCT = 0.025;
const SLIPPAGE_PCT = 0.02;
const shadow = resolveResearchStrategyExperiment("601899", "closure-v2-shadow");

// Every candidate keeps fixed sizing and at least 2x estimated-cost coverage.
// Weak setups still reach the engine's observation ledger, but cannot execute.
const candidates = [
  { id: "approved-base", costCoverageMultiple: 2.00 },
  { id: "confirm-3-3", costCoverageMultiple: 2.00, minBuyExecutionConfirmationVotes: 3, minSellExecutionConfirmationVotes: 3 },
  { id: "confirm-3-4", costCoverageMultiple: 2.00, minBuyExecutionConfirmationVotes: 3, minSellExecutionConfirmationVotes: 4 },
  { id: "confirm-4-4", costCoverageMultiple: 2.00, minBuyExecutionConfirmationVotes: 4, minSellExecutionConfirmationVotes: 4 },
  { id: "sell-quality-1", costCoverageMultiple: 2.00, minBuyExecutionConfirmationVotes: 3, minSellExecutionConfirmationVotes: 3, maxSellTrendRiskVotes: 1, minSellFormalPivotAge: 2 },
  { id: "sell-quality-2", costCoverageMultiple: 2.00, minBuyExecutionConfirmationVotes: 3, minSellExecutionConfirmationVotes: 4, maxSellTrendRiskVotes: 1, minSellFormalPivotAge: 2 },
  { id: "sell-quality-3", costCoverageMultiple: 2.00, minBuyExecutionConfirmationVotes: 3, minSellExecutionConfirmationVotes: 4, maxSellTrendRiskVotes: 0, minSellFormalPivotAge: 3 },
  { id: "trend-guard-1", costCoverageMultiple: 2.00, minBuyExecutionConfirmationVotes: 3, minSellExecutionConfirmationVotes: 3, hardTrendContinuationGate: 1, hardSellEntryTimingGate: 1 },
  { id: "trend-guard-2", costCoverageMultiple: 2.00, minBuyExecutionConfirmationVotes: 3, minSellExecutionConfirmationVotes: 4, hardTrendContinuationGate: 1, hardSellEntryTimingGate: 1, hardSellTrendTimingConflictGate: 1 },
  { id: "trend-guard-3", costCoverageMultiple: 2.00, minBuyExecutionConfirmationVotes: 4, minSellExecutionConfirmationVotes: 4, hardTrendContinuationGate: 1, hardSellEntryTimingGate: 1, hardSellTrendTimingConflictGate: 1, requireRapidRiseSellConfirmation: 1 },
  { id: "cost-2.25", costCoverageMultiple: 2.25, minBuyExecutionConfirmationVotes: 3, minSellExecutionConfirmationVotes: 3 },
  { id: "cost-2.50", costCoverageMultiple: 2.50, minBuyExecutionConfirmationVotes: 3, minSellExecutionConfirmationVotes: 3 },
  { id: "cost-3.00", costCoverageMultiple: 3.00, minBuyExecutionConfirmationVotes: 3, minSellExecutionConfirmationVotes: 3 },
  { id: "buy-quality-1", costCoverageMultiple: 2.00, minBuyExecutionConfirmationVotes: 3, minSellExecutionConfirmationVotes: 3, minBuyFormalPivotAge: 2, minBuyPriceMomentum30: 0.50 },
  { id: "buy-quality-2", costCoverageMultiple: 2.00, minBuyExecutionConfirmationVotes: 4, minSellExecutionConfirmationVotes: 3, minBuyFormalPivotAge: 2, minBuyPriceMomentum30: 0.60 },
  { id: "balanced-quality", costCoverageMultiple: 2.00, minBuyExecutionConfirmationVotes: 3, minSellExecutionConfirmationVotes: 4, minBuyFormalPivotAge: 2, minSellFormalPivotAge: 2, maxSellTrendRiskVotes: 1, hardSellEntryTimingGate: 1, requireRapidRiseSellConfirmation: 1 },
  // Audit phase 2: reverse-T losses are concentrated in weak VWAP extensions.
  // Test only causal entry information and keep exits, sizing, and costs fixed.
  { id: "sell-vwap-0.55", costCoverageMultiple: 2.00, deviation: 0.55, minSellExecutionConfirmationVotes: 4 },
  { id: "sell-vwap-0.70", costCoverageMultiple: 2.00, deviation: 0.70, minSellExecutionConfirmationVotes: 4 },
  { id: "sell-vwap-0.85", costCoverageMultiple: 2.00, deviation: 0.85, minSellExecutionConfirmationVotes: 4 },
  { id: "sell-vwap-1.00", costCoverageMultiple: 2.00, deviation: 1.00, minSellExecutionConfirmationVotes: 4 },
  { id: "sell-cutoff-1000", costCoverageMultiple: 2.00, maxSellEntryTime: "1000", minSellExecutionConfirmationVotes: 4 },
  { id: "sell-cutoff-1030", costCoverageMultiple: 2.00, maxSellEntryTime: "1030", minSellExecutionConfirmationVotes: 4 },
  { id: "sell-cutoff-1030-vwap-0.55", costCoverageMultiple: 2.00, maxSellEntryTime: "1030", deviation: 0.55, minSellExecutionConfirmationVotes: 4 },
  { id: "sell-cutoff-1030-vwap-0.70", costCoverageMultiple: 2.00, maxSellEntryTime: "1030", deviation: 0.70, minSellExecutionConfirmationVotes: 4 },
  { id: "sell-volume-0.35", costCoverageMultiple: 2.00, minSellVolumeRatio: 0.35, minSellExecutionConfirmationVotes: 4 },
  { id: "sell-volume-0.50", costCoverageMultiple: 2.00, minSellVolumeRatio: 0.50, minSellExecutionConfirmationVotes: 4 },
  { id: "sell-volume-0.70", costCoverageMultiple: 2.00, minSellVolumeRatio: 0.70, minSellExecutionConfirmationVotes: 4 },
  { id: "sell-vwap-0.55-volume-0.35", costCoverageMultiple: 2.00, deviation: 0.55, minSellVolumeRatio: 0.35, minSellExecutionConfirmationVotes: 4 },
  { id: "sell-vwap-0.70-volume-0.35", costCoverageMultiple: 2.00, deviation: 0.70, minSellVolumeRatio: 0.35, minSellExecutionConfirmationVotes: 4 },
  { id: "sell-vwap-0.85-volume-0.50", costCoverageMultiple: 2.00, deviation: 0.85, minSellVolumeRatio: 0.50, minSellExecutionConfirmationVotes: 4 },
  { id: "sell-vwap-0.55-cost-3", costCoverageMultiple: 3.00, deviation: 0.55, minSellExecutionConfirmationVotes: 4 },
  { id: "sell-vwap-0.70-cost-3", costCoverageMultiple: 3.00, deviation: 0.70, minSellExecutionConfirmationVotes: 4 },
  // Audit phase 3: cap loss tails and test whether confirmed winners can run
  // farther. These remain isolated from production and are selected only on
  // data available before each walk-forward test year.
  { id: "hard-stop-0.60", costCoverageMultiple: 2.00, hardStopPct: 0.60 },
  { id: "hard-stop-0.75", costCoverageMultiple: 2.00, hardStopPct: 0.75 },
  { id: "hard-stop-0.90", costCoverageMultiple: 2.00, hardStopPct: 0.90 },
  { id: "soft-stop-0.25-10", costCoverageMultiple: 2.00, softStopPct: 0.25, softStopMinutes: 10 },
  { id: "soft-stop-0.30-12", costCoverageMultiple: 2.00, softStopPct: 0.30, softStopMinutes: 12 },
  { id: "soft-stop-0.40-10", costCoverageMultiple: 2.00, softStopPct: 0.40, softStopMinutes: 10 },
  { id: "trail-0.80-0.25-0.20", costCoverageMultiple: 2.00, trailActivationPct: 0.80, trailMinNetPct: 0.25, trailRetracePct: 0.20 },
  { id: "trail-1.00-0.30-0.25", costCoverageMultiple: 2.00, trailActivationPct: 1.00, trailMinNetPct: 0.30, trailRetracePct: 0.25 },
  { id: "trail-1.40-0.50-0.35", costCoverageMultiple: 2.00, trailActivationPct: 1.40, trailMinNetPct: 0.50, trailRetracePct: 0.35 },
  { id: "sell-cutoff-1030-cost-2.50", costCoverageMultiple: 2.50, maxSellEntryTime: "1030", minSellExecutionConfirmationVotes: 4 },
  { id: "sell-cutoff-1030-cost-3.00", costCoverageMultiple: 3.00, maxSellEntryTime: "1030", minSellExecutionConfirmationVotes: 4 },
  { id: "sell-cutoff-1030-vwap-0.55-cost-2.50", costCoverageMultiple: 2.50, maxSellEntryTime: "1030", deviation: 0.55, minSellExecutionConfirmationVotes: 4 },
];
const years = ["2022", "2023", "2024", "2025", "2026"];
const trainingCutoffs = ["2022", "2023", "2024", "2025"];
const partitions = [
  ...years.map((year) => `year${year}`),
  ...trainingCutoffs.map((year) => `through${year}`),
  "training",
  "validation",
  "holdout",
  "overall",
];
const totals = Object.fromEntries(candidates.map(({ id }) => [
  id,
  Object.fromEntries(partitions.map((partition) => [partition, {
    days: 0,
    cycles: 0,
    wins: 0,
    net: 0,
    gross: 0,
    fees: 0,
    executionCost: 0,
    winningNet: 0,
    losingNet: 0,
    candidateOpportunities: 0,
    candidateClosed: 0,
    equity: CAPITAL,
    peakEquity: CAPITAL,
    maxDrawdownAmount: 0,
    maxDrawdownRate: 0,
  }]))
]));

function partitionFor(date) {
  const year = String(date).slice(0, 4);
  if (year <= "2024") return "training";
  if (year === "2025") return "validation";
  return "holdout";
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

function minimumNetProfitAmount(price, shares, costCoverageMultiple) {
  const normalQuantity = roundLot(shares / 3);
  const estimatedCost = estimateRoundTripCost(price, normalQuantity);
  return estimatedCost * Math.max(0, costCoverageMultiple - 1);
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

function add(target, result) {
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
  target.days += 1;
  target.cycles += result.trades;
  target.wins += result.wins;
  target.net += result.net;
  target.gross += result.gross;
  target.fees += result.fees;
  target.executionCost += result.executionCost;
  target.candidateOpportunities += result.diagnostics?.researchCandidateOpportunities ?? 0;
  target.candidateClosed += result.diagnostics?.candidateCycles ?? 0;
  for (const net of result.cycleNets) {
    if (net > 0) target.winningNet += net;
    else if (net < 0) target.losingNet += net;
  }
}

const reader = createInterface({ input: createReadStream(inputPath, "utf8"), crlfDelay: Infinity });
for await (const line of reader) {
  if (!line.trim()) continue;
  const session = JSON.parse(line);
  const year = String(session.date).slice(0, 4);
  const partition = partitionFor(session.date);
  const referencePrice = Number(session.previousClose) || Number(session.minutes?.[0]?.price) || 10;
  const shares = Math.max(300, Math.floor((90_000 / referencePrice) / 100) * 100);
  const directionPermission = resolveExternalDirectionPermission(session);

  for (const candidate of candidates) {
    const { id, costCoverageMultiple, ...overrides } = candidate;
    const result = runSmartTReplay(session.minutes, {
      capital: CAPITAL,
      baseShares: shares,
      sellable: shares,
      feeRate: FEE_RATE_PCT,
      slippage: SLIPPAGE_PCT,
      minCommission: true,
      slippageMode: "percent",
      forceCloseTime: "1450",
      profile: shadow.profile,
      profileOverrides: { ...shadow.profileOverrides, ...overrides },
      positionSizeMode: "fixed",
      minimumNetProfitAmount: minimumNetProfitAmount(referencePrice, shares, costCoverageMultiple),
      volatilityMode: shadow.volatilityMode,
      previousClose: session.previousClose,
      randomValue: 0.5,
      directionPermission,
    });
    if (years.includes(year)) add(totals[id][`year${year}`], result);
    for (const cutoff of trainingCutoffs) {
      if (year <= cutoff) add(totals[id][`through${cutoff}`], result);
    }
    add(totals[id][partition], result);
    add(totals[id].overall, result);
  }
}

function finalize(value) {
  const losses = value.cycles - value.wins;
  return {
    closureRate: value.days ? value.cycles / value.days : 0,
    cycles: value.cycles,
    winRate: value.cycles ? value.wins / value.cycles : 0,
    net: Number(value.net.toFixed(2)),
    gross: Number(value.gross.toFixed(2)),
    fees: Number(value.fees.toFixed(2)),
    executionCost: Number(value.executionCost.toFixed(2)),
    totalCosts: Number((value.fees + value.executionCost).toFixed(2)),
    averageWin: value.wins ? Number((value.winningNet / value.wins).toFixed(2)) : 0,
    averageLoss: losses ? Number((value.losingNet / losses).toFixed(2)) : 0,
    payoffRatio: losses && value.wins
      ? Number(((value.winningNet / value.wins) / Math.abs(value.losingNet / losses)).toFixed(3))
      : 0,
    profitFactor: value.losingNet < 0
      ? Number((value.winningNet / Math.abs(value.losingNet)).toFixed(3))
      : value.winningNet > 0 ? Number.POSITIVE_INFINITY : 0,
    maxDrawdownAmount: Number(value.maxDrawdownAmount.toFixed(2)),
    maxDrawdownRate: Number(value.maxDrawdownRate.toFixed(6)),
    candidateOpportunities: value.candidateOpportunities,
    candidateClosureRate: value.candidateOpportunities
      ? Number((value.candidateClosed / value.candidateOpportunities).toFixed(6))
      : 0,
  };
}

const results = Object.fromEntries(Object.entries(totals).map(([id, values]) => [
  id,
  Object.fromEntries(Object.entries(values).map(([partition, value]) => [partition, finalize(value)])),
]));

const MIN_TRAINING_CYCLE_RETENTION = 0.60;

function robustnessFor(values, trainingPartition, trainingYears) {
  const training = values[trainingPartition];
  const annual = trainingYears.map((year) => values[`year${year}`]);
  const baselineCycles = results["approved-base"][trainingPartition].cycles;
  const minimumTrainingCycles = Math.max(1, Math.ceil(baselineCycles * MIN_TRAINING_CYCLE_RETENTION));
  return {
    minimumTrainingCycleRetention: MIN_TRAINING_CYCLE_RETENTION,
    minimumTrainingCycles,
    trainingCycleRetention: baselineCycles ? Number((training.cycles / baselineCycles).toFixed(6)) : 0,
    sufficientTrainingSample: training.cycles >= minimumTrainingCycles,
    positiveTrainingYears: annual.filter((value) => value.net > 0).length,
    activeTrainingYears: annual.filter((value) => value.cycles > 0).length,
    worstTrainingYearNet: Number(Math.min(...annual.map((value) => value.net)).toFixed(2)),
    stableTraining: training.cycles >= minimumTrainingCycles
      && training.net > 0
      && training.profitFactor > 1
      && annual.filter((value) => value.net > 0).length >= Math.min(2, trainingYears.length),
  };
}

function rankForTrainingPartition(entries, trainingPartition, trainingYears) {
  return [...entries].sort((left, right) => {
    const leftRobustness = robustnessFor(left.values, trainingPartition, trainingYears);
    const rightRobustness = robustnessFor(right.values, trainingPartition, trainingYears);
    if (rightRobustness.stableTraining !== leftRobustness.stableTraining) return rightRobustness.stableTraining ? 1 : -1;
    if (rightRobustness.sufficientTrainingSample !== leftRobustness.sufficientTrainingSample) return rightRobustness.sufficientTrainingSample ? 1 : -1;
    if (rightRobustness.positiveTrainingYears !== leftRobustness.positiveTrainingYears) {
      return rightRobustness.positiveTrainingYears - leftRobustness.positiveTrainingYears;
    }
    if (rightRobustness.worstTrainingYearNet !== leftRobustness.worstTrainingYearNet) {
      return rightRobustness.worstTrainingYearNet - leftRobustness.worstTrainingYearNet;
    }
    const leftTraining = left.values[trainingPartition];
    const rightTraining = right.values[trainingPartition];
    if ((rightTraining.net > 0) !== (leftTraining.net > 0)) return rightTraining.net > 0 ? 1 : -1;
    if (rightTraining.net !== leftTraining.net) return rightTraining.net - leftTraining.net;
    if (rightTraining.profitFactor !== leftTraining.profitFactor) return rightTraining.profitFactor - leftTraining.profitFactor;
    if (rightTraining.maxDrawdownRate !== leftTraining.maxDrawdownRate) return leftTraining.maxDrawdownRate - rightTraining.maxDrawdownRate;
    return rightTraining.winRate - leftTraining.winRate;
  });
}

const entries = Object.entries(results).map(([id, values]) => ({ id, values }));
const rankedEntries = rankForTrainingPartition(entries, "training", ["2022", "2023", "2024"]);
const ranked = rankedEntries.map(({ id, values }) => {
  const candidate = candidates.find((item) => item.id === id);
  const validationPartitions = [values.validation, values.holdout];
  return {
    id,
    costCoverageMultiple: candidate.costCoverageMultiple,
    profileOverrides: Object.fromEntries(Object.entries(candidate).filter(([key]) => !["id", "costCoverageMultiple"].includes(key))),
    fixedPositionSize: true,
    positiveValidationPartitions: validationPartitions.filter((value) => value.net > 0).length,
    trainingRobustness: robustnessFor(values, "training", ["2022", "2023", "2024"]),
    annual: Object.fromEntries(years.map((year) => [year, values[`year${year}`]])),
    training: values.training,
    validation: values.validation,
    holdout: values.holdout,
    overall: values.overall,
  };
});
const selectedOnTraining = ranked.find((candidate) => candidate.trainingRobustness.stableTraining) ?? null;

const walkForwardFolds = [
  { trainingPartition: "through2022", trainingYears: ["2022"], testYear: "2023" },
  { trainingPartition: "through2023", trainingYears: ["2022", "2023"], testYear: "2024" },
  { trainingPartition: "through2024", trainingYears: ["2022", "2023", "2024"], testYear: "2025" },
  { trainingPartition: "through2025", trainingYears: ["2022", "2023", "2024", "2025"], testYear: "2026" },
];
const walkForward = walkForwardFolds.map((fold) => {
  const foldRanked = rankForTrainingPartition(entries, fold.trainingPartition, fold.trainingYears);
  const selected = foldRanked.find(({ values }) => (
    robustnessFor(values, fold.trainingPartition, fold.trainingYears).stableTraining
  )) ?? null;
  const bestRejected = selected ? null : foldRanked[0];
  return {
    trainedThrough: fold.trainingYears.at(-1),
    testYear: fold.testYear,
    decision: selected ? "candidate-selected" : "no-stable-candidate",
    selectedCandidate: selected?.id ?? null,
    trainingRobustness: selected
      ? robustnessFor(selected.values, fold.trainingPartition, fold.trainingYears)
      : null,
    training: selected?.values[fold.trainingPartition] ?? null,
    outOfSample: selected?.values[`year${fold.testYear}`] ?? null,
    bestRejectedCandidate: bestRejected?.id ?? null,
    bestRejectedTrainingRobustness: bestRejected
      ? robustnessFor(bestRejected.values, fold.trainingPartition, fold.trainingYears)
      : null,
    bestRejectedTraining: bestRejected?.values[fold.trainingPartition] ?? null,
    bestRejectedOutOfSample: bestRejected?.values[`year${fold.testYear}`] ?? null,
  };
});

console.log(JSON.stringify({
  methodology: {
    selectionData: "Training folds only; validation and holdout never affect candidate ranking.",
    minimumTrainingCycleRetention: MIN_TRAINING_CYCLE_RETENTION,
    stabilityRule: "Select only with sufficient samples, positive after-cost training net, profit factor above 1, and at least two profitable training years. If none qualifies, return no candidate; win rate remains secondary.",
  },
  selectionDecision: selectedOnTraining ? "candidate-selected" : "no-stable-candidate",
  selectedOnTraining,
  bestRejectedOnTraining: selectedOnTraining ? null : ranked[0],
  walkForward,
  ranked,
}, null, 2));
