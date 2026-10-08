export const DASHBOARD_LAYOUT_STORAGE_KEY = "rabbit-dashboard-layout-v1";

export const PANEL_REGISTRY = Object.freeze([
  Object.freeze({ id: "top-bar", title: "Top Bar", area: "fixed", defaultVisible: true, defaultLocked: true, description: "固定顶部导航与账户区。" }),
  Object.freeze({ id: "main-workspace", title: "Main Workspace", area: "fixed", defaultVisible: true, defaultLocked: true, description: "主图表与既有决策布局保持固定和优先。" }),
  Object.freeze({ id: "t-observation", title: "T Observation", area: "decision", defaultVisible: true, defaultLocked: false, description: "现有 T 辅助观察内容，不修改其计算逻辑。" }),
  Object.freeze({ id: "indicators", title: "Indicators", area: "optional", defaultVisible: false, defaultLocked: false, width: 360, height: 150, description: "指标模块槽位；当前不接入新数据。" }),
  Object.freeze({ id: "volume-structure", title: "Volume / 成交结构", area: "optional", defaultVisible: false, defaultLocked: false, width: 360, height: 150, description: "成交结构模块槽位；当前不接入新数据。" }),
  Object.freeze({ id: "position-t1", title: "Position / T+1", area: "optional", defaultVisible: false, defaultLocked: false, width: 360, height: 150, description: "持仓与 T+1 模块槽位；不会修改持仓或可卖数据。" }),
  Object.freeze({ id: "guidance-timeline", title: "Guidance Timeline", area: "optional", defaultVisible: false, defaultLocked: false, width: 420, height: 190, description: "指导时间线模块槽位；现有时间线仍保留在 T Observation。" }),
  Object.freeze({ id: "research", title: "Research", area: "optional", defaultVisible: false, defaultLocked: false, width: 420, height: 170, description: "研究模块槽位；研究背景不构成实时信号。" }),
  Object.freeze({ id: "tools", title: "Tools", area: "optional", defaultVisible: false, defaultLocked: false, width: 320, height: 150, description: "工具模块槽位；不连接执行接口。" }),
]);

const PRESET_VISIBILITY = Object.freeze({
  "操盘": ["t-observation"],
  "复盘": ["t-observation", "guidance-timeline", "position-t1"],
  "研究": ["t-observation", "indicators", "volume-structure", "guidance-timeline", "research", "tools"],
});

const byId = new Map(PANEL_REGISTRY.map(panel => [panel.id, panel]));

function defaultPanelState(panel) {
  return {
    visible: panel.defaultVisible,
    collapsed: false,
    locked: panel.defaultLocked,
    width: panel.width ?? null,
    height: panel.height ?? null,
  };
}

export function createDefaultDashboardLayout(preset = "操盘") {
  const selected = Object.hasOwn(PRESET_VISIBILITY, preset) ? preset : "操盘";
  const visible = new Set(["top-bar", "main-workspace", ...PRESET_VISIBILITY[selected]]);
  return {
    version: 1,
    preset: selected,
    order: PANEL_REGISTRY.filter(panel => panel.area === "optional").map(panel => panel.id),
    panels: Object.fromEntries(PANEL_REGISTRY.map(panel => [panel.id, { ...defaultPanelState(panel), visible: visible.has(panel.id) }])),
  };
}

export function normalizeDashboardLayout(value) {
  const defaults = createDefaultDashboardLayout();
  if (!value || typeof value !== "object") return defaults;
  const panels = { ...defaults.panels };
  for (const panel of PANEL_REGISTRY) {
    const saved = value.panels?.[panel.id];
    if (!saved || typeof saved !== "object") continue;
    panels[panel.id] = {
      visible: panel.area === "fixed" ? true : typeof saved.visible === "boolean" ? saved.visible : defaults.panels[panel.id].visible,
      collapsed: typeof saved.collapsed === "boolean" ? saved.collapsed : false,
      locked: panel.area === "fixed" ? true : typeof saved.locked === "boolean" ? saved.locked : defaults.panels[panel.id].locked,
      width: panel.area === "optional" ? clamp(saved.width, 280, 760, panel.width) : null,
      height: panel.area === "optional" ? clamp(saved.height, 120, 480, panel.height) : null,
    };
  }
  const optionalIds = PANEL_REGISTRY.filter(panel => panel.area === "optional").map(panel => panel.id);
  const savedOrder = Array.isArray(value.order) ? value.order.filter(id => optionalIds.includes(id)) : [];
  const order = [...new Set([...savedOrder, ...optionalIds])];
  const preset = Object.hasOwn(PRESET_VISIBILITY, value.preset) ? value.preset : "操盘";
  return { version: 1, preset, order, panels };
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function readDashboardLayout(storage) {
  if (!storage) return createDefaultDashboardLayout();
  try {
    const value = storage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY);
    return value ? normalizeDashboardLayout(JSON.parse(value)) : createDefaultDashboardLayout();
  } catch {
    return createDefaultDashboardLayout();
  }
}

export function writeDashboardLayout(storage, layout) {
  if (!storage) return false;
  try {
    storage.setItem(DASHBOARD_LAYOUT_STORAGE_KEY, JSON.stringify(normalizeDashboardLayout(layout)));
    return true;
  } catch {
    return false;
  }
}

export function setPanelVisible(layout, id, visible) {
  const current = normalizeDashboardLayout(layout);
  const panel = byId.get(id);
  if (!panel || panel.area === "fixed") return current;
  return { ...current, panels: { ...current.panels, [id]: { ...current.panels[id], visible: Boolean(visible) } } };
}

export function setPanelCollapsed(layout, id, collapsed) {
  const current = normalizeDashboardLayout(layout);
  if (!byId.has(id) || byId.get(id).area === "fixed") return current;
  return { ...current, panels: { ...current.panels, [id]: { ...current.panels[id], collapsed: Boolean(collapsed) } } };
}

export function setPanelLocked(layout, id, locked) {
  const current = normalizeDashboardLayout(layout);
  const panel = byId.get(id);
  if (!panel || panel.area === "fixed") return current;
  return { ...current, panels: { ...current.panels, [id]: { ...current.panels[id], locked: Boolean(locked) } } };
}

export function resizePanel(layout, id, width, height) {
  const current = normalizeDashboardLayout(layout);
  const panel = byId.get(id);
  if (!panel || panel.area !== "optional" || current.panels[id].locked) return current;
  return { ...current, panels: { ...current.panels, [id]: { ...current.panels[id], width: clamp(width, 280, 760, panel.width), height: clamp(height, 120, 480, panel.height) } } };
}

export function movePanelBefore(layout, id, targetId) {
  const current = normalizeDashboardLayout(layout);
  if (id === targetId || !current.order.includes(id) || !current.order.includes(targetId) || current.panels[id].locked) return current;
  const order = current.order.filter(item => item !== id);
  order.splice(order.indexOf(targetId), 0, id);
  return { ...current, order };
}

export function movePanel(layout, id, direction) {
  const current = normalizeDashboardLayout(layout);
  if (!current.order.includes(id) || current.panels[id].locked) return current;
  const index = current.order.indexOf(id);
  const targetIndex = Math.max(0, Math.min(current.order.length - 1, index + direction));
  if (targetIndex === index) return current;
  const order = [...current.order];
  order.splice(index, 1);
  order.splice(targetIndex, 0, id);
  return { ...current, order };
}

export function resetPanelPosition(layout, id) {
  const current = normalizeDashboardLayout(layout);
  const panel = byId.get(id);
  if (!panel || panel.area === "fixed") return current;
  const defaultOrder = PANEL_REGISTRY.filter(item => item.area === "optional").map(item => item.id);
  const order = [...current.order].sort((a, b) => defaultOrder.indexOf(a) - defaultOrder.indexOf(b));
  return { ...current, order, panels: { ...current.panels, [id]: { ...current.panels[id], width: panel.width ?? null, height: panel.height ?? null, collapsed: false } } };
}

export function applyDashboardPreset(_layout, preset) {
  if (!Object.hasOwn(PRESET_VISIBILITY, preset)) return normalizeDashboardLayout(_layout);
  return createDefaultDashboardLayout(preset);
}

export function resetDashboardLayout() {
  return createDefaultDashboardLayout("操盘");
}
