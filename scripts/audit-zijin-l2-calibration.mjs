import fs from 'node:fs';
import { runSmartTReplay } from '../lib/smart-t-engine.mjs';
import { evaluateQmtOrderFlow } from '../lib/qmt-orderflow-confirmation.mjs';

const sessions = fs.readFileSync(process.argv[2], 'utf8').trim().split(/\r?\n/).map(JSON.parse).filter(s => s.symbol === '601899').sort((a,b) => String(a.date).localeCompare(String(b.date)));
const quality = { minutes: 0, flaggedAvailable: 0, staleQuotes: 0, missingQuoteAge: 0, badTimeOrder: 0 };
const groups = {};
const comparisons = {};
for (const s of sessions) {
  const rows = s.minutes ?? [];
  rows.forEach((p,i) => {
    quality.minutes++;
    if (p.l2Available === true) quality.flaggedAvailable++;
    if (p.quoteAgeMinutes == null) quality.missingQuoteAge++;
    else if (p.quoteAgeMinutes > 1) quality.staleQuotes++;
    if (i && String(p.time) <= String(rows[i-1].time)) quality.badTimeOrder++;
  });
  if (rows.length < 100) continue;
  const shares = Math.floor(90000 / (s.previousClose || rows[0].price) / 100) * 100;
  for (const cutoff of [null, '1330', '1345', '1400']) {
    const r = runSmartTReplay(rows, { capital:200000, baseShares:shares, sellable:shares, feeRate:.025, slippage:.02, minCommission:true, slippageMode:'percent', forceCloseTime:'1450', previousClose:s.previousClose, profile:'平衡档', randomValue:0, lateReverseCutoff:cutoff });
    const key = cutoff ?? 'baseline';
    const c = comparisons[key] ??= { cycles:0, net:0, fees:0 };
    c.cycles += r.trades; c.net += r.net; c.fees += r.fees;
    if (cutoff) continue;
    const entries = r.actions.filter(a => a.meta?.phase === 'entry');
    entries.forEach((a,i) => {
      const index = rows.findIndex(p => p.time === a.time);
      if (index < 0 || !Number.isFinite(r.cycleNets[i])) return;
      const flow = evaluateQmtOrderFlow(rows.slice(0,index+1), index, a.direction === '反T' ? 'SELL_FIRST' : 'BUY_FIRST');
      const status = !flow.available ? 'missing' : flow.pass ? 'support' : 'conflict';
      const groupKey = `${String(s.date).slice(0,4)}:${status}`;
      const g = groups[groupKey] ??= { count:0, wins:0, net:0, dates:[] };
      g.count++; g.wins += Number(r.cycleNets[i] > 0); g.net += r.cycleNets[i]; g.dates.push(s.date);
    });
  }
}
console.log(JSON.stringify({ sessions:sessions.length, quality, comparisons, groups, limitation:'Daily-reset replay, not cross-day execution. 2026 is retrospective validation, not unseen data. No score change promoted.' },null,2));
