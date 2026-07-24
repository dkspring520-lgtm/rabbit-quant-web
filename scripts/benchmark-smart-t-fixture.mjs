import fs from "node:fs";
import { pathToFileURL } from "node:url";

const enginePath = process.env.SMART_T_ENGINE_PATH;
const engineModule = enginePath
  ? await import(pathToFileURL(enginePath).href)
  : await import("../lib/smart-t-engine.mjs");
const { runSmartTReplay } = engineModule;

const fixturePath = process.argv[2];
const profile = process.argv[3] ?? "平衡档";
const compact = process.argv.includes("--compact");
const overridesArgument = process.argv.slice(4).find((argument) => !argument.startsWith("--"));
const profileOverrides = overridesArgument ? JSON.parse(overridesArgument) : {};

if (!fixturePath) {
  throw new Error("用法: node scripts/benchmark-smart-t-fixture.mjs <fixture.json> [档位] [覆盖参数JSON]");
}

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

function metrics(rows) {
  const cycles = rows.flatMap((row) => row.result.cycleNets);
  const wins = cycles.filter((net) => net > 0).length;
  const positive = cycles.reduce((sum, net) => sum + Math.max(0, net), 0);
  const negative = cycles.reduce((sum, net) => sum + Math.max(0, -net), 0);
  return {
    stockDays: rows.length,
    candidateMinutes: rows.reduce((sum, row) => sum + (row.result.diagnostics?.candidates ?? 0), 0),
    tradedDays: rows.filter((row) => row.result.trades > 0).length,
    cycles: cycles.length,
    wins,
    losses: cycles.length - wins,
    winRate: cycles.length ? wins / cycles.length : null,
    net: rows.reduce((sum, row) => sum + row.result.net, 0),
    profitFactor: negative ? positive / negative : null,
    averageWin: wins ? positive / wins : null,
    averageLoss: cycles.length - wins ? negative / (cycles.length - wins) : null,
  };
}

const rows = fixture.sessions.map((session) => {
  const referencePrice = Number(session.previousClose) || Number(session.minutes[0]?.price) || 10;
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
    previousClose: referencePrice,
    profile,
    profileOverrides,
    randomValue: 0,
    gateAudit: true,
  });
  return { ...session, result };
});

const train = rows.filter((row) => row.partition === "train-older");
const holdout = rows.filter((row) => row.partition === "holdout-latest");
const trades = rows
  .filter((row) => row.result.trades > 0)
  .map((row) => ({
    code: row.code,
    date: row.date,
    partition: row.partition,
    net: row.result.net,
    direction: row.result.actions[0]?.side,
    entryTime: row.result.actions[0]?.time,
    exitTime: row.result.actions[1]?.time,
    exitReason: row.result.actions[1]?.reason,
    entryMeta: row.result.actions[0]?.meta,
  }))
  .sort((left, right) => left.net - right.net);

function tradeGroupMetrics(group) {
  const wins = group.filter((trade) => trade.net > 0).length;
  const positive = group.reduce((sum, trade) => sum + Math.max(0, trade.net), 0);
  const negative = group.reduce((sum, trade) => sum + Math.max(0, -trade.net), 0);
  return {
    trades: group.length,
    wins,
    losses: group.length - wins,
    winRate: group.length ? wins / group.length : null,
    net: group.reduce((sum, trade) => sum + trade.net, 0),
    profitFactor: negative ? positive / negative : null,
  };
}

const timeBuckets = {
  "09:30-09:59": trades.filter((trade) => trade.entryTime < "1000"),
  "10:00-11:30": trades.filter((trade) => trade.entryTime >= "1000" && trade.entryTime <= "1130"),
  "13:00-13:59": trades.filter((trade) => trade.entryTime >= "1300" && trade.entryTime < "1400"),
  "14:00-14:30": trades.filter((trade) => trade.entryTime >= "1400"),
};

const directionBuckets = {
  BUY_FIRST: trades.filter((trade) => trade.direction === "买入"),
  SELL_FIRST: trades.filter((trade) => trade.direction === "卖出"),
};

const gateAuditRaw = rows.reduce((summary, row) => {
  for (const [gateName, gate] of Object.entries(row.result.gateAudit?.gates ?? {})) {
    const current = summary[gateName] ?? {
      rejected: 0,
      favourable: 0,
      adverse: 0,
      soleReject: 0,
      soleFavourable: 0,
      mfePctSum: 0,
      maePctSum: 0,
    };
    current.rejected += gate.rejected;
    current.favourable += gate.favourable;
    current.adverse += gate.adverse;
    current.soleReject += gate.soleReject ?? 0;
    current.soleFavourable += gate.soleFavourable ?? 0;
    current.mfePctSum += gate.averageMfePct * gate.rejected;
    current.maePctSum += gate.averageMaePct * gate.rejected;
    summary[gateName] = current;
  }
  return summary;
}, {});

const gateAudit = Object.fromEntries(
  Object.entries(gateAuditRaw)
    .map(([gateName, stats]) => [gateName, {
      rejected: stats.rejected,
      favourableRate: stats.rejected ? stats.favourable / stats.rejected : 0,
      soleReject: stats.soleReject,
      soleFavourableRate: stats.soleReject ? stats.soleFavourable / stats.soleReject : 0,
      averageMfePct: stats.rejected ? stats.mfePctSum / stats.rejected : 0,
      averageMaePct: stats.rejected ? stats.maePctSum / stats.rejected : 0,
    }])
    .sort((left, right) => right[1].soleReject - left[1].soleReject || right[1].rejected - left[1].rejected),
);

const report = {
  fixture: {
    archive: fixture.archive,
    seed: fixture.seed,
    trainThrough: fixture.trainThrough,
  },
  profile,
  profileOverrides,
  overall: metrics(rows),
  train: metrics(train),
  holdout: metrics(holdout),
  byEntryTime: Object.fromEntries(
    Object.entries(timeBuckets).map(([bucket, group]) => [bucket, tradeGroupMetrics(group)]),
  ),
  byDirection: Object.fromEntries(
    Object.entries(directionBuckets).map(([bucket, group]) => [bucket, tradeGroupMetrics(group)]),
  ),
  allTrades: compact ? undefined : trades,
  worstTrades: trades.slice(0, compact ? 5 : 15),
  bestTrades: trades.slice(-(compact ? 5 : 15)).reverse(),
  gateAudit: compact ? Object.fromEntries(Object.entries(gateAudit).slice(0, 12)) : gateAudit,
};

console.log(JSON.stringify(report, null, 2));
