import fs from 'node:fs';
import { runSmartTReplay } from '../lib/smart-t-engine.mjs';
import { hasFormalAlertScore, isRiskExitAction } from '../lib/alert-delivery-policy.mjs';

const file = process.argv[2];
if (!file) throw new Error('usage: node scripts/audit-zijin-exit-alerts.mjs <jsonl>');
const sessions = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(JSON.parse).filter(s => s.symbol === '601899');
const groups = {};
const missing = [];
for (const session of sessions) {
  const rows = session.minutes ?? [];
  if (rows.length < 100) continue;
  const shares = Math.floor(90000 / (session.previousClose || rows[0].price) / 100) * 100;
  const replay = runSmartTReplay(rows, { capital: 200000, baseShares: shares, sellable: shares, feeRate: .025, slippage: .02, minCommission: true, slippageMode: 'percent', forceCloseTime: '1450', profile: '平衡档', previousClose: session.previousClose, randomValue: 0, lateReverseCutoff: '1330' });
  for (const action of replay.actions) {
    const phase = action.meta?.phase ?? 'unknown';
    const reason = phase === 'entry' ? 'entry' : action.meta?.forceExit ? 'forceExit' : action.meta?.stop ? 'stop' : action.meta?.takeProfit ? 'takeProfit' : action.meta?.trailingProfit ? 'trailingProfit' : 'timeOrStructureExit';
    const group = groups[reason] ??= { actions: 0, eligibleForFormalSync: 0, eligibleForRiskSync: 0, unresolved: 0 };
    group.actions++;
    group.eligibleForFormalSync += Number(hasFormalAlertScore(action));
    group.eligibleForRiskSync += Number(isRiskExitAction(action));
    if (!hasFormalAlertScore(action) && !isRiskExitAction(action)) {
      group.unresolved++;
      missing.push({ date: session.date, time: action.time, side: action.side, phase, reason, confirmationScore: action.confirmationScore ?? null });
    }
  }
}
console.log(JSON.stringify({ kind: 'zijin-exit-alert-audit', scope: 'Daily-reset replay with 13:30 cutoff; delivery eligibility only, not execution performance', groups, unresolvedActions: missing }, null, 2));
if (missing.length) process.exitCode = 1;
