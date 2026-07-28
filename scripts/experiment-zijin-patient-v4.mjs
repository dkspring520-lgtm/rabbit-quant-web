#!/usr/bin/env node
/**
 * Preregistered Zijin V4 patience experiment.
 *
 * 2022-2024: research partition
 * 2025: validation partition
 * 2026: frozen holdout, evaluated only when a fixed candidate passes both
 * earlier partitions after costs. Every replay remains minute-causal.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { runSmartTReplay } from "../lib/smart-t-engine.mjs";

const [inputPath] = process.argv.slice(2);
if (!inputPath) throw new Error("usage: node experiment-zijin-patient-v4.mjs SESSIONS.jsonl");

const CONFIGS = [
  { id: "baseline", label: "当前灵敏档", overrides: {} },
  { id: "hold-48", label: "最长持有48分钟", overrides: { timeExitMinutes: 48, softStopMinutes: 22 } },
  { id: "hold-60", label: "最长持有60分钟", overrides: { timeExitMinutes: 60, softStopMinutes: 26 } },
  {
    id: "quality",
    label: "只保留较大价差与高确认度",
    overrides: { score: 5, candidateNetPct: 0.48, deviation: 0.75, minRewardRisk: 1.55 },
  },
  {
    id: "quality-hold-48",
    label: "高质量入场+最长持有48分钟",
    overrides: { score: 5, candidateNetPct: 0.48, deviation: 0.75, minRewardRisk: 1.55, timeExitMinutes: 48, softStopMinutes: 22 },
  },
  {
    id: "quality-hold-60",
    label: "高质量入场+最长持有60分钟",
    overrides: { score: 5, candidateNetPct: 0.48, deviation: 0.75, minRewardRisk: 1.55, timeExitMinutes: 60, softStopMinutes: 26 },
  },
];

function emptyMetrics() {
  return { days: 0, cycles: 0, wins: 0, gross: 0, fees: 0, slippage: 0, net: 0, holdMinutes: 0 };
}

function add(metrics, replay) {
  metrics.days += 1;
  metrics.cycles += replay.trades;
  metrics.wins += replay.wins;
  metrics.gross += replay.gross;
  metrics.fees += replay.fees;
  metrics.slippage += replay.executionCost;
  metrics.net += replay.net;
  for (const action of replay.actions) {
    if (action.meta?.phase === "exit") metrics.holdMinutes += Number(action.meta.hold) || 0;
  }
}

function finish(metrics) {
  const round = (value) => Number(value.toFixed(2));
  return {
    days: metrics.days,
    cycles: metrics.cycles,
    wins: metrics.wins,
    winRate: metrics.cycles ? round(metrics.wins / metrics.cycles * 100) : 0,
    coverage: metrics.days ? round(metrics.cycles / metrics.days * 100) : 0,
    averageHoldMinutes: metrics.cycles ? round(metrics.holdMinutes / metrics.cycles) : 0,
    gross: round(metrics.gross),
    fees: round(metrics.fees),
    slippage: round(metrics.slippage),
    net: round(metrics.net),
    averageNetPerCycle: metrics.cycles ? round(metrics.net / metrics.cycles) : 0,
  };
}

const sessions = [];
const reader = createInterface({ input: createReadStream(inputPath, "utf8"), crlfDelay: Infinity });
for await (const line of reader) {
  if (line.trim()) sessions.push(JSON.parse(line));
}

function replayConfig(config, includeHoldout = false) {
  const partitions = { research2022To2024: emptyMetrics(), validation2025: emptyMetrics(), holdout2026: emptyMetrics() };
  for (const session of sessions) {
    const year = Number(String(session.date).slice(0, 4));
    if (year === 2026 && !includeHoldout) continue;
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
      profile: "灵敏档",
      profileOverrides: config.overrides,
      previousClose: session.previousClose,
      randomValue: 0.5,
    });
    const target = year <= 2024
      ? partitions.research2022To2024
      : year === 2025
        ? partitions.validation2025
        : partitions.holdout2026;
    add(target, replay);
  }
  return Object.fromEntries(Object.entries(partitions).map(([key, value]) => [key, finish(value)]));
}

const candidates = CONFIGS.map((config) => ({ ...config, partitions: replayConfig(config, false) }));
for (const candidate of candidates) {
  const research = candidate.partitions.research2022To2024;
  const validation = candidate.partitions.validation2025;
  candidate.passesGate = research.cycles >= 30
    && validation.cycles >= 10
    && research.net > 0
    && validation.net > 0
    && research.winRate >= 50
    && validation.winRate >= 50;
}

const selected = candidates
  .filter((candidate) => candidate.passesGate)
  .sort((left, right) => right.partitions.validation2025.net - left.partitions.validation2025.net)[0] ?? null;

let holdout = null;
if (selected) holdout = replayConfig(selected, true).holdout2026;

console.log(JSON.stringify({
  protocol: {
    causal: true,
    futureMinutesRead: false,
    research: "2022-2024",
    validation: "2025",
    frozenHoldout: "2026 through 2026-04-17",
    holdoutOpened: Boolean(selected),
    costs: "commission 0.025%, minimum ¥5, stamp tax and 0.02% two-sided slippage",
    fixedHypotheses: CONFIGS.length,
  },
  candidates,
  selected: selected ? { id: selected.id, label: selected.label, holdout2026: holdout } : null,
  conclusion: selected
    ? "A preregistered candidate passed research and 2025 validation; 2026 holdout was opened once."
    : "No candidate passed both research and 2025 validation after costs; 2026 remains unopened.",
}, null, 2));

