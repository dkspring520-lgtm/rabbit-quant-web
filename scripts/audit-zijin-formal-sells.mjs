import fs from 'node:fs';
import {runSmartTReplay} from '../lib/smart-t-engine.mjs';

const file=process.argv[2];
if(!file)throw Error('usage: node scripts/audit-zijin-formal-sells.mjs <jsonl>');
const sessions=fs.readFileSync(file,'utf8').trim().split(/\r?\n/).map(JSON.parse).filter(x=>x.symbol==='601899');
const findings=[];let formalSells=0,blockedLowSells=0,cycles=0;
for(const session of sessions){
  const rows=session.minutes??[]; if(rows.length<100)continue;
  const prices=rows.map(r=>Number(r.price)).filter(Number.isFinite),low=Math.min(...prices),high=Math.max(...prices),range=Math.max(high-low,.0001);
  const result=runSmartTReplay(rows,{capital:200000,baseShares:Math.max(300,Math.floor((90000/(session.previousClose||prices[0]))/100)*100),sellable:Math.max(300,Math.floor((90000/(session.previousClose||prices[0]))/100)*100),feeRate:.025,slippage:.02,minCommission:true,slippageMode:'percent',forceCloseTime:'1450',previousClose:session.previousClose,profile:'平衡档',randomValue:0});
  cycles+=result.trades;
  for(const action of result.actions??[])if(action.side==='卖出'){
    formalSells++;const level=(action.price-low)/range;const before=rows.findIndex(r=>r.time===action.time);const prev=before>0?Number(rows[before-1].price):action.price;
    const window=rows.slice(Math.max(0,before-10),before+1).map(r=>Number(r.price)).filter(Number.isFinite);
    const priorHigh=Math.max(...window), priorLow=Math.min(...window);
    const falling=action.price<prev, pullbackFromPriorHigh=(priorHigh-action.price)/Math.max(priorHigh-priorLow,.0001);
    const meta=action.meta??{};
    const lowRisk=level<.25 && !(pullbackFromPriorHigh>.35);
    if(lowRisk) {blockedLowSells++;findings.push({date:session.date,time:action.time,price:action.price,dayLow:low,dayHigh:high,positionInRange:Number(level.toFixed(3)),falling,priorHigh,priorLow,pullbackFromPriorHigh:Number(pullbackFromPriorHigh.toFixed(3)),reason:action.reason,meta});}
  }
}
console.log(JSON.stringify({kind:'formal-sell-audit',sessions:sessions.length,formalSells,cycles,suspiciousLowOrFallingSells:blockedLowSells,findings:findings.slice(0,100)},null,2));
