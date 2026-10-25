import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeZijinL2ReplayPayload, mergeZijinL2ReplayMinutes} from '../lib/zijin-l2-causal-replay.mjs';
import * as observer from '../scripts/zijin-l2-state-observer.mjs';
test('legacy causal flag is downgraded; source quality is retained', () => {
 const p={schemaVersion:1,causal:true,sourceWatermark:'w',minutes:[{exchangeMinute:'20261023-0930',fieldSources:{price:'snapshot'},quality:{verified:false},observedAt:'2026-10-23T01:31:02Z'}]};
 const r=normalizeZijinL2ReplayPayload(p,'20261023');
 assert.equal(r.causal,false); assert.equal(r.archiveCompletionStatus,'LEGACY_SOURCE_AVAILABILITY_UNVERIFIED'); assert.equal(r.sourceWatermark,'w'); assert.deepEqual(r.minutes[0].fieldSources,p.minutes[0].fieldSources);
});
test('absent numeric inputs remain unknown, not zero',()=>{
 const [r]=mergeZijinL2ReplayMinutes([{time:'0930',price:27}], [{exchangeMinute:'20261023-0930',amount:null}], '20261023');
 assert.equal(r.amount,null);assert.equal(r.volume,null);
});
test('ledger corruption and unreadable targets fail visibly; missing file can initialize',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'l2-contract-'));
 try { assert.deepEqual(await observer.readJsonLines(join(dir,'missing')),[]); const p=join(dir,'bad'); await writeFile(p,'{broken'); await assert.rejects(observer.readJsonLines(p)); await assert.rejects(observer.readJsonLines(dir)); } finally {await rm(dir,{recursive:true,force:true});}
});
import {mergeUnverifiedArchive, readOptionalJson} from '../lib/zijin-replay-storage.mjs';
test('late/restart snapshots cannot erase archived minutes; quality survives',()=>{
 const prior={minutes:[{exchangeMinute:'20261023-0930',book:{bidPrices:[27]},fieldSources:{book:'snapshot'},timeContract:{observedAt:'later'}}]};
 const merged=mergeUnverifiedArchive(prior,'20261023',[{exchangeMinute:'20261023-0931',amount:null}],'now');
 assert.equal(merged.minutes.length,2); assert.equal(merged.causal,false); assert.deepEqual(merged.minutes[0],prior.minutes[0]);
 const replay=normalizeZijinL2ReplayPayload(merged,'20261023');
 assert.deepEqual(replay.minutes[0].book,prior.minutes[0].book); assert.equal(replay.archiveCompletionStatus,merged.completionStatus);
});
test('corrupt archive must fail rather than look absent',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'l2-archive-'));
 try { const p=join(dir,'a'); await writeFile(p,'bad'); await assert.rejects(readOptionalJson(p)); assert.equal(await readOptionalJson(join(dir,'none')),null); }
 finally {await rm(dir,{recursive:true,force:true});}
});
import {readFile, mkdir} from 'node:fs/promises';
test('observer integration preserves prior archive on stale input and reports ledger corruption',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'l2-observer-'));
 const keys=['ZIJIN_L2_AUDIT_STATE_PATH','ZIJIN_L2_AUDIT_LEDGER_PATH','ZIJIN_L2_AUDIT_LABEL_PATH','ZIJIN_L2_REPLAY_ARCHIVE_DIR'];
 const old=keys.map(k=>process.env[k]); const oldFetch=globalThis.fetch;
 try {
  keys.forEach((k,i)=>process.env[k]=join(dir,String(i)));
  await mkdir(process.env[keys[3]]);
  const archive=join(process.env[keys[3]],'20261026.json');
  await writeFile(archive,JSON.stringify({minutes:[{exchangeMinute:'20261026-0930',price:27}]}));
  let stale=true;
  globalThis.fetch=async url=>({ok:true,json:async()=>String(url).includes('orderflow') ? {status:{connected:true,authorized:true,stale},lastExchangeTime:'20261026-093110123',recentMinutes:[{exchangeMinute:'20261026-0931',time:'0931',price:27,amount:null,book:{bidPrices:[27]},quality:{verified:false}}]} : {}});
  const m=await import('../scripts/zijin-l2-state-observer.mjs?integration');
  await m.runOnce('2026-10-26T01:31:10Z');
  assert.equal(JSON.parse(await readFile(archive)).minutes.length,1);
  stale=false;
  await m.runOnce('2026-10-26T01:31:10Z');
  const saved=JSON.parse(await readFile(archive));
  assert.equal(saved.causal,false); assert.equal(saved.minutes.length,2); assert.deepEqual(saved.minutes[1].book,{bidPrices:[27]});
  await writeFile(process.env[keys[1]],'corrupt');
  await assert.rejects(m.runOnce('2026-10-26T01:31:10Z'),/ledger read failed/);
 } finally {globalThis.fetch=oldFetch; keys.forEach((k,i)=>old[i]===undefined?delete process.env[k]:process.env[k]=old[i]);await rm(dir,{recursive:true,force:true});}
});
test('collector snapshot timestamps with seconds are accepted by freshness gate',()=>{
 assert.equal(observer.isFreshLiveExchangeMinute('20261026-093110123','2026-10-26T01:31:15Z'),true);
 assert.equal(observer.isFreshLiveExchangeMinute('20261026-092010123','2026-10-26T01:31:15Z'),false);
});
