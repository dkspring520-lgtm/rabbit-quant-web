import { buildCausalReferencePoints } from "../lib/causal-reference-points.mjs";
import { runSmartTReplay } from "../lib/smart-t-engine.mjs";

const universe = [
  "601899", "603993", "601012", "000063", "600519", "600036",
  "000333", "300750", "601318", "600276", "002415", "600900",
  "601088", "600030", "601166", "600887", "600309", "600031",
  "601668", "600050", "600028", "601857", "600438", "600690",
  "000651", "000858", "000001", "000725", "002594", "002230",
  "002714", "300059", "300015", "300124", "688981", "688008",
];
const rounds = Math.max(1, Number(process.argv[3]) || 100);
const seed = process.argv[4] ?? "20260716-causal-candidates";
const baseUrl = process.argv[2] ?? "http://127.0.0.1:3000";

function seededFraction(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function sample(values, count, sampleSeed) {
  return values
    .map((value) => ({ value, rank: seededFraction(`${sampleSeed}:${value}`) }))
    .sort((left, right) => left.rank - right.rank)
    .slice(0, count)
    .map((item) => item.value);
}

async function load(code) {
  const response = await fetch(`${baseUrl}/api/market-data?code=${code}`);
  if (!response.ok) throw new Error(`${code}: HTTP ${response.status}`);
  const data = await response.json();
  const sessions = [...(data.intradaySessions ?? [])]
    .filter((session) => (session.minutes?.length ?? 0) >= 120)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 5);
  if (!sessions.length) throw new Error(`${code}: no complete intraday sessions`);
  return { code, name: data.quote?.name ?? code, sessions };
}

const settled = await Promise.allSettled(universe.map(load));
const available = settled.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []);
if (available.length < 10) throw new Error(`Only ${available.length} stocks have complete public intraday sessions.`);

const trials = [];
const batchNets = [];
for (let round = 0; round < rounds; round += 1) {
  const selected = sample(available, 10, `${seed}:round:${round}`);
  let batchNet = 0;
  for (const stock of selected) {
    const session = stock.sessions[Math.floor(seededFraction(`${seed}:${round}:${stock.code}:session`) * stock.sessions.length)];
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
      randomValue: seededFraction(`${seed}:${round}:${stock.code}:replay`),
    });
    const references = buildCausalReferencePoints(session.minutes, result.observations ?? []);
    trials.push({
      round,
      code: stock.code,
      name: stock.name,
      date: session.date,
      result,
      references,
      referenceDirections: new Set(references.map((item) => item.direction)).size,
      formalCandidates: (result.observations ?? []).filter((item) => item.stage === "candidate").length,
    });
    batchNet += result.net;
  }
  batchNets.push(batchNet);
}

const cycleNets = trials.flatMap((trial) => trial.result.cycleNets);
const summary = {
  seed,
  rounds,
  stocksPerRound: 10,
  samples: trials.length,
  availableStocks: available.length,
  availableStockDays: available.reduce((sum, stock) => sum + stock.sessions.length, 0),
  referenceCoverage: trials.filter((trial) => trial.references.length > 0).length,
  twoSidedReferenceCoverage: trials.filter((trial) => trial.referenceDirections === 2).length,
  referencePoints: trials.reduce((sum, trial) => sum + trial.references.length, 0),
  formalCandidateCoverage: trials.filter((trial) => trial.formalCandidates > 0).length,
  formalCandidates: trials.reduce((sum, trial) => sum + trial.formalCandidates, 0),
  formalTradeCoverage: trials.filter((trial) => trial.result.trades > 0).length,
  completedCycles: cycleNets.length,
  winningCycles: cycleNets.filter((value) => value > 0).length,
  losingCycles: cycleNets.filter((value) => value < 0).length,
  netWinRate: cycleNets.length ? cycleNets.filter((value) => value > 0).length / cycleNets.length : null,
  gross: trials.reduce((sum, trial) => sum + trial.result.gross, 0),
  fees: trials.reduce((sum, trial) => sum + trial.result.fees, 0),
  slippage: trials.reduce((sum, trial) => sum + trial.result.executionCost, 0),
  net: trials.reduce((sum, trial) => sum + trial.result.net, 0),
  tradingBatches: batchNets.filter((value) => value !== 0).length,
  profitableBatches: batchNets.filter((value) => value > 0).length,
  losingBatches: batchNets.filter((value) => value < 0).length,
  noTradeBatches: batchNets.filter((value) => value === 0).length,
};

console.log(JSON.stringify(summary, null, 2));
