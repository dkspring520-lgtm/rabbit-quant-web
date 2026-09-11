import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildTimeSplits, assertDisjointTimeSplits } from "../lib/factor-research/factor-backtest-engine.mjs";
import { FactorEngine } from "../lib/factor-research/factor-engine.mjs";

const DEFAULT_MINUTE_DATA = "E:\\zijin-l2\\601899-factor-minute-ohlc-v1.jsonl";
const DEFAULT_LEDGER = "E:\\zijin-l2\\research-results\\zijin-v29-zuot-ab-base-samples.jsonl";
const DEFAULT_BASE_REPORT = "E:\\zijin-l2\\research-results\\zijin-v29-zuot-ab-base.json";
const DEFAULT_OUTPUT = "public/research/zijin-v29-zuot-ab.json";

export const ZIJIN_V29_ZUOT_AB_VERSION = "1.1.0-research";
export const ZIJIN_V29_ZUOT_FACTOR_IDS = Object.freeze([
  "vwap.bias",
  "volume.ratio_5_20",
  "volume.price_alignment_5m",
  "technical.macd_histogram",
  "technical.macd_histogram_delta",
  "orderflow.active_buy_imbalance",
  "orderflow.ofi_change_3m",
  "price.return_5m",
]);

export const ZIJIN_V29_ZUOT_AB_CONFIG = Object.freeze({
  maximumOpposingReturn5m: 0.004,
  continuationReturn5m: 0.002,
  continuationVolumeRatio: 1.15,
  minimumVwapBias: 0.0005,
  minimumVolumeRatio: 0.75,
  maximumOpposingVolumeAlignment: 0.35,
  minimumOfiImbalance: 0.02,
  minimumOfiChange: 0,
  minimumCompactVotes: 3,
  missingConfirmationPolicy: "reject",
  openingMinimumEvidencePoints: 3,
  positiveCollapseMaximumActiveBuyRatio: 0.25,
  positiveCollapseMaximumActiveBuyRatioChange: -0.13,
  positiveCollapseMaximumMicropriceEdgeBps: 3,
  positiveDivergenceMaximumActiveBuyRatio: 0.25,
  positiveDivergenceMaximumMicropriceEdgeBps: 1,
  positiveDivergenceMinimumPriceResponseBps: 15,
  splitRatios: Object.freeze({ train: 0.6, validation: 0.2, test: 0.2 }),
});

const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
  ? Number(value)
  : null;

const round = (value, digits = 8) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function argument(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function timeToSecond(time) {
  const normalized = String(time ?? "").replaceAll(":", "").padStart(4, "0").slice(0, 4);
  const hour = Number(normalized.slice(0, 2));
  const minute = Number(normalized.slice(2, 4));
  return Number.isInteger(hour) && Number.isInteger(minute) ? hour * 3600 + minute * 60 : null;
}

export function selectLastCompletedFactorRow(rows, decisionSecond) {
  const cutoff = finite(decisionSecond);
  if (cutoff === null) return null;
  let selected = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    const minuteStart = timeToSecond(row?.time);
    if (minuteStart === null || minuteStart + 60 > cutoff) continue;
    if (!selected || minuteStart > selected.minuteStart) selected = { row, minuteStart };
  }
  return selected ? {
    ...selected.row,
    minuteStartSecond: selected.minuteStart,
    minuteEndSecond: selected.minuteStart + 59,
  } : null;
}

export function evaluateV29OpeningShadow({ direction, evidence, decisionSecond, config: options = {} }) {
  if (!["positiveT", "reverseT"].includes(direction)) throw new Error(`Unsupported direction: ${direction}`);
  const config = { ...ZIJIN_V29_ZUOT_AB_CONFIG, ...options };
  const cutoff = finite(decisionSecond);
  const provided = Array.isArray(evidence) ? evidence : [];
  const causalEvidence = cutoff === null ? [] : provided
    .filter(point => {
      const second = finite(point?.second);
      return second !== null && second <= cutoff;
    })
    .sort((left, right) => Number(left.second) - Number(right.second));
  const ignoredFutureEvidencePoints = provided.length - causalEvidence.length;
  if (causalEvidence.length < config.openingMinimumEvidencePoints) {
    return {
      eligible: false,
      retainVariantA: true,
      retainVariantB: true,
      flowCollapseVeto: false,
      priceFlowDivergenceVeto: false,
      vetoReasons: ["insufficient-causal-opening-evidence"],
      causalEvidencePoints: causalEvidence.length,
      ignoredFutureEvidencePoints,
    };
  }

  const first = causalEvidence[0];
  const last = causalEvidence.at(-1);
  const firstActiveBuyRatio = finite(first.activeBuyRatio);
  const activeBuyRatio = finite(last.activeBuyRatio);
  const activeBuyRatioChange = firstActiveBuyRatio === null || activeBuyRatio === null
    ? null
    : activeBuyRatio - firstActiveBuyRatio;
  const micropriceEdgeBps = finite(last.micropriceEdgeBps);
  const priceResponseBps = finite(last.priceResponseBps);
  const flowCollapseVeto = direction === "positiveT"
    && activeBuyRatio !== null
    && activeBuyRatio <= config.positiveCollapseMaximumActiveBuyRatio
    && activeBuyRatioChange !== null
    && activeBuyRatioChange <= config.positiveCollapseMaximumActiveBuyRatioChange
    && micropriceEdgeBps !== null
    && micropriceEdgeBps <= config.positiveCollapseMaximumMicropriceEdgeBps;
  const priceFlowDivergenceVeto = direction === "positiveT"
    && activeBuyRatio !== null
    && activeBuyRatio <= config.positiveDivergenceMaximumActiveBuyRatio
    && micropriceEdgeBps !== null
    && micropriceEdgeBps <= config.positiveDivergenceMaximumMicropriceEdgeBps
    && priceResponseBps !== null
    && priceResponseBps >= config.positiveDivergenceMinimumPriceResponseBps;
  const vetoReasons = [];
  if (flowCollapseVeto) vetoReasons.push("positive-active-buy-flow-collapse");
  if (priceFlowDivergenceVeto) vetoReasons.push("positive-price-flow-divergence");

  return {
    eligible: true,
    retainVariantA: !flowCollapseVeto,
    retainVariantB: !flowCollapseVeto && !priceFlowDivergenceVeto,
    flowCollapseVeto,
    priceFlowDivergenceVeto,
    vetoReasons,
    firstActiveBuyRatio,
    activeBuyRatio,
    activeBuyRatioChange: round(activeBuyRatioChange),
    micropriceEdgeBps,
    priceResponseBps,
    causalEvidencePoints: causalEvidence.length,
    causalEvidenceEndSecond: finite(last.second),
    ignoredFutureEvidencePoints,
  };
}

function directionalValue(direction, positiveTValue) {
  return direction === "positiveT" ? positiveTValue : -positiveTValue;
}

export function evaluateV29ZuoTConfirmation({ direction, factorRow, config: options = {} }) {
  if (!["positiveT", "reverseT"].includes(direction)) throw new Error(`Unsupported direction: ${direction}`);
  const config = { ...ZIJIN_V29_ZUOT_AB_CONFIG, ...options };
  if (!factorRow) {
    return {
      eligible: false,
      directionContinuationPass: false,
      compactScorePass: false,
      compactVotes: 0,
      rejectionReasons: ["no-completed-minute-before-decision"],
    };
  }

  const factors = factorRow.factors ?? {};
  const return5m = finite(factors["price.return_5m"]);
  const volumeRatio = finite(factors["volume.ratio_5_20"]);
  const volumeAlignment = finite(factors["volume.price_alignment_5m"]);
  const macdHistogram = finite(factors["technical.macd_histogram"]);
  const macdDelta = finite(factors["technical.macd_histogram_delta"]);
  const ofi = finite(factors["orderflow.active_buy_imbalance"]);
  const ofiChange = finite(factors["orderflow.ofi_change_3m"]);
  const vwapBias = finite(factors["vwap.bias"]);
  const directionalReturn = return5m === null ? null : directionalValue(direction, return5m);
  const directionalMacd = macdHistogram === null ? null : directionalValue(direction, macdHistogram);
  const directionalMacdDelta = macdDelta === null ? null : directionalValue(direction, macdDelta);
  const directionalOfi = ofi === null ? null : directionalValue(direction, ofi);
  const directionalOfiChange = ofiChange === null ? null : directionalValue(direction, ofiChange);

  const directionGate = directionalReturn !== null
    && directionalReturn >= -config.maximumOpposingReturn5m;
  const continuationVeto = directionalReturn !== null
    && directionalReturn <= -config.continuationReturn5m
    && volumeRatio !== null
    && volumeRatio >= config.continuationVolumeRatio
    && directionalMacdDelta !== null
    && directionalMacdDelta < 0
    && directionalOfi !== null
    && directionalOfi < -config.minimumOfiImbalance;
  const votes = {
    vwap: vwapBias !== null && directionalValue(direction, -vwapBias) >= config.minimumVwapBias,
    volume: volumeRatio !== null
      && volumeRatio >= config.minimumVolumeRatio
      && (volumeAlignment === null
        || directionalValue(direction, volumeAlignment) >= -config.maximumOpposingVolumeAlignment),
    macd: directionalMacdDelta !== null
      && (directionalMacdDelta > 0 || (directionalMacd !== null && directionalMacd > 0)),
    ofi: directionalOfi !== null
      && directionalOfi >= config.minimumOfiImbalance
      && (directionalOfiChange === null || directionalOfiChange >= config.minimumOfiChange),
  };
  const compactVotes = Object.values(votes).filter(Boolean).length;
  const directionContinuationPass = directionGate && !continuationVeto;
  const compactScorePass = directionContinuationPass
    && ofi !== null
    && votes.ofi
    && compactVotes >= config.minimumCompactVotes;
  const rejectionReasons = [];
  if (return5m === null) rejectionReasons.push("missing-five-minute-direction");
  else if (!directionGate) rejectionReasons.push("opposing-five-minute-direction");
  if (continuationVeto) rejectionReasons.push("opposing-continuation");
  if (ofi === null) rejectionReasons.push("missing-ofi");
  else if (!votes.ofi) rejectionReasons.push("ofi-not-confirmed");
  if (compactVotes < config.minimumCompactVotes) rejectionReasons.push("insufficient-compact-votes");

  return {
    eligible: return5m !== null,
    directionContinuationPass,
    compactScorePass,
    compactVotes,
    votes,
    directionGate,
    continuationVeto,
    factorTime: factorRow.time,
    factorMinuteEndSecond: factorRow.minuteEndSecond,
    return5m,
    rejectionReasons,
  };
}

async function loadJsonLines(filePath, selector = value => value) {
  const values = [];
  const hash = createHash("sha256");
  const input = createReadStream(filePath);
  input.on("data", chunk => hash.update(chunk));
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const selected = selector(JSON.parse(line));
    if (selected) values.push(selected);
  }
  return { values, checksum: hash.digest("hex") };
}

function maximumCurrencyDrawdown(trades) {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const trade of trades) {
    equity += finite(trade.simulation?.netPnl) ?? 0;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return drawdown;
}

function metrics(rows) {
  const trades = [...rows].sort((left, right) =>
    left.candidate.date.localeCompare(right.candidate.date)
      || left.decisionSecond - right.decisionSecond);
  const wins = trades.filter(row => finite(row.simulation?.netPnl) > 0);
  const losses = trades.filter(row => finite(row.simulation?.netPnl) < 0);
  const grossProfit = wins.reduce((sum, row) => sum + row.simulation.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, row) => sum + row.simulation.netPnl, 0));
  return {
    closedTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? round(wins.length / trades.length) : null,
    netPnl: round(trades.reduce((sum, row) => sum + (finite(row.simulation?.netPnl) ?? 0), 0), 4),
    fees: round(trades.reduce((sum, row) => sum + (finite(row.simulation?.fees) ?? 0), 0), 4),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    maximumDrawdown: round(maximumCurrencyDrawdown(trades), 4),
    byDirection: Object.fromEntries(["positiveT", "reverseT"].map(direction => {
      const scoped = trades.filter(row => row.candidate.direction === direction);
      const scopedWins = scoped.filter(row => row.simulation.netPnl > 0);
      const scopedLosses = scoped.filter(row => row.simulation.netPnl < 0);
      const profit = scopedWins.reduce((sum, row) => sum + row.simulation.netPnl, 0);
      const loss = Math.abs(scopedLosses.reduce((sum, row) => sum + row.simulation.netPnl, 0));
      return [direction, {
        closedTrades: scoped.length,
        winRate: scoped.length ? round(scopedWins.length / scoped.length) : null,
        netPnl: round(scoped.reduce((sum, row) => sum + row.simulation.netPnl, 0), 4),
        profitFactor: loss > 0 ? round(profit / loss) : profit > 0 ? null : 0,
      }];
    })),
  };
}

function evaluateScopes(rows, splits) {
  const scopes = { all: new Set([...splits.train, ...splits.validation, ...splits.test]) };
  for (const name of ["train", "validation", "test"]) scopes[name] = new Set(splits[name]);
  return Object.fromEntries(Object.entries(scopes).map(([name, dates]) => [
    name,
    metrics(rows.filter(row => dates.has(row.candidate.date))),
  ]));
}

function countReasons(rows, field) {
  const counts = {};
  for (const row of rows.filter(item => !item.confirmation[field])) {
    for (const reason of row.confirmation.rejectionReasons) counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}

function summarizeOpeningVetoReasons(rows, retainField) {
  const relevantReasons = retainField === "retainVariantA"
    ? new Set(["positive-active-buy-flow-collapse"])
    : null;
  const rejected = rows.filter(item => !item.openingShadow[retainField]);
  const counts = {};
  for (const row of rejected) {
    for (const reason of row.openingShadow.vetoReasons) {
      if (relevantReasons && !relevantReasons.has(reason)) continue;
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
  }
  return {
    uniqueRejectedTrades: rejected.length,
    ruleHits: counts,
  };
}

async function main() {
  const minuteDataPath = path.resolve(argument("minute-data", DEFAULT_MINUTE_DATA));
  const ledgerPath = path.resolve(argument("ledger", DEFAULT_LEDGER));
  const baseReportPath = path.resolve(argument("base-report", DEFAULT_BASE_REPORT));
  const outputPath = path.resolve(argument("output", DEFAULT_OUTPUT));
  const [{ values: sessions, checksum: minuteChecksum }, { values: controlRows, checksum: ledgerChecksum }, baseReport] = await Promise.all([
    loadJsonLines(minuteDataPath, row => String(row.symbol) === "601899" ? row : null),
    loadJsonLines(ledgerPath, row => row.studyLayer === "riskManagedV29" && row.executed && row.simulation ? row : null),
    readFile(baseReportPath, "utf8").then(JSON.parse),
  ]);
  if (!sessions.length) throw new Error("No 601899 minute sessions found");
  if (!controlRows.length) throw new Error("No executed riskManagedV29 ledger rows found");

  const engine = new FactorEngine();
  const computed = engine.computeSessions(sessions, { factorIds: ZIJIN_V29_ZUOT_FACTOR_IDS });
  const computedByDate = new Map(computed.map(value => [value.session.date, value]));
  const compared = controlRows.map(row => {
    const factorRow = selectLastCompletedFactorRow(computedByDate.get(row.candidate.date)?.rows, row.decisionSecond);
    const confirmation = evaluateV29ZuoTConfirmation({
      direction: row.candidate.direction,
      factorRow,
    });
    const openingShadow = evaluateV29OpeningShadow({
      direction: row.candidate.direction,
      evidence: row.initialL2Decision?.evidence ?? row.l2Decision?.evidence,
      decisionSecond: row.decisionSecond,
    });
    return { ...row, confirmation, openingShadow };
  });
  const dates = computed.map(value => value.session.date).filter(Boolean).sort();
  const splits = buildTimeSplits(dates, ZIJIN_V29_ZUOT_AB_CONFIG.splitRatios);
  assertDisjointTimeSplits(splits);
  const variantA = compared.filter(row => row.confirmation.directionContinuationPass);
  const variantB = compared.filter(row => row.confirmation.compactScorePass);
  const openingVariantA = compared.filter(row => row.openingShadow.retainVariantA);
  const openingVariantB = compared.filter(row => row.openingShadow.retainVariantB);
  const withCompletedMinute = compared.filter(row => row.confirmation.factorTime);
  const withFiveMinuteDirection = compared.filter(row => row.confirmation.eligible);
  const withOpeningEvidence = compared.filter(row => row.openingShadow.eligible);
  const futureLeakageViolations = compared.filter(row => row.confirmation.factorMinuteEndSecond >= row.decisionSecond);
  const openingLeakageViolations = compared.filter(row =>
    row.openingShadow.causalEvidenceEndSecond > row.decisionSecond);
  const ignoredFutureEvidencePoints = compared.reduce((sum, row) =>
    sum + row.openingShadow.ignoredFutureEvidencePoints, 0);
  const missingOfiRows = compared.filter(row => row.confirmation.rejectionReasons.includes("missing-ofi"));
  const openingVariantBMetrics = evaluateScopes(openingVariantB, splits);

  const report = {
    mode: "zijin-v29-zuot-confirmation-ab",
    engineVersion: ZIJIN_V29_ZUOT_AB_VERSION,
    researchOnly: true,
    symbol: "601899.SH",
    safety: {
      affectsSmartT: false,
      affectsTradingAdapter: false,
      affectsProductionStrategy: false,
      automaticPromotion: false,
    },
    comparison: {
      control: "V2.9 recorded trades unchanged",
      variantA: "V2.9 retained only when causal five-minute direction passes and continuation is not vetoed",
      variantB: "Variant A plus VWAP, volume, MACD and OFI compact confirmation",
      openingVariantA: "V2.9 opening trades retained unless causal decision-time positive-T active-buy flow collapses",
      openingVariantB: "Opening Variant A plus positive-T price/flow divergence veto; reverse-T remains unchanged",
      variantBehavior: "Variants can only retain or reject an existing V2.9 trade; recorded entry, exit, fees and PnL are never changed",
    },
    config: ZIJIN_V29_ZUOT_AB_CONFIG,
    dataset: {
      minuteDataPath,
      minuteChecksum,
      ledgerPath,
      ledgerChecksum,
      baseReportPath,
      baseReportCommit: baseReport?.reproducibility?.gitCommit ?? null,
      sessions: sessions.length,
      firstDate: dates[0],
      lastDate: dates.at(-1),
    },
    reproducibility: {
      gitCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      asOf: new Date().toISOString(),
      factorEngineVersion: engine.engineVersion,
      factorIds: ZIJIN_V29_ZUOT_FACTOR_IDS,
    },
    eligibility: {
      controlTrades: compared.length,
      tradesWithCompletedPriorMinute: withCompletedMinute.length,
      tradesWithCausalFiveMinuteDirection: withFiveMinuteDirection.length,
      openingDecisionTrades: compared.filter(row => row.decisionSecond < 34260).length,
      tradesWithCausalOpeningEvidence: withOpeningEvidence.length,
      openingEvidencePointDistribution: Object.fromEntries([...new Set(compared.map(row =>
        row.openingShadow.causalEvidencePoints))].sort((left, right) => left - right).map(points => [
        points,
        compared.filter(row => row.openingShadow.causalEvidencePoints === points).length,
      ])),
      missingOfiTrades: missingOfiRows.length,
      conclusion: withFiveMinuteDirection.length
        ? "The confirmation layer had causally eligible V2.9 trades."
        : "No V2.9 executed trade had a completed five-minute direction window before its decision; A/B effectiveness is not estimable from this ledger.",
    },
    antiLeakage: {
      usesLastFullyCompletedMinuteOnly: true,
      currentIncompleteMinuteExcluded: true,
      openingEvidenceThroughDecisionSecondOnly: true,
      openingEvidenceAfterDecisionIgnored: ignoredFutureEvidencePoints,
      missingFactorValuesRemainMissing: true,
      futureLeakageViolations: futureLeakageViolations.length,
      openingLeakageViolations: openingLeakageViolations.length,
      pass: futureLeakageViolations.length === 0 && openingLeakageViolations.length === 0,
    },
    researchValidity: {
      classification: "historical-diagnostic-hypothesis-only",
      cleanHeldOutClaim: false,
      reason: "All 41 historical outcomes were inspected during this optimization cycle; chronological splits are descriptive and a new forward sample is required.",
      requiredNextValidation: "Freeze these rules and collect unseen forward opening samples without threshold changes.",
    },
    results: {
      control: evaluateScopes(compared, splits),
      variantA: evaluateScopes(variantA, splits),
      variantB: evaluateScopes(variantB, splits),
      openingVariantA: evaluateScopes(openingVariantA, splits),
      openingVariantB: openingVariantBMetrics,
    },
    rejectionReasons: {
      variantA: countReasons(compared, "directionContinuationPass"),
      variantB: countReasons(compared, "compactScorePass"),
      openingVariantA: summarizeOpeningVetoReasons(compared, "retainVariantA"),
      openingVariantB: summarizeOpeningVetoReasons(compared, "retainVariantB"),
    },
    promotionAssessment: {
      status: "insufficient-sample-shadow-only",
      minimumClosedTrades: 100,
      currentClosedTrades: openingVariantBMetrics.all.closedTrades,
      currentDescriptiveTestTrades: openingVariantBMetrics.test.closedTrades,
      automaticPromotion: false,
    },
    verdict: {
      minuteConfirmation: withFiveMinuteDirection.length === 0
        ? "not-comparable-no-causal-five-minute-samples"
        : "compare-metrics-before-any-promotion",
      openingShadow: withOpeningEvidence.length
        ? "historical-improvement-observed-forward-validation-required"
        : "not-comparable-no-causal-opening-evidence",
    },
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outputPath,
    eligibility: report.eligibility,
    control: report.results.control.all,
    variantA: report.results.variantA.all,
    variantB: report.results.variantB.all,
    openingVariantA: report.results.openingVariantA.all,
    openingVariantB: report.results.openingVariantB.all,
    antiLeakage: report.antiLeakage,
    verdict: report.verdict,
  }, null, 2));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
