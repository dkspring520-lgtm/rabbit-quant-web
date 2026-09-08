import test from 'node:test';
import assert from 'node:assert/strict';
import { studioSignals } from '../lib/rabbit-studio-signals.mjs';

test('keeps recorded anchors, rejects other dates/stocks and promotes formal duplicate', () => {
  const candidate = { id: 1, code: '601899', marketDate: '2026-09-08', marketTime: '1013', level: 'candidate', payload: { observation: { direction: '正T', price: 33.25, score: 80 } } };
  const formal = { ...candidate, id: 2, level: 'formal', payload: { action: { side: '买入', price: 33.26, reason: '量价确认' } } };
  const result = studioSignals([formal, candidate, { ...candidate, marketTime: '1300', marketDate: '2026-09-07' }, { ...candidate, code: '600519' }], '601899', '20260908');
  assert.equal(result.length, 1);
  assert.equal(result[0].price, 33.26);
  assert.equal(result[0].time, '1013');
  assert.equal(result[0].label, '正式买');
  assert.equal(result[0].score, null);
});

test('does not invent scores or display watch-only messages', () => {
  const row = { code: '601899', marketDate: '20260908', marketTime: '1400', level: 'candidate', payload: { observation: { direction: '反T', price: 34, score: '80%' } } };
  assert.equal(studioSignals([row], '601899', '20260908')[0].score, null);
  assert.deepEqual(studioSignals([{ ...row, level: 'watch' }], '601899', '20260908'), []);
});
