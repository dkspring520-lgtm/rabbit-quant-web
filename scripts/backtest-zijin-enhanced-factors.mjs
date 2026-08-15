import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { FactorBacktestEngine, FactorEngine } from "../lib/factor-research/index.mjs";

const DEFAULT_MINUTE_DATA = "E:\\zijin-l2\\601899-factor-minute-ohlc-v1.jsonl";
const DEFAULT_CONTEXT_DATA = "E:\\zijin-l2\\zijin-market-sector-daily-2024-2026.json";
const DEFAULT_OUTPUT = "E:\\zijin-l2\\research-results\\zijin-enhanced-factors-v1.json";
const FACTOR_IDS = Object.freeze([
  "orderflow.ofi_persistence_5m",
  "orderflow.microprice_edge",
  "vwap.same_minute_zscore",
  "volume.same_minute_zscore",
  "market.relative_strength_context",
  "market.sector_resonance",
  "market.metal_resonance",
]);

function argument(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function loadJsonLines(filePath) {
  const sessions = [];
  const hash = createHash("sha256");
  const input = createReadStream(filePath);
  input.on("data", chunk => hash.update(chunk));
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    if (parsed.symbol === "601899" && Array.isArray(parsed.minutes)) sessions.push(parsed);
  }
  return { sessions, checksum: hash.digest("hex") };
}

function rowsByDate(rows) {
  return new Map((Array.isArray(rows) ? rows : []).map(row => [String(row.date), row]));
}

function causalOpenGap(rows, date) {
  const index = rows.findIndex(row => String(row.date) === date);
  if (index <= 0) return null;
  const currentOpen = Number(rows[index]?.open);
  const previousClose = Number(rows[index - 1]?.close);
  return currentOpen > 0 && previousClose > 0 ? currentOpen / previousClose - 1 : null;
}

function addDailyContext(sessions, context) {
  const marketRows = context?.symbols?.sh000001 ?? [];
  const sectorRows = context?.symbols?.sh512400 ?? [];
  const marketDates = rowsByDate(marketRows);
  const sectorDates = rowsByDate(sectorRows);
  return sessions.map(session => {
    const date = String(session.date);
    const marketOpenGap = marketDates.has(date) ? causalOpenGap(marketRows, date) : null;
    const sectorOpenGap = sectorDates.has(date) ? causalOpenGap(sectorRows, date) : null;
    const contextValues = [marketOpenGap, sectorOpenGap].filter(Number.isFinite);
    const contextMean = contextValues.length
      ? contextValues.reduce((sum, value) => sum + value, 0) / contextValues.length
      : null;
    return {
      ...session,
      marketOpenGap,
      sectorOpenGap,
      goldOpenGap: null,
      copperOpenGap: null,
      marketRegime: contextMean === null
        ? "unknown"
        : contextMean >= 0.005 ? "strong"
          : contextMean <= -0.005 ? "weak"
            : "range",
    };
  });
}

function factorCoverage(sessions) {
  const computed = new FactorEngine().computeSessions(sessions, { factorIds: FACTOR_IDS });
  const totals = Object.fromEntries(FACTOR_IDS.map(factorId => [factorId, { available: 0, total: 0 }]));
  for (const session of computed) {
    for (const row of session.rows) {
      for (const factorId of FACTOR_IDS) {
        totals[factorId].total += 1;
        if (Number.isFinite(row.factors[factorId])) totals[factorId].available += 1;
      }
    }
  }
  return Object.fromEntries(Object.entries(totals).map(([factorId, value]) => [factorId, {
    ...value,
    ratio: value.total ? value.available / value.total : 0,
  }]));
}

function compactReport(report) {
  return report.reports.map(item => ({
    factorId: item.factorId,
    direction: item.direction,
    horizonMinutes: item.horizonMinutes,
    trainSamples: item.splitSamples.train,
    testSamples: item.test.sampleCount,
    trades: item.test.trades,
    winRate: item.test.winRate,
    ic: item.test.ic,
    orientedIc: item.test.orientedIc,
    averageNetReturn: item.test.averageNetReturn,
    netReturnSum: item.test.netReturnSum,
    profitFactor: item.test.profitFactor,
    maximumDrawdown: item.test.maximumDrawdown,
    factorScore: item.test.factorScore,
  }));
}

function topByDirection(reports, direction) {
  return reports.filter(item => item.direction === direction && item.trades >= 30)
    .sort((left, right) => (
      (right.profitFactor ?? -1) - (left.profitFactor ?? -1)
      || (right.netReturnSum ?? -Infinity) - (left.netReturnSum ?? -Infinity)
    )).slice(0, 8);
}

async function main() {
  const minuteDataPath = argument("minute-data", DEFAULT_MINUTE_DATA);
  const contextDataPath = argument("context-data", DEFAULT_CONTEXT_DATA);
  const outputPath = argument("output", DEFAULT_OUTPUT);
  const [{ sessions: rawSessions, checksum }, contextText] = await Promise.all([
    loadJsonLines(minuteDataPath),
    readFile(contextDataPath, "utf8"),
  ]);
  const sessions = addDailyContext(rawSessions, JSON.parse(contextText));
  const coverage = factorCoverage(sessions);
  const backtest = new FactorBacktestEngine().run(sessions, {
    factorIds: FACTOR_IDS,
    horizons: [5, 10, 15, 30],
    sampleInterval: 5,
    thresholdQuantile: 0.70,
    quantity: 1600,
    feeRate: 0.025,
    minCommission: true,
    slippage: 0.05,
    slippageMode: "percent",
    rolling: { minimumTrainDays: 60, testDays: 20, stepDays: 20 },
  });
  const reports = compactReport(backtest);
  const output = {
    mode: "zijin-601899-shadow-factor-research",
    researchOnly: true,
    affectsSmartT: false,
    symbol: "601899",
    createdAt: new Date().toISOString(),
    dataset: {
      path: minuteDataPath,
      checksum,
      sessions: sessions.length,
      firstDate: sessions[0]?.date ?? null,
      lastDate: sessions.at(-1)?.date ?? null,
    },
    context: {
      path: contextDataPath,
      market: "sh000001 current-open versus prior-close",
      sector: "sh512400 current-open versus prior-close",
      goldCopper: "not available; kept null",
    },
    config: backtest.config,
    antiOverfitting: backtest.antiOverfitting,
    coverage,
    topPositiveT: topByDirection(reports, "positiveT"),
    topReverseT: topByDirection(reports, "reverseT"),
    reports,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    output: outputPath,
    dataset: output.dataset,
    coverage,
    topPositiveT: output.topPositiveT,
    topReverseT: output.topReverseT,
  }, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
