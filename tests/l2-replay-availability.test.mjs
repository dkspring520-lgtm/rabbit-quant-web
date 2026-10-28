import assert from 'node:assert/strict';
import test from 'node:test';
import {buildZijinL2CausalReplayObservations} from '../lib/zijin-l2-causal-replay.mjs';
import * as replay from '../lib/zijin-l2-causal-replay.mjs';
const row=(minute, observedAt, persistedAt)=>({exchangeMinute:minute,quality:{verified:true,minuteFinality:'verified'},timeContract:{observedAt,persistedAt}});
test('missing durable receipt and unknown source quality fail closed',()=>{
 assert.deepEqual(replay.scheduleVerifiedReplayRows([{exchangeMinute:'20261023-0930'}], '2026-10-23T02:00:00Z').rows,[]);
 const r=row('20261023-0930','2026-10-23T01:31:02Z',null);
 assert.equal(replay.scheduleVerifiedReplayRows([r], '2026-10-23T02:00:00Z').blocked,true);
 assert.deepEqual(buildZijinL2CausalReplayObservations([r]),[]);
});
test('availability uses persisted time, not the earlier exchange label',()=>{
 const r=row('20261023-0930','2026-10-23T01:31:02Z','2026-10-23T01:31:03Z');
 assert.equal(replay.scheduleVerifiedReplayRows([r],'2026-10-23T01:31:02Z').rows.length,0);
 assert.equal(replay.scheduleVerifiedReplayRows([r],'2026-10-23T01:31:03Z').rows.length,1);
});
test('out of order availability cannot backfill an older exchange minute',()=>{
 const rows=[row('20261023-0930','2026-10-23T01:30:59Z','2026-10-23T01:33:00Z'),row('20261023-0931','2026-10-23T01:31:59Z','2026-10-23T01:32:00Z')];
 assert.equal(replay.scheduleVerifiedReplayRows(rows,'2026-10-23T02:00:00Z').blocked,true);
});
