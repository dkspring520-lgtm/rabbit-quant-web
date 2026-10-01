import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const text = value => String(value ?? "").trim();

export function normalizeMarketBars(rows = [], { symbol = "", timezone = "Asia/Shanghai" } = {}) {
  const quality = { missingRows: 0, duplicateTimestamps: 0, invalidPrice: 0, invalidVolume: 0, outOfOrder: 0 };
  const seen = new Set(); let previous = "";
  let cumulativeAmount = 0; let cumulativeVolume = 0;
  const bars = (Array.isArray(rows) ? rows : []).map(row => {
    const date = text(row.timestamp ?? row.datetime ?? `${row.trade_date ?? row.date} ${row.trade_time ?? row.time}`);
    const timestamp = date.replace(" ", "T"); const price = finite(row.close); const volume = finite(row.volume ?? row.vol);
    if (!timestamp || price === null) quality.invalidPrice += 1;
    if (volume === null || volume < 0) quality.invalidVolume += 1;
    if (seen.has(timestamp)) quality.duplicateTimestamps += 1; seen.add(timestamp);
    if (previous && timestamp < previous) quality.outOfOrder += 1; previous = timestamp;
    const amount = finite(row.amount); if (volume !== null && volume > 0) { cumulativeVolume += volume; cumulativeAmount += amount ?? 0; }
    return { symbol: text(row.symbol ?? row.code ?? symbol), timestamp, time: timestamp.slice(11, 16), open: finite(row.open), high: finite(row.high), low: finite(row.low), close: price, price, volume: volume === null || volume < 0 ? null : volume, amount, barVWAP: volume > 0 && amount !== null ? amount / volume : null, intradayVWAP: cumulativeVolume > 0 ? cumulativeAmount / cumulativeVolume : null, rawVWAP: null, derivedVWAP: true, timezone };
  }).filter(row => row.timestamp && row.price !== null);
  quality.missingRows = Math.max(0, (Array.isArray(rows) ? rows.length : 0) - bars.length);
  return { bars, quality };
}

export async function buildDataManifest(path, { rows = [], datasetVersion = "", symbol = "", timeframe = "1m", timezone = "Asia/Shanghai" } = {}) {
  const bytes = await readFile(path); const normalized = normalizeMarketBars(rows, { symbol, timezone });
  const times = normalized.bars.map(row => row.timestamp).sort();
  return { datasetVersion, symbol, source: path, startTime: times[0] ?? "", endTime: times.at(-1) ?? "", rowCount: normalized.bars.length, timeframe, columns: normalized.bars.length ? Object.keys(normalized.bars[0]) : [], timezone, fileHash: createHash("sha256").update(bytes).digest("hex"), dataQuality: normalized.quality };
}
