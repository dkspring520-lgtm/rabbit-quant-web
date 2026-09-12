import fs from 'node:fs';
import { runSmartTReplay } from '../lib/smart-t-engine.mjs';

const file = process.argv[2];
if (!file) throw new Error('usage: node scripts/backtest-zijin-crossday-t1.mjs <jsonl>');
const year = process.argv[3] ?? 'all';
const sessions = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(JSON.parse)
  .filter(x => x.symbol === '601899' && (year === 'all' || String(x.date).startsWith(year))).sort((a,b) => String(a.date).localeCompare(String(b.date)));
const lot = n => Math.floor(Math.max(0, n) / 100) * 100;
const buyFee = (p,q) => Math.max(5, p*q*.025/100);
const sellFee = (p,q) => Math.max(5, p*q*.025/100) + p*q*.05/100;
let cash = 200000, total = 0, sellable = 0, costs = 0, rejected = 0, trades = 0;
const daily = [];
for (const s of sessions) {
  const rows = s.minutes ?? []; if (rows.length < 100) continue;
  const ref = Number(s.previousClose || rows[0].price);
  if (!total) { total = lot(90000/ref); sellable = total; cash -= total*ref; }
  const replay = runSmartTReplay(rows, { capital: cash + total*ref, baseShares: total, sellable, feeRate:.025, slippage:.02, minCommission:true, slippageMode:'percent', forceCloseTime:'1450', previousClose:s.previousClose, profile:'平衡档', randomValue:0 });
  let dayActions = 0;
  for (const a of replay.actions ?? []) {
    const i = rows.findIndex(x => String(x.time) === String(a.time));
    const fill = rows[i + 1] ?? null;
    if (!fill) { rejected++; continue; }
    const price = Number(fill.price); const q = lot(a.quantity); if (!q || !Number.isFinite(price)) continue;
    if (a.side === '卖出') {
      if (q > sellable) { rejected++; continue; }
      cash += price*q - sellFee(price,q); costs += sellFee(price,q); sellable -= q; total -= q;
    } else {
      const cost = price*q + buyFee(price,q);
      if (cash < cost) { rejected++; continue; }
      cash -= cost; costs += buyFee(price,q); total += q;
    }
    dayActions++; trades++;
  }
  const last = Number(rows.at(-1).price);
  daily.push({date:s.date, actions:dayActions, cash:Number(cash.toFixed(2)), total, sellable, equity:Number((cash+total*last).toFixed(2))});
}
const first = daily[0]?.equity ?? 0, last = daily.at(-1)?.equity ?? 0;
console.log(JSON.stringify({kind:'zijin-crossday-t1',year,sessions:daily.length,trades,rejected,costs:Number(costs.toFixed(2)),startEquity:first,endEquity:last,change:Number((last-first).toFixed(2)),daily},null,2));
