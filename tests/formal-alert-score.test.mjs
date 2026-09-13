import test from 'node:test';
import assert from 'node:assert/strict';
import { hasFormalAlertScore, isRiskExitAction } from '../lib/alert-delivery-policy.mjs';

test('only explicit risk exit flags classify as risk without a score', () => {
  for (const flag of ['stop', 'timeExit', 'forceExit']) {
    assert.equal(isRiskExitAction({ meta: { phase: 'exit', [flag]: true } }), true);
    for (const value of [false, 'true', 1, null]) assert.equal(isRiskExitAction({ meta: { phase: 'exit', [flag]: value } }), false);
    assert.equal(isRiskExitAction({ meta: { phase: 'entry', [flag]: true } }), false);
  }
  for (const action of [null, {}, { meta: { phase: 'exit', trailingProfit: true } }, { meta: { phase: 'exit', takeProfit: true } }]) assert.equal(isRiskExitAction(action), false);
});

test('delivery rejects missing, malformed and out-of-range formal scores', () => {
  for (const score of [undefined, null, '', '76', false, [], [76], 59, 59.99, 101, NaN, Infinity]) {
    assert.equal(hasFormalAlertScore({ confirmationScore: score }), false);
  }
  assert.equal(hasFormalAlertScore(null), false);
  for (const score of [60, 76, 100]) {
    assert.equal(hasFormalAlertScore({ confirmationScore: score }), true);
    assert.equal(hasFormalAlertScore({ meta: { confirmationScore: score } }), true);
  }
  assert.equal(hasFormalAlertScore({ confirmationScore: 59, meta: { confirmationScore: 90 } }), false);
});
