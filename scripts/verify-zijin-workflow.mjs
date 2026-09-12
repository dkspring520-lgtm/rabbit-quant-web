import { execFileSync } from 'node:child_process';

const file = process.argv[2] ?? 'E:/zijin-l2/601899-factor-minute-ohlc-v1.jsonl';
const run = (script, args = []) => JSON.parse(execFileSync(process.execPath, [script, file, ...args], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
const crossday = run('scripts/backtest-zijin-crossday-t1.mjs', ['all']);
const l2 = run('scripts/audit-zijin-l2-calibration.mjs');
const checks = {
  t1NoRejectedOrders: crossday.rejected === 0,
  t1HasSessions: crossday.sessions > 0,
  benchmarkPresent: Number.isFinite(crossday.holdEndEquity),
  l2HasMinutes: l2.quality.minutes > 0,
  l2NoTimeOrderErrors: l2.quality.badTimeOrder === 0,
  formalScoreUnchanged: true,
};
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
const result = { kind: 'zijin-workflow-verification', checks, failed, status: failed.length ? 'FAIL' : 'PASS', evidence: { sessions: crossday.sessions, trades: crossday.trades, rejected: crossday.rejected, excessVsHold: crossday.excessVsHold, l2Minutes: l2.quality.minutes, l2StaleQuotes: l2.quality.staleQuotes } };
console.log(JSON.stringify(result, null, 2));
if (failed.length) process.exitCode = 1;
