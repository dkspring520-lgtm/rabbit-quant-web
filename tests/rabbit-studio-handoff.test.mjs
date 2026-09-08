import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/authenticated-app.tsx", import.meta.url), "utf8");

test("studio handoff only selects an existing synchronized monitor", () => {
  assert.match(page, /const readProfessionalHandoffStockCode = \(\) => \{/);
  assert.match(page, /if\(params\.get\("view"\)\)return null;/);
  assert.match(page, /return \/\^\\d\{6\}\$\/.test\(code\)\?code:null;/);
  assert.match(page, /if\(!demoMode&&!remoteSyncReady\.current\)return;/);
  assert.match(page, /const index=stockList\.findIndex\(item=>item\.code===handoffCode\);/);
  assert.match(page, /if\(index<0\)\{professionalHandoffHandled\.current=handoffKey;return;\}/);
  assert.match(page, /selectActiveStock\(index\);\s*setActiveView\("操盘台"\);/);

  const handoffStart = page.indexOf("const handoffCode=readProfessionalHandoffStockCode();");
  const handoffEnd = page.indexOf("  useEffect(()=>{", handoffStart + 1);
  const handoff = page.slice(handoffStart, handoffEnd);
  assert.doesNotMatch(handoff, /setStockList\(/);
  assert.doesNotMatch(handoff, /fetch\(/);
});
