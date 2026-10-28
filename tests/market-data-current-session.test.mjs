import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

// Execute the real route with deterministic upstream responses; no network.
const source=readFileSync(new URL('../app/api/market-data/route.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  .replaceAll(/"@\/([^\"]+)"/g,(_,path)=>JSON.stringify(new URL('../'+path,import.meta.url).href));
const {GET}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const RealDate=Date;
test('real ordinary and trial routes preserve source dates and reject future/old/undated minutes',async t=>{
 t.mock.method(globalThis,'Date',class extends RealDate {
   constructor(...args){super(...(args.length?args:['2026-10-28T12:00:00+08:00']));}
   static now(){return new RealDate('2026-10-28T12:00:00+08:00').getTime();}
 });
 let minuteDate='20261028',eastmoney=false;
 t.mock.method(globalThis,'fetch',async input=>{
   const url=String(input);
   if(url.startsWith('https://qt.gtimg.cn/')){
     const f=Array(50).fill('0');f[1]='ZIJIN';f[2]='601899';f[3]='28';f[4]='27';f[5]='28';f[30]='20261028113000';
     return new Response('v_sh601899="'+f.join('~')+'";');
   }
   if(url.includes('/minute/query?')){
     if(eastmoney)throw new Error('synthetic Tencent failure');
     return Response.json({data:{sh601899:{data:{date:minuteDate,data:['0930 28 100 280000','1130 28 200 560000','1300 29 300 850000','1500 30 400 1150000']}}}});
   }
   if(url.includes('klt=1&'))return Response.json({data:{klines:['2026-10-28 09:30,28,28,28,28,1','2026-10-28 11:30,28,28,28,28,1','2026-10-28 15:00,30,30,30,30,1']}});
   return Response.json({data:{}});
 });
 for(const mode of ['trial-realtime','realtime','']){
   const response=await GET(new Request(`http://localhost/api/market-data?code=601899&mode=${mode}`));
   assert.equal(response.status,200);
   const result=await response.json();
   assert.deepEqual(result.minutes.map(p=>[p.date,p.time]),[['2026-10-28','0930'],['2026-10-28','1130']]);
 }
 for(const date of ['20261027',undefined]){
   minuteDate=date;
   const result=await (await GET(new Request('http://localhost/api/market-data?code=601899&mode=trial-realtime'))).json();
   assert.deepEqual(result.minutes,[]);
 }
 eastmoney=true;
 const fallback=await (await GET(new Request('http://localhost/api/market-data?code=601899&mode=trial-realtime'))).json();
 assert.equal(fallback.minuteProvider,'eastmoney-public');
 assert.deepEqual(fallback.minutes.map(p=>p.time),['0930','1130']);
 assert.ok(fallback.minutes.every(p=>p.date==='2026-10-28'));
});
