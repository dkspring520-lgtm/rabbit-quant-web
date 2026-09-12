import test from 'node:test';
import assert from 'node:assert/strict';
import {selectChartSession,snapshotTradingDate,tradingDate} from '../lib/chart-session.mjs';
const minutes=[{time:'0930',price:32.5}];
test('weekend fetch retains Friday source date',()=>{
  const data={sourceTimestamp:'2026-09-11T16:15:00+08:00',fetchedAt:'2026-09-12T03:40:00Z',minutes};
  assert.equal(selectChartSession([data]).date,'2026-09-11');
});
test('quote-only refresh uses session own date, not newest quote date',()=>{
  const result=selectChartSession([{sourceTimestamp:'2026-09-14T09:31:00+08:00'},{intradaySessions:[{date:'20260911',minutes}]}]);
  assert.equal(result.date,'2026-09-11');
  assert.equal(result.minutes,minutes);
});
test('unknown date never uses fetchedAt or today',()=>{
  assert.equal(snapshotTradingDate({fetchedAt:'2026-09-12'}),null);
  assert.equal(selectChartSession([{fetchedAt:'2026-09-12',minutes}]).date,null);
});
test('latest valid session and malformed dates',()=>{
  assert.equal(tradingDate('2026-02-30'),null);
  assert.equal(selectChartSession([{intradaySessions:[{date:'20260910',minutes},{date:'20260911',minutes}]}]).date,'2026-09-11');
});
