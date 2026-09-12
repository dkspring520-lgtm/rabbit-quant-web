import fs from "node:fs";
import { runSmartTReplay } from "../lib/smart-t-engine.mjs";

const file = process.argv[2];
if (!file) throw new Error("usage: node scripts/backtest-zijin-t1.mjs <jsonl>");
const sessions = fs.readFileSync(file, "utf8").trim().split(/\r?\n/).map(JSON.parse).filter(x => x.symbol === "601899");
const feeRate = 0.025 / 100, stampRate = 0.05 / 100, slippage = 0.02 / 100;
const lot = n => Math.floor(Math.max(0, n) / 100) * 100;
const fee = (side, price, qty) => Math.max(5, price * qty * feeRate) + (side === "卖出" ? price * qty * stampRate : 0);
const reports = [];
const shadowLateReverseCutoff = process.argv[3] ?? null;
const diagnosticTotals = {};
for (const s of sessions) {
  const rows = s.minutes ?? []; if (rows.length < 100) continue;
  const close = Number(s.previousClose || rows[0].price);
  const initial = lot(90000 / close);
  let cash = 200000 - initial * close, sellable = initial, total = initial, costs = 0, rejected = 0;
  const replay = runSmartTReplay(rows, { capital: 200000, baseShares: initial, sellable: initial, feeRate: .025, slippage: .02, minCommission: true, slippageMode: "percent", forceCloseTime: "1450", previousClose: s.previousClose, profile: "平衡档", shadowLateReverseCutoff, randomValue: 0 });
  for (const [k, v] of Object.entries(replay.diagnostics ?? {})) if (typeof v === "number") diagnosticTotals[k] = (diagnosticTotals[k] ?? 0) + v;
  for (const a of replay.actions ?? []) {
    const q = lot(a.quantity); if (!q) continue;
    if (a.side === "卖出") {
      if (q > sellable) { rejected++; continue; }
      sellable -= q; total -= q; cash += a.price * q; costs += fee("卖出", a.price, q);
    } else if (a.side === "买入") {
      const gross = a.price * q, c = fee("买入", a.price, q);
      if (cash < gross + c) { rejected++; continue; }
      cash -= gross; total += q; costs += c;
    }
  }
  const last = Number(rows.at(-1).price);
  const strategyValue = cash + total * last - costs;
  const holdValue = (200000 - initial * close) + initial * last;
  reports.push({ date: s.date, actions: replay.actions?.length ?? 0, rejected, initialShares: initial, finalShares: total, sellableEnd: sellable, strategyValue: Number(strategyValue.toFixed(2)), holdValue: Number(holdValue.toFixed(2)), excessVsHold: Number((strategyValue - holdValue).toFixed(2)), costs: Number(costs.toFixed(2)) });
}
const sum = k => reports.reduce((a, x) => a + x[k], 0);
console.log(JSON.stringify({ kind: "zijin-t1-backtest", sessions: reports.length, totalRejected: sum("rejected"), totalCosts: Number(sum("costs").toFixed(2)), strategyValue: Number(sum("strategyValue").toFixed(2)), holdValue: Number(sum("holdValue").toFixed(2)), excessVsHold: Number(sum("excessVsHold").toFixed(2)), diagnosticTotals, reports }, null, 2));
