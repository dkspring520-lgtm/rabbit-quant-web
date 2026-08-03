import { readFile } from "node:fs/promises";
import { runSmartTReplay } from "../lib/smart-t-engine.mjs";

const files = process.argv.slice(2);
if (!files.length) {
  throw new Error("pass one or more raw unseen session JSON files");
}

const profileOverrides = {
  minBuyExecutionConfirmationVotes: 4,
  minSellExecutionConfirmationVotes: 2,
  enableMatureSellReversalRiskOverride: 0,
  enableSellExhaustionVolumeRegime: 1,
};

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
      const exit = row.result.actions?.[index * 2 + 1];
      const net = row.result.cycleNets[index];
      const key = keyFor(entry, exit);
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

function cycleRows(rows) {
  return rows.flatMap((row) => (row.result.cycleNets ?? []).map((net, index) => {
    const entry = row.result.actions?.[index * 2];
    const exit = row.result.actions?.[index * 2 + 1];
    const meta = entry?.meta ?? {};
    return {
      partition: row.partition,
      net,
      entryTime: entry?.time ?? "",
      direction: entry?.direction ?? "",
      exitReason: exit?.reason ?? "",
      confirmationVotes: meta.executionConfirmationVotes ?? null,
      confirmationMask: [
        meta.executionScoreConfirmed ? "S" : "-",
        meta.structuralConfirmation ? "T" : "-",
        meta.executionMomentumConfirmed ? "M" : "-",
        meta.entryTimingValid ? "E" : "-",
      ].join(""),
      trendRiskVotes: meta.trendRiskVotes ?? null,
      score: meta.score ?? null,
      edge: meta.edge ?? null,
      rewardRisk: meta.rewardRisk ?? null,
      ratio: meta.ratio ?? null,
      deviation: meta.deviation ?? null,
      pivotReversal: meta.pivotReversal ?? null,
      sessionMove: meta.sessionMove ?? null,
    };
  }));
}

const reports = [];
for (const file of files) {
  const fixture = JSON.parse(await readFile(file, "utf8"));
  const rows = fixture.sessions.map((session) => {
    const referencePrice = Number(session.previousClose) || Number(session.minutes[0]?.price) || 10;
    const shares = Math.max(300, Math.floor((90_000 / referencePrice) / 100) * 100);
    return {
      partition: session.partition,
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
        profileOverrides,
        randomValue: 0,
        volatilityMode: "causal-hybrid",
      }),
    };
  });
  reports.push({
    file,
    seed: fixture.seed,
    development: summarize(rows.filter((row) => row.partition === "train-older")),
    holdout: summarize(rows.filter((row) => row.partition === "holdout-latest")),
    overall: summarize(rows),
    cycles: cycleRows(rows),
    slices: {
      confirmationVotes: grouped(rows, (entry) => String(entry?.meta?.executionConfirmationVotes ?? "unknown")),
      trendRiskVotes: grouped(rows, (entry) => String(entry?.meta?.trendRiskVotes ?? "unknown")),
      score: grouped(rows, (entry) => String(entry?.meta?.score ?? "unknown")),
      entryHalfHour: grouped(rows, (entry) => {
        const time = entry?.time ?? "";
        const minute = Number(time.slice(2, 4));
        return `${time.slice(0, 2)}:${minute < 30 ? "00" : "30"}`;
      }),
      edgeBucket: grouped(rows, (entry) => String(Math.floor(Number(entry?.meta?.edge ?? 0) * 5) / 5)),
      rewardRiskBucket: grouped(rows, (entry) => String(Math.floor(Number(entry?.meta?.rewardRisk ?? 0) * 2) / 2)),
      ratioBucket: grouped(rows, (entry) => String(Math.floor(Number(entry?.meta?.ratio ?? 0) * 2) / 2)),
      exitReason: grouped(rows, (_entry, exit) => exit?.reason ?? "unknown"),
    },
  });
  process.stderr.write(`${file}: ${reports.at(-1).overall.cycles} cycles\n`);
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  profileOverrides,
  reports,
}, null, 2));
