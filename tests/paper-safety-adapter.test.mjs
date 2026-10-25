import assert from 'node:assert/strict';
import test from 'node:test';
import {PaperExecutionEngine as Paper,calculatePaperCosts} from '../lib/paper-trading/paper-execution-engine.mjs';
import {PaperExecutionEngine as RL,executePaperAction} from '../lib/rl-research/paper-execution-engine.mjs';
const market={date:'20261023',time:'1000',price:10,marketPrice:10,cash:10000,position:0,availableSellablePosition:0};
test('both explicit fee configs include transfer fee on buy/sell',async()=>{
 const config={commission:.025,minimumCommission:5,stampDuty:.05,transferFee:.001,slippage:0};
 assert.equal(calculatePaperCosts({side:'BUY',orderPrice:10,fillPrice:10,quantity:100,config}).fees,5.01);
 assert.equal(calculatePaperCosts({side:'SELL',orderPrice:10,fillPrice:10,quantity:100,config}).fees,5.51);
 assert.equal(executePaperAction(market,{action:'BUY',quantity:100},{feeRate:.025,minimumCommission:5,stampDutyRate:.0005,transferFeeRate:.00001,slippagePct:0}).fee,5.01);
});
for(const [name,Engine,action] of [['paper',Paper,{side:'BUY'}],['rl',RL,{action:'BUY'}]]) {
 test(name+' does not unlock same-day purchases on date regression',async()=>{
  const e=new Engine({symbol:'601899',initialCash:10000});e.execute(market,{...action,orderId:'buy',quantity:100});
  assert.throws(()=>e.advanceTo('20261022'),/date|日期/i);
  assert.equal(name==='paper'?e.snapshot().position.availableSellablePosition:e.snapshot().sellablePosition,0);
 });
}
import {createDurablePaperSession} from '../lib/paper-trading/durable-session.mjs';
for(const kind of ['paper','research']) test(kind+' durable execution fails visibly and deduplicates across restart',async()=>{
 let value=null,fail=true;
 const storage={getItem:()=>value,setItem:(_k,v)=>{if(fail)throw new Error('quota failure');value=v;}};
 const options={engineKind:kind,accountKey:'synthetic-account',key:'paper-only',storage,initialOptions:{symbol:'601899',initialCash:10000}};
 const action={orderId:'one',quantity:100,...(kind==='paper'?{side:'BUY'}:{action:'BUY'})};
 const first=createDurablePaperSession(options);
 await assert.rejects(()=>first.execute(market,action),/quota/); assert.equal(first.snapshot().cash,10000);
 fail=false;const fill=await first.execute(market,action);const cash=first.snapshot().cash;
 const restarted=createDurablePaperSession(options);
 assert.deepEqual(await restarted.execute({...market,price:20},action),fill);assert.equal(restarted.snapshot().cash,cash);
 await assert.rejects(()=>restarted.execute(market,{...action,quantity:200}),/conflicts/);
 const sell={orderId:'two',quantity:100,...(kind==='paper'?{side:'SELL'}:{action:'SELL'})};
 const rejected=await restarted.execute(market,sell);assert.equal(rejected.status,kind==='paper'?'REJECTED':'rejected');
 assert.throws(()=>createDurablePaperSession({...options,engineKind:kind==='paper'?'research':'paper'}),/identity/);
 value='{bad';assert.throws(()=>createDurablePaperSession(options));
});
import {PAPER_COSTS_V2,RESEARCH_COSTS_V2} from '../lib/paper-trading/durable-session.mjs';
test('explicit adapter configs preserve different legacy rate units',async()=>{
 assert.equal(PAPER_COSTS_V2.stampDuty/100,RESEARCH_COSTS_V2.stampDutyRate);
 assert.equal(PAPER_COSTS_V2.transferFee/100,RESEARCH_COSTS_V2.transferFeeRate);
});
for(const kind of ['paper','research']) test(kind+' restart preserves T+1 and settles only a forward date',async()=>{
 let value=null;const storage={getItem:()=>value,setItem:(_k,v)=>{value=v;}};
 const options={engineKind:kind,accountKey:'test',storage,key:'test',initialOptions:{symbol:'601899',initialCash:10000}};
 let session=createDurablePaperSession(options);const action=side=>kind==='paper'?{side}:{action:side};
 await session.execute(market,{...action('BUY'),orderId:'b',quantity:100});
 session=createDurablePaperSession(options);
 await assert.rejects(()=>session.execute({...market,date:'20261022'},{...action('SELL'),orderId:'back',quantity:100}),/date/i);
 const done=await session.execute({...market,date:'20261026'},{...action('SELL'),orderId:'forward',quantity:100});
 assert.equal(done.status,kind==='paper'?'FILLED':'filled');
});
test('both engines reject explicitly stale input without mutating balances',async()=>{
 for(const [Engine,action] of [[Paper,{side:'BUY'}],[RL,{action:'BUY'}]]){
  const e=new Engine({initialCash:10000,symbol:'601899'});const order=e.execute({...market,dataQuality:{stale:true}},{...action,orderId:'stale',quantity:100});
  assert.equal(order.status.toLowerCase(),'rejected');assert.equal(e.snapshot().cash,10000);
 }
});
test('persisted account cannot silently switch symbol or fee configuration',async()=>{
 let raw=null;const storage={getItem:()=>raw,setItem:(_k,v)=>{raw=v;}};
 const options={engineKind:'paper',accountKey:'same',storage,key:'same',initialOptions:{symbol:'601899',initialCash:10000}};
 await createDurablePaperSession(options).execute(market,{side:'BUY',quantity:100,orderId:'one'});
 assert.throws(()=>createDurablePaperSession({...options,initialOptions:{symbol:'other',initialCash:10000}}),/configuration/);
 const saved=JSON.parse(raw);saved.engine.position.totalPosition=-100;raw=JSON.stringify(saved);
 assert.throws(()=>createDurablePaperSession(options),/inventory/);
});
