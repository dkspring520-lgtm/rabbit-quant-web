import { readFile } from "node:fs/promises";
import { runSmartTReplay } from "../lib/smart-t-engine.mjs";

const files = process.argv.slice(2);
if (!files.length) throw new Error("pass one or more raw unseen session JSON files");

const limit = Math.max(0, Number(process.env.SMART_T_SESSION_LIMIT) || 0);
const allVariants = [
  { id: "current", overrides: {} },
  { id: "sell-volume-off", overrides: { enableSellExhaustionVolumeRegime: 0 } },
  { id: "sell-volume-recalibrated", overrides: { maxSellExhaustionVolumeRatio: 0.55, minSellExpansionVolumeRatio: 0.85 } },
  { id: "sell-volume-recalibrated-two-cycles", overrides: { maxSellExhaustionVolumeRatio: 0.55, minSellExpansionVolumeRatio: 0.85, maxCycles: 2 } },
  { id: "sell-volume-recalibrated-two-cycles-cooldown-5", overrides: { maxSellExhaustionVolumeRatio: 0.55, minSellExpansionVolumeRatio: 0.85, maxCycles: 2, cooldown: 5 } },
  { id: "sell-volume-recalibrated-three-cycles-cooldown-5", overrides: { maxSellExhaustionVolumeRatio: 0.55, minSellExpansionVolumeRatio: 0.85, maxCycles: 3, cooldown: 5 } },
  { id: "coverage-confirmation-1", overrides: { maxSellExhaustionVolumeRatio: 0.55, minSellExpansionVolumeRatio: 0.85, maxCycles: 2, cooldown: 5, minSellExecutionConfirmationVotes: 1 } },
  { id: "coverage-local-soft", overrides: { maxSellExhaustionVolumeRatio: 0.55, minSellExpansionVolumeRatio: 0.85, maxCycles: 2, cooldown: 5, deviation: 0.65, reversal: 0.20, minRewardRisk: 1.40 } },
  { id: "coverage-confirmation-1-local-soft", overrides: { maxSellExhaustionVolumeRatio: 0.55, minSellExpansionVolumeRatio: 0.85, maxCycles: 2, cooldown: 5, minSellExecutionConfirmationVotes: 1, deviation: 0.65, reversal: 0.20, minRewardRisk: 1.40 } },
  { id: "coverage-deviation-065", overrides: { maxSellExhaustionVolumeRatio: 0.55, minSellExpansionVolumeRatio: 0.85, maxCycles: 2, cooldown: 5, deviation: 0.65 } },
  { id: "coverage-deviation-064", overrides: { maxSellExhaustionVolumeRatio: 0.55, minSellExpansionVolumeRatio: 0.85, maxCycles: 2, cooldown: 5, deviation: 0.64 } },
  { id: "coverage-deviation-063", overrides: { maxSellExhaustionVolumeRatio: 0.55, minSellExpansionVolumeRatio: 0.85, maxCycles: 2, cooldown: 5, deviation: 0.63 } },
  { id: "coverage-deviation-062", overrides: { maxSellExhaustionVolumeRatio: 0.55, minSellExpansionVolumeRatio: 0.85, maxCycles: 2, cooldown: 5, deviation: 0.62 } },
  { id: "coverage-deviation-060", overrides: { maxSellExhaustionVolumeRatio: 0.55, minSellExpansionVolumeRatio: 0.85, maxCycles: 2, cooldown: 5, deviation: 0.60 } },
  { id: "coverage-deviation-060-hard-stop-065", overrides: { maxSellExhaustionVolumeRatio: 0.55, minSellExpansionVolumeRatio: 0.85, maxCycles: 2, cooldown: 5, deviation: 0.60, hardStopPct: 0.65 } },
  { id: "coverage-deviation-060-soft-stop", overrides: { maxSellExhaustionVolumeRatio: 0.55, minSellExpansionVolumeRatio: 0.85, maxCycles: 2, cooldown: 5, deviation: 0.60, softStopPct: 0.36, softStopMinutes: 12 } },
  { id: "coverage-deviation-060-exit-guard", overrides: { maxSellExhaustionVolumeRatio: 0.55, minSellExpansionVolumeRatio: 0.85, maxCycles: 2, cooldown: 5, deviation: 0.60, hardStopPct: 0.65, softStopPct: 0.36, softStopMinutes: 12, timeExitMinutes: 28 } },
  { id: "coverage-deviation-065-reward-risk-140", overrides: { maxSellExhaustionVolumeRatio: 0.55, minSellExpansionVolumeRatio: 0.85, maxCycles: 2, cooldown: 5, deviation: 0.65, minRewardRisk: 1.40 } },
  { id: "coverage-reversal-020", overrides: { maxSellExhaustionVolumeRatio: 0.55, minSellExpansionVolumeRatio: 0.85, maxCycles: 2, cooldown: 5, reversal: 0.20 } },
  { id: "coverage-reward-risk-140", overrides: { maxSellExhaustionVolumeRatio: 0.55, minSellExpansionVolumeRatio: 0.85, maxCycles: 2, cooldown: 5, minRewardRisk: 1.40 } },
  { id: "sell-mature-risk", overrides: { enableMatureSellReversalRiskOverride: 1 } },
  { id: "sell-risk-2", overrides: { maxSellTrendRiskVotes: 2 } },
  { id: "sell-risk-2-votes-3", overrides: { maxSellTrendRiskVotes: 2, minSellExecutionConfirmationVotes: 3 } },
  { id: "sell-risk-2-expansion-085", overrides: { maxSellTrendRiskVotes: 2, minSellExpansionVolumeRatio: 0.85 } },
  { id: "buy-votes-3", overrides: { minBuyExecutionConfirmationVotes: 3 } },
  { id: "buy-risk-1", overrides: { maxBuyTrendRiskVotes: 1 } },
  { id: "buy-votes-3-risk-1", overrides: { minBuyExecutionConfirmationVotes: 3, maxBuyTrendRiskVotes: 1 } },
  { id: "precision-current", overrides: { precisionEntryWindows: 1 } },
  { id: "precision-sell-3", overrides: { precisionEntryWindows: 1, minSellExecutionConfirmationVotes: 3 } },
];
const selectedVariantIds = new Set(
  String(process.env.SMART_T_VARIANTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const variants = selectedVariantIds.size
  ? allVariants.filter((variant) => selectedVariantIds.has(variant.id))
  : allVariants;

function summarize(rows) {
  const cycles = rows.flatMap((row) => row.result.cycleNets ?? []);
  const wins = cycles.filter((net) => net > 0).length;
  const gains = cycles.reduce((sum, net) => sum + Math.max(0, net), 0);
  const losses = cycles.reduce((sum, net) => sum + Math.max(0, -net), 0);
  return {
    stockDays: rows.length,
    candidateDays: rows.filter((row) => (row.result.diagnostics?.candidates ?? 0) > 0).length,
    cycles: cycles.length,
    triggerRate: rows.length ? cycles.length / rows.length : 0,
    wins,
    winRate: cycles.length ? wins / cycles.length : null,
    net: rows.reduce((sum, row) => sum + row.result.net, 0),
    profitFactor: losses ? gains / losses : gains > 0 ? null : 0,
  };
}

function summarizeCycleRows(rows) {
  const wins = rows.filter((row) => row.net > 0).length;
  const gains = rows.reduce((sum, row) => sum + Math.max(0, row.net), 0);
  const losses = rows.reduce((sum, row) => sum + Math.max(0, -row.net), 0);
  return {
    cycles: rows.length,
    wins,
    winRate: rows.length ? wins / rows.length : null,
    net: rows.reduce((sum, row) => sum + row.net, 0),
    profitFactor: losses ? gains / losses : gains > 0 ? null : 0,
  };
}

function collectCycleRows(result, fixture = "") {
  const entries = (result.actions ?? []).filter((action) => action.meta?.phase === "entry");
  return (result.cycleNets ?? []).map((net, index) => ({
    net,
    fixture,
    time: entries[index]?.time,
    direction: entries[index]?.direction,
    meta: entries[index]?.meta ?? {},
  }));
}

function riskSlices(rows) {
  const cycles = rows.flatMap((row) => collectCycleRows(row.result, row.fixture));
  const groups = new Map();
  for (const cycle of cycles) {
    const meta = cycle.meta;
    const riskMask = [
      meta.trendRiskCycleRegime ? "C" : "-",
      meta.trendRiskOneWayContinuation ? "O" : "-",
      meta.trendRiskWeakReversalQuality ? "W" : "-",
    ].join("");
    const volumeRegime = meta.ratio <= 0.4 ? "exhaustion" : meta.ratio >= 1 ? "expansion" : "middle";
    const key = `${meta.trendRiskVotes}|${riskMask}|${volumeRegime}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(cycle);
  }
  return [...groups.entries()]
    .map(([key, cycleRows]) => ({ key, ...summarizeCycleRows(cycleRows) }))
    .sort((a, b) => b.cycles - a.cycles);
}

function cycleSlices(rows) {
  const cycles = rows.flatMap((row) => collectCycleRows(row.result, row.fixture));
  const ratioBucket = (ratio) => {
    if (ratio <= 0.4) return "r00-40";
    if (ratio < 0.55) return "r40-55";
    if (ratio < 0.7) return "r55-70";
    if (ratio < 0.85) return "r70-85";
    if (ratio < 1) return "r85-100";
    return "r100+";
  };
  const dimensions = {
    ratio: (cycle) => ratioBucket(cycle.meta.ratio),
    hour: (cycle) => cycle.time?.slice(0, 2) ?? "--",
    direction: (cycle) => cycle.direction ?? "--",
    ratioHour: (cycle) => `${ratioBucket(cycle.meta.ratio)}|${cycle.time?.slice(0, 2) ?? "--"}`,
    ratioRisk: (cycle) => `${ratioBucket(cycle.meta.ratio)}|risk${cycle.meta.trendRiskVotes}`,
    fixtureRatio: (cycle) => `${cycle.fixture}|${ratioBucket(cycle.meta.ratio)}`,
  };
  return Object.fromEntries(Object.entries(dimensions).map(([dimension, selector]) => {
    const groups = new Map();
    for (const cycle of cycles) {
      const key = selector(cycle);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(cycle);
    }
    return [dimension, [...groups.entries()]
      .map(([key, cycleRows]) => ({ key, ...summarizeCycleRows(cycleRows) }))
      .sort((a, b) => b.cycles - a.cycles)];
  }));
}

const fixtures = await Promise.all(files.map(async (file) => {
  const fixture = JSON.parse(await readFile(file, "utf8"));
  return {
    file,
    sessions: limit ? fixture.sessions.slice(0, limit) : fixture.sessions,
  };
}));

const reports = [];
for (const variant of variants) {
  const rows = [];
  for (const fixture of fixtures) {
    for (const session of fixture.sessions) {
      const referencePrice = Number(session.previousClose) || Number(session.minutes[0]?.price) || 10;
      const shares = Math.max(300, Math.floor((90_000 / referencePrice) / 100) * 100);
      rows.push({
        fixture: fixture.file,
        result: runSmartTReplay(session.minutes, {
          capital: 200_000,
          baseShares: shares,
          sellable: shares,
          feeRate: 0.025,
          slippage: 0.02,
          minCommission: true,
          slippageMode: "percent",
          forceCloseTime: "1450",
          previousClose: session.previousClose,
          profile: "平衡档",
          profileOverrides: variant.overrides,
          randomValue: 0,
          volatilityMode: "causal-hybrid",
        }),
      });
    }
  }
  reports.push({
    ...variant,
    summary: summarize(rows),
    ...(variant.id === "sell-risk-2" ? { riskSlices: riskSlices(rows) } : {}),
    cycleSlices: cycleSlices(rows),
  });
  process.stderr.write(`${variant.id}: ${JSON.stringify(reports.at(-1).summary)}\n`);
}

console.log(JSON.stringify({ limit, files, reports }, null, 2));
