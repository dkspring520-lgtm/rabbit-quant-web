import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("random batch replaces unavailable feeds and exposes progress", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /fetch\("\/api\/stock-universe"/);
  assert.match(source, /diversifyStockUniverse\(universeResponse\.stocks,`\$\{seed\}:market`,recentCodes\)/);
  assert.match(source, /const sampledItems=queue\.slice\(0,10\)/);
  assert.match(source, /representative-fallback/);
  assert.match(source, /while\(available\.length<10 && cursor<queue\.length\)/);
  assert.match(source, /setBatchFetchProgress\(\{ready:available\.length,attempted\}\)/);
  assert.match(source, /batchFetchProgress\.ready\}\/10/);
  assert.match(source, /replacementStocks=Math\.max\(0,attempted-sampledCodes\.length\)/);
  assert.match(source, /smart-t-recent-random-batch-codes/);
  assert.match(source, /overlapWithPrevious/);
});

test("stock universe route loads the full A-share list and declares its fallback", async () => {
  const source = await readFile(new URL("../app/api/stock-universe/route.ts", import.meta.url), "utf8");
  assert.match(source, /"https:\/\/push2\.eastmoney\.com"/);
  assert.match(source, /`\$\{upstream\}\/api\/qt\/clist\/get\?\$\{query\}`/);
  assert.match(source, /push2delay\.eastmoney\.com/);
  assert.match(source, /for \(const upstream of upstreams\)/);
  assert.match(source, /pz: "6000"/);
  assert.match(source, /unique\.length < 3_000/);
  assert.match(source, /provider: "representative-fallback"/);
  assert.match(source, /X-Stock-Universe-Fallback/);
  assert.match(source, /"Cache-Control": "no-store"/);
});

test("desktop header keeps navigation and account actions in separate grid tracks", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const homeStyles = await readFile(new URL("../app/home.css", import.meta.url), "utf8");
  assert.match(styles, /\.topbar\{[^}]*display:grid;grid-template-columns:auto minmax\(0,1fr\) auto/);
  assert.match(styles, /@media\(max-width:1900px\) and \(min-width:1101px\)/);
  assert.match(styles, /@media\(max-width:1600px\) and \(min-width:1101px\)/);
  assert.match(homeStyles, /\.account-button b\{[^}]*text-overflow:ellipsis/);
});
