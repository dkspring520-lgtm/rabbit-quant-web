import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compactGuidanceMarkers } from '../lib/guidance-marker-display.mjs';

test('dense same-kind dots show the latest anchor and aggregate the display count', () => {
  const rows = Array.from({length: 10}, (_, i) => ({key: String(i), kind: 'positive-t-watch', x: 100 + i, y: 50, timestamp: i}));
  const before = structuredClone(rows);
  const output = compactGuidanceMarkers(rows);
  assert.equal(output.length, 1);
  assert.equal(output[0].key, '9');
  assert.equal(output[0].displayCount, 10);
  assert.deepEqual(rows, before);
});

test('opposite direction, distinct height and separated screen points remain visible', () => {
  const rows = [
    {kind:'positive-t-watch', x:100, y:50},
    {kind:'counter-t-watch', x:100, y:50},
    {kind:'positive-t-watch', x:100, y:90},
    {kind:'positive-t-watch', x:150, y:50},
  ];
  assert.equal(compactGuidanceMarkers(rows).length, 4);
  assert.deepEqual(compactGuidanceMarkers([]), []);
});

test('zoom reveals points without any time-based cooldown', () => {
  const rows = [0,1,2].map(i => ({kind:'counter-t-watch', x:100+i*5, y:50}));
  assert.equal(compactGuidanceMarkers(rows).length, 1);
  assert.equal(compactGuidanceMarkers(rows.map(row => ({...row,x:row.x*5}))).length, 3);
});

test('main desk observation glyphs use tooltip and keyboard focus instead of permanent text', () => {
  const source = readFileSync(new URL('../app/authenticated-app.tsx', import.meta.url),'utf8');
  const block = source.slice(source.indexOf('{tGuidanceMarkerLayout.map'), source.indexOf('{false&&isZijinStock&&orderFlowChartPoint'));
  assert.ok(block.includes('onFocus='));
  assert.ok(block.includes('displayCount'));
  assert.ok(block.includes('<title>'));
  assert.ok(!block.includes('t-guidance-marker-label'));
  assert.ok(!block.includes('t-guidance-marker-leader'));
});

test('formal labels are Chinese and compact shadow captions remain in details', () => {
  const source = readFileSync(new URL('../app/authenticated-app.tsx', import.meta.url),'utf8');
  const badge = source.slice(source.indexOf('const SignalBadgeText='),source.indexOf('const v29ShadowActionLabel='));
  assert.ok(badge.includes('formalSide==="buy"?"买":"卖"'));
  assert.ok(!badge.includes('"SELL"'));
  const shadow = source.slice(source.indexOf('{intradayMarkerLayout.shadowActions.map'),source.indexOf('{intradayMarkerLayout.actions.map'));
  assert.ok(shadow.includes('chartAnnotationMode==="full"'));
  assert.ok(shadow.includes('影子参考，不可执行'));
});
