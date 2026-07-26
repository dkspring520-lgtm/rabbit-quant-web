import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("L2 console status never renders a provider endpoint or raw connection error", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /const l2ConsoleNode="上海节点"/);
  assert.doesNotMatch(source, /detail:`\$\{liveL2Status\.node/);
  assert.doesNotMatch(source, /detail:liveL2Status\.error/);
  assert.match(source, /detail:`\$\{l2ConsoleNode\} · \$\{marketSession\.label\}，开市后恢复实时校验`/);
});
