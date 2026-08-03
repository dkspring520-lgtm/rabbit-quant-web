import { readFile } from "node:fs/promises";
import { runSmartTReplay } from "../lib/smart-t-engine.mjs";

const cache = JSON.parse(await readFile(
  new URL("../.data-inspect/smart-t-v41-1000-sessions.json", import.meta.url),
  "utf8",
));

const variants = [
  { id: "current", overrides: {} },
  { id: "hard-continuation", overrides: { hardTrendContinuationGate: 1 } },
  { id: "hard-continuation-sell-timing", overrides: { hardTrendContinuationGate: 1, hardSellEntryTimingGate: 1 } },
  { id: "combined-sell-risk", overrides: { hardSellTrendTimingConflictGate: 1 } },
  { id: "combined-sell-risk-opening-l2", overrides: { hardSellTrendTimingConflictGate: 1, requireEarlyOpeningRiskL2: 1 } },
  { id: "combined-risk-opening-l2-buy-3", overrides: { hardSellTrendTimingConflictGate: 1, requireEarlyOpeningRiskL2: 1, minBuyExecutionConfirmationVotes: 3 } },
  { id: "combined-risk-opening-l2-mature-buy", overrides: { hardSellTrendTimingConflictGate: 1, requireEarlyOpeningRiskL2: 1, enableMatureBuyReversalRiskOverride: 1 } },
  { id: "combined-risk-opening-l2-sell-3", overrides: { hardSellTrendTimingConflictGate: 1, requireEarlyOpeningRiskL2: 1, minSellExecutionConfirmationVotes: 3 } },
  { id: "sell-risk-2", overrides: { maxSellTrendRiskVotes: 2 } },
  { id: "sell-risk-2-sell-3", overrides: { maxSellTrendRiskVotes: 2, minSellExecutionConfirmationVotes: 3 } },
  { id: "sell-risk-2-combined", overrides: { maxSellTrendRiskVotes: 2, hardSellTrendTimingConflictGate: 1 } },
  { id: "sell-risk-2-combined-sell-3", overrides: { maxSellTrendRiskVotes: 2, hardSellTrendTimingConflictGate: 1, minSellExecutionConfirmationVotes: 3 } },
  { id: "buy-risk-1", overrides: { maxBuyTrendRiskVotes: 1 } },
  { id: "buy-risk-1-buy-3", overrides: { maxBuyTrendRiskVotes: 1, minBuyExecutionConfirmationVotes: 3 } },
  { id: "two-side-risk-combined", overrides: { maxBuyTrendRiskVotes: 1, maxSellTrendRiskVotes: 2, hardSellTrendTimingConflictGate: 1 } },
  { id: "two-side-risk-combined-sell-3", overrides: { maxBuyTrendRiskVotes: 1, maxSellTrendRiskVotes: 2, hardSellTrendTimingConflictGate: 1, minSellExecutionConfirmationVotes: 3 } },
  { id: "precision-window", overrides: { precisionEntryWindows: 1 } },
  { id: "precision-window-sell-3", overrides: { precisionEntryWindows: 1, minSellExecutionConfirmationVotes: 3 } },
  { id: "mature-sell", overrides: { enableMatureSellReversalRiskOverride: 1 } },
  { id: "mature-sell-age-6", overrides: { enableMatureSellReversalRiskOverride: 1, matureSellReversalMinPivotAge: 6 } },
  { id: "max-cycles-3", overrides: { maxCycles: 3 } },
  { id: "cooldown-3", overrides: { cooldown: 3 } },
  { id: "relaxed-sell-volume", overrides: { maxSellExhaustionVolumeRatio: 0.70, minSellExpansionVolumeRatio: 0.80 } },
  { id: "relaxed-sell-volume-sell-3", overrides: { maxSellExhaustionVolumeRatio: 0.70, minSellExpansionVolumeRatio: 0.80, minSellExecutionConfirmationVotes: 3 } },
  { id: "score-3", overrides: { score: 3 } },
  { id: "score-3-sell-3", overrides: { score: 3, minSellExecutionConfirmationVotes: 3 } },
  { id: "score-3-relaxed-volume", overrides: { score: 3, maxSellExhaustionVolumeRatio: 0.70, minSellExpansionVolumeRatio: 0.80 } },
  { id: "lower-reward-risk", overrides: { minRewardRisk: 1.30 } },
  { id: "score-3-lower-reward-risk", overrides: { score: 3, minRewardRisk: 1.30 } },
  { id: "lighter-sell-volume", overrides: { minSellVolumeRatio: 0.75 } },
  { id: "score-3-lighter-sell-volume", overrides: { score: 3, minSellVolumeRatio: 0.75 } },
  { id: "smaller-deviation", overrides: { deviation: 0.55, reversal: 0.20 } },
  { id: "rapid-rise-sell-confirmation", overrides: { requireRapidRiseSellConfirmation: 1 } },
  { id: "rapid-rise-score-3", overrides: { requireRapidRiseSellConfirmation: 1, score: 3 } },
  { id: "rapid-rise-score-3-relaxed-volume", overrides: { requireRapidRiseSellConfirmation: 1, score: 3, maxSellExhaustionVolumeRatio: 0.70, minSellExpansionVolumeRatio: 0.80 } },
  { id: "score-3-reverse-cutoff", overrides: { score: 3, maxSellEntryTime: "1030" } },
  { id: "rapid-rise-score-3-reverse-cutoff", overrides: { requireRapidRiseSellConfirmation: 1, score: 3, maxSellEntryTime: "1030" } },
];
const requestedVariantIds = process.argv[2]?.split(",").filter(Boolean);
const selectedVariants = requestedVariantIds?.length
  ? variants.filter((variant) => requestedVariantIds.includes(variant.id))
  : variants;
if (requestedVariantIds?.length && selectedVariants.length !== requestedVariantIds.length) {
  throw new Error(`unknown calibration variant: ${requestedVariantIds.filter((id) => !selectedVariants.some((variant) => variant.id === id)).join(", ")}`);
}

function summarize(rows) {
  const cycles = rows.flatMap((row) => row.result.cycleNets ?? []);
  const wins = cycles.filter((net) => net > 0).length;
  const gains = cycles.reduce((sum, net) => sum + Math.max(0, net), 0);
  const losses = cycles.reduce((sum, net) => sum + Math.max(0, -net), 0);
  return {
    stockDays: rows.length,
    candidateDays: rows.filter((row) => (row.result.diagnostics?.candidates ?? 0) > 0).length,
    tradingDays: rows.filter((row) => row.result.trades > 0).length,
    cycles: cycles.length,
    wins,
    winRate: cycles.length ? wins / cycles.length : null,
    net: rows.reduce((sum, row) => sum + row.result.net, 0),
    averageCycleNet: cycles.length ? cycles.reduce((sum, net) => sum + net, 0) / cycles.length : null,
    profitFactor: losses ? gains / losses : gains > 0 ? null : 0,
  };
}

function grouped(rows, keyFor) {
  const groups = new Map();
  for (const row of rows) {
    for (let index = 0; index < (row.result.cycleNets ?? []).length; index += 1) {
      const entry = row.result.actions?.[index * 2];
      const net = row.result.cycleNets[index];
      const key = keyFor(entry);
      const values = groups.get(key) ?? [];
      values.push(net);
      groups.set(key, values);
    }
  }
  return Object.fromEntries([...groups.entries()].map(([key, values]) => {
    const wins = values.filter((net) => net > 0).length;
    const gains = values.reduce((sum, net) => sum + Math.max(0, net), 0);
    const losses = values.reduce((sum, net) => sum + Math.max(0, -net), 0);
    return [key, {
      cycles: values.length,
      wins,
      winRate: values.length ? wins / values.length : null,
      net: values.reduce((sum, net) => sum + net, 0),
      profitFactor: losses ? gains / losses : gains > 0 ? null : 0,
    }];
  }));
}

function rejectedGates(rows, direction) {
  const totals = {};
  for (const row of rows) {
    const gates = row.result.gateAudit?.directions?.[direction]?.gates ?? {};
    for (const [gate, stats] of Object.entries(gates)) {
      const current = totals[gate] ?? { rejected: 0, soleReject: 0, favourable: 0, soleFavourable: 0 };
      current.rejected += stats.rejected;
      current.soleReject += stats.soleReject;
      current.favourable += stats.favourable;
      current.soleFavourable += stats.soleFavourable;
      totals[gate] = current;
    }
  }
  return Object.fromEntries(Object.entries(totals)
    .sort((left, right) => right[1].rejected - left[1].rejected)
    .map(([gate, stats]) => [gate, {
      ...stats,
      favourableRate: stats.rejected ? stats.favourable / stats.rejected : 0,
      soleFavourableRate: stats.soleReject ? stats.soleFavourable / stats.soleReject : 0,
    }]));
}

const report = [];
for (const variant of selectedVariants) {
  const rows = [];
  for (const stock of cache.loaded) {
    for (let sessionIndex = 0; sessionIndex < stock.sessions.length; sessionIndex += 1) {
      const session = stock.sessions[sessionIndex];
      const referencePrice = Number(session.previousClose) || Number(session.minutes[0]?.price) || 10;
      const shares = Math.max(300, Math.floor((90_000 / referencePrice) / 100) * 100);
      rows.push({
        latest: sessionIndex === 0,
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
          gateAudit: true,
        }),
      });
    }
  }
  report.push({
    id: variant.id,
    overrides: variant.overrides,
    development: summarize(rows.filter((row) => !row.latest)),
    holdout: summarize(rows.filter((row) => row.latest)),
    overall: summarize(rows),
    slices: {
      direction: grouped(rows, (entry) => entry?.direction ?? "unknown"),
      entryHour: grouped(rows, (entry) => entry?.time?.slice(0, 2) ?? "unknown"),
      directionHour: grouped(rows, (entry) => `${entry?.direction ?? "unknown"}-${entry?.time?.slice(0, 2) ?? "unknown"}`),
      confirmationVotes: grouped(rows, (entry) => String(entry?.meta?.executionConfirmationVotes ?? "unknown")),
      trendRiskVotes: grouped(rows, (entry) => String(entry?.meta?.trendRiskVotes ?? "unknown")),
      rejectedBuyGates: rejectedGates(rows, "BUY_FIRST"),
      rejectedSellGates: rejectedGates(rows, "SELL_FIRST"),
    },
  });
  process.stderr.write(`${variant.id}: ${report.at(-1).overall.cycles} cycles\n`);
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  protocol: "same 200 stocks x 5 sessions; latest session per stock is holdout",
  variants: report,
}, null, 2));
