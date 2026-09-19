import fs from 'node:fs';
import crypto from 'node:crypto';
import { runSmartTReplay } from '../lib/smart-t-engine.mjs';
const file=process.argv[2]??'.data-inspect/zijin-601899-2022-2026.jsonl';
const raw=fs.readFileSync(file,'utf8');
const sessions=raw.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
const groups=new Map();
for(const split of ['selection','holdout'])for(const direction of ['正T','反T'])for(const band of ['<60','60-69','70-79','80-100','unscored'])groups.set(`${split}:${direction}:${band}`,{split,direction,band,n:0,wins:0,net:0,profit:0,loss:0,equity:0,peak:0,maxDrawdownYuan:0});
let unclosed=0;
for(const session of sessions){
  const replay=runSmartTReplay(session.minutes??[],{capital:200000,baseShares:Math.floor(90000/session.previousClose/100)*100,sellable:Math.floor(90000/session.previousClose/100)*100,previousClose:session.previousClose,feeRate:.025,slippage:.02,minCommission:true,slippageMode:'percent',forceCloseTime:'1450',profile:'平衡档',randomValue:0});
  const entries=new Map();
  for(const action of replay.actions??[]){
    if(action.meta?.phase==='entry')entries.set(action.cycleId,action);
    if(action.meta?.phase!=='exit')continue;
    const entry=entries.get(action.cycleId);
    if(!entry)throw new Error('Unmatched exit');
    const score=entry.confirmationScore;
    const band=typeof score!=='number'||!Number.isFinite(score)?'unscored':score<60?'<60':score<70?'60-69':score<80?'70-79':'80-100';
    const split=String(session.date)<'20260101'?'selection':'holdout';
    const g=groups.get(`${split}:${entry.direction}:${band}`),net=action.meta.cycleNet;
    if(!Number.isFinite(net))throw new Error('Missing cycle net');
    g.n++;g.wins+=net>0?1:0;g.net+=net;g.profit+=Math.max(0,net);g.loss+=Math.max(0,-net);g.equity+=net;g.peak=Math.max(g.peak,g.equity);g.maxDrawdownYuan=Math.max(g.maxDrawdownYuan,g.peak-g.equity);
    entries.delete(action.cycleId);
  }
  unclosed+=entries.size;
}
const report={generatedAt:new Date().toISOString(),datasetSha256:crypto.createHash('sha256').update(raw).digest('hex'),sessions:sessions.length,firstDate:sessions[0]?.date,lastDate:sessions.at(-1)?.date,unclosed,
  methodology:'Current runSmartTReplay, balanced profile, per-session reset, 200000 capital, 90000 base holding. Entry score groups; exit cycleNet includes engine costs. Holdout >=20260101. Group drawdown is cumulative closed-cycle PnL, not account mark-to-market. No historical L2 reconstruction. Not a production-configuration or portfolio-equity backtest.',
  bands:[...groups.values()].map(g=>({split:g.split,direction:g.direction,band:g.band,n:g.n,winRate:g.n?g.wins/g.n:null,netYuan:+g.net.toFixed(2),meanNetYuan:g.n?+(g.net/g.n).toFixed(2):null,profitFactor:g.loss?g.profit/g.loss:null,noLoss:g.n>0&&g.loss===0,maxDrawdownYuan:+g.maxDrawdownYuan.toFixed(2)}))};
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
