import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStaticCacheSource } from '../scripts/vinext-windows-compat.mjs';

test('Windows compatibility patch normalizes keys at the walk and is idempotent', () => {
  const patched = normalizeStaticCacheSource('relativePath: path.relative(base, batch[j]),');
  assert.match(patched, /split\(path.sep\).join/);
  assert.equal(normalizeStaticCacheSource(patched), patched);
});

test('Windows compatibility patch fails closed for unknown source', () => {
  assert.throws(() => normalizeStaticCacheSource('changed upstream implementation'), /Unsupported/);
});
