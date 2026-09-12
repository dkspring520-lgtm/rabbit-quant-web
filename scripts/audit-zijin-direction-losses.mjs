import fs from "node:fs";
import { runSmartTReplay } from "../lib/smart-t-engine.mjs";
const file = process.argv[2];
const sessions = fs.readFileSync(file, "utf8").trim().split(/\r?\n/).map(JSON.parse).filter(x => x.symbol === "601899");
const out = [];
let lateReverseEntries = 0;
for (const s of sessions) {
  const p = Number(s.previousClose || s.minutes[0]?.price); const shares = Math.floor(90000 / p / 100) * 100;
  const r = runSmartTReplay(s.minutes, { capital: 200000, baseShares: shares, sellable: shares, feeRate: .025, slippage: .02, minCommission: true, slippageMode: "percent", forceCloseTime: "1450", previousClose: s.previousClose, profile: "平衡档", randomValue: 0 });
  if (!(r.cycleNets ?? []).some(n => n < 0)) continue;
  const actions = r.actions ?? [];
  for (const a of actions) if (a.direction === "反T" && String(a.time) >= "1400" && a.meta?.phase === "entry") lateReverseEntries++;
  for (let i = 0; i < actions.length; i += 2) {
    const entry = actions[i], exit = actions[i + 1];
    if (!r.cycleNets?.[Math.floor(i / 2)] || r.cycleNets[Math.floor(i / 2)] >= 0) continue;
    out.push({ date: s.date, net: r.cycleNets[Math.floor(i / 2)], entry: entry && { time: entry.time, side: entry.side, price: entry.price, direction: entry.direction }, exit: exit && { time: exit.time, side: exit.side, price: exit.price, reason: exit.reason?.split("；")[0], hold: exit.meta?.hold, move: exit.meta?.move } });
  }
}
console.log(JSON.stringify({ count: out.length, lateReverseEntries, losses: out }, null, 2));
