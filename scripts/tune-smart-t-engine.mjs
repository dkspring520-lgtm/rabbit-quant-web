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

async function load(code) {
  const response = await fetch(`${baseUrl}/api/market-data?code=${code}`);
  if (!response.ok) throw new Error(`${code}: HTTP ${response.status}`);
  const data = await response.json();
  return [...(data.intradaySessions ?? [])]
    .filter((session) => (session.minutes?.length ?? 0) >= 120)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 5)
    .map((session, sessionIndex) => ({ code, session, partition: sessionIndex === 0 ? "holdout-latest" : "train-older" }));
}

function replay(sample, profileOverrides) {
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
    profileOverrides,
    randomValue: 0,
  });
}

function summarize(results, sampleCount) {
  const traded = results.filter((result) => result.trades > 0);
  const nets = traded.flatMap((result) => result.cycleNets);
  const wins = nets.filter((net) => net > 0).length;
  const positive = nets.reduce((sum, net) => sum + Math.max(0, net), 0);
  const negative = nets.reduce((sum, net) => sum + Math.max(0, -net), 0);
  return {
    samples: sampleCount,
    trades: nets.length,
    coverage: sampleCount ? traded.length / sampleCount : 0,
    wins,
    losses: nets.length - wins,
    winRate: nets.length ? wins / nets.length : null,
    net: nets.reduce((sum, net) => sum + net, 0),
    profitFactor: negative ? positive / negative : null,
    averageWin: wins ? positive / wins : null,
    averageLoss: nets.length - wins ? negative / (nets.length - wins) : null,
  };
}

const settled = await Promise.allSettled(universe.map(load));
const samples = settled.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
const trainSamples = samples.filter((sample) => sample.partition === "train-older");
const holdoutSamples = samples.filter((sample) => sample.partition === "holdout-latest");

const configs = [];
for (const targetNetPct of [0.64, 0.69]) {
  for (const hardStopPct of [0.75, 0.85]) {
    for (const softStopPct of [0.40, 0.48]) {
      for (const softStopMinutes of [12, 16]) {
        for (const trailActivationPct of [0.22, 0.30, 0.40, 0.50]) {
          for (const trailRetracePct of [0.08, 0.15, 0.22, 0.30]) {
            for (const trailMinNetPct of [0.01, 0.04, 0.08, 0.12]) {
              const timeExitMinutes = 32;
              if (hardStopPct < softStopPct) continue;
              configs.push({
                targetNetPct,
                hardStopPct,
                softStopPct,
                softStopMinutes,
                timeExitMinutes,
                trailActivationPct,
                trailRetracePct,
                trailMinNetPct,
              });
            }
          }
        }
      }
    }
  }
}

const trainRanked = configs.map((config) => {
  const train = summarize(trainSamples.map((sample) => replay(sample, config)), trainSamples.length);
  return { config, train };
}).filter((item) => item.train.trades >= 12)
  .sort((left, right) => {
    const leftQualified = (left.train.winRate ?? 0) >= 0.65 && left.train.net > 0 ? 1 : 0;
    const rightQualified = (right.train.winRate ?? 0) >= 0.65 && right.train.net > 0 ? 1 : 0;
    if (leftQualified !== rightQualified) return rightQualified - leftQualified;
    const leftScore = (left.train.winRate ?? 0) * 4
      + Math.min(3, left.train.profitFactor ?? 0)
      + Math.min(1, left.train.coverage * 4)
      + Math.min(1, Math.max(-1, left.train.net / 1000));
    const rightScore = (right.train.winRate ?? 0) * 4
      + Math.min(3, right.train.profitFactor ?? 0)
      + Math.min(1, right.train.coverage * 4)
      + Math.min(1, Math.max(-1, right.train.net / 1000));
    return rightScore - leftScore;
  });

const top = trainRanked.slice(0, 30).map((item) => ({
  ...item,
  holdout: summarize(holdoutSamples.map((sample) => replay(sample, item.config)), holdoutSamples.length),
}));

console.log(JSON.stringify({
  uniqueStockDays: samples.length,
  trainSamples: trainSamples.length,
  holdoutSamples: holdoutSamples.length,
  searchedConfigs: configs.length,
  top,
}, null, 2));
