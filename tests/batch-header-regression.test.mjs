import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("random batch replaces unavailable feeds and exposes progress", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /sampleWithSeed\(batchValidationUniverse,10,seed\)/);
  assert.match(source, /const replacementCodes=sampleWithSeed\(/);
  assert.match(source, /while\(available\.length<10 && cursor<queue\.length\)/);
  assert.match(source, /setBatchFetchProgress\(\{ready:available\.length,attempted\}\)/);
  assert.match(source, /batchFetchProgress\.ready\}\/10/);
  assert.match(source, /replacementStocks=Math\.max\(0,attempted-sampledCodes\.length\)/);
});

test("desktop header keeps navigation and account actions in separate grid tracks", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const homeStyles = await readFile(new URL("../app/home.css", import.meta.url), "utf8");
  assert.match(styles, /\.topbar\{[^}]*display:grid;grid-template-columns:auto minmax\(0,1fr\) auto/);
  assert.match(styles, /@media\(max-width:1900px\) and \(min-width:1101px\)/);
  assert.match(styles, /@media\(max-width:1600px\) and \(min-width:1101px\)/);
  assert.match(homeStyles, /\.account-button b\{[^}]*text-overflow:ellipsis/);
});
