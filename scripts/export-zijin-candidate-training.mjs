#!/usr/bin/env node
/** Export causal candidate snapshots for walk-forward quality modelling. */

import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { runSmartTReplay } from "../lib/smart-t-engine.mjs";
import { calculateZijinEconomicThreshold } from "../lib/zijin-transaction-cost.mjs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("usage: node export-zijin-candidate-training.mjs SESSIONS.jsonl OUTPUT.jsonl");
}

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

function percentage(current, base) {
  return Number.isFinite(current) && Number.isFinite(base) && base !== 0
    ? (current - base) / base * 100
    : 0;
}

function rollingFeatures(points, index) {
  const current = points[index];
  const feature = {};
  for (const width of [1, 3, 5, 10, 15, 30]) {
    const base = points[Math.max(0, index - width)]?.price ?? current.price;
    feature[`return${width}`] = percentage(current.price, base);
  }
  for (const width of [3, 5, 10, 20]) {
    const visible = points.slice(Math.max(0, index - width + 1), index + 1);
    const previous = points.slice(Math.max(0, index - width * 2 + 1), Math.max(0, index - width + 1));
    const visibleVolume = visible.reduce((sum, point) => sum + (Number(point.volume) || 0), 0);
    const previousVolume = previous.reduce((sum, point) => sum + (Number(point.volume) || 0), 0);
    feature[`volumeRatio${width}`] = previousVolume > 0 ? visibleVolume / previousVolume : 1;
    const prices = visible.map((point) => Number(point.price)).filter(Number.isFinite);
    feature[`range${width}`] = prices.length
      ? percentage(Math.max(...prices), Math.min(...prices))
      : 0;
  }
  const visible = points.slice(0, index + 1);
  const sessionHigh = Math.max(...visible.map((point) => point.price));
  const sessionLow = Math.min(...visible.map((point) => point.price));
  feature.fromSessionHigh = percentage(current.price, sessionHigh);
  feature.fromSessionLow = percentage(current.price, sessionLow);
  feature.minuteIndex = index;
  return feature;
}

function outcomeMap(result) {
  return new Map((result.candidateOutcomes ?? []).map((outcome) => [
    `${outcome.time}|${outcome.direction}`,
    outcome,
  ]));
}

function simulateBarrier(points, index, direction, roundTripCostPct, {
  targetPct = 0.35,
  stopPct = 0.18,
  horizonMinutes = 20,
} = {}) {
  const entry = points[index + 1];
  if (!entry || !Number.isFinite(Number(entry.price))) return null;
  const entryPrice = Number(entry.price);
  const sign = direction === "正T" ? 1 : -1;
  const end = Math.min(points.length, index + horizonMinutes + 2);
  let exitPrice = Number(points[end - 1]?.price ?? entryPrice);
  let exitReason = "timeout";
  let holdingMinutes = Math.max(1, end - index - 1);
  for (let cursor = index + 2; cursor < end; cursor += 1) {
    const price = Number(points[cursor]?.price);
    if (!Number.isFinite(price)) continue;
    const grossPct = sign * (price - entryPrice) / entryPrice * 100;
    if (grossPct >= targetPct) {
      exitPrice = price;
      exitReason = "target";
      holdingMinutes = cursor - index - 1;
      break;
    }
    if (grossPct <= -stopPct) {
      exitPrice = price;
      exitReason = "stop";
      holdingMinutes = cursor - index - 1;
      break;
    }
  }
  const grossPct = sign * (exitPrice - entryPrice) / entryPrice * 100;
  const netPct = grossPct - roundTripCostPct;
  return { entryPrice, exitPrice, grossPct, netPct, exitReason, holdingMinutes };
}

const input = createInterface({ input: createReadStream(inputPath, "utf8"), crlfDelay: Infinity });
const output = createWriteStream(outputPath, "utf8");
let exported = 0;

for await (const line of input) {
  if (!line.trim()) continue;
  const session = JSON.parse(line);
  const year = Number(String(session.date).slice(0, 4));
  if (year > 2026) continue;
  const points = session.minutes ?? [];
  if (!points.length) continue;
  const referencePrice = Number(session.previousClose) || Number(points[0]?.price) || 10;
  const quantity = Math.max(300, Math.floor((90_000 / referencePrice) / 100) * 100);
  const replay = runSmartTReplay(points, {
    capital: 200_000,
    baseShares: quantity,
    sellable: quantity,
    feeRate: 0.025,
    slippage: 0.02,
    minCommission: true,
    slippageMode: "percent",
    forceCloseTime: "1450",
    profile: "灵敏档",
    profileOverrides,
    volatilityMode: "fixed",
    previousClose: session.previousClose,
    randomValue: 0.5,
  });
  const outcomes = outcomeMap(replay);
  const indexByTime = new Map(points.map((point, index) => [point.time, index]));

  for (const observation of replay.observations ?? []) {
    if (observation.stage !== "candidate") continue;
    const outcome = outcomes.get(`${observation.time}|${observation.direction}`);
    const horizon = outcome?.horizons?.find((item) => item.minutes === 15 && item.complete);
    const index = indexByTime.get(observation.time);
    if (!horizon || !Number.isInteger(index)) continue;
    const threshold = calculateZijinEconomicThreshold(observation.price, {
      quantity,
      minimumNetPct: 0,
      minimumNetYuan: 0,
      minimumGrossSpreadYuan: 0,
    });
    const barrier = simulateBarrier(
      points,
      index,
      observation.direction,
      threshold.roundTripCostPct,
    );
    if (!barrier) continue;
    const row = {
      date: String(session.date),
      year,
      time: observation.time,
      direction: observation.direction,
      price: observation.price,
      quantity,
      target15ReturnPct: horizon.returnPct,
      target15MfePct: horizon.mfePct,
      target15MaePct: horizon.maePct,
      roundTripCostPct: threshold.roundTripCostPct,
      netReturnPct: horizon.returnPct - threshold.roundTripCostPct,
      profitable: horizon.returnPct > threshold.roundTripCostPct ? 1 : 0,
      barrierTargetPct: 0.35,
      barrierStopPct: 0.18,
      barrierHorizonMinutes: 20,
      barrierEntryPrice: barrier.entryPrice,
      barrierExitPrice: barrier.exitPrice,
      barrierGrossPct: barrier.grossPct,
      barrierNetPct: barrier.netPct,
      barrierProfitable: barrier.netPct > 0 ? 1 : 0,
      barrierExitReason: barrier.exitReason,
      barrierHoldingMinutes: barrier.holdingMinutes,
      score: observation.score ?? 0,
      directionScore: observation.scoreBreakdown?.direction ?? 0,
      locationScore: observation.scoreBreakdown?.location ?? 0,
      triggerScore: observation.scoreBreakdown?.trigger ?? 0,
      locationPassed: observation.scoreBreakdown?.passed?.location ? 1 : 0,
      triggerPassed: observation.scoreBreakdown?.passed?.trigger ? 1 : 0,
      cycleAligned: observation.cycleAligned ? 1 : 0,
      edge: observation.edge ?? 0,
      pairGap: observation.pairGap ?? 0,
      vwapDeviation: observation.vwapDeviation ?? 0,
      pivotVwapDeviation: observation.pivotVwapDeviation ?? 0,
      similaritySamples: observation.similarity?.samples ?? 0,
      blockers: observation.blockers?.length ?? 0,
      alignedDivergence: observation.divergenceShadow?.aligned?.aligned ? 1 : 0,
      divergenceStrength: observation.divergenceShadow?.aligned?.strength ?? 0,
      opposingDivergence: observation.divergenceShadow?.opposing?.aligned ? 1 : 0,
      alignedPivotAge: observation.divergenceShadow?.aligned?.pivot?.age ?? 0,
      alignedVolumeConfirmed: observation.divergenceShadow?.aligned?.volumePrice?.confirmed ? 1 : 0,
      alignedVolumeRatio: observation.divergenceShadow?.aligned?.volumePrice?.volumeRatio ?? 0,
      alignedPriceExtensionPct: observation.divergenceShadow?.aligned?.volumePrice?.priceExtensionPct ?? 0,
      alignedMacdConfirmed: observation.divergenceShadow?.aligned?.macd?.confirmed ? 1 : 0,
      alignedMacdImprovementPct: observation.divergenceShadow?.aligned?.macd?.improvementPct ?? 0,
      opposingPivotAge: observation.divergenceShadow?.opposing?.pivot?.age ?? 0,
      opposingVolumeConfirmed: observation.divergenceShadow?.opposing?.volumePrice?.confirmed ? 1 : 0,
      opposingVolumeRatio: observation.divergenceShadow?.opposing?.volumePrice?.volumeRatio ?? 0,
      opposingPriceExtensionPct: observation.divergenceShadow?.opposing?.volumePrice?.priceExtensionPct ?? 0,
      opposingMacdConfirmed: observation.divergenceShadow?.opposing?.macd?.confirmed ? 1 : 0,
      opposingMacdImprovementPct: observation.divergenceShadow?.opposing?.macd?.improvementPct ?? 0,
      rangeConfirmed: observation.rangeEvidence?.confirmed ? 1 : 0,
      rangeCrossings: observation.rangeEvidence?.crossings ?? 0,
      rangeAmplitude: observation.rangeEvidence?.amplitude ?? 0,
      rangeVwapDrift: observation.rangeEvidence?.vwapDrift ?? 0,
      cyclePreference: observation.cyclePreference ?? "unknown",
      pivotAssessment: observation.pivotAssessment ?? "unknown",
      ...rollingFeatures(points, index),
    };
    if (!output.write(`${JSON.stringify(row)}\n`)) await once(output, "drain");
    exported += 1;
  }
}

output.end();
await once(output, "finish");
console.error(JSON.stringify({ exported, outputPath }));
