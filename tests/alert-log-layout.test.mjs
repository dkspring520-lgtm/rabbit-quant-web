import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("alert audit opens as a bounded bottom sheet instead of covering the desk", async () => {
  const desktop = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const mobile = await readFile(new URL("../app/mobile.css", import.meta.url), "utf8");

  assert.match(desktop, /\.alert-log-dialog\{[^}]*height:min\(58dvh,620px\)/);
  assert.match(desktop, /\.alert-log-list\{[^}]*flex:1 1 0;min-height:120px[^}]*overflow:auto/);
  assert.match(mobile, /\.alert-log-dialog\{[^}]*height:min\(76dvh,680px\)/);
  assert.match(mobile, /\.alert-log-row\.head\{display:none\}/);
  assert.match(mobile, /grid-template-areas:"stock result" "time time" "reason reason" "delivery provider"/);
});
