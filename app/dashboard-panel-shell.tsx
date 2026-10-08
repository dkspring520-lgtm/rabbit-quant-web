"use client";

import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  DASHBOARD_LAYOUT_STORAGE_KEY,
  PANEL_REGISTRY,
  applyDashboardPreset,
  movePanel,
  movePanelBefore,
  normalizeDashboardLayout,
  resetDashboardLayout,
  resetPanelPosition,
  readDashboardLayout,
  resizePanel,
  setPanelCollapsed,
  setPanelLocked,
  setPanelVisible,
  writeDashboardLayout,
} from "@/lib/dashboard-panel-layout.mjs";

export type DashboardPanelDefinition = {
  id: string;
  title: string;
  area: "fixed" | "decision" | "optional";
  defaultVisible: boolean;
  defaultLocked: boolean;
  description: string;
  width?: number;
  height?: number;
};

export type DashboardPanelState = {
  visible: boolean;
  collapsed: boolean;
  locked: boolean;
  width: number | null;
  height: number | null;
};

export type DashboardLayout = {
  version: number;
  preset: string;
  order: string[];
  panels: Record<string, DashboardPanelState>;
};

type PanelShellProps = {
  id: string;
  title: string;
  description?: string;
  state: DashboardPanelState;
  layout: DashboardLayout;
  onChange: (next: DashboardLayout) => void;
  children: ReactNode;
  className?: string;
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLElement>, id: string) => void;
  onDragOver?: (event: DragEvent<HTMLElement>) => void;
  onDrop?: (event: DragEvent<HTMLElement>, id: string) => void;
  resizeEnabled?: boolean;
};

export function DashboardPanelShell({ id, title, description, state, layout, onChange, children, className = "", draggable = false, onDragStart, onDragOver, onDrop, resizeEnabled = true }: PanelShellProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);
  const panelStyle: CSSProperties = {
    width: state.collapsed || !state.width ? undefined : state.width,
    minHeight: state.collapsed || !state.height ? undefined : state.height,
  };

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = resizeRef.current;
      if (!current) return;
      onChange(resizePanel(layout, id, current.width + event.clientX - current.startX, current.height + event.clientY - current.startY) as DashboardLayout);
    };
    const end = () => { resizeRef.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
  }, [id, layout, onChange]);

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (state.locked || !resizeEnabled) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    resizeRef.current = { startX: event.clientX, startY: event.clientY, width: rect.width, height: rect.height };
  };

  return <section ref={panelRef} className={["dashboard-panel-shell", state.collapsed ? "is-collapsed" : "", state.locked ? "is-locked" : "", className].filter(Boolean).join(" ")} style={panelStyle} aria-labelledby={"dashboard-panel-title-" + id} onDragStart={event => onDragStart?.(event, id)} onDragOver={event => onDragOver?.(event)} onDrop={event => onDrop?.(event, id)}>
    <header className="dashboard-panel-shell-head">
      <div className="dashboard-panel-shell-title">
        {draggable && <span className="dashboard-panel-drag-handle" aria-hidden="true" draggable={!state.locked} title={state.locked ? "已锁定" : "拖动排序"}>⠿</span>}
        <div><b id={"dashboard-panel-title-" + id}>{title}</b>{description && <small>{description}</small>}</div>
      </div>
      <div className="dashboard-panel-shell-actions">
        <button type="button" onClick={() => onChange(setPanelCollapsed(layout, id, !state.collapsed) as DashboardLayout)} aria-label={state.collapsed ? "展开" + title : "收起" + title}>{state.collapsed ? "展开" : "收起"}</button>
        <button type="button" onClick={() => onChange(setPanelLocked(layout, id, !state.locked) as DashboardLayout)} aria-pressed={state.locked} aria-label={state.locked ? "解锁" + title : "锁定" + title}>{state.locked ? "锁定" : "解锁"}</button>
        <button type="button" onClick={() => onChange(resetPanelPosition(layout, id) as DashboardLayout)} aria-label={"重置" + title + "位置"}>重置</button>
      </div>
    </header>
    {!state.collapsed && <div className="dashboard-panel-shell-body">{children}</div>}
    {!state.locked && resizeEnabled && <button className="dashboard-panel-resize-handle" type="button" onPointerDown={startResize} aria-label={"调整" + title + "大小"} />}
  </section>;
}

type PanelManagerProps = { layout: DashboardLayout; onChange: (next: DashboardLayout) => void; onClose: () => void };

export function DashboardPanelManager({ layout, onChange, onClose }: PanelManagerProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const registry = PANEL_REGISTRY as DashboardPanelDefinition[];
  const change = (next: unknown) => onChange(normalizeDashboardLayout(next) as DashboardLayout);
  return <div className="dashboard-layout-overlay" role="dialog" aria-modal="true" aria-label="布局管理器" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dashboard-layout-manager">
      <header><div><span>TRADING DESK LAYOUT</span><h2>工作台布局</h2><p>默认只显示主工作区与 T 观察；隐藏模块不占用布局空间。</p></div><button type="button" onClick={onClose} aria-label="关闭布局管理器">×</button></header>
      <div className="dashboard-layout-presets" role="group" aria-label="布局预设">{["操盘", "复盘", "研究"].map(preset => <button key={preset} type="button" className={layout.preset === preset ? "active" : ""} onClick={() => change(applyDashboardPreset(layout, preset))} aria-pressed={layout.preset === preset}>{preset}</button>)}<button type="button" onClick={() => change(resetDashboardLayout())}>恢复默认</button></div>
      <div className="dashboard-layout-list" aria-label="面板注册表">{registry.map(panel => { const state = layout.panels[panel.id]; if (!state) return null; const fixed = panel.area === "fixed"; return <div className={["dashboard-layout-row", state.visible ? "visible" : "hidden"].join(" ")} key={panel.id} draggable={!fixed && !state.locked} onDragStart={event => { setDragId(panel.id); event.dataTransfer.setData("text/plain", panel.id); }} onDragOver={event => { if (dragId && dragId !== panel.id) event.preventDefault(); }} onDrop={event => { event.preventDefault(); const source = dragId || event.dataTransfer.getData("text/plain"); if (source) change(movePanelBefore(layout, source, panel.id)); setDragId(null); }} onDragEnd={() => setDragId(null)}>
          <span className="dashboard-layout-row-handle" aria-hidden="true">{fixed ? "•" : "⠿"}</span><div className="dashboard-layout-row-copy"><b>{panel.title}</b><small>{panel.description}</small></div><span className="dashboard-layout-row-area">{fixed ? "固定" : panel.area === "decision" ? "决策栏" : "模块区"}</span>
          <button type="button" disabled={fixed} onClick={() => change(setPanelVisible(layout, panel.id, !state.visible))} aria-pressed={state.visible}>{state.visible ? "显示" : "隐藏"}</button>
          <button type="button" disabled={fixed} onClick={() => change(setPanelLocked(layout, panel.id, !state.locked))} aria-pressed={state.locked}>{state.locked ? "锁定" : "解锁"}</button>
          <button type="button" disabled={fixed} onClick={() => change(movePanel(layout, panel.id, -1))} aria-label={"上移" + panel.title}>↑</button><button type="button" disabled={fixed} onClick={() => change(movePanel(layout, panel.id, 1))} aria-label={"下移" + panel.title}>↓</button>
        </div>; })}</div>
      <footer><span>布局自动保存到本机浏览器</span><button type="button" onClick={onClose}>完成</button></footer>
    </section>
  </div>;
}

type PanelAreaProps = { layout: DashboardLayout; onChange: (next: DashboardLayout) => void; renderPanel: (id: string) => ReactNode };

export function DashboardOptionalPanelArea({ layout, onChange, renderPanel }: PanelAreaProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const registry = PANEL_REGISTRY as DashboardPanelDefinition[];
  const optional = layout.order.map(id => registry.find(panel => panel.id === id)).filter((panel): panel is DashboardPanelDefinition => Boolean(panel && panel.area === "optional" && layout.panels[panel.id]?.visible));
  if (!optional.length) return null;
  return <section className="dashboard-optional-area" aria-label="可选工作台模块">{optional.map(panel => <DashboardPanelShell key={panel.id} id={panel.id} title={panel.title} description={panel.description} state={layout.panels[panel.id]} layout={layout} onChange={onChange} className="dashboard-optional-panel" draggable onDragStart={(event, id) => { setDragId(id); event.dataTransfer.setData("text/plain", id); }} onDragOver={event => { if (dragId) event.preventDefault(); }} onDrop={(event, id) => { event.preventDefault(); const source = dragId || event.dataTransfer.getData("text/plain"); if (source) onChange(movePanelBefore(layout, source, id) as DashboardLayout); setDragId(null); }}>{renderPanel(panel.id)}</DashboardPanelShell>)}</section>;
}

export { DASHBOARD_LAYOUT_STORAGE_KEY, PANEL_REGISTRY, applyDashboardPreset, readDashboardLayout, resetDashboardLayout, writeDashboardLayout };
