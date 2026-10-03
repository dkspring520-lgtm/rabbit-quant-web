import { mkdir, writeFile } from "node:fs/promises";
const dir = ".data-inspect/offline-rl-v0.9.6";
await mkdir(dir, { recursive: true });
const symbol = "601899.SH";
const bars = [
  ["2025-10-09", "1000", 10], ["2025-10-09", "1001", 10.1], ["2025-10-10", "1000", 10.2], ["2025-10-10", "1001", 10.1],
].map(([date, time, price]) => ({ date: date.replaceAll("-", ""), previousClose: 10, minutes: [{ time: time.replace(":", ""), open: price, high: price, low: price, close: price, price, volume: 100, amount: price * 100 }] }));
const signals = [
  { symbol, timestamp: "2025-10-09T10:00:00", action: "BUY_SMALL", strategyId: "OHLCV_T_RESEARCH_V1", strategyVersion: "OHLCV_T_RESEARCH_V1" },
  { symbol, timestamp: "2025-10-09T10:01:00", action: "WAIT", strategyId: "OHLCV_T_RESEARCH_V1", strategyVersion: "OHLCV_T_RESEARCH_V1" },
  { symbol, timestamp: "2025-10-10T10:00:00", action: "SELL_PART", strategyId: "OHLCV_T_RESEARCH_V1", strategyVersion: "OHLCV_T_RESEARCH_V1" },
  { symbol, timestamp: "2025-10-10T10:01:00", action: "SELL_ALL", strategyId: "OHLCV_T_RESEARCH_V1", strategyVersion: "OHLCV_T_RESEARCH_V1" },
];
await writeFile(`${dir}/fixture-market.jsonl`, bars.map(row => JSON.stringify(row)).join("\n") + "\n");
await writeFile(`${dir}/fixture-signals.jsonl`, signals.map(row => JSON.stringify(row)).join("\n") + "\n");
await writeFile(`${dir}/fixture-scenarios.json`, JSON.stringify([{ scenarioId: "SYNTHETIC_RESEARCH_PORTFOLIO_C_10000_V0.1", accountType: "SYNTHETIC_RESEARCH_PORTFOLIO", initialCash: 10000, initialPosition: 1000, initialSellablePosition: 1000, initialAverageCost: 10 }], null, 2) + "\n");
console.log(JSON.stringify({ marketRows: bars.length, signals: signals.length, scenarios: 1, directory: dir }, null, 2));
