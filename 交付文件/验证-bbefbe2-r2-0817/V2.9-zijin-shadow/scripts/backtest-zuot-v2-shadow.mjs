import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { buildTimeSplits, assertDisjointTimeSplits } from "../lib/factor-research/factor-backtest-engine.mjs";
import { simulateClosureTrade } from "../lib/factor-research/factor-closure-backtest.mjs";
import { FactorEngine, auditFutureInvariance } from "../lib/factor-research/factor-engine.mjs";
import { maximumDrawdown } from "../lib/factor-research/factor-evaluation.mjs";
import { resolveGitCommit, sha256 } from "../lib/factor-research/reproducibility.mjs";
import {
  buildZuoTCandidateEvents,
  buildZuoTShadowDecisions,
  ZUOT_V1_RECONSTRUCTED_FACTOR_IDS,
  ZUOT_V2_CORE_FACTOR_IDS,
  ZUOT_V2_SHADOW_SAFETY,
  ZUOT_V2_SHADOW_VERSION,
} from "../lib/factor-research/zuot-v2-shadow.mjs";

const DEFAULT_MINUTE_DATA = "E:\\zijin-l2\\601899-factor-minute-ohlc-v1.jsonl";
const DEFAULT_CONTEXT_DATA = "E:\\zijin-l2\\zijin-market-sector-daily-2024-2026.json";
const DEFAULT_OUTPUT = "public/research/zuot-v2-shadow-backtest.json";
export const ZUOT_SHADOW_EXPERIMENT_IDS = Object.freeze([
  "v1-reconstructed-baseline",
  "v2-confirm-only",
  "v2-standalone",
]);
const SLIPPAGE_STRESS_BPS = Object.freeze([2, 5, 10]);
export const ZUOT_V2_COMMON_BACKTEST_CONFIG = Object.freeze({
  quantity: 1600,
  feeRate: 0.025,
  minCommission: true,
  minimumPriceMove: 0.08,
  costCoverageMultiple: 2,
  takeProfitAtrMultiple: 0.8,
  stopLossAtrMultiple: 0.65,
  minimumStopMove: 0.06,
  maximumHoldMinutes: Object.freeze({ positiveT: 45, reverseT: 50 }),
  pricePathMode: "ohlc-first-touch",
  sameMinuteConflict: "stop-first",
  l2ContinuityMinutes: 5,
  splitRatios: Object.freeze({ train: 0.60, validation: 0.20, test: 0.20 }),
  rolling: Object.freeze({ minimumTrainDays: 60, testDays: 20, stepDays: 20 }),
});

export function resolveZuoTShadowBacktestConfig(experimentId) {
  if (!ZUOT_SHADOW_EXPERIMENT_IDS.includes(experimentId)) throw new Error(`Unsupported experiment: ${experimentId}`);
  return ZUOT_V2_COMMON_BACKTEST_CONFIG;
}

const round = (value, digits = 8) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function argument(name, fallback) {
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
    const parsed = JSON.parse(line);
    if (String(parsed.symbol) === "601899" && Array.isArray(parsed.minutes)) sessions.push(parsed);
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

function groupCount(rows, selector) {
  const groups = {};
  for (const row of rows) {
    const key = String(selector(row) ?? "unknown");
    groups[key] = (groups[key] ?? 0) + 1;
  }
  return groups;
}

function tradeMetrics(trades) {
  const ordered = [...trades].sort((left, right) => left.date.localeCompare(right.date) || left.entryIndex - right.entryIndex);
  const wins = ordered.filter(trade => trade.netPnl > 0);
  const losses = ordered.filter(trade => trade.netPnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const average = (rows, selector) => rows.length ? rows.reduce((sum, row) => sum + selector(row), 0) / rows.length : null;
  return {
    trades: ordered.length,
    wins: wins.length,
    losses: losses.length,
    afterCostWinRate: ordered.length ? round(wins.length / ordered.length) : null,
    grossPnl: round(ordered.reduce((sum, trade) => sum + trade.grossPnl, 0), 4),
    fees: round(ordered.reduce((sum, trade) => sum + trade.fees, 0), 4),
    netPnl: round(ordered.reduce((sum, trade) => sum + trade.netPnl, 0), 4),
    averageNetPnl: round(average(ordered, trade => trade.netPnl), 4),
    payoffRatio: wins.length && losses.length
      ? round(average(wins, trade => trade.netPnl) / Math.abs(average(losses, trade => trade.netPnl)))
      : null,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    maximumDrawdown: round(maximumDrawdown(ordered.map(trade => trade.netReturn))),
    averageMfe: round(average(ordered, trade => trade.mfe)),
    averageMae: round(average(ordered, trade => trade.mae)),
    exits: groupCount(ordered, trade => trade.exitReason),
  };
}

function groupTradeMetrics(trades, selector) {
  const groups = Map.groupBy(trades, selector);
  return Object.fromEntries([...groups.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([key, rows]) => [String(key ?? "unknown"), tradeMetrics(rows)]));
}

function simulateSignals(signals, sessionsByDate, slippageBps) {
  const config = { ...ZUOT_V2_COMMON_BACKTEST_CONFIG, slippage: slippageBps / 100, slippageMode: "percent" };
  return signals.map(signal => {
    const computed = sessionsByDate.get(signal.date);
    const trade = simulateClosureTrade({
      session: computed?.session,
      entryIndex: signal.index,
      direction: signal.direction,
      atrRate: signal.atrRate,
      config,
      pricePathMode: ZUOT_V2_COMMON_BACKTEST_CONFIG.pricePathMode,
    });
    return trade ? {
      ...trade,
      experimentId: signal.experimentId,
      vwapBias: signal.vwapBias,
      return5m: signal.return5m,
      v1VoteCount: signal.v1VoteCount,
      v2VoteCount: signal.v2VoteCount,
      continuationVeto: signal.continuationVeto,
    } : null;
  }).filter(Boolean);
}

function evaluateScope({ decisions, sessionsByDate, dates, slippageBps, includeCounterfactual = false }) {
  const dateSet = dates instanceof Set ? dates : new Set(dates);
  const scoped = decisions.filter(decision => dateSet.has(decision.date));
  const candidateEvents = buildZuoTCandidateEvents(scoped);
  const formalSignals = candidateEvents.map(event => event.formalDecision).filter(Boolean);
  const trades = simulateSignals(formalSignals, sessionsByDate, slippageBps);
  const metrics = tradeMetrics(trades);
  const candidateCount = candidateEvents.length;
  const takeProfits = metrics.exits.takeProfit ?? 0;
  const report = {
    slippageBpsPerSide: slippageBps,
    candidateEvents: candidateCount,
    formalSignals: formalSignals.length,
    candidateToFormalRate: candidateCount ? round(formalSignals.length / candidateCount) : null,
    targetClosureRate: formalSignals.length ? round(takeProfits / formalSignals.length) : null,
    metrics,
    byDirection: groupTradeMetrics(trades, trade => trade.direction),
    byYear: groupTradeMetrics(trades, trade => String(trade.date).slice(0, 4)),
    byMarketRegime: groupTradeMetrics(trades, trade => trade.marketRegime),
    rejectionReasons: groupCount(
      candidateEvents.filter(event => !event.formalDecision),
      event => event.firstDecision.rejectionReasons[0] ?? "other",
    ),
  };
  if (includeCounterfactual) {
    const rejectedSignals = candidateEvents.filter(event => !event.formalDecision).map(event => event.firstDecision);
    report.rejectedSignalCounterfactual = {
      signals: rejectedSignals.length,
      metrics: tradeMetrics(simulateSignals(rejectedSignals, sessionsByDate, slippageBps)),
    };
  }
  return report;
}

function rollingOutOfSample({ decisions, sessionsByDate, developmentDates }) {
  const folds = [];
  const aggregateTrades = [];
  const { minimumTrainDays, testDays, stepDays } = ZUOT_V2_COMMON_BACKTEST_CONFIG.rolling;
  for (let trainEnd = minimumTrainDays; trainEnd < developmentDates.length; trainEnd += stepDays) {
    const test = developmentDates.slice(trainEnd, Math.min(developmentDates.length, trainEnd + testDays));
    if (!test.length) continue;
    const scoped = decisions.filter(decision => test.includes(decision.date));
    const signals = buildZuoTCandidateEvents(scoped).map(event => event.formalDecision).filter(Boolean);
    const trades = simulateSignals(signals, sessionsByDate, 2);
    aggregateTrades.push(...trades);
    folds.push({
      trainStart: developmentDates[0] ?? null,
      trainThrough: developmentDates[trainEnd - 1] ?? null,
      testStart: test[0] ?? null,
      testEnd: test.at(-1) ?? null,
      trainDays: trainEnd,
      testDays: test.length,
      fixedRuleNoRefit: true,
      timeOrdered: (developmentDates[trainEnd - 1] ?? "") < (test[0] ?? ""),
      result: tradeMetrics(trades),
    });
  }
  return {
    scope: "development-only-excludes-locked-test",
    fixedRuleNoRefit: true,
    folds,
    aggregate: tradeMetrics(aggregateTrades),
  };
}

function experimentFactorIds(experimentId) {
  return experimentId === "v1-reconstructed-baseline"
    ? ZUOT_V1_RECONSTRUCTED_FACTOR_IDS
    : ZUOT_V2_CORE_FACTOR_IDS;
}

function promotionReview(experiments) {
  const baseline = experiments["v1-reconstructed-baseline"];
  const v2 = experiments["v2-standalone"];
  const full = v2.fullSample["2bps"].metrics;
  const locked = v2.lockedTest["2bps"].metrics;
  const stress = v2.lockedTest["5bps"].metrics;
  const baselineLocked = baseline.lockedTest["2bps"].metrics;
  const gates = {
    minimumClosures100: full.trades >= 100,
    lockedTestNetPositive: locked.netPnl > 0,
    lockedTestProfitFactor: locked.profitFactor !== null && locked.profitFactor >= 1.2,
    lockedTestWinRate: locked.afterCostWinRate !== null && locked.afterCostWinRate >= 0.52,
    stress5BpsNetPositive: stress.netPnl > 0,
    drawdownNoWorseThanReconstructedV1: locked.maximumDrawdown !== null
      && baselineLocked.maximumDrawdown !== null
      && locked.maximumDrawdown <= baselineLocked.maximumDrawdown,
  };
  return {
    gates,
    passed: Object.values(gates).every(Boolean),
    status: Object.values(gates).every(Boolean) ? "eligible-for-human-review" : "continue-shadow-research",
    automaticPromotion: false,
    warning: "V1 is a reconstructed comparison baseline, not a preserved historical artifact.",
  };
}

async function main() {
  const minuteDataPath = path.resolve(argument("minute-data", DEFAULT_MINUTE_DATA));
  const contextDataPath = path.resolve(argument("context-data", DEFAULT_CONTEXT_DATA));
  const outputPath = path.resolve(argument("output", DEFAULT_OUTPUT));
  const { sessions: rawSessions, checksum } = await loadJsonLines(minuteDataPath);
  if (!rawSessions.length) throw new Error("No 601899 sessions found in minute dataset");
  const contextAvailable = await exists(contextDataPath);
  const context = contextAvailable ? JSON.parse(await readFile(contextDataPath, "utf8")) : null;
  const sessions = context ? addDailyContext(rawSessions, context) : rawSessions;
  const allFactorIds = [...new Set(ZUOT_V1_RECONSTRUCTED_FACTOR_IDS)];
  const factorEngine = new FactorEngine();
  const computedSessions = factorEngine.computeSessions(sessions, { factorIds: allFactorIds });
  const sessionsByDate = new Map(computedSessions.map(computed => [computed.session.date, computed]));
  const dates = [...sessionsByDate.keys()].filter(Boolean).sort();
  const splits = buildTimeSplits(dates, ZUOT_V2_COMMON_BACKTEST_CONFIG.splitRatios);
  assertDisjointTimeSplits(splits);
  const developmentDates = [...splits.train, ...splits.validation];
  const allDates = new Set(dates);
  const lockedDates = new Set(splits.test);
  const experiments = {};

  for (const experimentId of ZUOT_SHADOW_EXPERIMENT_IDS) {
    const decisions = buildZuoTShadowDecisions(computedSessions, { experimentId });
    const fullSample = {};
    const lockedTest = {};
    for (const slippageBps of SLIPPAGE_STRESS_BPS) {
      fullSample[`${slippageBps}bps`] = evaluateScope({
        decisions,
        sessionsByDate,
        dates: allDates,
        slippageBps,
        includeCounterfactual: slippageBps === 2,
      });
      lockedTest[`${slippageBps}bps`] = evaluateScope({
        decisions,
        sessionsByDate,
        dates: lockedDates,
        slippageBps,
        includeCounterfactual: slippageBps === 2,
      });
    }
    experiments[experimentId] = {
      label: experimentId === "v1-reconstructed-baseline"
        ? "重建版 V1 对照（非历史原件）"
        : experimentId === "v2-confirm-only" ? "V2 仅确认 V1 候选" : "V2 精简因子独立候选",
      factorIds: experimentFactorIds(experimentId),
      fullSample,
      lockedTest,
      rollingOutOfSample: rollingOutOfSample({ decisions, sessionsByDate, developmentDates }),
    };
  }

  const report = {
    mode: "zuoT-v2-shadow-offline-research",
    symbol: "601899",
    version: ZUOT_V2_SHADOW_VERSION,
    createdAt: new Date().toISOString(),
    safety: ZUOT_V2_SHADOW_SAFETY,
    baselineDisclosure: "No preserved zuoT-v1-shadow artifact was found; V1 is reconstructed and must not be presented as historical production performance.",
    dataset: {
      datasetId: `zijin-601899-minute-ohlc-${checksum.slice(0, 12)}`,
      path: minuteDataPath,
      checksum,
      sessions: sessions.length,
      firstDate: dates[0] ?? null,
      lastDate: dates.at(-1) ?? null,
      contextPath: contextAvailable ? contextDataPath : null,
      contextMissingValues: "kept-null-not-zero-filled",
    },
    reproducibility: {
      datasetChecksum: checksum,
      engineVersion: `${factorEngine.engineVersion}+zuot-${ZUOT_V2_SHADOW_VERSION}`,
      factorVersion: computedSessions[0]?.factorVersion ?? "unknown",
      configHash: sha256({ backtest: ZUOT_V2_COMMON_BACKTEST_CONFIG, experiments: ZUOT_SHADOW_EXPERIMENT_IDS, slippage: SLIPPAGE_STRESS_BPS }),
      asOf: `${dates.at(-1)}T${computedSessions.at(-1)?.session.minutes.at(-1)?.time ?? "1500"}`,
      gitCommit: resolveGitCommit(),
    },
    commonBacktestConfig: ZUOT_V2_COMMON_BACKTEST_CONFIG,
    timeSplits: splits,
    lockedTest: {
      locked: true,
      optimizationAllowed: false,
      startDate: splits.test[0] ?? null,
      endDate: splits.test.at(-1) ?? null,
      days: splits.test.length,
    },
    antiOverfitting: {
      chronologicalSplit: true,
      disjointSplitAudit: true,
      lockedFinal20Percent: true,
      rollingOutOfSample: true,
      fixedRulesNoLockedTestRefit: true,
      futureLeakageAudit: auditFutureInvariance(sessions[0], { factorIds: allFactorIds }),
      missingOfiNeverFormal: true,
    },
    experiments,
  };
  report.promotionReview = promotionReview(experiments);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const summary = Object.fromEntries(ZUOT_SHADOW_EXPERIMENT_IDS.map(experimentId => {
    const experiment = experiments[experimentId];
    return [experimentId, {
      full2bps: experiment.fullSample["2bps"],
      locked2bps: experiment.lockedTest["2bps"],
      locked5bps: experiment.lockedTest["5bps"],
    }];
  }));
  process.stdout.write(`${JSON.stringify({ output: outputPath, dataset: report.dataset, promotionReview: report.promotionReview, summary }, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
