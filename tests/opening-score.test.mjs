import test from 'node:test';
import assert from 'node:assert/strict';
import {openingScoreEvents} from '../lib/opening-score.mjs';
const row=(time,price,extra={})=>({time,price,...extra});
test('extreme opening is visible before 0935 and observation only',()=>{
  const events=openingScoreEvents([row('0930',96,{open:96})],100);
  assert.equal(events[0].label,'极端低开');
  assert.equal(events[0].score,80);
  assert.equal(events[0].executionAllowed,false);
});
test('flat open then crash is not called extreme low open',()=>{
  const events=openingScoreEvents([row('0930',100),row('0931',96)],100);
  assert.equal(events[0].label,'开盘急跌');
});
test('missing open or previous close does not fabricate background',()=>{
  assert.deepEqual(openingScoreEvents([row('1000',96)],100),[]);
  assert.deepEqual(openingScoreEvents([row('0930',96)],null),[]);
});
test('confirmed repair, band deduplication and prefix causality',()=>{
  const rows=[row('0930',96),row('0931',95),row('0932',96),row('0933',97,{averagePrice:96}),row('0934',98,{averagePrice:96})];
  const events=openingScoreEvents(rows,100);
  assert.equal(events.filter(e=>e.label.includes('修复走强')).length,1);
  assert.deepEqual(events.filter(e=>e.time<'0934'),openingScoreEvents(rows.slice(0,-1),100));
});
