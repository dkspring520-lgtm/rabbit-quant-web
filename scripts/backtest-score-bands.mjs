import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runSmartTReplay } from '../lib/smart-t-engine.mjs';
import { resolveBacktestStrategyExperiment } from '../lib/zijin-strategy-experiments.mjs';
import { smartTProfitModeOptions } from '../lib/profit-mode.mjs';
const file=process.argv[2]??'.data-inspect/zijin-601899-2022-2026.jsonl';
const mode=process.argv[4]??'standard';
if(!['standard','zijin-small-spread'].includes(mode))throw new Error('Mode must be standard or zijin-small-spread');
const experiment=resolveBacktestStrategyExperiment('601899','closure-first');
const profitOptions=smartTProfitModeOptions('601899',mode);
const config={capital:200000,feeRate:.025,slippage:.02,minCommission:true,slippageMode:'percent',forceCloseTime:'1450',randomValue:0,
  ...profitOptions,profile:experiment.profile,volatilityMode:experiment.volatilityMode,profileOverrides:{...profitOptions.profileOverrides,...experiment.profileOverrides},positionSizeMode:experiment.positionSizeMode,strategyVersion:'closure-first',lateReverseCutoff:'1330'};
const raw=fs.readFileSync(file,'utf8');
const sessions=raw.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
const groups=new Map();
for(const split of ['historical-before-2026','historical-2026'])for(const direction of ['正T','反T'])for(const band of ['<60','60-69','70-79','80-100','unscored'])groups.set(`${split}:${direction}:${band}`,{split,direction,band,n:0,wins:0,net:0,profit:0,loss:0,equity:0,peak:0,maxDrawdownYuan:0});
let unclosed=0;
let engineClosedNet=0;
const trades=[];
for(const session of sessions){
  if(!Number.isFinite(session.previousClose)||session.previousClose<=0)throw new Error(`Invalid previous close: ${session.date}`);
  if(session.symbol&&String(session.symbol)!=='601899')throw new Error('Dataset must contain only 601899');
  const shares=Math.floor(90000/session.previousClose/100)*100;
  const replay=runSmartTReplay(session.minutes??[],{...config,baseShares:shares,sellable:shares,previousClose:session.previousClose});
  engineClosedNet+=(replay.cycleNets??[]).reduce((sum,value)=>sum+value,0);
  const entries=new Map();
  for(const action of replay.actions??[]){
    if(action.meta?.phase==='entry')entries.set(action.cycleId,action);
    if(action.meta?.phase!=='exit')continue;
    const entry=entries.get(action.cycleId);
    if(!entry)throw new Error('Unmatched exit');
    const score=entry.confirmationScore;
    const band=typeof score!=='number'||!Number.isFinite(score)||score<0||score>100?'unscored':score<60?'<60':score<70?'60-69':score<80?'70-79':'80-100';
    const split=String(session.date)<'20260101'?'historical-before-2026':'historical-2026';
    const g=groups.get(`${split}:${entry.direction}:${band}`),net=action.meta.cycleNet;
    if(!Number.isFinite(net))throw new Error('Missing cycle net');
    if(Math.abs(action.meta.cycleGross-action.meta.cycleFees-action.meta.cycleExecution-net)>0.01)throw new Error('Cycle cost reconciliation failed');
    trades.push({date:session.date,cycleId:action.cycleId,split,direction:entry.direction,band,entryScore:score,entryTime:entry.time,exitTime:action.time,quantity:entry.quantity,gross:action.meta.cycleGross,fees:action.meta.cycleFees,slippage:action.meta.cycleExecution,net,entryReason:entry.reason,exitReason:action.reason});
    g.n++;g.wins+=net>0?1:0;g.net+=net;g.profit+=Math.max(0,net);g.loss+=Math.max(0,-net);g.equity+=net;g.peak=Math.max(g.peak,g.equity);g.maxDrawdownYuan=Math.max(g.maxDrawdownYuan,g.peak-g.equity);
    entries.delete(action.cycleId);
  }
  unclosed+=entries.size;
}
const totalNet=trades.reduce((sum,trade)=>sum+trade.net,0);
if(Math.abs(totalNet-engineClosedNet)>0.01)throw new Error('Engine and grouped closed-cycle PnL differ');
const sourceHashes=Object.fromEntries(['scripts/backtest-score-bands.mjs','lib/smart-t-engine.mjs','lib/zijin-strategy-experiments.mjs','lib/profit-mode.mjs'].map(path=>[path,crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')]));
const report={schemaVersion:2,generatedAt:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),mode,config,configSha256:crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex'),datasetSha256:crypto.createHash('sha256').update(raw).digest('hex'),sessions:sessions.length,firstDate:sessions[0]?.date,lastDate:sessions.at(-1)?.date,unclosed,
  methodology:'Uses the desk Zijin strategy resolver and profit-mode overrides, not balanced profile. Per-session reset, 200000 capital, approx 90000 base holding. Entry score groups; closed-cycle net includes engine fees and slippage. Both date splits are retrospective: 2026 data was previously used in research. Group drawdown is cumulative closed-cycle PnL, not account mark-to-market. Not account replication: actual positions and similarityArchive unavailable; shadow-only preopen permission omitted. No future out-of-sample claim.',
  sourceHashes,summary:{closedCycles:trades.length,wins:trades.filter(trade=>trade.net>0).length,netYuan:+totalNet.toFixed(2),engineClosedNetYuan:+engineClosedNet.toFixed(2)},trades,
  bands:[...groups.values()].map(g=>({split:g.split,direction:g.direction,band:g.band,n:g.n,winRate:g.n?g.wins/g.n:null,netYuan:+g.net.toFixed(2),meanNetYuan:g.n?+(g.net/g.n).toFixed(2):null,profitFactor:g.loss?g.profit/g.loss:null,noLoss:g.n>0&&g.loss===0,maxDrawdownYuan:+g.maxDrawdownYuan.toFixed(2)}))};
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
