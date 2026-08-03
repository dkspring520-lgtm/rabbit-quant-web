import { runSmartTReplay } from "../lib/smart-t-engine.mjs";

const baseUrl = process.argv[2] ?? "https://www.zhuandianmi.com";
const groupCount = Math.max(1, Number(process.argv[3] ?? 100));
const groupSize = 10;
const targetDays = groupCount * groupSize;
const seed = process.argv[4] ?? "live-100-groups-20260725";
const rawProfileOverrides = process.argv[5];
const profileOverrides = rawProfileOverrides?.startsWith("base64:")
  ? JSON.parse(Buffer.from(rawProfileOverrides.slice(7), "base64").toString("utf8"))
  : rawProfileOverrides ? JSON.parse(rawProfileOverrides) : {};

function hash(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

function sortBySeed(rows, salt) {
  return [...rows].sort((left, right) =>
    hash(`${salt}:${left.code}`) - hash(`${salt}:${right.code}`));
}

async function fetchJson(url, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadStock(stock) {
  const data = await fetchJson(`${baseUrl}/api/market-data?code=${stock.code}`);
  const sessions = [...(data.intradaySessions ?? [])]
    .filter((session) => (session.minutes?.length ?? 0) >= 120)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 5);
  if (!sessions.length) throw new Error("no complete session");
  const session = sessions[hash(`${seed}:${stock.code}:session`) % sessions.length];
  return {
    code: stock.code,
    name: data.quote?.name || stock.name || stock.code,
    session,
  };
}

function replay(row) {
  const prices = row.session.minutes.map((point) => Number(point.price)).filter(Number.isFinite);
  const referencePrice = Number(row.session.previousClose) || prices[0] || 10;
  const shares = Math.max(300, Math.floor((90_000 / referencePrice) / 100) * 100);
  return runSmartTReplay(row.session.minutes, {
    capital: 200_000,
    baseShares: shares,
    sellable: shares,
    feeRate: 0.025,
    slippage: 0.02,
    minCommission: true,
    slippageMode: "percent",
    forceCloseTime: "1450",
    previousClose: row.session.previousClose,
    profile: "平衡档",
    profileOverrides,
    randomValue: 0,
  });
}

function ratioBucket(value) {
  if (!Number.isFinite(value)) return "unknown";
  if (value < 0.55) return "<0.55";
  if (value < 0.85) return "0.55-0.84";
  if (value < 1.20) return "0.85-1.19";
  if (value < 1.60) return "1.20-1.59";
  return ">=1.60";
}

function timeBucket(time) {
  if (time < "0945") return "09:30-09:44";
  if (time <= "1000") return "09:45-10:00";
  if (time <= "1030") return "10:01-10:30";
  if (time <= "1130") return "10:31-11:30";
  if (time <= "1330") return "13:00-13:30";
  if (time <= "1400") return "13:31-14:00";
  return "14:01-14:50";
}

function exitKind(meta = {}) {
  if (meta.catastrophicStop) return "catastrophic-stop";
  if (meta.stop) return "structural-stop";
  if (meta.takeProfit) return "take-profit";
  if (meta.trailingProfit) return "trailing-profit";
  if (meta.timeExit) return "time-exit";
  if (meta.forceExit) return "force-close";
  return "other";
}

function summarizeCycles(rows) {
  const positive = rows.reduce((sum, row) => sum + Math.max(0, row.net), 0);
  const negative = rows.reduce((sum, row) => sum + Math.max(0, -row.net), 0);
  return {
    cycles: rows.length,
    wins: rows.filter((row) => row.net > 0).length,
    losses: rows.filter((row) => row.net <= 0).length,
    winRate: rows.length ? rows.filter((row) => row.net > 0).length / rows.length : null,
    net: rows.reduce((sum, row) => sum + row.net, 0),
    averageNet: rows.length ? rows.reduce((sum, row) => sum + row.net, 0) / rows.length : null,
    profitFactor: negative ? positive / negative : null,
  };
}

function groupCycles(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries([...groups].map(([key, values]) => [key, summarizeCycles(values)]));
}

function primaryNoTradeReason(result) {
  const d = result.diagnostics ?? {};
  const raw = d.candidates ?? 0;
  if (!raw) return "no-candidate";
  const choices = [
    ["trend-risk", d.regimeBlocked ?? 0],
    ["structure-confirmation", d.structureBlocked ?? 0],
    ["quality-confirmation", d.qualityBlocked ?? 0],
    ["score", d.scoreBlocked ?? 0],
    ["timing", d.timingBlocked ?? 0],
    ["cost-reward", d.costBlocked ?? 0],
    ["falling-knife", d.fallingKnifeBlocked ?? 0],
    ["rising-knife", d.risingKnifeBlocked ?? 0],
    ["cash", d.cashBlocked ?? 0],
  ];
  choices.sort((left, right) => right[1] - left[1]);
  return choices[0][1] > 0 ? choices[0][0] : "other-confirmation";
}

function countBy(rows, keyOf) {
  const counts = {};
  for (const row of rows) {
    const key = keyOf(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]));
}

const universePayload = await fetchJson(`${baseUrl}/api/stock-universe?pool=full-a-v1`);
const queue = sortBySeed(universePayload.stocks ?? [], seed);
const loaded = [];
const failures = [];

for (let cursor = 0; cursor < queue.length && loaded.length < targetDays; cursor += 20) {
  const wave = queue.slice(cursor, cursor + 20);
  const settled = await Promise.allSettled(wave.map(loadStock));
  settled.forEach((entry, index) => {
    if (entry.status === "fulfilled" && loaded.length < targetDays) loaded.push(entry.value);
    if (entry.status === "rejected") {
      failures.push({ code: wave[index].code, reason: String(entry.reason?.message ?? entry.reason) });
    }
  });
  if (loaded.length % 100 < 20 || loaded.length >= targetDays) {
    process.stderr.write(`loaded ${loaded.length}/${targetDays}, fetch failures ${failures.length}\n`);
  }
}

if (loaded.length < targetDays) {
  throw new Error(`Only ${loaded.length}/${targetDays} complete stock-days could be loaded`);
}

const trials = loaded.map((row, index) => ({
  ...row,
  group: Math.floor(index / groupSize) + 1,
  result: replay(row),
}));

const cycles = [];
for (const trial of trials) {
  const byCycle = new Map();
  for (const action of trial.result.actions ?? []) {
    if (!action.cycleId) continue;
    if (!byCycle.has(action.cycleId)) byCycle.set(action.cycleId, {});
    if (action.meta?.phase === "entry") byCycle.get(action.cycleId).entry = action;
    if (action.meta?.phase === "exit") byCycle.get(action.cycleId).exit = action;
  }
  for (const [cycleId, actions] of byCycle) {
    if (!actions.entry || !actions.exit) continue;
    const net = trial.result.cycleNets?.[cycleId - 1];
    cycles.push({
      group: trial.group,
      code: trial.code,
      name: trial.name,
      date: trial.session.date,
      cycleId,
      net,
      direction: actions.entry.direction,
      entryTime: actions.entry.time,
      exitTime: actions.exit.time,
      exitKind: exitKind(actions.exit.meta),
      hold: actions.exit.meta?.hold,
      entry: actions.entry.meta ?? {},
      exit: actions.exit.meta ?? {},
    });
  }
}

const noTradeTrials = trials.filter((trial) => trial.result.trades === 0);
const candidateMarkerCount = trials.reduce((sum, trial) =>
  sum + (trial.result.observations ?? []).filter((item) => item.stage === "candidate").length, 0);
const candidateMarkerDays = trials.filter((trial) =>
  (trial.result.observations ?? []).some((item) => item.stage === "candidate")).length;
const rawCandidateCount = trials.reduce((sum, trial) =>
  sum + (trial.result.diagnostics?.candidates ?? 0), 0);
const rawCandidateDays = trials.filter((trial) =>
  (trial.result.diagnostics?.candidates ?? 0) > 0).length;
const diagnosticKeys = [
  "regimeBlocked", "structureBlocked", "qualityBlocked", "scoreBlocked",
  "timingBlocked", "costBlocked", "fallingKnifeBlocked", "risingKnifeBlocked",
  "strongSellTrendBlocked", "strongBuyTrendBlocked", "candidateOnlyBlocked",
  "openingChaseBlocked", "broadDowntrendBuyBlocked", "cashBlocked",
  "sameDirectionWaveBlocked",
];
const diagnosticTotals = Object.fromEntries(diagnosticKeys.map((key) => [
  key,
  trials.reduce((sum, trial) => sum + (trial.result.diagnostics?.[key] ?? 0), 0),
]));

const groups = Array.from({ length: groupCount }, (_, index) => {
  const group = index + 1;
  const groupTrials = trials.filter((trial) => trial.group === group);
  const groupCycles = cycles.filter((cycle) => cycle.group === group);
  return {
    group,
    stockDays: groupTrials.length,
    formalCycles: groupCycles.length,
    wins: groupCycles.filter((cycle) => cycle.net > 0).length,
    net: groupTrials.reduce((sum, trial) => sum + trial.result.net, 0),
    candidateMarkerDays: groupTrials.filter((trial) =>
      (trial.result.observations ?? []).some((item) => item.stage === "candidate")).length,
  };
});

const retrospectiveGuards = {
  "block-opening-reverse-before-0945-high-volume": (row) =>
    !(row.direction === "反T" && row.entry.opening && row.entryTime < "0945" && row.entry.ratio >= 0.85),
  "block-weak-reversal-with-pivot-age-under-4": (row) =>
    !(row.entry.trendRiskWeakReversalQuality && row.entry.pivotAge < 4),
  "block-both-targeted-risk-patterns": (row) =>
    !(
      (row.direction === "反T" && row.entry.opening && row.entryTime < "0945" && row.entry.ratio >= 0.85)
      || (row.entry.trendRiskWeakReversalQuality && row.entry.pivotAge < 4)
    ),
};

const guardAudit = Object.fromEntries(Object.entries(retrospectiveGuards).map(([name, keep]) => {
  const retained = cycles.filter(keep);
  return [name, {
    removed: cycles.length - retained.length,
    removedLosses: cycles.filter((row) => !keep(row) && row.net <= 0).length,
    retained: summarizeCycles(retained),
  }];
}));

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  baseUrl,
  profileOverrides,
  seed,
  deployedUniverse: {
    fallback: universePayload.fallback,
    stockCount: universePayload.stocks?.length ?? 0,
    fetchFailures: failures.length,
    failureExamples: failures.slice(0, 10),
  },
  sample: {
    groups: groupCount,
    stockDays: trials.length,
    uniqueStocks: new Set(trials.map((trial) => trial.code)).size,
    candidateMarkerDays,
    candidateMarkerCount,
    rawCandidateDays,
    rawCandidateCount,
    formalTradeDays: trials.filter((trial) => trial.result.trades > 0).length,
    formalCycles: cycles.length,
    groupsWithFormalTrigger: groups.filter((group) => group.formalCycles > 0).length,
    groupsWithoutFormalTrigger: groups.filter((group) => group.formalCycles === 0).length,
    groupsWithAtLeastTwoTriggers: groups.filter((group) => group.formalCycles >= 2).length,
  },
  performance: summarizeCycles(cycles),
  byDirection: groupCycles(cycles, (row) => row.direction),
  byEntryTime: groupCycles(cycles, (row) => timeBucket(row.entryTime)),
  byVolumeRatio: groupCycles(cycles, (row) => ratioBucket(row.entry.ratio)),
  byOpening: groupCycles(cycles, (row) => row.entry.opening ? "opening" : "regular"),
  byTrendRiskVotes: groupCycles(cycles, (row) => String(row.entry.trendRiskVotes ?? "unknown")),
  byRegime: groupCycles(cycles, (row) => row.entry.regime ?? "unknown"),
  lossExitReasons: countBy(cycles.filter((row) => row.net <= 0), (row) => row.exitKind),
  noTradePrimaryReasons: countBy(noTradeTrials, (trial) => primaryNoTradeReason(trial.result)),
  diagnosticTotalsNonExclusive: diagnosticTotals,
  groups: {
    zeroFormal: groups.filter((group) => group.formalCycles === 0).map((group) => group.group),
    formalCycleDistribution: countBy(groups, (group) => String(group.formalCycles)),
  },
  retrospectiveGuardAudit: guardAudit,
  worstLosses: [...cycles].sort((left, right) => left.net - right.net).slice(0, 15),
}, null, 2));
