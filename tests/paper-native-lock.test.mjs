import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
import {createDurablePaperSession} from '../lib/paper-trading/durable-session.mjs';
const market={date:'20261023',time:'1000',price:10};
test('interleaved writers both retain confirmed fills under native lock',async()=>{
 let raw=null,hook=null,other;
 const storage={getItem:()=>raw,setItem:(_key,value)=>{if(hook){const fn=hook;hook=null;fn();}raw=value;}};
 const options={engineKind:'paper',accountKey:'concurrent',key:'native-concurrent',storage,initialOptions:{initialPosition:1000,initialCash:10000}};
 const a=createDurablePaperSession(options),b=createDurablePaperSession(options);
 hook=()=>{other=b.execute(market,{orderId:'B',side:'BUY',quantity:100});};
 assert.equal((await a.execute(market,{orderId:'A',side:'BUY',quantity:100})).status,'FILLED');
 assert.equal((await other).status,'FILLED');
 const restored=createDurablePaperSession(options);
 assert.equal(restored.snapshot().position.totalPosition,1200);
 await restored.execute(market,{orderId:'A',side:'BUY',quantity:100});
 assert.equal(restored.snapshot().position.totalPosition,1200);
});
test('lock absence fails closed and storage failure releases native lock',async()=>{
 let raw=null,fail=true;
 const storage={getItem:()=>raw,setItem:(_k,v)=>{if(fail)throw Error('disk');raw=v;}};
 const options={engineKind:'paper',accountKey:'failure',key:'native-failure',storage,initialOptions:{initialCash:10000}};
 const action={orderId:'one',side:'BUY',quantity:100};
 await assert.rejects(createDurablePaperSession({...options,locks:null}).execute(market,action),/锁/);
 assert.equal(raw,null);
 await assert.rejects(createDurablePaperSession(options).execute(market,action),/disk/);
 fail=false;
 assert.equal((await createDurablePaperSession(options).execute(market,action)).status,'FILLED');
});
test('native lock owner termination releases ownership without an application lease',async()=>{
 const worker=new Worker(`const {parentPort}=require('node:worker_threads');navigator.locks.request('rabbit-paper:terminated',async()=>{parentPort.postMessage('held');await new Promise(()=>{});});setInterval(()=>{},1000);`,{eval:true});
 try {
  await once(worker,'message');
  await worker.terminate();
  const result=await navigator.locks.request('rabbit-paper:terminated',{signal:AbortSignal.timeout(2000)},()=>true);
  assert.equal(result,true);
 } finally {await worker.terminate();}
});
