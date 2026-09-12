import fs from 'node:fs';
import { runSmartTReplay } from '../lib/smart-t-engine.mjs';
import { evaluateQmtOrderFlow } from '../lib/qmt-orderflow-confirmation.mjs';
const sessions = fs.readFileSync(process.argv[2], 'utf8').trim().split(/\r?\n/).map(JSON.parse)
  .filter(s => s.symbol === '601899' && String(s.date) >= '20260102' && String(s.date) <= '20260430');
const rowsOut=[];
for (const s of sessions) {
  const rows=s.minutes??[], ref=Number(s.previousClose||rows[0]?.price), shares=Math.floor(90000/ref/100)*100;
  const r=runSmartTReplay(rows,{capital:200000,baseShares:shares,sellable:shares,feeRate:.025,slippage:.02,minCommission:true,slippageMode:'percent',forceCloseTime:'1450',previousClose:s.previousClose,profile:'平衡档',randomValue:0});
  for(let i=0;i<(r.cycleNets??[]).length;i++) if(r.cycleNets[i]<0){const e=r.actions[i*2],x=r.actions[i*2+1]; const ei=rows.findIndex(p=>String(p.time)===String(e?.time)); const flow=ei>=0?evaluateQmtOrderFlow(rows.slice(0,ei+1),ei,e?.direction==='反T'?'SELL_FIRST':'BUY_FIRST'):null; rowsOut.push({date:s.date,net:Number(r.cycleNets[i].toFixed(2)),entry:e&&{time:e.time,side:e.side,price:e.price,direction:e.direction},exit:x&&{time:x.time,reason:x.reason?.split('；')[0],hold:x.meta?.hold},l2:flow?.available?(flow.pass?'support':'conflict'):'missing'});}
}
console.log(JSON.stringify({count:rowsOut.length,losses:rowsOut},null,2));
