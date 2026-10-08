import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app/authenticated-app.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("production Trading Desk uses one unified right rail with guidance first", () => {
  assert.match(app, /decision-zone unified-right-rail/);
  assert.match(app, /统一观察台/);
  assert.match(app, /DashboardPanelShell id="t-observation" title="当前指导"/);
  assert.match(app, /className="unified-rail-section decision-summary-section"/);
  assert.match(app, /className="unified-rail-section unified-market-context"/);
  assert.match(app, /className="unified-rail-section unified-position-section"/);
  assert.match(css, /decision-zone\.unified-right-rail>\.dashboard-panel-shell\.t-observation-card\{order:1!important/);
  assert.match(css, /decision-zone\.unified-right-rail>\.decision-summary-section\{order:2!important/);
  assert.match(css, /decision-zone\.unified-right-rail>\.unified-market-context\{order:3!important/);
});

test("market-closed reverse-T copy separates chart history from live signal", () => {
  assert.match(app, /收盘复盘 · 无当前反T/);
  assert.match(app, /图表黄色标记是当日历史观察点，不是当前实时信号。/);
  assert.match(app, /收盘复盘 · 实时融合暂停/);
});
