import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("loading fallback exposes a recovery path instead of waiting forever", () => {
  const source = fs.readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /12_000/);
  assert.match(source, /加载超时/);
  assert.match(source, /location\.reload/);
});
