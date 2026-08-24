import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { buildTimeSplits, assertDisjointTimeSplits } from "../lib/factor-research/factor-backtest-engine.mjs";
import { simulateClosureTrade } from "../lib/factor-research/factor-closure-backtest.mjs";
import { FactorEngine } from "../lib/factor-research/factor-engine.mjs";
import { maximumDrawdown } from "../lib/factor-research/factor-evaluation.mjs";
import { resolveGitCommit, sha256 } from "../lib/factor-research/reproducibility.mjs";
import {
  buildZuoTCandidateEvents,
  buildZuoTShadowDecisions,
  ZUOT_V2_CORE_FACTOR_IDS,
  ZUOT_V2_SHADOW_VERSION,
} from "../lib/factor-research/zuot-v2-shadow.mjs";
import {
  DEFAULT_ZIJIN_CHIP_ORDERFLOW_CONFIG,
  evaluateZijinChipOrderFlowShadow,
  ZIJIN_CHIP_ORDERFLOW_SHADOW_SAFETY,
  ZIJIN_CHIP_ORDERFLOW_SHADOW_VERSION,
} from "../lib/zijin-chip-orderflow-shadow.mjs";
import { ZUOT_V2_COMMON_BACKTEST_CONFIG } from "./backtest-zuot-v2-shadow.mjs";

const DEFAULT_MINUTE_DATA = "E:\\zijin-l2\\601899-factor-minute-ohlc-v1.jsonl";
const DEFAULT_CONTEXT_DATA = "E:\\zijin-l2\\zijin-market-sector-daily-2024-2026.json";
const DEFAULT_OUTPUT = "public/research/zijin-chip-orderflow-shadow.json";
const BASELINE_EXPERIMENT_ID = "v2-standalone";
const SLIPPAGE_BPS_PER_SIDE = 2;

const round = (value, digits = 8) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadJsonLines(filePath) {
  const sessions = [];
  const hash = createHash("sha256");
  const input = createReadStream(filePath);
  input.on("data", chunk => hash.update(chunk));
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const session = JSON.parse(line);
    if (String(session.symbol) === "601899" && Array.isArray(session.minutes)) sessions.push(session);
  }
  sessions.sort((left, right) => String(left.date).localeCompare(String(right.date)));
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
    const values = [marketOpenGap, sectorOpenGap].filter(Number.isFinite);
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    return {
      ...session,
      marketOpenGap,
      sectorOpenGap,
      marketRegime: mean === null ? "unknown" : mean >= 0.005 ? "strong" : mean <= -0.005 ? "weak" : "range",
    };
  });
}

function dateInRange(date, startDate, endDate) {
  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}

function groupCount(rows, selector) {
  const result = {};
  for (const row of rows) {
    const key = String(selector(row) ?? "unknown");
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function tradeMetrics(trades) {
  const ordered = [...trades].sort((left, right) => left.date.localeCompare(right.date) || left.entryIndex - right.entryIndex);
  const wins = ordered.filter(trade => trade.netPnl > 0);
  const losses = ordered.filter(trade => trade.netPnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  return {
    trades: ordered.length,
    wins: wins.length,
    losses: losses.length,
    afterCostWinRate: ordered.length ? round(wins.length / ordered.length) : null,
    grossPnl: round(ordered.reduce((sum, trade) => sum + trade.grossPnl, 0), 4),
    fees: round(ordered.reduce((sum, trade) => sum + trade.fees, 0), 4),
    netPnl: round(ordered.reduce((sum, trade) => sum + trade.netPnl, 0), 4),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    maximumDrawdown: round(maximumDrawdown(ordered.map(trade => trade.netReturn))),
    exits: groupCount(ordered, trade => trade.exitReason),
  };
}

function simulateSignal(signal, sessionsByDate) {
  const computed = sessionsByDate.get(signal.date);
  const config = {
    ...ZUOT_V2_COMMON_BACKTEST_CONFIG,
    slippage: SLIPPAGE_BPS_PER_SIDE / 100,
    slippageMode: "percent",
  };
  return simulateClosureTrade({
    session: computed?.session,
    entryIndex: signal.index,
    direction: signal.direction,
    atrRate: signal.atrRate,
    config,
    pricePathMode: ZUOT_V2_COMMON_BACKTEST_CONFIG.pricePathMode,
  });
}

function compareRows(rows) {
  const baselineTrades = rows.map(row => row.baselineTrade).filter(Boolean);
  const retainedRows = rows.filter(row => row.shadow.retained);
  const retainedTrades = retainedRows.map(row => row.baselineTrade).filter(Boolean);
  const rejectedRows = rows.filter(row => !row.shadow.retained && row.baselineTrade);
  const rejectedWinningTrades = rejectedRows.filter(row => row.baselineTrade.netPnl > 0).length;
  const rejectedLosingTrades = rejectedRows.filter(row => row.baselineTrade.netPnl < 0).length;
  const baselineWinningTrades = baselineTrades.filter(trade => trade.netPnl > 0).length;
  return {
    baselineSignals: rows.length,
    retainedSignals: retainedRows.length,
    signalRetentionRate: rows.length ? round(retainedRows.length / rows.length) : null,
    baseline: tradeMetrics(baselineTrades),
    fourLayerConfirmation: tradeMetrics(retainedTrades),
    impact: {
      rejectedTrades: rejectedRows.length,
      lossesCorrectlyIntercepted: rejectedLosingTrades,
      winningTradesMistakenlyRejected: rejectedWinningTrades,
      winnerVetoRate: baselineWinningTrades ? round(rejectedWinningTrades / baselineWinningTrades) : null,
      vetoFalsePositiveRate: rejectedRows.length ? round(rejectedWinningTrades / rejectedRows.length) : null,
      rejectionReasons: groupCount(
        rows.filter(row => !row.shadow.retained).flatMap(row => row.shadow.rejectionReasons ?? [row.shadow.reason]),
        reason => reason,
      ),
    },
  };
}

function compareScope(rows, dates) {
  const dateSet = dates instanceof Set ? dates : new Set(dates);
  const scoped = rows.filter(row => dateSet.has(row.signal.date));
  const comparison = compareRows(scoped);
  comparison.byDirection = Object.fromEntries(["positiveT", "reverseT"].map(direction => [
    direction,
    compareRows(scoped.filter(row => row.signal.direction === direction)),
  ]));
  return comparison;
}

function rollingOutOfSample(rows, developmentDates) {
  const folds = [];
  const { minimumTrainDays, testDays, stepDays } = ZUOT_V2_COMMON_BACKTEST_CONFIG.rolling;
  for (let trainEnd = minimumTrainDays; trainEnd < developmentDates.length; trainEnd += stepDays) {
    const test = developmentDates.slice(trainEnd, Math.min(developmentDates.length, trainEnd + testDays));
    if (!test.length) continue;
    folds.push({
      trainStart: developmentDates[0] ?? null,
      trainThrough: developmentDates[trainEnd - 1] ?? null,
      testStart: test[0] ?? null,
      testEnd: test.at(-1) ?? null,
      trainDays: trainEnd,
      testDays: test.length,
      fixedRulesNoRefit: true,
      result: compareScope(rows, test),
    });
  }
  return { fixedRulesNoRefit: true, folds };
}

function promotionReview(lockedTest) {
  const baseline = lockedTest.baseline;
  const candidate = lockedTest.fourLayerConfirmation;
  const gates = {
    minimumLockedTestTrades30: candidate.trades >= 30,
    lockedTestNetPositive: candidate.netPnl > 0,
    lockedTestNetNoWorseThanBaseline: candidate.netPnl >= baseline.netPnl,
    lockedTestProfitFactorAtLeast12: candidate.profitFactor !== null && candidate.profitFactor >= 1.2,
    lockedTestProfitFactorNoWorseThanBaseline: candidate.profitFactor !== null
      && baseline.profitFactor !== null
      && candidate.profitFactor >= baseline.profitFactor,
    lockedTestDrawdownNoWorseThanBaseline: candidate.maximumDrawdown !== null
      && baseline.maximumDrawdown !== null
      && candidate.maximumDrawdown <= baseline.maximumDrawdown,
    winnerVetoRateAtMost20Percent: lockedTest.impact.winnerVetoRate !== null
      && lockedTest.impact.winnerVetoRate <= 0.20,
  };
  const passed = Object.values(gates).every(Boolean);
  return {
    gates,
    passed,
    status: passed ? "eligible-for-human-review" : "continue-shadow-research",
    automaticPromotion: false,
    productionSignalImpact: false,
  };
}

async function main() {
  const minuteDataPath = path.resolve(argument("minute-data", DEFAULT_MINUTE_DATA));
  const contextDataPath = path.resolve(argument("context-data", DEFAULT_CONTEXT_DATA));
  const outputPath = path.resolve(argument("output", DEFAULT_OUTPUT));
  const startDate = argument("start-date");
  const endDate = argument("end-date");
  const { sessions: loadedSessions, checksum } = await loadJsonLines(minuteDataPath);
  if (!loadedSessions.length) throw new Error("No 601899 sessions found in minute dataset");
  const contextAvailable = await exists(contextDataPath);
  const context = contextAvailable ? JSON.parse(await readFile(contextDataPath, "utf8")) : null;
  const allSessions = context ? addDailyContext(loadedSessions, context) : loadedSessions;
  const selectedSessions = allSessions.filter(session => dateInRange(String(session.date), startDate, endDate));
  if (!selectedSessions.length) {
    throw new Error(`No sessions in requested range ${startDate ?? "dataset-start"}..${endDate ?? "dataset-end"}`);
  }

  const factorEngine = new FactorEngine();
  const computedSessions = factorEngine.computeSessions(selectedSessions, { factorIds: ZUOT_V2_CORE_FACTOR_IDS });
  const sessionsByDate = new Map(computedSessions.map(computed => [String(computed.session.date), computed]));
  const rawSessionsByDate = new Map(allSessions.map(session => [String(session.date), session]));
  const dates = [...sessionsByDate.keys()].sort();
  const splits = buildTimeSplits(dates, ZUOT_V2_COMMON_BACKTEST_CONFIG.splitRatios);
  assertDisjointTimeSplits(splits);

  const decisions = buildZuoTShadowDecisions(computedSessions, { experimentId: BASELINE_EXPERIMENT_ID });
  const signals = buildZuoTCandidateEvents(decisions).map(event => event.formalDecision).filter(Boolean);
  const evaluatedRows = signals.map(signal => {
    const currentSession = rawSessionsByDate.get(String(signal.date));
    const shadow = evaluateZijinChipOrderFlowShadow({
      baselineDecision: signal,
      sessions: allSessions,
      currentSession,
    });
    return {
      signal,
      shadow,
      baselineTrade: simulateSignal(signal, sessionsByDate),
    };
  });

  const developmentDates = [...splits.train, ...splits.validation];
  const scopes = {
    fullSample: compareScope(evaluatedRows, dates),
    train: compareScope(evaluatedRows, splits.train),
    validation: compareScope(evaluatedRows, splits.validation),
    lockedTest: compareScope(evaluatedRows, splits.test),
  };
  const availableYears = [...new Set(dates.map(date => date.slice(0, 4)))];
  const report = {
    mode: "zijin-chip-map-order-flow-four-layer-shadow",
    symbol: "601899",
    createdAt: new Date().toISOString(),
    version: ZIJIN_CHIP_ORDERFLOW_SHADOW_VERSION,
    baselineVersion: ZUOT_V2_SHADOW_VERSION,
    safety: ZIJIN_CHIP_ORDERFLOW_SHADOW_SAFETY,
    disclosure: {
      chipMapIsProxy: true,
      chipMapDefinition: "Causal minute volume-at-price proxy; it is not account-level holder cost distribution.",
      cancellationIsHeuristic: true,
      cancellationDefinition: "Abnormal depth disappearance inferred from adjacent retained snapshots; no order IDs are available.",
      confirmationCannotCreateSignals: true,
    },
    requestedRange: { startDate, endDate },
    dataset: {
      datasetId: `zijin-601899-minute-ohlc-l2-${checksum.slice(0, 12)}`,
      path: minuteDataPath,
      checksum,
      loadedSessions: allSessions.length,
      selectedSessions: selectedSessions.length,
      firstAvailableDate: String(allSessions[0]?.date ?? ""),
      lastAvailableDate: String(allSessions.at(-1)?.date ?? ""),
      firstSelectedDate: dates[0] ?? null,
      lastSelectedDate: dates.at(-1) ?? null,
      availableYears,
      requested2024Available: availableYears.includes("2024"),
      contextPath: contextAvailable ? contextDataPath : null,
    },
    reproducibility: {
      datasetChecksum: checksum,
      engineVersion: `${factorEngine.engineVersion}+zuot-${ZUOT_V2_SHADOW_VERSION}+chip-flow-${ZIJIN_CHIP_ORDERFLOW_SHADOW_VERSION}`,
      factorVersion: computedSessions[0]?.factorVersion ?? "unknown",
      configHash: sha256({
        baseline: ZUOT_V2_COMMON_BACKTEST_CONFIG,
        chipOrderFlow: DEFAULT_ZIJIN_CHIP_ORDERFLOW_CONFIG,
        startDate,
        endDate,
        slippageBpsPerSide: SLIPPAGE_BPS_PER_SIDE,
      }),
      asOf: `${dates.at(-1)}T${computedSessions.at(-1)?.session.minutes.at(-1)?.time ?? "1500"}`,
      gitCommit: resolveGitCommit(),
    },
    config: {
      baselineExperimentId: BASELINE_EXPERIMENT_ID,
      slippageBpsPerSide: SLIPPAGE_BPS_PER_SIDE,
      chipOrderFlow: DEFAULT_ZIJIN_CHIP_ORDERFLOW_CONFIG,
    },
    timeSplits: splits,
    antiOverfitting: {
      chronologicalSplit: true,
      disjointSplitAudit: true,
      lockedFinal20Percent: true,
      fixedRulesNoLockedTestRefit: true,
      rollingOutOfSample: true,
      causalChipMap: true,
      missingL2CannotConfirm: true,
    },
    scopes,
    rollingOutOfSample: rollingOutOfSample(evaluatedRows, developmentDates),
  };
  report.promotionReview = promotionReview(scopes.lockedTest);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    output: outputPath,
    dataset: report.dataset,
    fullSample: report.scopes.fullSample,
    lockedTest: report.scopes.lockedTest,
    promotionReview: report.promotionReview,
  }, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
