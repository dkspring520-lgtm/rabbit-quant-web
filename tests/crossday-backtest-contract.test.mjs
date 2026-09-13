import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('cross-day backtest exposes explicit execution contract', () => {
  const source = fs.readFileSync(new URL('../scripts/backtest-zijin-crossday-t1.mjs', import.meta.url), 'utf8');
  assert.match(source, /signalToNextMinute:true/);
  assert.match(source, /fill\.suspended/);
  assert.match(source, /q > sellable/);
  assert.match(source, /startDate > endDate/);
});
