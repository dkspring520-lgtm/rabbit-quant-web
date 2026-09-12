import fs from 'node:fs';
import { runSmartTReplay } from '../lib/smart-t-engine.mjs';

const file = process.argv[2];
if (!file) throw new Error('usage: node scripts/backtest-zijin-crossday-t1.mjs <jsonl>');
const year = process.argv[3] ?? 'all';
const startDate = process.argv[4] ?? '';
const endDate = process.argv[5] ?? '';
const lateReverseCutoff = process.argv[6] ?? null;
const sessions = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(JSON.parse)
  .filter(x => x.symbol === '601899' && (year === 'all' || String(x.date).startsWith(year)) && (!startDate || String(x.date) >= startDate) && (!endDate || String(x.date) <= endDate)).sort((a,b) => String(a.date).localeCompare(String(b.date)));
const lot = n => Math.floor(Math.max(0, n) / 100) * 100;
const buyFee = (p,q) => Math.max(5, p*q*.025/100);
const sellFee = (p,q) => Math.max(5, p*q*.025/100) + p*q*.05/100;
let cash = 200000, total = 0, sellable = 0, costs = 0, rejected = 0, trades = 0;
let initialCash = 200000, initialShares = 0, initialRef = 0;
const daily = [];
for (const s of sessions) {
  const rows = s.minutes ?? []; if (rows.length < 100) continue;
  const ref = Number(s.previousClose || rows[0].price);
  if (!daily.length) { total = lot(90000/ref); cash -= total*ref; initialShares = total; initialRef = ref; }
  // All shares carried from the preceding trading day are now sellable.
  sellable = total;
  const replay = runSmartTReplay(rows, { capital: cash + total*ref, baseShares: total, sellable, feeRate:.025, slippage:.02, minCommission:true, slippageMode:'percent', forceCloseTime:'1450', previousClose:s.previousClose, profile:'平衡档', lateReverseCutoff, randomValue:0 });
  let dayActions = 0;
  for (const a of replay.actions ?? []) {
    const i = rows.findIndex(x => String(x.time) === String(a.time));
    const fill = i >= 0 ? rows[i + 1] ?? null : null;
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
const first = initialCash, last = daily.at(-1)?.equity ?? initialCash;
const holdLast = daily.at(-1) ? (initialCash - initialShares*initialRef) + initialShares*Number(sessions.at(-1).minutes.at(-1).price) : initialCash;
console.log(JSON.stringify({kind:'zijin-crossday-t1',year,lateReverseCutoff,sessions:daily.length,trades,rejected,costs:Number(costs.toFixed(2)),startEquity:first,endEquity:last,change:Number((last-first).toFixed(2)),holdEndEquity:Number(holdLast.toFixed(2)),excessVsHold:Number((last-holdLast).toFixed(2)),daily},null,2));
