#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

import { runSmartTReplay } from "../lib/smart-t-engine.mjs";

const inputPath = process.argv[2] ?? ".data-inspect/zijin-601899-sessions.jsonl";
const outputPath = process.argv[3] ?? ".tmp-zijin-divergence-shadow-audit.json";
const reader = createInterface({
  input: createReadStream(inputPath, "utf8"),
  crlfDelay: Infinity,
});

const rows = [];
const COST_PCT = 0.12;
const TARGET_NET_PCT = 0.64;
const HORIZON = 20;

function normalizeTime(value) {
  return String(value ?? "").replace(":", "").padStart(4, "0");
}

function directionalMove(direction, entry, exit) {
  if (!(entry > 0) || !(exit > 0)) return 0;
  return direction === "正T"
    ? ((exit - entry) / entry) * 100
    : ((entry - exit) / entry) * 100;
}

function outcome(minutes, observation) {
  const signalIndex = minutes.findIndex(
    (point) => normalizeTime(point.time) === normalizeTime(observation.time),
  );
  const entryIndex = signalIndex + 1;
  if (signalIndex < 0 || entryIndex >= minutes.length) return null;
  const future = minutes.slice(entryIndex, entryIndex + HORIZON + 1);
  if (future.length < 2) return null;
  const entry = Number(future[0].price);
  const endpointNetPct = directionalMove(
    observation.direction,
    entry,
    Number(future.at(-1).price),
  ) - COST_PCT;
  const maximumFavourableNetPct = Math.max(
    ...future.slice(1).map((point) => (
      directionalMove(observation.direction, entry, Number(point.price)) - COST_PCT
    )),
  );
  return {
    endpointNetPct,
    endpointWin: endpointNetPct > 0,
    targetHit: maximumFavourableNetPct >= TARGET_NET_PCT,
    maximumFavourableNetPct,
  };
}

function summarize(items) {
  if (!items.length) {
    return {
      signals: 0,
      endpointWinRate: null,
      targetHitRate: null,
      averageEndpointNetPct: null,
      averageMaximumFavourableNetPct: null,
    };
  }
  return {
    signals: items.length,
    endpointWinRate: items.filter((item) => item.endpointWin).length / items.length,
    targetHitRate: items.filter((item) => item.targetHit).length / items.length,
    averageEndpointNetPct: items.reduce((sum, item) => sum + item.endpointNetPct, 0) / items.length,
    averageMaximumFavourableNetPct: items.reduce(
      (sum, item) => sum + item.maximumFavourableNetPct,
      0,
    ) / items.length,
  };
}

for await (const line of reader) {
  if (!line.trim()) continue;
  const session = JSON.parse(line);
  const referencePrice = Number(session.previousClose)
    || Number(session.minutes?.[0]?.price)
    || 10;
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
    profile: "平衡档",
    previousClose: session.previousClose,
    randomValue: 0.5,
  });
  for (const observation of replay.observations ?? []) {
    if (observation.stage !== "candidate") continue;
    const result = outcome(session.minutes, observation);
    if (!result) continue;
    rows.push({
      date: session.date,
      time: observation.time,
      direction: observation.direction,
      divergenceStatus: observation.divergenceShadow?.status ?? "neutral",
      combined: Boolean(observation.divergenceShadow?.aligned?.combined),
      executable: Boolean(observation.executable),
      ...result,
    });
  }
}

const report = {
  stock: "601899 紫金矿业",
  protocol: {
    strategy: "Smart-T V4 平衡档候选层",
    divergenceMode: "shadow-only",
    futureUsage: "仅用于信号后的结果标注，不参与信号产生",
    fill: "候选确认后的下一分钟",
    horizonMinutes: HORIZON,
    roundTripCostPct: COST_PCT,
    targetNetPct: TARGET_NET_PCT,
  },
  results: {
    allCandidates: summarize(rows),
    divergenceAligned: summarize(rows.filter((row) => row.divergenceStatus === "aligned")),
    divergenceConflict: summarize(rows.filter((row) => row.divergenceStatus === "conflict")),
    divergenceNeutral: summarize(rows.filter((row) => row.divergenceStatus === "neutral")),
    combinedDivergence: summarize(rows.filter((row) => row.combined)),
    executableCandidates: summarize(rows.filter((row) => row.executable)),
  },
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
