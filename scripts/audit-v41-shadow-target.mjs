import { readFile, writeFile } from "node:fs/promises";
import { PROFILES, runSmartTReplay } from "../lib/smart-t-engine.mjs";

const cachePath = new URL("../.data-inspect/smart-t-v41-1000-sessions.json", import.meta.url);
const outputPath = new URL("../.data-inspect/v41-shadow-target-audit.json", import.meta.url);
const cache = JSON.parse(await readFile(cachePath, "utf8"));
const profileName = Object.keys(PROFILES)[1];

const variants = [
  { id: "strict-current", overrides: {} },
  {
    id: "range-balanced",
    overrides: {
      shadowRangeMinCrossings: 1, shadowRangeSideBias: 0.18,
      shadowRangeCrossingBias: 0.08, shadowRangeMinAmplitude: 0.75,
      shadowRangeMaxVwapDrift: 0.50, shadowMorningStartMinute: 10,
      shadowMorningEndMinute: 110, shadowMinParticipation: 0.75,
      shadowLocationFloor: 0.28, shadowLocationFactor: 0.55,
    },
  },
  {
    id: "range-balanced-buy-only",
    overrides: {
      shadowRangeMinCrossings: 1, shadowRangeSideBias: 0.18,
      shadowRangeCrossingBias: 0.08, shadowRangeMinAmplitude: 0.75,
      shadowRangeMaxVwapDrift: 0.50, shadowMorningStartMinute: 10,
      shadowMorningEndMinute: 110, shadowMinParticipation: 0.75,
      shadowLocationFloor: 0.28, shadowLocationFactor: 0.55,
      shadowAllowSellFirst: 0,
    },
  },
  {
    id: "range-wide",
    overrides: {
      maxCycles: 2, shadowRangeMinCrossings: 1, shadowRangeSideBias: 0.15,
      shadowRangeCrossingBias: 0.06, shadowRangeMinAmplitude: 0.60,
      shadowRangeMaxVwapDrift: 0.65, shadowMorningStartMinute: 8,
      shadowMorningEndMinute: 115, shadowMinParticipation: 0.60,
      shadowLocationFloor: 0.25, shadowLocationFactor: 0.50,
    },
  },
  {
    id: "range-wide-buy-only",
    overrides: {
      maxCycles: 2, shadowRangeMinCrossings: 1, shadowRangeSideBias: 0.15,
      shadowRangeCrossingBias: 0.06, shadowRangeMinAmplitude: 0.60,
      shadowRangeMaxVwapDrift: 0.65, shadowMorningStartMinute: 8,
      shadowMorningEndMinute: 115, shadowMinParticipation: 0.60,
      shadowLocationFloor: 0.25, shadowLocationFactor: 0.50,
      shadowAllowSellFirst: 0,
    },
  },
  {
    id: "range-full-day",
    overrides: {
      maxCycles: 2, shadowRangeMinCrossings: 1, shadowRangeSideBias: 0.18,
      shadowRangeCrossingBias: 0.08, shadowRangeMinAmplitude: 0.75,
      shadowRangeMaxVwapDrift: 0.50, shadowMorningStartMinute: 10,
      shadowMorningEndMinute: 110, shadowAllowAfternoon: 1,
      shadowAfternoonStartMinute: 150, shadowAfternoonEndMinute: 200,
      shadowMinParticipation: 0.75, shadowLocationFloor: 0.28,
      shadowLocationFactor: 0.55,
    },
  },
  {
    id: "range-full-day-buy-only",
    overrides: {
      maxCycles: 2, shadowRangeMinCrossings: 1, shadowRangeSideBias: 0.18,
      shadowRangeCrossingBias: 0.08, shadowRangeMinAmplitude: 0.75,
      shadowRangeMaxVwapDrift: 0.50, shadowMorningStartMinute: 10,
      shadowMorningEndMinute: 110, shadowAllowAfternoon: 1,
      shadowAfternoonStartMinute: 150, shadowAfternoonEndMinute: 200,
      shadowMinParticipation: 0.75, shadowLocationFloor: 0.28,
      shadowLocationFactor: 0.55, shadowAllowSellFirst: 0,
    },
  },
  {
    id: "aligned-balanced",
    overrides: {
      maxCycles: 2, shadowAllowAlignedTrend: 1,
      shadowRangeMinCrossings: 1, shadowRangeSideBias: 0.18,
      shadowRangeCrossingBias: 0.08, shadowRangeMinAmplitude: 0.75,
      shadowRangeMaxVwapDrift: 0.50, shadowMorningStartMinute: 10,
      shadowMorningEndMinute: 110, shadowMinParticipation: 0.75,
      shadowLocationFloor: 0.28, shadowLocationFactor: 0.55,
    },
  },
  {
    id: "aligned-balanced-buy-only",
    overrides: {
      maxCycles: 2, shadowAllowAlignedTrend: 1,
      shadowRangeMinCrossings: 1, shadowRangeSideBias: 0.18,
      shadowRangeCrossingBias: 0.08, shadowRangeMinAmplitude: 0.75,
      shadowRangeMaxVwapDrift: 0.50, shadowMorningStartMinute: 10,
      shadowMorningEndMinute: 110, shadowMinParticipation: 0.75,
      shadowLocationFloor: 0.28, shadowLocationFactor: 0.55,
      shadowAllowSellFirst: 0,
    },
  },
];

function replay(stock, session, sessionIndex, overrides) {
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
      previousClose: session.previousClose,
      profile: profileName,
      profileOverrides: overrides,
      randomValue: 0,
      strategyVersion: "V4.1-shadow",
    }),
  };
}

function metrics(rows) {
  const cycles = rows.flatMap((row) => row.result.cycleNets ?? []);
  const gains = cycles.reduce((sum, value) => sum + Math.max(0, value), 0);
  const losses = cycles.reduce((sum, value) => sum + Math.max(0, -value), 0);
  const wins = cycles.filter((value) => value > 0).length;
  return {
    stockDays: rows.length,
    uniqueStocks: new Set(rows.map((row) => row.code)).size,
    tradingDays: rows.filter((row) => (row.result.cycleNets?.length ?? 0) > 0).length,
    cycles: cycles.length,
    wins,
    losses: cycles.length - wins,
    winRate: cycles.length ? wins / cycles.length : null,
    cycleRate: rows.length ? cycles.length / rows.length : 0,
    net: rows.reduce((sum, row) => sum + row.result.net, 0),
    gross: rows.reduce((sum, row) => sum + row.result.gross, 0),
    fees: rows.reduce((sum, row) => sum + row.result.fees, 0),
    slippage: rows.reduce((sum, row) => sum + row.result.executionCost, 0),
    averageCycleNet: cycles.length ? cycles.reduce((sum, value) => sum + value, 0) / cycles.length : null,
    profitFactor: losses ? gains / losses : gains > 0 ? null : 0,
  };
}

function trainingRank(summary) {
  const targetDistance = summary.cycles < 80
    ? (80 - summary.cycles) / 80
    : summary.cycles > 160
      ? (summary.cycles - 160) / 160
      : 0;
  const enoughEvidence = Math.min(1, summary.cycles / 80);
  return (summary.winRate ?? 0) * 100
    + Math.min(2, summary.profitFactor ?? 0) * 12
    + enoughEvidence * 20
    + (summary.net > 0 ? 8 : -8)
    - targetDistance * 35;
}

const evaluated = [];
for (const variant of variants) {
  const rows = cache.loaded.flatMap((stock) => stock.sessions.map((session, sessionIndex) => replay(stock, session, sessionIndex, variant.overrides)));
  const trainingRows = rows.filter((row) => row.sessionIndex >= 1);
  evaluated.push({
    ...variant,
    rows,
    training: metrics(trainingRows),
  });
  process.stderr.write(`${variant.id}: ${evaluated.at(-1).training.cycles} cycles, ${((evaluated.at(-1).training.winRate ?? 0) * 100).toFixed(2)}%\n`);
}

const eligible = evaluated.filter(({ training }) => training.cycles >= 80
  && training.cycles <= 160
  && (training.winRate ?? 0) >= 0.65
  && training.net > 0
  && (training.profitFactor ?? 0) >= 1.20);
const selected = [...(eligible.length ? eligible : evaluated)]
  .sort((left, right) => trainingRank(right.training) - trainingRank(left.training))[0];
const holdoutRows = selected.rows.filter((row) => row.sessionIndex === 0);
const combined = metrics(selected.rows);

let state = 0x5a17c9e3;
const random = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 0x1_0000_0000;
};
const byStock = new Map();
for (const row of selected.rows) {
  const bucket = byStock.get(row.code) ?? [];
  bucket.push(row);
  byStock.set(row.code, bucket);
}
const stockCodes = [...byStock.keys()];
const batchRows = [];
for (let batch = 0; batch < 200; batch += 1) {
  const pool = [...stockCodes];
  for (let pick = 0; pick < 10; pick += 1) {
    const stockIndex = Math.floor(random() * pool.length);
    const code = pool.splice(stockIndex, 1)[0];
    const sessions = byStock.get(code);
    batchRows.push(sessions[Math.floor(random() * sessions.length)]);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  cacheGeneratedAt: cache.generatedAt,
  protocol: {
    target: "200 seeded batches x 10 distinct stocks",
    targetCycles: [200, 400],
    targetAfterCostWinRate: 0.65,
    training: "older four sessions per stock (800 stock-days)",
    holdout: "latest session per stock (200 stock-days); opened only for selected training variant",
    fees: "commission 0.025%, minimum CNY 5, stamp duty and two-sided 0.02% slippage",
    noFutureData: true,
  },
  trainingTargetMet: eligible.length > 0,
  selected: {
    id: selected.id,
    overrides: selected.overrides,
    training: selected.training,
    holdout: metrics(holdoutRows),
    combined,
  },
  seeded200Batches: {
    ...metrics(batchRows),
    batches: 200,
    sampledStockDays: batchRows.length,
    uniqueStockDays: new Set(batchRows.map((row) => `${row.code}:${row.date}`)).size,
    targetMet: (() => {
      const summary = metrics(batchRows);
      return summary.cycles >= 200 && summary.cycles <= 400 && (summary.winRate ?? 0) >= 0.65;
    })(),
  },
  trainingVariants: evaluated.map(({ id, overrides, training }) => ({ id, overrides, training, rank: trainingRank(training) })),
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
