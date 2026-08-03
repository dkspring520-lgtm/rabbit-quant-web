import { runSmartTReplay } from "../lib/smart-t-engine.mjs";

const universe = [
  "601899", "603993", "601012", "000063", "600519", "600036",
  "000333", "300750", "601318", "600276", "002415", "600900",
  "601088", "600030", "601166", "600887", "600309", "600031",
  "601668", "600050", "600028", "601857", "600438", "600690",
  "000651", "000858", "000001", "000725", "002594", "002230",
  "002714", "300059", "300015", "300124", "688981", "688008",
];

const baseUrl = process.argv[2] ?? "http://127.0.0.1:3000";
const profile = process.argv[3] ?? "平衡档";
const profileOverridesJson = process.env.SMART_T_OVERRIDES ?? process.argv[4];
const profileOverrides = profileOverridesJson ? JSON.parse(profileOverridesJson) : {};

async function load(code) {
  const response = await fetch(`${baseUrl}/api/market-data?code=${code}`);
  if (!response.ok) throw new Error(`${code}: HTTP ${response.status}`);
  const data = await response.json();
  const sessions = [...(data.intradaySessions ?? [])]
    .filter((session) => (session.minutes?.length ?? 0) >= 120)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 5);
  return { code, name: data.quote?.name ?? code, sessions };
}

function timeBucket(time) {
  if (time <= "0944") return "09:30-09:44";
  if (time <= "1000") return "09:45-10:00";
  if (time <= "1030") return "10:01-10:30";
  if (time <= "1110") return "10:31-11:10";
  return "13:00-13:30";
}

function exitType(reason = "") {
  if (reason.includes("止盈")) return "止盈";
  if (reason.includes("浮盈回撤保护")) return "浮盈保护";
  if (reason.includes("止损")) return "止损";
  if (reason.includes("时间退出")) return "时间退出";
  if (reason.includes("强制")) return "尾盘强制";
  return "其他";
}

function emptyStats() {
  return { samples: 0, candidates: 0, trades: 0, wins: 0, gross: 0, fees: 0, slippage: 0, net: 0, positive: 0, negative: 0 };
}

function add(stats, trial) {
  stats.samples += 1;
  stats.candidates += trial.result.diagnostics?.candidates ?? 0;
  if (!trial.result.trades) return;
  const net = trial.result.cycleNets[0];
  stats.trades += 1;
  stats.wins += net > 0 ? 1 : 0;
  stats.gross += trial.result.gross;
  stats.fees += trial.result.fees;
  stats.slippage += trial.result.executionCost;
  stats.net += trial.result.net;
  stats.positive += net > 0 ? net : 0;
  stats.negative += net < 0 ? Math.abs(net) : 0;
}

function summarize(stats) {
  return {
    ...stats,
    candidateRate: stats.samples ? stats.candidates / stats.samples : 0,
    tradeRate: stats.samples ? stats.trades / stats.samples : 0,
    winRate: stats.trades ? stats.wins / stats.trades : null,
    averageNet: stats.trades ? stats.net / stats.trades : null,
    averageWin: stats.wins ? stats.positive / stats.wins : null,
    averageLoss: stats.trades - stats.wins ? stats.negative / (stats.trades - stats.wins) : null,
    profitFactor: stats.negative ? stats.positive / stats.negative : null,
  };
}

const settled = await Promise.allSettled(universe.map(load));
const available = settled.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []);
const trials = [];

for (const stock of available) {
  stock.sessions.forEach((session, sessionIndex) => {
    const prices = session.minutes.map((point) => Number(point.price)).filter(Number.isFinite);
    const referencePrice = session.previousClose || prices[0] || 10;
    const shares = Math.max(300, Math.floor((90_000 / referencePrice) / 100) * 100);
    const result = runSmartTReplay(session.minutes, {
      capital: 200_000,
      baseShares: shares,
      sellable: shares,
      feeRate: 0.025,
      slippage: 0.02,
      minCommission: true,
      slippageMode: "percent",
      forceCloseTime: "1450",
      previousClose: session.previousClose,
      profile,
      profileOverrides,
      randomValue: 0,
    });
    const entry = result.actions[0] ?? null;
    const exit = result.actions[1] ?? null;
    trials.push({
      code: stock.code,
      name: stock.name,
      date: session.date,
      partition: sessionIndex === 0 ? "holdout-latest" : "train-older",
      result,
      direction: entry?.side === "买入" ? "正T" : entry ? "反T" : "无交易",
      timeBucket: entry ? timeBucket(entry.time) : "无交易",
      exitType: exit ? exitType(exit.reason) : "无交易",
    });
  });
}

function groupBy(key, source = trials) {
  const groups = new Map();
  for (const trial of source) {
    const value = trial[key];
    if (!groups.has(value)) groups.set(value, emptyStats());
    add(groups.get(value), trial);
  }
  return Object.fromEntries([...groups].map(([name, stats]) => [name, summarize(stats)]));
}

const partitions = {};
for (const partition of ["train-older", "holdout-latest"]) {
  const stats = emptyStats();
  trials.filter((trial) => trial.partition === partition).forEach((trial) => add(stats, trial));
  partitions[partition] = summarize(stats);
}

const overall = emptyStats();
trials.forEach((trial) => add(overall, trial));

console.log(JSON.stringify({
  profile,
  profileOverrides,
  availableStocks: available.length,
  uniqueStockDays: trials.length,
  partitions,
  overall: summarize(overall),
  byDirection: groupBy("direction"),
  byEntryTime: groupBy("timeBucket"),
  byExit: groupBy("exitType"),
  allTrades: trials
    .filter((trial) => trial.result.trades)
    .map((trial) => ({
      code: trial.code,
      name: trial.name,
      date: trial.date,
      partition: trial.partition,
      direction: trial.direction,
      entryTime: trial.result.actions[0]?.time,
      exitTime: trial.result.actions[1]?.time,
      exitType: trial.exitType,
      net: trial.result.net,
      entryMeta: trial.result.actions[0]?.meta,
      exitMeta: trial.result.actions[1]?.meta,
    })),
  worstTrades: trials
    .filter((trial) => trial.result.trades)
    .sort((left, right) => left.result.net - right.result.net)
    .slice(0, 15)
    .map((trial) => ({
      code: trial.code,
      name: trial.name,
      date: trial.date,
      partition: trial.partition,
      direction: trial.direction,
      entryTime: trial.result.actions[0]?.time,
      exitTime: trial.result.actions[1]?.time,
      exitType: trial.exitType,
      net: trial.result.net,
      entryMeta: trial.result.actions[0]?.meta,
      exitMeta: trial.result.actions[1]?.meta,
    })),
  bestTrades: trials
    .filter((trial) => trial.result.trades)
    .sort((left, right) => right.result.net - left.result.net)
    .slice(0, 15)
    .map((trial) => ({
      code: trial.code,
      name: trial.name,
      date: trial.date,
      partition: trial.partition,
      direction: trial.direction,
      entryTime: trial.result.actions[0]?.time,
      exitTime: trial.result.actions[1]?.time,
      exitType: trial.exitType,
      net: trial.result.net,
      entryMeta: trial.result.actions[0]?.meta,
      exitMeta: trial.result.actions[1]?.meta,
    })),
}, null, 2));
