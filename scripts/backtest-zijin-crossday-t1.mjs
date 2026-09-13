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
if (!sessions.length) throw new Error(`no 601899 sessions matched window: ${year} ${startDate}-${endDate}`);
if (startDate && endDate && startDate > endDate) throw new Error('startDate must not be after endDate');
const lot = n => Math.floor(Math.max(0, n) / 100) * 100;
const buyFee = (p,q) => Math.max(5, p*q*.025/100);
const sellFee = (p,q) => Math.max(5, p*q*.025/100) + p*q*.05/100;
let cash = 200000, total = 0, sellable = 0, costs = 0, rejected = 0, trades = 0;
const rejectReasons = {};
const completedCycles = [];
let openLeg = null;
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
    if (!fill) { rejected++; rejectReasons.noNextMinute = (rejectReasons.noNextMinute ?? 0) + 1; continue; }
    if (fill.suspended || fill.trading === false || Number(fill.volume) === 0 || !Number.isFinite(Number(fill.price))) {
      rejected++; rejectReasons.untradableNextMinute = (rejectReasons.untradableNextMinute ?? 0) + 1; continue;
    }
    const rawPrice = Number(fill.price); const q = lot(a.quantity); if (!q || !Number.isFinite(rawPrice)) continue;
    const price = rawPrice * (a.side === '买入' ? 1.0002 : 0.9998);
    if (a.side === '卖出') {
      if (q > sellable) { rejected++; continue; }
      cash += price*q - sellFee(price,q); costs += sellFee(price,q); sellable -= q; total -= q;
    } else {
      const cost = price*q + buyFee(price,q);
      if (cash < cost) { rejected++; continue; }
      cash -= cost; costs += buyFee(price,q); total += q;
    }
    if (!openLeg) openLeg = { direction: a.side === '买入' ? '正T' : '反T', price, quantity:q, time:a.time, date:s.date, fee:a.side === '买入' ? buyFee(price,q) : sellFee(price,q) };
    else { const gross = openLeg.direction === '正T' ? (price-openLeg.price)*q : (openLeg.price-price)*q; const closeFee = a.side === '买入' ? buyFee(price,q) : sellFee(price,q); completedCycles.push({ direction:openLeg.direction, entryTime:openLeg.time, exitTime:a.time, entryDate:openLeg.date, exitReason:a.reason ?? null, gross:Number(gross.toFixed(2)), fees:Number((openLeg.fee+closeFee).toFixed(2)), net:Number((gross-openLeg.fee-closeFee).toFixed(2)) }); openLeg=null; }
    dayActions++; trades++;
  }
  const last = Number(rows.at(-1).price);
  daily.push({date:s.date, actions:dayActions, cash:Number(cash.toFixed(2)), total, sellable, equity:Number((cash+total*last).toFixed(2))});
}
const first = initialCash, last = daily.at(-1)?.equity ?? initialCash;
const wins = completedCycles.filter(c => c.net > 0), losses = completedCycles.filter(c => c.net < 0);
const grossProfit = wins.reduce((n,c)=>n+c.net,0), grossLoss = Math.abs(losses.reduce((n,c)=>n+c.net,0));
const holdLast = daily.at(-1) ? (initialCash - initialShares*initialRef) + initialShares*Number(sessions.at(-1).minutes.at(-1).price) : initialCash;
const cycleGroups = {};
for (const cycle of completedCycles) {
  const bucket = `${cycle.direction}:${String(cycle.entryTime ?? "").slice(0,2) < "12" ? "morning" : "afternoon"}`;
  const g = cycleGroups[bucket] ??= { cycles: 0, wins: 0, net: 0 };
  g.cycles += 1; g.wins += cycle.net > 0 ? 1 : 0; g.net += cycle.net;
}
for (const g of Object.values(cycleGroups)) { g.winRatePct = g.cycles ? Number((g.wins / g.cycles * 100).toFixed(2)) : 0; g.net = Number(g.net.toFixed(2)); }
let peak=first,maxDrawdown=0,maxDrawdownPct=0; for(const d of daily){peak=Math.max(peak,d.equity); maxDrawdown=Math.max(maxDrawdown,peak-d.equity); if(peak>0) maxDrawdownPct=Math.max(maxDrawdownPct,(peak-d.equity)/peak*100);}
console.log(JSON.stringify({kind:'zijin-crossday-t1',year,lateReverseCutoff,execution:{signalToNextMinute:true,slippagePct:0.02,t1:true,feesIncluded:true,holdBenchmark:true,untradableSkipped:true},sessions:daily.length,trades,rejected,rejectReasons,costs:Number(costs.toFixed(2)),cycles:completedCycles.length,incompleteCycle:openLeg?{direction:openLeg.direction,quantity:openLeg.quantity,entryPrice:openLeg.price}:null,cycleGroups,wins:wins.length,losses:losses.length,winRatePct:completedCycles.length?Number((wins.length/completedCycles.length*100).toFixed(2)):0,profitFactor:grossLoss?Number((grossProfit/grossLoss).toFixed(3)):null,averageNet:completedCycles.length?Number((completedCycles.reduce((n,c)=>n+c.net,0)/completedCycles.length).toFixed(2)):0,startEquity:first,endEquity:last,change:Number((last-first).toFixed(2)),holdEndEquity:Number(holdLast.toFixed(2)),excessVsHold:Number((last-holdLast).toFixed(2)),maxDrawdown:Number(maxDrawdown.toFixed(2)),maxDrawdownPct:Number(maxDrawdownPct.toFixed(2)),daily},null,2));
