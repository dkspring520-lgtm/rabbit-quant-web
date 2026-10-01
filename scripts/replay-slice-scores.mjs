import fs from 'node:fs';
import {scoreSlice} from '../lib/slice-scoring.mjs';
import {advanceSlice} from '../lib/slice-alerts.mjs';
const file=process.argv[2];
if(!file)throw Error('Provide real minute JSONL path');
const sessions=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse).filter(s=>s.symbol==='601899').sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(-20);
const outcomes=[];
for(const session of sessions){let state={};for(let i=5;i<session.minutes.length;i++){const r=session.minutes[i];if(r.time<'0935'||r.time>'1456'||r.l2Available!==true)continue;const score=scoreSlice(session.minutes.slice(0,i+1));const count=state.events?.length??0;state=advanceSlice(state,{...score,available:score.ready,time:r.time,price:r.price});if(state.events.length>count){const e=state.events.at(-1),entry=session.minutes[i+1],exit=session.minutes[i+6];if(entry&&exit){const p=entry.open??entry.price;outcomes.push({date:session.date,side:e.side,score:e.score,returnPct:(exit.price/p-1)*100*(e.side==='buy'?1:-1)});}}}}
console.log(JSON.stringify({kind:'event-study-not-trade-backtest',start:sessions[0]?.date,end:sessions.at(-1)?.date,days:sessions.length,eventsWithFiveMinuteOutcome:outcomes.length,meanDirectionalReturnPct:outcomes.reduce((s,r)=>s+r.returnPct,0)/Math.max(1,outcomes.length),positive:outcomes.filter(r=>r.returnPct>0).length,feesIncluded:false,warning:'Overlapping observations; no executed positions or win-rate claim'},null,2));
