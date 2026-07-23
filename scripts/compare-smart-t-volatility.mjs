import { readFile } from "node:fs/promises";
import { PROFILES, runSmartTReplay } from "../lib/smart-t-engine.mjs";

const cachePath = new URL(process.argv[2] ?? "../.data-inspect/smart-t-v41-1000-sessions.json", import.meta.url);
const profileName = process.argv[3] ?? "平衡档";
const cache = JSON.parse(await readFile(cachePath, "utf8"));

if (!PROFILES[profileName]) {
  throw new Error(`unknown profile: ${profileName}`);
}

const variants = [
  { id: "classic-fixed", volatilityMode: "fixed" },
  { id: "causal-realized-shadow", volatilityMode: "causal-realized" },
];

function replay(stock, session, sessionIndex, variant) {
  const prices = session.minutes.map((point) => Number(point.price)).filter(Number.isFinite);
  const referencePrice = Number(session.previousClose) || prices[0] || 10;
  const shares = Math.max(300, Math.floor((90_000 / referencePrice) / 100) * 100);
  return {
    code: stock.code,
    name: stock.name,
    date: session.date,
    sessionIndex,
    result: runSmartTReplay(session.minutes, {
      capital: 200_000,
      baseShares: shares,
      sellable: shares,
      feeRate: 0.025,
      slippage: 0.02,
      minCommission: true,
      slippageMode: "percent",
      forceCloseTime: "1450",
      profile: profileName,
      previousClose: session.previousClose,
      randomValue: 0,
      gateAudit: variant.id === "classic-fixed",
      volatilityMode: variant.volatilityMode,
    }),
  };
}

function metrics(rows) {
  const cycles = rows.flatMap((row) => row.result.cycleNets ?? []);
  const wins = cycles.filter((value) => value > 0).length;
  const gains = cycles.reduce((sum, value) => sum + Math.max(0, value), 0);
  const losses = cycles.reduce((sum, value) => sum + Math.max(0, -value), 0);
  const candidates = rows.reduce((sum, row) => sum + Number(row.result.diagnostics?.candidates ?? 0), 0);
  const observations = rows.reduce((sum, row) => sum + Number(row.result.diagnostics?.observations ?? 0), 0);
  const drawdowns = rows.map((row) => Number(row.result.maxDrawdown)).filter(Number.isFinite);
  return {
    stockDays: rows.length,
    uniqueStocks: new Set(rows.map((row) => row.code)).size,
    candidateCoverage: rows.filter((row) => Number(row.result.diagnostics?.candidates ?? 0) > 0).length,
    candidates,
    observationCoverage: rows.filter((row) => Number(row.result.diagnostics?.observations ?? 0) > 0).length,
    observations,
    tradingStockDays: rows.filter((row) => (row.result.cycleNets?.length ?? 0) > 0).length,
    cycles: cycles.length,
    wins,
    losses: cycles.length - wins,
    winRate: cycles.length ? wins / cycles.length : null,
    cycleRate: rows.length ? cycles.length / rows.length : 0,
    gross: rows.reduce((sum, row) => sum + row.result.gross, 0),
    fees: rows.reduce((sum, row) => sum + row.result.fees, 0),
    slippage: rows.reduce((sum, row) => sum + row.result.executionCost, 0),
    net: rows.reduce((sum, row) => sum + row.result.net, 0),
    averageCycleNet: cycles.length ? cycles.reduce((sum, value) => sum + value, 0) / cycles.length : null,
    profitFactor: losses ? gains / losses : gains > 0 ? null : 0,
    averageSessionDrawdownPct: drawdowns.length
      ? drawdowns.reduce((sum, value) => sum + value, 0) / drawdowns.length
      : 0,
    worstSessionDrawdownPct: drawdowns.length ? Math.min(...drawdowns) : 0,
  };
}

function aggregateGateAudit(rows) {
  const gates = {};
  let rejectedCandidateMinutes = 0;
  let favourableRejected = 0;
  for (const row of rows) {
    const audit = row.result.gateAudit;
    if (!audit) continue;
    rejectedCandidateMinutes += audit.rejectedCandidateMinutes;
    favourableRejected += audit.favourableRejected;
    for (const [gate, stats] of Object.entries(audit.gates ?? {})) {
      const current = gates[gate] ?? {
        rejected: 0,
        favourable: 0,
        soleReject: 0,
        soleFavourable: 0,
        mfeWeighted: 0,
        maeWeighted: 0,
      };
      current.rejected += stats.rejected;
      current.favourable += stats.favourable;
      current.soleReject += stats.soleReject;
      current.soleFavourable += stats.soleFavourable;
      current.mfeWeighted += stats.averageMfePct * stats.rejected;
      current.maeWeighted += stats.averageMaePct * stats.rejected;
      gates[gate] = current;
    }
  }

  const ranked = Object.entries(gates)
    .map(([gate, stats]) => ({
      gate,
      rejected: stats.rejected,
      favourable: stats.favourable,
      favourableRate: stats.rejected ? stats.favourable / stats.rejected : 0,
      soleReject: stats.soleReject,
      soleFavourable: stats.soleFavourable,
      soleFavourableRate: stats.soleReject ? stats.soleFavourable / stats.soleReject : 0,
      averageMfePct: stats.rejected ? stats.mfeWeighted / stats.rejected : 0,
      averageMaePct: stats.rejected ? stats.maeWeighted / stats.rejected : 0,
    }))
    .sort((left, right) => right.soleFavourable - left.soleFavourable
      || right.favourable - left.favourable
      || right.rejected - left.rejected);

  return {
    rejectedCandidateMinutes,
    favourableRejected,
    favourableRejectedRate: rejectedCandidateMinutes
      ? favourableRejected / rejectedCandidateMinutes
      : 0,
    topPotentialFalseRejections: ranked.slice(0, 12),
  };
}

const evaluated = [];
for (const variant of variants) {
  const rows = cache.loaded.flatMap((stock) => stock.sessions.map(
    (session, sessionIndex) => replay(stock, session, sessionIndex, variant),
  ));
  evaluated.push({
    id: variant.id,
    rows,
    all: metrics(rows),
    development: metrics(rows.filter((row) => row.sessionIndex >= 1)),
    latestHoldout: metrics(rows.filter((row) => row.sessionIndex === 0)),
  });
  process.stderr.write(`${variant.id}: ${evaluated.at(-1).all.cycles} cycles\n`);
}

const report = {
  generatedAt: new Date().toISOString(),
  cacheGeneratedAt: cache.generatedAt,
  profile: profileName,
  protocol: {
    comparison: "same 200 stocks x same 5 complete sessions",
    development: "older four sessions per stock",
    latestHoldout: "latest session per stock",
    noFutureData: true,
    profitTarget: "after-cost 0.64%-1.00%",
    adaptiveInput: "causal RMS close-to-close one-minute returns; no fake ATR",
  },
  variants: evaluated.map(({ id, all, development, latestHoldout }) => ({
    id,
    all,
    development,
    latestHoldout,
  })),
  classicGateAudit: aggregateGateAudit(evaluated.find((item) => item.id === "classic-fixed").rows),
};

console.log(JSON.stringify(report, null, 2));
