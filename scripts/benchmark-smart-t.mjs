import { runSmartTReplay } from "../lib/smart-t-engine.mjs";

const universe = [
  "601899", "601012", "000063", "600519", "600036", "601318", "600276", "600030", "601166", "600887",
  "000333", "000651", "002415", "300750", "002594", "600900", "601088", "600309", "600690", "000858",
];
const rounds = 100;
const seed = 2026071403;
const baseUrl = process.argv[2] ?? "http://127.0.0.1:4173";

function seededFraction(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

async function load(code) {
  const response = await fetch(`${baseUrl}/api/market-data?code=${code}`);
  if (!response.ok) throw new Error(`${code}: HTTP ${response.status}`);
  const data = await response.json();
  if (!data.intradaySessions?.length) throw new Error(`${code}: no complete intraday sessions`);
  return { code, data };
}

const available = (await Promise.allSettled(universe.map(load))).flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []);
if (!available.length) throw new Error("No complete public intraday sessions are available.");

const trialResults = [];
const roundNets = [];
for (let round = 0; round < rounds; round += 1) {
  let roundNet = 0;
  for (const selected of available) {
    const sessions = selected.data.intradaySessions;
    const session = sessions[Math.floor(seededFraction(`${seed}:${selected.code}:session:${round}`) * sessions.length)];
    const result = runSmartTReplay(session.minutes, {
      capital: 200_000,
      baseShares: 6_000,
      sellable: 6_000,
      feeRate: 0.025,
      slippage: 0.02,
      minCommission: true,
      slippageMode: "percent",
      forceCloseTime: "1450",
      profile: "平衡档",
      previousClose: session.previousClose,
      randomValue: seededFraction(`${seed}:${selected.code}:round:${round}`),
    });
    trialResults.push(result);
    roundNet += result.net;
  }
  roundNets.push(roundNet);
}

const cycleNets = trialResults.flatMap((result) => result.cycleNets);
const gross = trialResults.reduce((sum, result) => sum + result.gross, 0);
const fees = trialResults.reduce((sum, result) => sum + result.fees, 0);
const slippage = trialResults.reduce((sum, result) => sum + result.executionCost, 0);
const net = trialResults.reduce((sum, result) => sum + result.net, 0);
const wins = cycleNets.filter((value) => value > 0).length;

console.log(JSON.stringify({
  seed,
  samples: trialResults.length,
  stocksPerRound: available.length,
  uniqueStockDays: available.reduce((sum, item) => sum + item.data.intradaySessions.length, 0),
  completedCycles: cycleNets.length,
  winningCycles: wins,
  netWinRate: cycleNets.length ? wins / cycleNets.length : 0,
  gross,
  fees,
  slippage,
  totalCosts: fees + slippage,
  net,
  tradingRounds: roundNets.filter((value) => value !== 0).length,
  profitableRounds: roundNets.filter((value) => value > 0).length,
  losingRounds: roundNets.filter((value) => value < 0).length,
  noTradeRounds: roundNets.filter((value) => value === 0).length,
}, null, 2));
