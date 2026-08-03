#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DEFAULT_INPUT = path.join(ROOT, ".tmp-zijin-through-20260722.jsonl");
const DEFAULT_OUTPUT = path.join(ROOT, "public", "research", "zijin-opening-slice-analysis.json");

const WINDOWS = [
  { id: "09:30-09:34", start: "0930", end: "0934" },
  { id: "09:35-09:39", start: "0935", end: "0939" },
  { id: "09:40-09:44", start: "0940", end: "0944" },
  { id: "09:45-09:59", start: "0945", end: "0959" },
];

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function quantile(values, q) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordered.length) return null;
  const position = (ordered.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower];
  const weight = position - lower;
  return ordered[lower] * (1 - weight) + ordered[upper] * weight;
}

function mean(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function median(values) {
  return quantile(values, 0.5);
}

function pct(to, from) {
  return Number.isFinite(to) && Number.isFinite(from) && from > 0
    ? (to / from - 1) * 100
    : null;
}

function rangePct(points, denominator) {
  const prices = points.map((point) => Number(point.price)).filter(Number.isFinite);
  if (!prices.length || !(denominator > 0)) return null;
  return (Math.max(...prices) - Math.min(...prices)) / denominator * 100;
}

function select(points, start, end) {
  return points.filter((point) => point.time >= start && point.time <= end);
}

function first(points, time) {
  return points.find((point) => point.time === time) ?? null;
}

function gapBucket(gapPct) {
  if (gapPct <= -1) return "低开≤-1%";
  if (gapPct < -0.3) return "低开-1%~-0.3%";
  if (gapPct <= 0.3) return "平开±0.3%";
  if (gapPct < 1) return "高开0.3%~1%";
  return "高开≥1%";
}

function directionBucket(movePct) {
  if (movePct >= 0.3) return "前5分钟上涨≥0.3%";
  if (movePct <= -0.3) return "前5分钟下跌≤-0.3%";
  return "前5分钟震荡";
}

function summarizeRows(rows) {
  const ranges = rows.map((row) => row.rangePct);
  const absReturns = rows.map((row) => Math.abs(row.returnPct));
  return {
    days: rows.length,
    meanRangePct: round(mean(ranges)),
    medianRangePct: round(median(ranges)),
    p75RangePct: round(quantile(ranges, 0.75)),
    p90RangePct: round(quantile(ranges, 0.90)),
    meanAbsoluteReturnPct: round(mean(absReturns)),
    rangeAtLeast050Rate: round(rows.filter((row) => row.rangePct >= 0.50).length / Math.max(1, rows.length)),
    rangeAtLeast070Rate: round(rows.filter((row) => row.rangePct >= 0.70).length / Math.max(1, rows.length)),
    rangeAtLeast100Rate: round(rows.filter((row) => row.rangePct >= 1.00).length / Math.max(1, rows.length)),
  };
}

function buildDay(raw) {
  const points = Array.isArray(raw.minutes)
    ? raw.minutes
      .map((point) => ({
        time: String(point.time ?? "").replace(/\D/g, "").padStart(4, "0").slice(-4),
        price: Number(point.price),
        volume: Math.max(0, Number(point.volume) || 0),
      }))
      .filter((point) => point.time.length === 4 && point.price > 0)
      .sort((a, b) => a.time.localeCompare(b.time))
    : [];
  const previousClose = Number(raw.previousClose);
  const open = first(points, "0930");
  const minute0934 = first(points, "0934");
  const minute0959 = first(points, "0959");
  if (!(previousClose > 0) || !open || !minute0934 || !minute0959) return null;

  const opening30 = select(points, "0930", "0959");
  const restOfDay = points.filter((point) => point.time >= "1000");
  const fullDay = points.filter((point) => point.time >= "0930" && point.time <= "1500");
  if (opening30.length < 25 || fullDay.length < 180) return null;

  const openGapPct = pct(open.price, previousClose);
  const firstFiveMovePct = pct(minute0934.price, open.price);
  const postFiveMovePct = pct(minute0959.price, minute0934.price);
  const openingHigh = Math.max(...opening30.map((point) => point.price));
  const openingLow = Math.min(...opening30.map((point) => point.price));
  const fullHigh = Math.max(...fullDay.map((point) => point.price));
  const fullLow = Math.min(...fullDay.map((point) => point.price));
  const firstFive = select(points, "0930", "0934");
  const firstFiveHigh = Math.max(...firstFive.map((point) => point.price));
  const firstFiveLow = Math.min(...firstFive.map((point) => point.price));
  const restOpening = select(points, "0935", "0959");
  const laterOpeningHigh = Math.max(...restOpening.map((point) => point.price));
  const laterOpeningLow = Math.min(...restOpening.map((point) => point.price));
  const totalVolume = fullDay.reduce((sum, point) => sum + point.volume, 0);
  const openingVolume = opening30.reduce((sum, point) => sum + point.volume, 0);
  const firstFiveDirection = directionBucket(firstFiveMovePct);
  const continuation = Math.abs(firstFiveMovePct) < 0.30
    ? null
    : Math.sign(firstFiveMovePct) === Math.sign(postFiveMovePct);

  return {
    date: String(raw.date),
    year: String(raw.date).slice(0, 4),
    openGapPct,
    gapBucket: gapBucket(openGapPct),
    firstFiveDirection,
    firstFiveMovePct,
    postFiveMovePct,
    firstFiveContinuedTo1000: continuation,
    gapFilledBy1000: openGapPct > 0
      ? openingLow <= previousClose
      : openGapPct < 0
        ? openingHigh >= previousClose
        : true,
    opening30RangePct: rangePct(opening30, previousClose),
    restOfDayRangePct: rangePct(restOfDay, previousClose),
    openingVolumeShare: totalVolume > 0 ? openingVolume / totalVolume : null,
    dayHighInOpening30: openingHigh >= fullHigh,
    dayLowInOpening30: openingLow <= fullLow,
    firstFiveHighBrokenBy1000: laterOpeningHigh > firstFiveHigh,
    firstFiveLowBrokenBy1000: laterOpeningLow < firstFiveLow,
    slices: Object.fromEntries(WINDOWS.map((window) => {
      const segment = select(points, window.start, window.end);
      return [window.id, {
        rangePct: rangePct(segment, previousClose),
        returnPct: segment.length >= 2
          ? pct(segment.at(-1).price, segment[0].price)
          : null,
        volume: segment.reduce((sum, point) => sum + point.volume, 0),
      }];
    })),
  };
}

function groupSummary(days, key) {
  const groups = new Map();
  for (const day of days) {
    const id = day[key];
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(day);
  }
  return [...groups.entries()].map(([id, rows]) => ({
    id,
    days: rows.length,
    meanOpening30RangePct: round(mean(rows.map((row) => row.opening30RangePct))),
    medianOpening30RangePct: round(median(rows.map((row) => row.opening30RangePct))),
    gapFillBy1000Rate: round(mean(rows.map((row) => row.gapFilledBy1000 ? 1 : 0))),
    dayHighInOpening30Rate: round(mean(rows.map((row) => row.dayHighInOpening30 ? 1 : 0))),
    dayLowInOpening30Rate: round(mean(rows.map((row) => row.dayLowInOpening30 ? 1 : 0))),
  })).sort((a, b) => String(a.id).localeCompare(String(b.id), "zh-CN"));
}

function parseArgs(argv) {
  const args = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT };
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === "--input") args.input = path.resolve(argv[++index]);
    else if (argv[index] === "--output") args.output = path.resolve(argv[++index]);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const lines = fs.readFileSync(args.input, "utf8").split(/\r?\n/).filter(Boolean);
  const days = lines.map((line) => buildDay(JSON.parse(line))).filter(Boolean);
  if (!days.length) throw new Error("No complete Zijin sessions were found.");

  const sliceRows = WINDOWS.map((window) => {
    const rows = days.map((day) => day.slices[window.id]);
    return { id: window.id, ...summarizeRows(rows) };
  });
  const firstFiveDirectional = ["前5分钟上涨≥0.3%", "前5分钟下跌≤-0.3%"]
    .map((id) => {
      const rows = days.filter((day) => day.firstFiveDirection === id);
      return {
        id,
        days: rows.length,
        continuationTo1000Rate: round(mean(rows.map((row) => row.firstFiveContinuedTo1000 ? 1 : 0))),
        reversalTo1000Rate: round(mean(rows.map((row) => row.firstFiveContinuedTo1000 ? 0 : 1))),
        meanPostFiveMovePct: round(mean(rows.map((row) => row.postFiveMovePct))),
      };
    });

  const report = {
    schemaVersion: 1,
    experimentId: "zijin-opening-30m-slice-analysis",
    generatedAt: new Date().toISOString(),
    source: path.basename(args.input),
    coverage: {
      start: days[0].date,
      end: days.at(-1).date,
      completeTradingDays: days.length,
      note: "Historical minute data only. L2 order-flow is analyzed separately from the actual connection date and is not backfilled.",
    },
    causality: {
      featureRule: "Every slice uses only prices and volume observed by that slice endpoint.",
      outcomeRule: "Later prices are used only for retrospective outcome labels such as continuation, gap fill and daily-extreme location.",
      futureFunctionUsedForSignals: false,
    },
    overall: {
      opening30: summarizeRows(days.map((day) => ({
        rangePct: day.opening30RangePct,
        returnPct: day.postFiveMovePct,
      }))),
      meanRestOfDayRangePct: round(mean(days.map((day) => day.restOfDayRangePct))),
      medianRestOfDayRangePct: round(median(days.map((day) => day.restOfDayRangePct))),
      meanOpeningVolumeShare: round(mean(days.map((day) => day.openingVolumeShare))),
      dayHighInOpening30Rate: round(mean(days.map((day) => day.dayHighInOpening30 ? 1 : 0))),
      dayLowInOpening30Rate: round(mean(days.map((day) => day.dayLowInOpening30 ? 1 : 0))),
      eitherDayExtremeInOpening30Rate: round(mean(days.map((day) => (
        day.dayHighInOpening30 || day.dayLowInOpening30 ? 1 : 0
      )))),
      firstFiveHighBrokenBy1000Rate: round(mean(days.map((day) => day.firstFiveHighBrokenBy1000 ? 1 : 0))),
      firstFiveLowBrokenBy1000Rate: round(mean(days.map((day) => day.firstFiveLowBrokenBy1000 ? 1 : 0))),
    },
    slices: sliceRows,
    byOpeningGap: groupSummary(days, "gapBucket"),
    byYear: groupSummary(days, "year"),
    firstFiveDirectional,
    interpretationGuardrails: [
      "The observed intraday range is not the same as executable profit.",
      "Fees, slippage and next-minute execution must be applied in strategy backtests.",
      "The first five minutes are a high-noise opportunity-detection window, not automatic trade permission.",
    ],
  };

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
