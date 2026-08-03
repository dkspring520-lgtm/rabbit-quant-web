import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:3000";
const profile = process.argv[3] ?? "平衡档";
const analyzer = new URL("./analyze-smart-t.mjs", import.meta.url);
const raw = execFileSync(process.execPath, [fileURLToPath(analyzer), baseUrl, profile], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
const report = JSON.parse(raw);

function metrics(rows) {
  const wins = rows.filter((row) => row.net > 0).length;
  const positive = rows.reduce((sum, row) => sum + Math.max(0, row.net), 0);
  const negative = rows.reduce((sum, row) => sum + Math.max(0, -row.net), 0);
  return {
    trades: rows.length,
    wins,
    losses: rows.length - wins,
    winRate: rows.length ? wins / rows.length : null,
    net: rows.reduce((sum, row) => sum + row.net, 0),
    profitFactor: negative ? positive / negative : null,
  };
}

function pass(row, gate) {
  const meta = row.entryMeta ?? {};
  const directionSign = row.direction === "正T" ? 1 : -1;
  if ((meta.score ?? 0) < gate.minScore) return false;
  if ((meta.ratio ?? 0) < gate.minRatio) return false;
  if ((meta.pivotReversal ?? 0) < gate.minPivot) return false;
  if (directionSign * (meta.localMomentum3 ?? 0) < gate.minMomentum) return false;
  if (row.direction === "正T" && (meta.vwapMomentum15 ?? 0) < -gate.maxVwapSlope) return false;
  if (row.direction === "反T" && (meta.vwapMomentum15 ?? 0) > gate.maxVwapSlope) return false;
  if (row.direction === "正T" && (meta.sessionMove ?? 0) < -gate.maxCounterSession) return false;
  if (row.direction === "反T" && (meta.sessionMove ?? 0) > gate.maxCounterSession) return false;
  if (gate.excludeFirstTenMinutes && row.entryTime < "0945") return false;
  return true;
}

const gates = [];
for (const minScore of [4, 5]) {
  for (const minRatio of [0.35, 0.45, 0.50, 0.60, 0.75, 0.90]) {
    for (const minMomentum of [0, 0.03, 0.05, 0.08, 0.12]) {
      for (const minPivot of [0.22, 0.25, 0.30, 0.35]) {
        for (const maxVwapSlope of [0.20, 0.30, 0.50, 99]) {
          for (const maxCounterSession of [1.20, 1.50, 99]) {
            for (const excludeFirstTenMinutes of [false, true]) {
              gates.push({
                minScore,
                minRatio,
                minMomentum,
                minPivot,
                maxVwapSlope,
                maxCounterSession,
                excludeFirstTenMinutes,
              });
            }
          }
        }
      }
    }
  }
}

const train = report.allTrades.filter((row) => row.partition === "train-older");
const holdout = report.allTrades.filter((row) => row.partition === "holdout-latest");
const ranked = gates
  .map((gate) => {
    const trainMetrics = metrics(train.filter((row) => pass(row, gate)));
    const holdoutMetrics = metrics(holdout.filter((row) => pass(row, gate)));
    return { gate, train: trainMetrics, holdout: holdoutMetrics };
  })
  .filter((item) => item.train.trades >= 10 && item.holdout.trades >= 3)
  .sort((left, right) => {
    const leftScore = (left.holdout.winRate ?? 0) * 3
      + (left.train.winRate ?? 0) * 2
      + Math.min(2, left.train.profitFactor ?? 0)
      + Math.min(2, left.holdout.profitFactor ?? 0)
      + Math.min(1, left.train.trades / 20);
    const rightScore = (right.holdout.winRate ?? 0) * 3
      + (right.train.winRate ?? 0) * 2
      + Math.min(2, right.train.profitFactor ?? 0)
      + Math.min(2, right.holdout.profitFactor ?? 0)
      + Math.min(1, right.train.trades / 20);
    return rightScore - leftScore;
  });

console.log(JSON.stringify({
  baseline: {
    train: metrics(train),
    holdout: metrics(holdout),
  },
  searchedGates: gates.length,
  eligibleGates: ranked.length,
  top: ranked.slice(0, 30),
}, null, 2));
