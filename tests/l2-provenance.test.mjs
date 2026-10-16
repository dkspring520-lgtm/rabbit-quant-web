import test from 'node:test';
import assert from 'node:assert/strict';
import {withL2Provenance, shouldApplyL2Response, l2ProvenanceText} from '../lib/l2-provenance.mjs';

const now = Date.parse('2026-10-15T01:30:43Z');
function payload() {
  return {updatedAt: '2026-10-15T01:30:43Z', status: {connected:true,authorized:true,stale:false},
    streams:Object.fromEntries(['snapshot','transaction','order'].map(name=>[name, {
      exchangeTime: name==='snapshot'?'20261015-093041000':'20261015-093000040',
      receivedAt:'2026-10-15T01:30:42Z', available:true,generation:1}])),
    book:{source:'snapshot',lastPrice:29.73},latestTrade:{price:29.72,volume:100,generation:1,sequence:null,
      eventKind:'trade',available:true,exchangeTime:'20261015-093000040',receivedAt:'2026-10-15T01:30:42Z'},tradeEventsMeta:{generation:1}};
}
test('legacy response keeps quote and status without fabricating provenance',()=>{
  const old={book:{lastPrice:29.73},status:{connected:true,stale:false}};
  const p=withL2Provenance(old,now);
  assert.deepEqual(p.book,old.book);assert.equal(p.status.stale,false);assert.equal(p.streams,undefined);
  assert.match(l2ProvenanceText(p),/旧版响应/);
});
test('independent quote/trade clocks and missing sequence remain explicit',()=>{
  const p=withL2Provenance(payload(),now);
  assert.equal(p.status.stale,false);assert.equal(p.book.lastPrice,29.73);assert.equal(p.latestTrade.price,29.72);
  assert.match(l2ProvenanceText(p),/09:30:41.000/);assert.match(l2ProvenanceText(p),/09:30:00.040/);
  assert.match(l2ProvenanceText(p),/未认证唯一逐笔/);
});
test('receipt age, disconnect, missing stream and reconnect invalidate availability',()=>{
  assert.equal(withL2Provenance(payload(),now+16000).status.stale,true);
  let p=payload();p.status.connected=false;assert.equal(withL2Provenance(p,now).latestTrade.available,false);
  p=payload();delete p.streams.order;assert.equal(withL2Provenance(p,now).status.stale,true);
  p=payload();p.tradeEventsMeta.generation=2;assert.equal(withL2Provenance(p,now).latestTrade.available,false);
});
test('older HTTP/SSE response cannot overwrite current snapshot semantics',()=>{
  const p=payload(), old=payload();old.updatedAt='2026-10-15T01:30:41Z';
  assert.equal(shouldApplyL2Response(p,old),false);
  old.updatedAt=p.updatedAt;old.streams.snapshot.exchangeTime='20261015-093000040';
  assert.equal(shouldApplyL2Response(p,old),false);assert.equal(shouldApplyL2Response(null,p),true);
});
test('own trade receipt expires despite cancellation or UNKNOWN refreshing the stream',()=>{
  for(const kind of ['cancel','unknown']){const p=payload();p.transactionEvents=[{eventKind:kind}];p.latestTrade.receivedAt='2026-10-15T01:30:13Z';const r=withL2Provenance(p,now);assert.equal(r.streams.transaction.available,true);assert.equal(r.latestTrade.available,false);assert.equal(r.latestTrade.receiptAgeSeconds,30);}
});
test('API never revives collector false, missing or unverified trade classification',()=>{
  let p=payload();p.latestTrade.available=false;assert.equal(withL2Provenance(p,now).latestTrade.available,false);
  p=payload();delete p.latestTrade.available;assert.equal(withL2Provenance(p,now).latestTrade.available,false);
  for(const kind of [undefined,'unknown','cancel']){p=payload();p.latestTrade.eventKind=kind;assert.equal(withL2Provenance(p,now).latestTrade.available,false);}
});
test('trade missing receipt timezone, invalid or future receipt remains unavailable',()=>{
  for(const receivedAt of [undefined,'bad','2026-10-15T01:30:42','2026-10-15T01:30:44Z']){const p=payload();p.latestTrade.receivedAt=receivedAt;const r=withL2Provenance(p,now);assert.equal(r.latestTrade.available,false);if(receivedAt?.endsWith('44Z'))assert.equal(r.latestTrade.receiptAgeSeconds,-1);}
});
test('API retains fifteen second upper cap and honors tighter collector rejection',()=>{
  const p=payload();p.latestTrade.receivedAt=new Date(now-15000).toISOString();assert.equal(withL2Provenance(p,now).latestTrade.available,true);assert.equal(withL2Provenance(p,now+1).latestTrade.available,false);p.latestTrade.available=false;assert.equal(withL2Provenance(p,now-7000).latestTrade.available,false);
});
test('trade cross-day, missing generation and cross-generation cannot become current',()=>{
  for(const patch of [{exchangeTime:'20261014-093000040'},{generation:undefined},{generation:2}]){const p=payload();Object.assign(p.latestTrade,patch);assert.equal(withL2Provenance(p,now).latestTrade.available,false);}
  const p=payload();p.streams.transaction.generation=2;assert.equal(withL2Provenance(p,now).latestTrade.available,false);
});
test('legitimate trade channel differs from latest transaction record without becoming invalid',()=>{
  const p=payload();p.latestTrade.channel=1008;p.streams.transaction.channel=1007;assert.equal(withL2Provenance(p,now).latestTrade.available,true);
});
test('legacy or missing authorization never certifies last execution availability',()=>{
  const p=payload();delete p.streams;assert.equal(withL2Provenance(p,now).latestTrade.available,false);
  const q=payload();delete q.status.authorized;assert.equal(withL2Provenance(q,now).latestTrade.available,false);
});
