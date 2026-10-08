import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/authenticated-app.tsx", import.meta.url), "utf8");
const redesign = await readFile(new URL("../app/zijin-lab-redesign.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/zijin-lab-redesign.css", import.meta.url), "utf8");

test("from-scratch redesign is an isolated comparison route", () => {
  assert.ok(source.includes('get("view")==="zijin-lab-redesign"'));
  assert.ok(source.includes('setActiveView("操盘台")'));
  assert.match(source, /<ZijinLabRedesign/);
  assert.match(source, /activeView === "操盘台"/);
  assert.match(redesign, /DashboardPanelShell/);
  assert.match(redesign, /DashboardPanelManager/);
  assert.match(redesign, /DashboardOptionalPanelArea/);
  assert.ok(styles.includes(".redesign-body"));
  assert.ok(styles.includes(".redesign-chart-field"));
  assert.ok(styles.includes(".redesign-observation-panel"));
  assert.ok(styles.includes("@media (max-width: 760px)"));
  assert.ok(redesign.includes("redesign-current-marker"));
  assert.ok(redesign.includes("redesign-crosshair"));
  assert.ok(styles.includes('font-feature-settings: "tnum" 1'));
  assert.ok(styles.includes(".redesign-control-segment"));
  assert.ok(styles.includes(".redesign-volume-divider"));
});
