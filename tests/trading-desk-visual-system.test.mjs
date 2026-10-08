import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/authenticated-app.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("trading desk uses shared layout tokens and restrained light/dark surfaces", () => {
  assert.match(styles, /--desk-space-1:4px/);
  assert.match(styles, /--desk-radius:10px/);
  assert.match(styles, /--desk-font:Inter/);
  assert.match(styles, /--desk-type-xs:8px/);
  assert.match(styles, /--desk-control-height:30px/);
  assert.ok(styles.includes(':root[data-theme="light"] .app-shell.minimal-ui.tv-console{'));
  assert.ok(styles.includes(':root:not([data-theme="light"]) .app-shell.minimal-ui.tv-console{'));
  assert.match(styles, /--desk-accent:#4f7864/);
  assert.match(styles, /--desk-accent:#91ad94/);
  assert.match(styles, /background-image:none/);
  assert.match(styles, /Remove the legacy blue active accents/);
});

test("T Observation stays primary while historical detail is collapsed but accessible", () => {
  assert.ok(source.includes('DashboardPanelShell id="t-observation"'));
  assert.ok(source.includes('resizeEnabled={false}'));
  assert.ok(styles.includes('order:-3!important'));
  assert.ok(styles.includes('decision-zone>.dashboard-panel-shell.t-observation-card{order:1!important}'));
  assert.ok(styles.includes('decision-zone>.decision-primary-card{order:2!important'));
  assert.ok(styles.includes('decision-zone>.order-flow-top-card{order:3!important'));
  assert.ok(styles.includes('.ai-watch-bunny{display:none!important}'));
  assert.ok(source.includes('main-force-track') && source.includes('is-empty'));
  assert.ok(styles.includes('order:1!important;border-left:2px solid var(--desk-accent)'));
  assert.ok(styles.includes('.t-observation-card.waiting{opacity:1}'));
  assert.ok(source.includes('<details className="t-observation-research"'));
  assert.ok(source.includes('<details className="t-observation-timeline"'));
  assert.ok(source.includes('jumpToGuidanceTimestamp(item.timestamp)'));
});

test("responsive desk keeps a stacked workspace and visible keyboard focus affordances", () => {
  assert.ok(styles.includes('@media(max-width:980px){'));
  assert.ok(styles.includes('display:block;'));
  assert.ok(styles.includes('.t-observation-facts{grid-template-columns:repeat(2,minmax(0,1fr))}'));
  assert.ok(styles.includes('.decision-zone :is(button,a,summary):focus-visible'));
  assert.match(styles, /prefers-reduced-motion:reduce/);
  assert.ok(styles.includes('.dashboard-panel-shell.is-collapsed'));
  assert.ok(styles.includes('.dashboard-panel-shell.is-locked'));
});

test("final micro-polish keeps the default chart and mobile rail quiet", () => {
  assert.ok(source.includes('chartAnnotationMode!=="compact"&&<div className="rabbit-chart-caption"'));
  assert.ok(source.includes('className="mobile-position-toggle"'));
  assert.ok(source.includes('className="decision-position-content"'));
  assert.ok(styles.includes('.chart-tools.collapsed .chart-control-groups{'));
  assert.ok(styles.includes('.chart-tools.collapsed .chart-control-group:not(:first-child){display:none}'));
  assert.ok(styles.includes('.chart-tools.collapsed .strategy-signal-legend'));
  assert.ok(styles.includes('.decision-position-card.mobile-collapsed .decision-position-content{display:none}'));
  assert.ok(styles.includes('.t-observation-facts small,'));
});
