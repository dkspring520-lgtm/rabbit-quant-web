import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreProfitExit } from '../lib/exit-confirmation-score.mjs';

test('trailing profit needs current net profit and an observed exit trigger', () => {
  const input = { holdingConfirmed: true, netProfit: 12, protectionArmed: true, reversalConfirmed: true };
  assert.equal(scoreProfitExit(input).score, 100);
  assert.equal(scoreProfitExit(input).qualified, true);
  assert.equal(scoreProfitExit({ ...input, reversalConfirmed: false }).qualified, false);
  assert.equal(scoreProfitExit({ ...input, netProfit: -1 }).qualified, false);
  assert.equal(scoreProfitExit({ ...input, netProfit: NaN }).qualified, false);
  assert.equal(scoreProfitExit({ ...input, holdingConfirmed: false }).qualified, false);
  assert.equal(scoreProfitExit({ ...input, protectionArmed: false }).qualified, false);
  assert.equal(scoreProfitExit({}).score, 0);
});

test('target and trailing exit evidence remain separately inspectable', () => {
  const target = scoreProfitExit({ holdingConfirmed: true, netProfit: 30, targetReached: true });
  assert.equal(target.score, 100);
  assert.equal(target.kind, 'exit-condition-coverage');
  const incomplete = scoreProfitExit({ netProfit: 30, reversalConfirmed: true });
  assert.equal(incomplete.score, 50);
  assert.equal(incomplete.qualified, false);
});
