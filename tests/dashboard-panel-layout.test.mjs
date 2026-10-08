import test from "node:test";
import assert from "node:assert/strict";
import {
  PANEL_REGISTRY,
  applyDashboardPreset,
  createDefaultDashboardLayout,
  movePanel,
  normalizeDashboardLayout,
  readDashboardLayout,
  resetDashboardLayout,
  resizePanel,
  setPanelCollapsed,
  setPanelLocked,
  setPanelVisible,
  writeDashboardLayout,
} from "../lib/dashboard-panel-layout.mjs";

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("registry exposes fixed defaults and optional modules are hidden", () => {
  const layout = createDefaultDashboardLayout();
  assert.ok(PANEL_REGISTRY.some(panel => panel.id === "main-workspace"));
  assert.equal(layout.panels["top-bar"].visible, true);
  assert.equal(layout.panels["main-workspace"].visible, true);
  assert.equal(layout.panels["t-observation"].visible, true);
  assert.equal(PANEL_REGISTRY.find(panel => panel.id === "t-observation")?.area, "decision");
  assert.deepEqual(layout.order, PANEL_REGISTRY.filter(panel => panel.area === "optional").map(panel => panel.id));
  for (const panel of PANEL_REGISTRY.filter(panel => panel.area === "optional")) {
    assert.equal(layout.panels[panel.id].visible, false, panel.id + " is hidden by default");
  }
  assert.equal(layout.panels.indicators.visible, false);
  assert.equal(layout.panels.research.visible, false);
});

test("visibility, collapse, lock, resize and reorder are persistent layout operations", () => {
  let layout = createDefaultDashboardLayout();
  layout = setPanelVisible(layout, "research", true);
  layout = setPanelCollapsed(layout, "research", true);
  layout = setPanelLocked(layout, "research", false);
  layout = resizePanel(layout, "research", 600, 240);
  layout = movePanel(layout, "research", -1);
  assert.equal(layout.panels.research.visible, true);
  assert.equal(layout.panels.research.collapsed, true);
  assert.equal(layout.panels.research.width, 600);
  assert.equal(layout.panels.research.height, 240);
  assert.equal(layout.order.includes("research"), true);
});

test("fixed panels cannot be hidden, unlocked or resized", () => {
  const layout = createDefaultDashboardLayout();
  assert.equal(setPanelVisible(layout, "main-workspace", false).panels["main-workspace"].visible, true);
  assert.equal(setPanelLocked(layout, "top-bar", false).panels["top-bar"].locked, true);
  assert.deepEqual(resizePanel(layout, "main-workspace", 700, 300), layout);
});

test("presets and localStorage persistence are deterministic", () => {
  const store = storage();
  const research = applyDashboardPreset(createDefaultDashboardLayout(), "研究");
  assert.equal(research.preset, "研究");
  assert.equal(research.panels.research.visible, true);
  assert.equal(research.panels["main-workspace"].visible, true);
  assert.equal(writeDashboardLayout(store, research), true);
  assert.deepEqual(readDashboardLayout(store), research);
  assert.equal(resetDashboardLayout().preset, "操盘");
});

test("malformed saved layout falls back to safe defaults", () => {
  const store = { getItem: () => "{bad json" };
  assert.equal(readDashboardLayout(store).preset, "操盘");
  assert.equal(normalizeDashboardLayout(null).panels["t-observation"].visible, true);
});
