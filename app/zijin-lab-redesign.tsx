"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DashboardOptionalPanelArea, DashboardPanelManager, DashboardPanelShell, type DashboardLayout, type DashboardPanelState } from "./dashboard-panel-shell";
import "./zijin-lab-redesign.css";

type MinutePoint = { time: string; price: number; volume?: number | null; open?: number | null; high?: number | null; low?: number | null; averagePrice?: number | null };
type TimelineItem = { key: string; time: string; timestamp?: string | number | null; eventType: string; reason: string };
type Quote = { price?: number | null; changePercent?: number | null; previousClose?: number | null } | null;

export type ZijinLabRedesignProps = {
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onBack: () => void;
  onOpenLayout: () => void;
  layout: DashboardLayout;
  onLayoutChange: (next: DashboardLayout) => void;
  layoutOpen: boolean;
  onLayoutClose: () => void;
  stock: { code: string; name: string };
  quote: Quote;
  minutePoints: MinutePoint[];
  chartType: "line" | "candle";
  onChartTypeChange: (value: "line" | "candle") => void;
  onTimelineClick?: (item: TimelineItem) => void;
  observation: {
    available: boolean;
    action: string;
    actionText: string;
    state: string;
    message: string;
    reasons: string[];
    nextStep: string;
    context: string;
    confirmation: string;
    research: string;
    timeline: TimelineItem[];
  };
};

function compactTime(value: string) {
  const digits = String(value).replace(/\\D/g, "").slice(-4).padStart(4, "0");
  return digits.slice(0, 2) + ":" + digits.slice(2);
}

function formatPrice(value: number | null | undefined) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "--";
}

function formatChange(value: number | null | undefined) {
  return Number.isFinite(Number(value)) ? (Number(value) >= 0 ? "+" : "") + Number(value).toFixed(2) + "%" : "待更新";
}

function changeClass(value: number | null | undefined) {
  if (!Number.isFinite(Number(value)) || Number(value) === 0) return "flat";
  return Number(value) > 0 ? "up" : "down";
}

function stateClass(value: string) {
  return String(value || "neutral").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

function RedesignChart({ points, chartType, currentPrice, previousClose }: { points: MinutePoint[]; chartType: "line" | "candle"; currentPrice?: number | null; previousClose?: number | null }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const chart = useMemo(() => {
    const valid = points.filter(point => Number.isFinite(point.price) && point.price > 0);
    if (valid.length < 2) return null;
    const width = 980;
    const height = 470;
    const left = 42;
    const right = 20;
    const top = 28;
    const priceBottom = 350;
    const volumeTop = 382;
    const volumeBottom = 442;
    const displayPrice = Number.isFinite(Number(currentPrice)) && Number(currentPrice) > 0 ? Number(currentPrice) : valid.at(-1)!.price;
    const prices = [...valid.map(point => point.price), displayPrice];
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const padding = Math.max((max - min) * 0.12, Math.max(max, 1) * 0.0015);
    const low = min - padding;
    const high = max + padding;
    const x = (index: number) => left + (index / Math.max(1, valid.length - 1)) * (width - left - right);
    const y = (price: number) => top + ((high - price) / Math.max(0.0001, high - low)) * (priceBottom - top);
    const maxVolume = Math.max(1, ...valid.map(point => Number(point.volume) || 0));
    const averageValues = valid.map(point => Number.isFinite(Number(point.averagePrice)) && Number(point.averagePrice) > 0 ? Number(point.averagePrice) : null);
    const averageKnown = averageValues.filter((value): value is number => value !== null).length;
    const averagePath = averageKnown >= 2 ? averageValues.map((value, index) => value === null ? "" : (index ? "L" : "M") + x(index).toFixed(2) + "," + y(value).toFixed(2)).filter(Boolean).join(" ") : "";
    const previousCloseValue = Number.isFinite(Number(previousClose)) && Number(previousClose) > 0 ? Number(previousClose) : null;
    const path = valid.map((point, index) => (index ? "L" : "M") + x(index).toFixed(2) + "," + y(point.price).toFixed(2)).join(" ");
    const areaPath = path + " L" + x(valid.length - 1).toFixed(2) + "," + priceBottom + " L" + x(0).toFixed(2) + "," + priceBottom + " Z";
    const candleCount = valid.filter(point => Number.isFinite(Number(point.open)) && Number.isFinite(Number(point.high)) && Number.isFinite(Number(point.low))).length;
    return { width, height, valid, x, y, path, areaPath, min: low, max: high, volumeTop, volumeBottom, candleReady: candleCount >= Math.max(2, Math.ceil(valid.length * .8)), displayPrice, displayY: y(displayPrice), lastX: x(valid.length - 1), averagePath, previousClose: previousCloseValue, previousCloseY: previousCloseValue === null ? null : y(previousCloseValue), volumes: valid.map((point, index) => ({ x: x(index), height: Math.max(3, ((Number(point.volume) || 0) / maxVolume) * (volumeBottom - volumeTop)), up: index === 0 || point.price >= valid[index - 1].price })) };
  }, [currentPrice, points, previousClose]);

  if (!chart) return <div className="redesign-chart-empty"><span>等待已出现的分钟数据</span><b>暂无足够结构信息</b><small>不补填、不使用未来行情。</small></div>;

  const hoveredPoint = hoveredIndex === null ? null : chart.valid[hoveredIndex];
  const hoveredX = hoveredIndex === null ? null : chart.x(hoveredIndex);
  return <svg className={"redesign-chart " + chartType} viewBox={"0 0 " + chart.width + " " + chart.height} role="img" aria-label="紫金矿业当前交易日价格与成交量观察图" onMouseLeave={() => setHoveredIndex(null)}>
    <defs><linearGradient id="redesign-price-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#527c69" stopOpacity=".16" /><stop offset="1" stopColor="#527c69" stopOpacity="0" /></linearGradient></defs>
    {[0, 1, 2, 3].map(index => <line key={"h-" + index} className="redesign-grid-line" x1="42" x2="960" y1={58 + index * 96} y2={58 + index * 96} />)}
    <line className="redesign-baseline" x1="42" x2="960" y1="350" y2="350" />
    <line className="redesign-volume-divider" x1="42" x2="960" y1={chart.volumeTop - 8} y2={chart.volumeTop - 8} />
    {chart.volumes.map((bar, index) => <rect key={"v-" + index} className={"redesign-volume " + (bar.up ? "up" : "down")} x={bar.x - 2.5} y={chart.volumeBottom - bar.height} width="5" height={bar.height} />)}
    <path className="redesign-price-area" d={chart.areaPath} />
    {chart.previousCloseY !== null && <><line className="redesign-previous-close" x1="42" x2="960" y1={chart.previousCloseY} y2={chart.previousCloseY} /><text className="redesign-reference-label" x="954" y={chart.previousCloseY - 5} textAnchor="end">昨收 {formatPrice(chart.previousClose)}</text></>}
    {chart.averagePath && <path className="redesign-average-path" d={chart.averagePath} />}
    {chartType === "line" || !chart.candleReady ? <path className="redesign-price-path" d={chart.path} /> : chart.valid.map((point, index) => {
      const open = Number(point.open);
      const close = Number(point.price);
      const high = Number(point.high);
      const low = Number(point.low);
      const bodyTop = Math.min(chart.y(open), chart.y(close));
      const bodyHeight = Math.max(2, Math.abs(chart.y(close) - chart.y(open)));
      return <g key={"c-" + index} className={close >= open ? "up" : "down"}><line className="redesign-candle-wick" x1={chart.x(index)} x2={chart.x(index)} y1={chart.y(high)} y2={chart.y(low)} /><rect className="redesign-candle-body" x={chart.x(index) - 2.8} y={bodyTop} width="5.6" height={bodyHeight} /></g>;
    })}
    <text className="redesign-axis-label" x="42" y="18">PRICE / OBSERVED MINUTES</text>
    <text className="redesign-axis-label" x="42" y="468">VOLUME</text>
    <text className="redesign-axis-label right" x="960" y="18">{compactTime(chart.valid.at(-1)?.time ?? "")}</text>
    <g className="redesign-current-marker">
      <line x1="42" x2="944" y1={chart.displayY} y2={chart.displayY} />
      <circle cx={chart.lastX} cy={chart.displayY} r="4" />
      <rect x="946" y={Math.max(30, Math.min(326, chart.displayY - 12))} width="54" height="24" rx="2" />
      <text x="973" y={Math.max(30, Math.min(326, chart.displayY - 12)) + 15} textAnchor="middle">{formatPrice(chart.displayPrice)}</text>
    </g>
    {chart.valid.map((point, index) => <rect key={"hover-" + point.time + "-" + index} className="redesign-hover-target" x={chart.x(index) - Math.max(8, (chart.width - 62) / Math.max(1, chart.valid.length - 1) / 2)} y="25" width={Math.max(16, (chart.width - 62) / Math.max(1, chart.valid.length - 1))} height="330" onMouseEnter={() => setHoveredIndex(index)} />)}
    {hoveredPoint && hoveredX !== null && <g className="redesign-crosshair"><line x1={hoveredX} x2={hoveredX} y1="26" y2="350" /><rect x={Math.max(48, Math.min(820, hoveredX - 72))} y="34" width="144" height="44" rx="2" /><text x={Math.max(48, Math.min(820, hoveredX - 72)) + 10} y="51">{compactTime(hoveredPoint.time)} · {formatPrice(hoveredPoint.price)}</text><text x={Math.max(48, Math.min(820, hoveredX - 72)) + 10} y="67">均价 {formatPrice(hoveredPoint.averagePrice)}</text></g>}
  </svg>;
}

function ObservationBody({ observation }: { observation: ZijinLabRedesignProps["observation"] }) {
  return <div className="redesign-observation-body">
    <div className="redesign-observation-state"><span className="redesign-eyebrow">当前状态</span><div className="redesign-current-line"><i className={"redesign-status-dot " + stateClass(observation.state)} aria-hidden="true" /><strong>{observation.available ? observation.actionText || observation.action : "暂无足够结构信息"}</strong></div><p>{observation.available ? observation.message : "等待真实行情与 CORE_SAFE 依赖，不使用假数据。"}</p><b className={"redesign-state-mark " + stateClass(observation.state)}>{observation.available ? observation.state : "等待"}</b></div>
    <div className="redesign-observation-rule" />
    <section className="redesign-observation-section"><span className="redesign-eyebrow">原因</span><ul>{(observation.available && observation.reasons.length ? observation.reasons : ["暂无可解释的结构依据"]).slice(0, 3).map(reason => <li key={reason}>{reason}</li>)}</ul></section>
    <section className="redesign-next-step"><span className="redesign-eyebrow">下一步</span><strong>{observation.available ? observation.nextStep : "继续观察"}</strong></section>
    <dl className="redesign-observation-meta"><div><dt>市场上下文</dt><dd>{observation.context || "暂无上下文"}</dd></div><div><dt>确认状态</dt><dd>{observation.confirmation || "等待确认"}</dd></div></dl>
    <details className="redesign-research-note"><summary><span>历史研究</span><small>不参与当前评分</small></summary><p>{observation.research || "当前没有可展示的历史研究背景。"}</p></details>
    <div className="redesign-observation-foot">辅助观察，不是买卖指令</div>
  </div>;
}

export default function ZijinLabRedesign({ theme, onToggleTheme, onBack, onOpenLayout, layout, onLayoutChange, layoutOpen, onLayoutClose, stock, quote, minutePoints, chartType, onChartTypeChange, onTimelineClick, observation }: ZijinLabRedesignProps) {
  const latestTime = minutePoints.at(-1)?.time ?? "--";
  const panelState = layout.panels["t-observation"];
  const optionalCopy: Record<string, ReactNode> = { indicators: <span>指标沿用主图，不建立第二套计算。</span>, "volume-structure": <span>成交结构在主图与现有数据层中保持一致。</span>, "position-t1": <span>持仓与 T+1 继续使用现有校验。</span>, "guidance-timeline": <span>指导时间线保留在观察层。</span>, research: <span>研究只作背景，不参与实时评分。</span>, tools: <span>工具按需开放，不连接执行接口。</span> };
  return <main className={"redesign-shell " + (theme === "dark" ? "theme-dark" : "")}>
    <header className="redesign-topbar"><div className="redesign-brand"><span className="redesign-brand-mark">双兔</span><div><strong>做T神器</strong><small>日内观察工作台</small></div></div><div className="redesign-route-title"><span>重构预览</span><b>人类指导 · 601899</b></div><div className="redesign-top-actions"><span className="redesign-session-mark"><i aria-hidden="true" />{compactTime(latestTime)} · 观察中</span><div className="redesign-control-segment"><button type="button" onClick={onOpenLayout}>布局管理</button><button type="button" onClick={onToggleTheme}>{theme === "dark" ? "浅色" : "深色"}</button><button type="button" className="redesign-back" onClick={onBack}>返回操盘台</button></div></div></header>
    <div className="redesign-body">
      <aside className="redesign-index" aria-label="观察台索引"><div className="redesign-index-top"><span className="redesign-eyebrow">观察台</span><strong>现场</strong></div><div className="redesign-index-stock"><span>{stock.code}</span><b>{stock.name}</b><small>仅观察 · 不下单</small></div><nav><a className="active" href="#market-field">市场现场</a><a href="#observation">人类观察</a><a href="#evidence">证据带</a></nav><div className="redesign-index-note"><span>当前模式</span><b>结构确认前</b><small>主图保持中心，细节按需展开。</small></div></aside>
      <section className="redesign-workspace" id="market-field"><div className="redesign-workspace-head"><div><span className="redesign-eyebrow">日内市场现场</span><h1>{stock.name}<small>{stock.code}</small></h1></div><div className="redesign-quote"><strong>{formatPrice(quote?.price)}</strong><span className={"redesign-quote-change " + changeClass(quote?.changePercent)}>{formatChange(quote?.changePercent)}</span></div></div><div className="redesign-chart-tools" role="toolbar" aria-label="图表工具"><div className="redesign-tool-copy"><span>已出现分钟</span><b>{minutePoints.length || 0}</b><small>· 数据时间 {compactTime(latestTime)}</small></div><div className="redesign-chart-modes"><button className={chartType === "line" ? "active" : ""} type="button" onClick={() => onChartTypeChange("line")}>分时</button><button className={chartType === "candle" ? "active" : ""} type="button" onClick={() => onChartTypeChange("candle")}>1mK</button></div></div><div className="redesign-chart-field"><RedesignChart points={minutePoints} chartType={chartType} currentPrice={quote?.price} previousClose={quote?.previousClose} /></div><div className="redesign-chart-caption"><span>主图</span><b>价格 · 均价 · 成交量 · 当前观察</b><small>未来分钟不进入图表</small></div><section className="redesign-evidence-band" id="evidence"><div><span className="redesign-eyebrow">阅读顺序</span><b>先看结构，再等确认</b><small>正式信号、研究层与人类观察保持分离。</small></div><div><span className="redesign-eyebrow">市场上下文</span><b>{observation.context || "暂无上下文"}</b><small>背景信息，不是动作信号。</small></div><div><span className="redesign-eyebrow">数据状态</span><b>{minutePoints.length ? "分钟数据已接入" : "等待分钟数据"}</b><small>{quote?.previousClose ? "昨收 " + formatPrice(quote.previousClose) : "暂无昨收基准"}</small></div></section></section>
      <aside className="redesign-observation-column" id="observation"><div className="redesign-column-head"><span className="redesign-eyebrow">人类指导</span><b>观察摘要</b><small>只回答现在发生什么、为什么、等什么。</small></div>{panelState?.visible === false ? <div className="redesign-hidden-panel"><b>T Observation 已隐藏</b><button type="button" onClick={onOpenLayout}>在布局中显示</button></div> : <DashboardPanelShell id="t-observation" title="T Observation" description="人类观察层 · 不生成交易动作" state={panelState ?? { visible: true, collapsed: false, locked: false, width: null, height: null } as DashboardPanelState} layout={layout} onChange={onLayoutChange} resizeEnabled={false} className="redesign-observation-panel"><ObservationBody observation={observation} /></DashboardPanelShell>}<div className="redesign-timeline-block"><span className="redesign-eyebrow">指导时间线</span>{observation.timeline.length ? <ol>{observation.timeline.slice(0, 4).map(item => <li key={item.key}><button type="button" onClick={() => onTimelineClick?.(item)} title={item.reason}><time>{item.time}</time><span>{item.eventType}</span></button></li>)}</ol> : <p>暂无指导历史。</p>}</div></aside>
    </div>
    <DashboardOptionalPanelArea layout={layout} onChange={onLayoutChange} renderPanel={panelId => <div className="redesign-optional-copy">{optionalCopy[panelId] || <span>模块已注册，等待明确的数据接入需求。</span>}</div>} />
    {layoutOpen && <DashboardPanelManager layout={layout} onChange={onLayoutChange} onClose={onLayoutClose} />}
  </main>;
}
