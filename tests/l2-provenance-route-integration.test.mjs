import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

test('real route preserves provenance through JSON, bounded SSE and legacy JSON',async()=>{
  const base=new URL('../.sites-runtime/route-tests/',import.meta.url);
  await mkdir(base,{recursive:true});const dir=await mkdtemp(join(fileURLToPath(base),'state-'));
  assert.ok(dir.startsWith(fileURLToPath(base)));
  const file=join(dir,'state.json');process.env.ZIJIN_L2_STATE_PATH=file;
  const {GET}=await import('../app/api/research/zijin-l2-orderflow/route.ts');
  const fresh=()=>({schemaVersion:6,updatedAt:new Date().toISOString(),symbol:'601899',lastExchangeTime:'20261015-093041000',
    lastExchangeTimeSource:'snapshot',status:{connected:true,authorized:true,ageSeconds:0,stale:false},messages:{snapshot:1,transaction:2,order:3},
    streams:Object.fromEntries(['snapshot','transaction','order'].map(s=>[s,{exchangeTime:s==='snapshot'?'20261015-093041000':'20261015-093000040',receivedAt:new Date().toISOString(),available:true,generation:1}])),
    book:{lastPrice:29.73},session:{volume:7159911},latestTrade:{price:29.72,volume:100,generation:1,eventKind:'trade',available:true,exchangeTime:'20261015-093000040',receivedAt:new Date().toISOString()},tradeEventsMeta:{generation:1}});
  try{
    await writeFile(file,JSON.stringify(fresh()));
    const response=await GET(new Request('http://localhost/api/research/zijin-l2-orderflow'));
    const data=await response.json();assert.equal(data.status.stale,false);assert.equal(data.latestTrade.price,29.72);
    assert.equal(data.latestTrade.available,true);
    assert.equal(data.book.lastPrice,29.73);assert.equal(data.lastExchangeTimeSource,'snapshot');
    assert.match(response.headers.get('cache-control'),/no-store/);
    const abort=new AbortController();
    const stream=await GET(new Request('http://localhost/api/research/zijin-l2-orderflow?stream=1',{signal:abort.signal}));
    const reader=stream.body.getReader();const first=await reader.read();abort.abort();await reader.cancel();
    assert.match(new TextDecoder().decode(first.value),/"latestTrade"/);
    assert.equal(stream.headers.get('x-accel-buffering'),'no');
    for(const [name,modify] of [
      ['old own receipt',p=>{p.latestTrade.receivedAt=new Date(Date.now()-30000).toISOString();}],
      ['collector false',p=>{p.latestTrade.available=false;}],
      ['unknown classification',p=>{p.latestTrade.eventKind='unknown';}],
      ['missing receipt',p=>{delete p.latestTrade.receivedAt;}],
      ['previous source date',p=>{p.latestTrade.exchangeTime='20261014-093000040';}],
    ]){
      await new Promise(resolve=>setTimeout(resolve,270));const p=fresh();modify(p);await writeFile(file,JSON.stringify(p));
      const checked=await (await GET(new Request('http://localhost/api/research/zijin-l2-orderflow'))).json();
      assert.equal(checked.streams.transaction.available,true,name);assert.equal(checked.latestTrade.available,false,name);
    }
    await new Promise(resolve=>setTimeout(resolve,270));await writeFile(file,JSON.stringify(fresh()));
    assert.equal((await (await GET(new Request('http://localhost/api/research/zijin-l2-orderflow'))).json()).latestTrade.available,true);
    await new Promise(resolve=>setTimeout(resolve,270));
    await writeFile(file,JSON.stringify({updatedAt:new Date().toISOString(),status:{connected:true,authorized:true,ageSeconds:0},messages:{snapshot:1},book:{lastPrice:29.73}}));
    const old=await (await GET(new Request('http://localhost/api/research/zijin-l2-orderflow'))).json();
    assert.equal(old.provenanceStatus,'legacy-unavailable');assert.equal(old.book.lastPrice,29.73);
  }finally{delete process.env.ZIJIN_L2_STATE_PATH;await rm(dir,{recursive:true,force:true});}
});
