import test from 'node:test';
import assert from 'node:assert/strict';
import { persistentChartLabel, selectCompactChartLabels } from '../lib/chart-label-policy.mjs';

test('compact labels keep candidates and V1/V2.9, not ordinary rebound text', () => {
  for (const strategy of ['closure', 'v1', 'v29']) {
    assert.equal(persistentChartLabel(strategy, '正T候选'), true);
    assert.equal(persistentChartLabel(strategy, '反T候选'), true);
  }
  assert.equal(persistentChartLabel('observation', '反弹观察'), false);
  assert.equal(persistentChartLabel('closure', '反弹观察'), false);
  assert.equal(persistentChartLabel('observation', '反弹观察', 'full'), true);
  assert.equal(persistentChartLabel('observation', '正T候选'), true);
});

test('hidden 99-point observation cannot consume the visible V1 candidate slot', () => {
  const rows = [
    {strategy:'observation', score:99, labelVisible:false},
    {strategy:'closure', score:85, labelVisible:true},
    {strategy:'v1', score:80, labelVisible:true},
    {strategy:'v29', score:75, labelVisible:true},
    {strategy:'v1', score:70, labelVisible:true},
  ].map((row, i) => ({...row, isSell:false, labelRendered:true, observation:{time:`101${i}`}}));
  const result = selectCompactChartLabels(rows, row => row.score);
  assert.deepEqual(result.map(row => row.labelRendered), [false,true,true,true,false]);
  assert.deepEqual(selectCompactChartLabels([], () => 0), []);
});
