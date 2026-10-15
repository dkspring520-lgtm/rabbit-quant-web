import test from 'node:test';
import assert from 'node:assert/strict';
import {withL2Provenance, shouldApplyL2Response, l2ProvenanceText} from '../lib/l2-provenance.mjs';

const now = Date.parse('2026-10-15T01:30:43Z');
function payload() {
  return {updatedAt: '2026-10-15T01:30:43Z', status: {connected:true,authorized:true,stale:false},
    streams:Object.fromEntries(['snapshot','transaction','order'].map(name=>[name, {
      exchangeTime: name==='snapshot'?'20261015-093041000':'20261015-093000040',
      receivedAt:'2026-10-15T01:30:42Z', available:true}])),
    book:{source:'snapshot',lastPrice:29.73},latestTrade:{price:29.72,volume:100,generation:1,sequence:null},tradeEventsMeta:{generation:1}};
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
