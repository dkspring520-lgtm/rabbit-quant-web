"use client";

import { useMemo, useState, type MouseEvent } from "react";
import "./styles.css";

type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type ChartMode = "candles" | "line";
type Timeframe = "5m" | "15m" | "1h" | "4h" | "1D";

const TIMEFRAME_STEP_MINUTES: Record<Timeframe, number> = {
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1D": 1440,
};

const WATCHLIST = [
  { symbol: "XAUUSD", name: "现货黄金", price: "", change: "", tone: "up" },
  { symbol: "XAGUSD", name: "现货白银", price: "39.18", change: "+1.12%", tone: "up" },
  { symbol: "EURUSD", name: "欧元/美元", price: "1.1748", change: "-0.18%", tone: "down" },
  { symbol: "DXY", name: "美元指数", price: "97.61", change: "-0.23%", tone: "down" },
  { symbol: "US10Y", name: "美国十年期", price: "4.14%", change: "+0.04%", tone: "up" },
];

const NEWS = [
  { time: "18:32", source: "Market Desk", title: "黄金维持高位震荡，市场等待美国数据" },
  { time: "17:48", source: "宏观雷达", title: "美元回落为贵金属提供短线支撑" },
  { time: "16:05", source: "经济日历", title: "晚间关注美国初请失业金与制造业数据" },
];

function formatCandleTime(index: number, timeframe: Timeframe) {
  const end = Date.UTC(2026, 8, 24, 10, 45);
  const timestamp = end - (71 - index) * TIMEFRAME_STEP_MINUTES[timeframe] * 60_000;
  const date = new Date(timestamp);
  if (timeframe === "1D") {
    return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
  }
  return `${String((date.getUTCHours() + 8) % 24).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function buildCandles(timeframe: Timeframe): Candle[] {
  return Array.from({ length: 72 }, (_, index) => {
    const base = 3362 + index * 0.31 + Math.sin(index / 5.3) * 7.4 + Math.sin(index / 2.1) * 2.1;
    const open = base + Math.sin(index * 1.7) * 0.75;
    const close = base + Math.cos(index * 1.13) * 1.1 + (index > 55 ? (index - 55) * 0.38 : 0);
    const high = Math.max(open, close) + 1.3 + (index % 4) * 0.35;
    const low = Math.min(open, close) - 1.1 - (index % 3) * 0.32;
    return {
      time: formatCandleTime(index, timeframe),
      open,
      high,
      low,
      close,
      volume: 28 + Math.abs(Math.sin(index / 3)) * 56 + (index % 9 === 0 ? 30 : 0),
    };
  });
}

function formatPrice(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function XauUsdMarketPage() {
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [chartMode, setChartMode] = useState<ChartMode>("candles");
  const [activeTab, setActiveTab] = useState("概览");
  const [query, setQuery] = useState("XAUUSD");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const candles = useMemo(() => buildCandles(timeframe), [timeframe]);
  const chart = useMemo(() => {
    const width = 960;
    const height = 470;
    const left = 48;
    const right = 62;
    const top = 24;
    const bottom = 62;
    const volumeHeight = 70;
    const plotWidth = width - left - right;
    const priceBottom = height - bottom - volumeHeight;
    const prices = candles.flatMap((item) => [item.high, item.low]);
    const min = Math.min(...prices) - 2;
    const max = Math.max(...prices) + 2;
    const x = (index: number) => left + (index / (candles.length - 1)) * plotWidth;
    const y = (price: number) => top + ((max - price) / (max - min)) * (priceBottom - top);
    const maxVolume = Math.max(...candles.map((item) => item.volume));
    return { width, height, left, right, top, bottom, volumeHeight, plotWidth, priceBottom, min, max, x, y, maxVolume };
  }, [candles]);
  const current = candles.at(-1)!;
  const hovered = hoveredIndex === null ? current : candles[hoveredIndex] ?? current;
  const linePath = candles.map((item, index) => `${index === 0 ? "M" : "L"}${chart.x(index).toFixed(1)},${chart.y(item.close).toFixed(1)}`).join(" ");
  const average = candles.reduce((sum, item) => sum + item.close, 0) / candles.length;
  const previousClose = current.close / 1.0064;
  const changeAmount = current.close - previousClose;
  const currentChange = (changeAmount / previousClose) * 100;
  const currentChangeLabel = `${currentChange >= 0 ? "+" : ""}${currentChange.toFixed(2)}%`;
  const lastUpdateLabel = timeframe === "1D" ? `${current.time} UTC+8` : `${current.time}:12 UTC+8`;
  const sessionOpen = candles[0].open;
  const sessionHigh = Math.max(...candles.map((item) => item.high));
  const sessionLow = Math.min(...candles.map((item) => item.low));
  const rangeProgress = Math.max(0, Math.min(100, ((current.close - sessionLow) / (sessionHigh - sessionLow)) * 100));

  const handleChartMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const viewBoxX = ((event.clientX - rect.left) / rect.width) * chart.width;
    const ratio = Math.max(0, Math.min(1, (viewBoxX - chart.left) / chart.plotWidth));
    setHoveredIndex(Math.round(ratio * (candles.length - 1)));
  };

  return (
    <main className="xau-terminal">
      <header className="xau-topbar">
        <div className="xau-brand"><span className="xau-brand-mark">双兔</span><span>市场终端</span></div>
        <nav className="xau-main-nav" aria-label="主导航">
          <a className="active" href="#chart">图表</a><a href="#markets">市场</a><a href="#calendar">经济日历</a>
        </nav>
        <div className="xau-top-actions"><span className="xau-demo-pill"><i />演示行情</span><button className="xau-icon-button" type="button" aria-label="搜索">⌕</button><button className="xau-login" type="button">登录</button></div>
      </header>

      <section className="xau-commandbar" aria-label="品种搜索">
        <div className="xau-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value.toUpperCase())} aria-label="搜索品种" /><kbd>⌘ K</kbd></div>
        <span className="xau-command-hint">输入品种代码或名称</span>
        <button className="xau-watch-add" type="button">＋ 加入自选</button>
      </section>

      <section className="xau-instrument-head">
        <div className="xau-instrument-title"><div className="xau-symbol-icon">Au</div><div><div className="xau-title-line"><h1>黄金兑美元</h1><span className="xau-symbol-code">XAUUSD</span><span className="xau-market-tag">现货</span></div><p>示意行情源 · 美元计价 · 24小时市场</p></div></div>
        <div className="xau-quote-main"><strong>{formatPrice(current.close)}</strong><span className={currentChange >= 0 ? "up" : "down"}>{currentChange >= 0 ? "+" : ""}{changeAmount.toFixed(2)}&nbsp; ({currentChangeLabel})</span><small>演示报价 · {lastUpdateLabel}</small></div>
        <div className="xau-head-stats"><span><em>今开</em><b>{formatPrice(sessionOpen)}</b></span><span><em>最高</em><b>{formatPrice(sessionHigh)}</b></span><span><em>最低</em><b>{formatPrice(sessionLow)}</b></span><span><em>振幅</em><b>{((sessionHigh - sessionLow) / previousClose * 100).toFixed(2)}%</b></span></div>
      </section>

      <div className="xau-terminal-grid">
        <aside className="xau-watchlist" id="markets">
          <div className="xau-panel-head"><div><span className="xau-kicker">WATCHLIST</span><h2>自选列表</h2></div><button className="xau-icon-button" type="button" aria-label="自选设置">⋯</button></div>
          <div className="xau-watch-tabs"><button className="active" type="button">主要</button><button type="button">外汇</button><button type="button">商品</button></div>
          <div className="xau-watch-rows">{WATCHLIST.map((item) => { const isActive = item.symbol === "XAUUSD"; const displayPrice = isActive ? formatPrice(current.close) : item.price; const displayChange = isActive ? currentChangeLabel : item.change; return <button className={`xau-watch-row ${isActive ? "selected" : ""}`} type="button" key={item.symbol} title={isActive ? "当前演示品种" : "演示界面：该品种图表尚未接入"} aria-current={isActive ? "true" : undefined}><span className="xau-watch-name"><b>{item.symbol}</b><small>{item.name}</small></span><span className="xau-watch-value"><b>{displayPrice}</b><em className={isActive ? (currentChange >= 0 ? "up" : "down") : item.tone}>{displayChange}</em></span></button>; })}</div>
          <div className="xau-watch-footer"><span>同步时间</span><b>{current.time}</b></div>
        </aside>

        <section className="xau-chart-panel" id="chart">
          <div className="xau-chart-toolbar"><div className="xau-timeframes">{(["5m", "15m", "1h", "4h", "1D"] as Timeframe[]).map((item) => <button className={timeframe === item ? "active" : ""} type="button" key={item} onClick={() => setTimeframe(item)}>{item}</button>)}</div><div className="xau-chart-actions"><button className="xau-tool-button" type="button" aria-label="指标">∿ <span>指标</span></button><button className="xau-tool-button" type="button" aria-label="全屏">⛶</button><button className="xau-tool-button" type="button" aria-label="设置">⚙</button></div></div>
          <div className="xau-chart-subbar"><div className="xau-chart-kind"><button className={chartMode === "candles" ? "active" : ""} type="button" onClick={() => setChartMode("candles")}>蜡烛图</button><button className={chartMode === "line" ? "active" : ""} type="button" onClick={() => setChartMode("line")}>折线图</button><span className="xau-divider" /><span className="xau-indicator-chip"><i className="vwap" />均线 20</span><span className="xau-indicator-chip"><i className="rsi" />RSI 14</span></div><span className="xau-chart-status"><i />市场开放 · 约15分钟延迟</span></div>
          <div className="xau-chart-wrap">
            <svg className="xau-chart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label="XAUUSD 黄金兑美元价格图表" onMouseMove={handleChartMove} onMouseLeave={() => setHoveredIndex(null)}>
              <defs><linearGradient id="xau-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#2eb89a" stopOpacity=".16" /><stop offset="1" stopColor="#2eb89a" stopOpacity="0" /></linearGradient></defs>
              {[0, 1, 2, 3, 4].map((index) => { const value = chart.max - ((chart.max - chart.min) / 4) * index; const y = chart.y(value); return <g key={`grid-y-${index}`}><line x1={chart.left} x2={chart.width - chart.right} y1={y} y2={y} className="xau-grid-line" /><text x={chart.width - chart.right + 10} y={y + 4} className="xau-axis-label">{formatPrice(value)}</text></g>; })}
              {[0, 12, 24, 36, 48, 60, 71].map((index) => <g key={`grid-x-${index}`}><line x1={chart.x(index)} x2={chart.x(index)} y1={chart.top} y2={chart.height - chart.bottom} className="xau-grid-line vertical" /><text x={chart.x(index)} y={chart.height - 19} textAnchor="middle" className="xau-axis-label">{candles[index].time}</text></g>)}
              {chartMode === "line" && <path d={`${linePath} L${chart.x(candles.length - 1)},${chart.priceBottom} L${chart.x(0)},${chart.priceBottom} Z`} fill="url(#xau-area)" />}
              {chartMode === "line" && <path d={linePath} className="xau-price-line" />}
              {chartMode === "candles" && candles.map((item, index) => { const candleWidth = Math.max(4, chart.plotWidth / candles.length * .62); const up = item.close >= item.open; const x = chart.x(index); const bodyTop = chart.y(Math.max(item.open, item.close)); const bodyBottom = chart.y(Math.min(item.open, item.close)); return <g key={item.time}><line x1={x} x2={x} y1={chart.y(item.high)} y2={chart.y(item.low)} className={`xau-wick ${up ? "up" : "down"}`} /><rect x={x - candleWidth / 2} y={bodyTop} width={candleWidth} height={Math.max(1.5, bodyBottom - bodyTop)} className={`xau-candle ${up ? "up" : "down"}`} /></g>; })}
              {candles.map((item, index) => { const x = chart.x(index); const barHeight = item.volume / chart.maxVolume * chart.volumeHeight; return <rect key={`vol-${item.time}`} x={x - 2} y={chart.height - chart.bottom - barHeight} width="4" height={barHeight} className={`xau-volume ${item.close >= item.open ? "up" : "down"}`} />; })}
              <path d={`M${chart.x(0)},${chart.y(average)} L${chart.x(candles.length - 1)},${chart.y(average)}`} className="xau-average-line" />
              <line x1={chart.left} x2={chart.width - chart.right} y1={chart.y(current.close)} y2={chart.y(current.close)} className="xau-current-line" /><rect x={chart.width - chart.right + 6} y={chart.y(current.close) - 11} width="56" height="22" rx="3" className="xau-current-tag" /><text x={chart.width - chart.right + 34} y={chart.y(current.close) + 4} textAnchor="middle" className="xau-current-label">{formatPrice(current.close)}</text>
              {hoveredIndex !== null && <><line x1={chart.x(hoveredIndex)} x2={chart.x(hoveredIndex)} y1={chart.top} y2={chart.priceBottom} className="xau-crosshair" /><circle cx={chart.x(hoveredIndex)} cy={chart.y(hovered.close)} r="4" className="xau-crosshair-dot" /><g transform={`translate(${Math.min(chart.width - 180, Math.max(chart.left + 8, chart.x(hoveredIndex) + 12))} ${Math.max(10, chart.y(hovered.close) - 65)})`}><rect width="164" height="52" rx="5" className="xau-tooltip-box" /><text x="10" y="18" className="xau-tooltip-title">{hovered.time} · {timeframe}</text><text x="10" y="36" className="xau-tooltip-copy">O {formatPrice(hovered.open)}  H {formatPrice(hovered.high)}  L {formatPrice(hovered.low)}  C {formatPrice(hovered.close)}</text></g></>}
            </svg>
          </div>
          <div className="xau-chart-legend"><span><i className="candle-up" />上涨</span><span><i className="candle-down" />下跌</span><span><i className="legend-line" />均线 20</span><span className="xau-data-note">演示界面 · 真实行情接口待接入</span></div>
        </section>

        <aside className="xau-detail-panel">
          <div className="xau-detail-tabs"><button className="active" type="button">行情概览</button><button type="button">技术指标</button></div>
          <div className="xau-detail-quote"><span>黄金兑美元</span><strong>{formatPrice(current.close)}</strong><b className={currentChange >= 0 ? "up" : "down"}>{currentChangeLabel}</b><small>演示报价 · {lastUpdateLabel}</small></div>
          <div className="xau-range"><div className="xau-range-head"><span>日内区间</span><b>{formatPrice(sessionLow)} — {formatPrice(sessionHigh)}</b></div><div className="xau-range-track"><i style={{ right: `${100 - rangeProgress}%` }} /><b style={{ right: `${100 - rangeProgress}%` }} /></div><div className="xau-range-labels"><span>低</span><span>高</span></div></div>
          <div className="xau-metrics"><span><em>昨收</em><b>{formatPrice(previousClose)}</b></span><span><em>成交量</em><b>演示</b></span><span><em>点差</em><b>0.18</b></span><span><em>波动率</em><b>中等</b></span></div>
          <div className="xau-signal-card"><div><span className="xau-kicker">双兔观察</span><b>等待回踩确认</b></div><p>价格仍在日内均价上方，当前只做位置观察，不生成买卖指令。</p><small>确认度 <strong>72</strong> · 风险 <strong className="xau-warn">中</strong></small></div>
          <button className="xau-alert-button" type="button">＋ 创建价格提醒</button>
        </aside>
      </div>

      <section className="xau-bottom-panel" id="calendar">
        <div className="xau-bottom-tabs">{["概览", "新闻", "经济日历", "技术分析"].map((tab) => <button key={tab} className={activeTab === tab ? "active" : ""} type="button" onClick={() => setActiveTab(tab)}>{tab}</button>)}</div>
        {activeTab === "概览" && <div className="xau-overview-grid"><div><span className="xau-kicker">市场摘要</span><h3>黄金处于高位震荡区间</h3><p>美元走弱与避险需求提供支撑，但短线仍需要回踩确认。这里保留双兔的观察语义，不把界面提示当成自动交易指令。</p></div><div className="xau-overview-facts"><span><em>趋势</em><b className="up">偏强</b></span><span><em>动能</em><b>中性</b></span><span><em>支撑</em><b>{formatPrice(sessionLow)}</b></span><span><em>阻力</em><b>{formatPrice(sessionHigh)}</b></span></div></div>}
        {activeTab === "新闻" && <div className="xau-news-list">{NEWS.map((item) => <article key={`${item.time}-${item.title}`}><time>{item.time}</time><div><b>{item.title}</b><small>{item.source}</small></div></article>)}</div>}
        {activeTab === "经济日历" && <div className="xau-calendar-list"><article><time>20:30</time><div><b>美国初请失业金人数</b><small>预期 · 高影响</small></div><strong>待公布</strong></article><article><time>22:00</time><div><b>美国成屋销售</b><small>预期 · 中影响</small></div><strong>待公布</strong></article></div>}
        {activeTab === "技术分析" && <div className="xau-analysis-grid"><span><em>移动均线</em><b className="up">买入</b><small>MA20 仍向上</small></span><span><em>RSI(14)</em><b>56.8</b><small>中性区间</small></span><span><em>MACD</em><b className="up">偏多</b><small>柱体收窄</small></span><span><em>综合判断</em><b>等待确认</b><small>仅作研究参考</small></span></div>}
      </section>
      <footer className="xau-footer"><span>双兔市场终端</span><span>界面原型 · XAUUSD</span><span>数据与交易功能需接入授权行情源</span></footer>
    </main>
  );
}
