import fs from "node:fs";
import readline from "node:readline";

const source =
  process.argv[2] ?? ".data-inspect/zijin-601899-sessions.jsonl";
const COST_PCT = 0.12;
const TARGET_NET_PCT = 0.64;
const STOP_GROSS_PCT = 0.45;
const PIVOT_CONFIRM_BARS = 3;
const PIVOT_RADIUS = 3;
const MIN_PIVOT_GAP = 5;
const MAX_PIVOT_GAP = 60;
const COOLDOWN_BARS = 20;

function pct(a, b) {
  return b ? ((a - b) / b) * 100 : 0;
}

function ema(values, period) {
  const alpha = 2 / (period + 1);
  const out = [];
  let value = values[0] ?? 0;
  for (let i = 0; i < values.length; i += 1) {
    value = i === 0 ? values[i] : alpha * values[i] + (1 - alpha) * value;
    out.push(value);
  }
  return out;
}

function localPivot(prices, pivotIndex, kind) {
  const start = pivotIndex - PIVOT_RADIUS;
  const end = pivotIndex + PIVOT_RADIUS;
  if (start < 0 || end >= prices.length) return false;
  const value = prices[pivotIndex];
  for (let i = start; i <= end; i += 1) {
    if (i === pivotIndex) continue;
    if (kind === "HIGH" && prices[i] > value) return false;
    if (kind === "LOW" && prices[i] < value) return false;
  }
  return true;
}

function volumeAround(volumes, index) {
  const start = Math.max(0, index - 1);
  const end = Math.min(volumes.length - 1, index + 1);
  let sum = 0;
  for (let i = start; i <= end; i += 1) sum += volumes[i] ?? 0;
  return sum / (end - start + 1);
}

function classifySignal(current, previous, prices, volumes, dif, kind) {
  const priceMove =
    kind === "HIGH"
      ? pct(prices[current], prices[previous])
      : pct(prices[previous], prices[current]);
  if (priceMove < 0.15) return null;

  const currentVolume = volumeAround(volumes, current);
  const previousVolume = volumeAround(volumes, previous);
  const volumeDivergence =
    previousVolume > 0 && currentVolume / previousVolume <= 0.85;

  const difScale = Math.max(Math.abs(prices[current]), 0.01);
  const difChangePct =
    kind === "HIGH"
      ? ((dif[current] - dif[previous]) / difScale) * 100
      : ((dif[previous] - dif[current]) / difScale) * 100;
  const macdDivergence = difChangePct <= -0.02;

  if (!volumeDivergence && !macdDivergence) return null;
  return {
    direction: kind === "HIGH" ? "SELL_FIRST" : "BUY_FIRST",
    volumeDivergence,
    macdDivergence,
    combined: volumeDivergence && macdDivergence,
    priceMove,
  };
}

function outcome(points, signalIndex, direction) {
  const entryIndex = signalIndex + 1;
  if (entryIndex >= points.length) return null;
  const entry = points[entryIndex].price;
  const maxIndex = Math.min(points.length - 1, entryIndex + 30);
  let mfe = 0;
  let mae = 0;
  let targetHit = false;
  let stopHit = false;
  let firstResolution = "NONE";

  for (let i = entryIndex + 1; i <= maxIndex; i += 1) {
    const move =
      direction === "BUY_FIRST"
        ? pct(points[i].price, entry)
        : pct(entry, points[i].price);
    mfe = Math.max(mfe, move);
    mae = Math.min(mae, move);
    if (!targetHit && move - COST_PCT >= TARGET_NET_PCT) {
      targetHit = true;
      if (firstResolution === "NONE") firstResolution = "TARGET";
    }
    if (!stopHit && move <= -STOP_GROSS_PCT) {
      stopHit = true;
      if (firstResolution === "NONE") firstResolution = "STOP";
    }
  }

  const endpoint = points[maxIndex].price;
  const gross =
    direction === "BUY_FIRST" ? pct(endpoint, entry) : pct(entry, endpoint);
  const net = gross - COST_PCT;
  return {
    net,
    mfeNet: mfe - COST_PCT,
    mae,
    targetFirst: firstResolution === "TARGET",
    profitable: net > 0,
  };
}

function bucket() {
  return {
    signals: 0,
    profitable: 0,
    targetFirst: 0,
    netSum: 0,
    mfeNetSum: 0,
    maeSum: 0,
  };
}

function add(result, value) {
  result.signals += 1;
  result.profitable += value.profitable ? 1 : 0;
  result.targetFirst += value.targetFirst ? 1 : 0;
  result.netSum += value.net;
  result.mfeNetSum += value.mfeNet;
  result.maeSum += value.mae;
}

function finish(value) {
  const n = value.signals || 1;
  return {
    signals: value.signals,
    endpointWinRate: +(value.profitable / n).toFixed(4),
    targetFirstRate: +(value.targetFirst / n).toFixed(4),
    averageNetPct: +(value.netSum / n).toFixed(4),
    averageMfeNetPct: +(value.mfeNetSum / n).toFixed(4),
    averageMaePct: +(value.maeSum / n).toFixed(4),
  };
}

const aggregate = {
  all: bucket(),
  volumeOnly: bucket(),
  macdOnly: bucket(),
  combined: bucket(),
  buy: bucket(),
  sell: bucket(),
  morning: bucket(),
  afternoon: bucket(),
  train: bucket(),
  validation: bucket(),
  blind: bucket(),
  vwapEconomic: bucket(),
  trendAligned: bucket(),
  fullCoreFilter: bucket(),
};

const input = fs.createReadStream(source, { encoding: "utf8" });
const lines = readline.createInterface({ input, crlfDelay: Infinity });
let tradingDays = 0;

for await (const line of lines) {
  if (!line.trim()) continue;
  const session = JSON.parse(line);
  const points = session.minutes ?? [];
  if (points.length < 40) continue;
  tradingDays += 1;

  const prices = points.map((point) => Number(point.price));
  const volumes = points.map((point) => Number(point.volume ?? 0));
  const ema12 = ema(prices, 12);
  const ema26 = ema(prices, 26);
  const dif = prices.map((_, index) => ema12[index] - ema26[index]);
  const vwaps = [];
  let cumulativeAmount = 0;
  let cumulativeVolume = 0;
  for (let i = 0; i < points.length; i += 1) {
    cumulativeAmount += prices[i] * volumes[i];
    cumulativeVolume += volumes[i];
    vwaps.push(cumulativeVolume > 0 ? cumulativeAmount / cumulativeVolume : prices[i]);
  }
  const pivots = { HIGH: [], LOW: [] };
  let lastSignalIndex = -COOLDOWN_BARS;

  for (
    let index = PIVOT_RADIUS * 2 + PIVOT_CONFIRM_BARS;
    index < points.length - 1;
    index += 1
  ) {
    const pivotIndex = index - PIVOT_CONFIRM_BARS;
    for (const kind of ["HIGH", "LOW"]) {
      if (!localPivot(prices, pivotIndex, kind)) continue;
      const prior = pivots[kind].at(-1);
      pivots[kind].push(pivotIndex);
      if (prior == null) continue;
      const gap = pivotIndex - prior;
      if (gap < MIN_PIVOT_GAP || gap > MAX_PIVOT_GAP) continue;
      if (index - lastSignalIndex < COOLDOWN_BARS) continue;

      const signal = classifySignal(
        pivotIndex,
        prior,
        prices,
        volumes,
        dif,
        kind,
      );
      if (!signal) continue;
      const value = outcome(points, index, signal.direction);
      if (!value) continue;
      lastSignalIndex = index;

      add(aggregate.all, value);
      add(
        signal.combined
          ? aggregate.combined
          : signal.volumeDivergence
            ? aggregate.volumeOnly
            : aggregate.macdOnly,
        value,
      );
      add(
        signal.direction === "BUY_FIRST" ? aggregate.buy : aggregate.sell,
        value,
      );
      add(
        Number(points[index].time) < 1300
          ? aggregate.morning
          : aggregate.afternoon,
        value,
      );
      const year = Number(String(session.date).slice(0, 4));
      add(
        year <= 2024
          ? aggregate.train
          : year === 2025
            ? aggregate.validation
            : aggregate.blind,
        value,
      );

      const decisionPrice = prices[index];
      const deviationPct = pct(decisionPrice, vwaps[index]);
      const slope30Pct =
        index >= 30 ? pct(vwaps[index], vwaps[index - 30]) : 0;
      const economic =
        signal.direction === "BUY_FIRST"
          ? deviationPct <= -0.5
          : deviationPct >= 0.5;
      const aligned =
        signal.direction === "BUY_FIRST"
          ? slope30Pct >= -0.1
          : slope30Pct <= 0.1;
      if (economic) add(aggregate.vwapEconomic, value);
      if (aligned) add(aggregate.trendAligned, value);
      if (economic && aligned && signal.combined) {
        add(aggregate.fullCoreFilter, value);
      }
    }
  }
}

const report = {
  stock: "601899 紫金矿业",
  tradingDays,
  causalProtocol: {
    pivotConfirmationBars: PIVOT_CONFIRM_BARS,
    earliestFill: "信号确认后的下一分钟价格",
    futureWindowMinutes: 30,
    roundTripCostPct: COST_PCT,
    targetNetPct: TARGET_NET_PCT,
    stopGrossPct: STOP_GROSS_PCT,
  },
  results: Object.fromEntries(
    Object.entries(aggregate).map(([key, value]) => [key, finish(value)]),
  ),
};

console.log(JSON.stringify(report, null, 2));
