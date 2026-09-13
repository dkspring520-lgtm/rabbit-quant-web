import test from 'node:test';
import assert from 'node:assert/strict';
import { hasFormalAlertScore } from '../lib/alert-delivery-policy.mjs';

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
