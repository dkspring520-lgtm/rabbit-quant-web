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
const overrideSource = process.env.SMART_T_OVERRIDES ?? process.argv[3];
const overrides = overrideSource ? JSON.parse(overrideSource) : {};

async function loadStock(code) {
  const response = await fetch(`${baseUrl}/api/market-data?code=${code}`);
  if (!response.ok) throw new Error(`${code}: HTTP ${response.status}`);
  const data = await response.json();
  const sessions = [...(data.intradaySessions ?? [])]
    .filter((session) => (session.minutes?.length ?? 0) >= 120)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 5);
  return sessions.map((session, index) => ({
    code,
    name: data.quote?.name ?? code,
    session,
    partition: index === 0 ? "holdout-latest" : "train-older",
  }));
}

function replay(sample) {
  const prices = sample.session.minutes.map((point) => Number(point.price)).filter(Number.isFinite);
  const referencePrice = sample.session.previousClose || prices[0] || 10;
  const shares = Math.max(300, Math.floor((90_000 / referencePrice) / 100) * 100);
  return runSmartTReplay(sample.session.minutes, {
    capital: 200_000,
    baseShares: shares,
    sellable: shares,
    feeRate: 0.025,
    slippage: 0.02,
    minCommission: true,
    slippageMode: "percent",
    forceCloseTime: "1450",
    previousClose: sample.session.previousClose,
    profile: "平衡档",
    profileOverrides: overrides,
    randomValue: 0,
  });
}

function entryTimeBucket(time) {
  if (time < "0945") return "09:33-09:44";
  if (time <= "1000") return "09:45-10:00";
  if (time <= "1030") return "10:01-10:30";
  if (time <= "1110") return "10:31-11:10";
  return "13:00-13:30";
}

function holdBucket(hold) {
  if (hold <= 8) return "4-8分钟";
  if (hold <= 16) return "9-16分钟";
  if (hold <= 24) return "17-24分钟";
  if (hold <= 32) return "25-32分钟";
  return "33分钟以上";
}

function exitKind(meta = {}) {
  if (meta.takeProfit) return "1%上限止盈";
  if (meta.trailingProfit) return "0.64%-1%回撤保护";
  if (meta.stop) return "止损";
  if (meta.timeExit) return "时间退出";
  if (meta.forceExit) return "尾盘强制";
  return "其他";
}

function emptyStats() {
  return { samples: 0, trades: 0, wins: 0, losses: 0, gross: 0, fees: 0, slippage: 0, net: 0, positive: 0, negative: 0 };
}

function addTrial(stats, row) {
  stats.samples += 1;
  if (!row.net && !row.trade) return;
  stats.trades += 1;
  stats.wins += row.net > 0 ? 1 : 0;
  stats.losses += row.net <= 0 ? 1 : 0;
  stats.gross += row.gross;
  stats.fees += row.fees;
  stats.slippage += row.slippage;
  stats.net += row.net;
  stats.positive += Math.max(0, row.net);
  stats.negative += Math.max(0, -row.net);
}

function summarize(stats) {
  return {
    samples: stats.samples,
    trades: stats.trades,
    coverage: stats.samples ? stats.trades / stats.samples : 0,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.trades ? stats.wins / stats.trades : null,
    gross: stats.gross,
    fees: stats.fees,
    slippage: stats.slippage,
    net: stats.net,
    averageNet: stats.trades ? stats.net / stats.trades : null,
    averageWin: stats.wins ? stats.positive / stats.wins : null,
    averageLoss: stats.losses ? stats.negative / stats.losses : null,
    profitFactor: stats.negative ? stats.positive / stats.negative : null,
  };
}

function group(rows, field) {
  const groups = new Map();
  for (const row of rows) {
    const key = row[field];
    if (!groups.has(key)) groups.set(key, emptyStats());
    addTrial(groups.get(key), row);
  }
  return Object.fromEntries([...groups].map(([key, stats]) => [key, summarize(stats)]));
}

const settled = await Promise.allSettled(universe.map(loadStock));
const samples = settled.flatMap((item) => item.status === "fulfilled" ? item.value : []);
const rows = samples.map((sample) => {
  const result = replay(sample);
  const entry = result.actions.find((action) => action.meta?.phase === "entry");
  const exit = result.actions.find((action) => action.meta?.phase === "exit");
  return {
    code: sample.code,
    name: sample.name,
    date: sample.session.date,
    partition: sample.partition,
    trade: Boolean(entry && exit),
    direction: entry?.side === "买入" ? "正T" : entry ? "反T" : "无交易",
    opening: entry?.meta?.opening ? "开盘策略" : entry ? "普通策略" : "无交易",
    regime: entry?.meta?.regime ?? "无交易",
    entryTime: entry?.time ?? "无交易",
    entryTimeBucket: entry ? entryTimeBucket(entry.time) : "无交易",
    holdBucket: exit ? holdBucket(exit.meta?.hold ?? 0) : "无交易",
    exitKind: exit ? exitKind(exit.meta) : "无交易",
    score: entry?.meta?.score ?? null,
    edge: entry?.meta?.edge ?? null,
    rewardRisk: entry?.meta?.rewardRisk ?? null,
    ratio: entry?.meta?.ratio ?? null,
    deviation: entry?.meta?.deviation ?? null,
    pivotReversal: entry?.meta?.pivotReversal ?? null,
    localMomentum3: entry?.meta?.localMomentum3 ?? null,
    vwapMomentum15: entry?.meta?.vwapMomentum15 ?? null,
    vwapMomentum30: entry?.meta?.vwapMomentum30 ?? null,
    sessionMove: entry?.meta?.sessionMove ?? null,
    gross: result.gross,
    fees: result.fees,
    slippage: result.executionCost,
    net: result.net,
  };
});

const overall = emptyStats();
rows.forEach((row) => addTrial(overall, row));

console.log(JSON.stringify({
  baseUrl,
  overrides,
  availableStocks: new Set(samples.map((sample) => sample.code)).size,
  uniqueStockDays: samples.length,
  overall: summarize(overall),
  byPartition: group(rows, "partition"),
  byDirection: group(rows.filter((row) => row.trade), "direction"),
  byOpening: group(rows.filter((row) => row.trade), "opening"),
  byRegime: group(rows.filter((row) => row.trade), "regime"),
  byEntryTime: group(rows.filter((row) => row.trade), "entryTimeBucket"),
  byHold: group(rows.filter((row) => row.trade), "holdBucket"),
  byExit: group(rows.filter((row) => row.trade), "exitKind"),
  losses: rows.filter((row) => row.trade && row.net <= 0).sort((left, right) => left.net - right.net),
  wins: rows.filter((row) => row.trade && row.net > 0).sort((left, right) => right.net - left.net),
}, null, 2));
