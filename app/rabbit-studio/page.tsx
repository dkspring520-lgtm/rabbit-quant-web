"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore, type MouseEvent } from "react";
import { buildRabbitStudioMetrics } from "@/lib/rabbit-studio-metrics.mjs";
import { studioSignals } from "@/lib/rabbit-studio-signals.mjs";
import "./styles.css";

type WatchItem = { code: string; name: string };

type Quote = {
  code?: string;
  name?: string;
  price?: number | null;
  previousClose?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
  amount?: number | null;
  change?: number | null;
  changePercent?: number | null;
};

type Minute = {
  time: string;
  price: number;
  volume?: number | null;
  averagePrice?: number | null;
};

type MarketPayload = {
  provider?: string | null;
  minuteProvider?: string | null;
  quote?: Quote | null;
  minutes?: Minute[];
  delayed?: boolean;
  trial?: boolean;
  fetchedAt?: string;
  quality?: { score?: number; label?: string; level?: string } | null;
};

type SeriesRow = Minute & { vwap: number | null };
// The source is a one-minute intraday series.  These labels describe what is
// actually shown, rather than implying that every choice is a new candle
// interval.
type Timeframe = "完整分时" | "近120分" | "5分聚合";

const watchlist: WatchItem[] = [
  { code: "601899", name: "紫金矿业" },
  { code: "601012", name: "隆基绿能" },
  { code: "600519", name: "贵州茅台" },
];

const timeframes: Timeframe[] = ["完整分时", "近120分", "5分聚合"];
const fallbackSeries: SeriesRow[] = [];

function supportedWatchCode(value: string | null) {
  return value && watchlist.some((item) => item.code === value) ? value : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function formatPrice(value: number | null | undefined) {
  return positive(value)
    ? new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
    : "--";
}

function formatPercent(value: number | null | undefined, signed = true) {
  if (!finite(value)) return "--";
  return `${signed && value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatTime(value: string | undefined) {
  if (!value) return "--:--";
  const normalized = value.replace(/[^0-9]/g, "");
  return normalized.length === 4 ? `${normalized.slice(0, 2)}:${normalized.slice(2)}` : value;
}

function formatFetchedAt(value: string | undefined) {
  if (!value) return "等待数据时间";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "数据时间待同步" : `更新于 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
}

async function loadMarket(code: string, mode: "trial-realtime" | "trial-quote", signal: AbortSignal) {
  try {
    const response = await fetch(`/api/market-data?code=${encodeURIComponent(code)}&mode=${mode}`, {
      signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    return await response.json() as MarketPayload;
  } catch {
    return null;
  }
}

function makeSeries(minutes: Minute[]): SeriesRow[] {
  let cumulativeVolume = 0;
  let cumulativeValue = 0;
  let previousVwap: number | null = null;

  return minutes
    .filter((row) => typeof row?.time === "string" && positive(row?.price))
    .map((row) => {
      const volume = finite(row.volume) && row.volume >= 0 ? row.volume : 0;
      if (volume > 0) {
        cumulativeVolume += volume;
        cumulativeValue += row.price * volume;
      }
      const sourceVwap = positive(row.averagePrice) ? row.averagePrice : null;
      const calculatedVwap = cumulativeVolume > 0 ? cumulativeValue / cumulativeVolume : null;
      const vwap = sourceVwap ?? calculatedVwap ?? previousVwap;
      previousVwap = vwap;
      return { ...row, vwap };
    });
}

function aggregateFiveMinute(rows: SeriesRow[]) {
  const result: SeriesRow[] = [];
  let group: SeriesRow[] = [];
  let previousMinute: number | null = null;
  const flush = () => {
    const last = group.at(-1);
    if (!last) return;
    const volume = group.reduce((sum, row) => sum + (finite(row.volume) && row.volume > 0 ? row.volume : 0), 0);
    const weightedVwap = group.reduce((sum, row) => sum + (row.vwap ?? row.price) * (finite(row.volume) && row.volume > 0 ? row.volume : 1), 0)
      / group.reduce((sum, row) => sum + (finite(row.volume) && row.volume > 0 ? row.volume : 1), 0);
    result.push({ ...last, volume, vwap: finite(weightedVwap) ? weightedVwap : last.vwap });
    group = [];
  };
  rows.forEach((row) => {
    const digits = row.time.replace(/[^0-9]/g, "");
    const hour = Number(digits.slice(0, 2));
    const minute = Number(digits.slice(2, 4));
    const absoluteMinute = Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
    // Do not merge the 11:30 and 13:00 sessions into one five-minute bar.
    if (group.length && (absoluteMinute === null || previousMinute === null || absoluteMinute - previousMinute > 5)) flush();
    group.push(row);
    previousMinute = absoluteMinute;
    if (group.length >= 5) flush();
  });
  flush();
  return result;
}

function quantileLabels(rows: SeriesRow[]) {
  if (!rows.length) return [] as Array<{ label: string; index: number }>;
  const indexes = [0, Math.floor((rows.length - 1) / 3), Math.floor(((rows.length - 1) * 2) / 3), rows.length - 1];
  return [...new Set(indexes)].map((index) => ({ label: formatTime(rows[index]?.time), index }));
}

function tradingDateKey() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  return parts.replace(/[^0-9]/g, "");
}

function positionLabel(positionPct: number | null) {
  if (!finite(positionPct)) return "位置待计算";
  if (positionPct <= 15) return "日内下沿附近";
  if (positionPct < 40) return "日内下部";
  if (positionPct <= 60) return "日内中部";
  if (positionPct < 85) return "日内上部";
  return "日内上沿附近";
}

function rangeLabel(amplitudePct: number | null) {
  if (!finite(amplitudePct)) return "区间待补全";
  if (amplitudePct < 0.8) return "窄幅整理";
  if (amplitudePct < 2) return "区间运行";
  return "波动展开";
}

export default function RabbitStudioPage() {
  // The server snapshot stays deterministic; the browser snapshot can safely
  // honor a handoff URL after hydration without a synchronous state effect.
  const deepLinkedCode = useSyncExternalStore(
    () => () => {},
    () => supportedWatchCode(new URLSearchParams(window.location.search).get("code")) ?? watchlist[0].code,
    () => watchlist[0].code,
  );
  const [selectedOverride, setSelectedOverride] = useState<string | null>(null);
  const selected = selectedOverride ?? deepLinkedCode;
  const [timeframe, setTimeframe] = useState<Timeframe>("完整分时");
  const [snapshots, setSnapshots] = useState<Record<string, MarketPayload | null>>({});
  const [loadingCodes, setLoadingCodes] = useState<Record<string, boolean>>({ "601899": true });
  const [journal, setJournal] = useState<string | null>(null);
  const [journalSaved, setJournalSaved] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [signalFeed, setSignalFeed] = useState<{ alerts: unknown[]; status: string }>({ alerts: [], status: "正在同步信号" });
  const [selectedSignal, setSelectedSignal] = useState<string | null>(null);
  const [signalsVisible, setSignalsVisible] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch('/api/control/alerts?afterId=0&limit=100', { credentials: 'include', cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '登录后同步账户信号' : '信号暂不可用');
        const payload = await response.json();
        if (!Array.isArray(payload.alerts)) throw new Error('信号暂不可用');
        if (!controller.signal.aborted) setSignalFeed({ alerts: payload.alerts, status: '已同步账户最近信号' });
      } catch (error) {
        if (!controller.signal.aborted) setSignalFeed({ alerts: [], status: error instanceof Error ? error.message : '信号暂不可用' });
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const requests = watchlist.map(async (item) => ({
      code: item.code,
      payload: await loadMarket(item.code, item.code === selected ? "trial-realtime" : "trial-quote", controller.signal),
    }));

    void Promise.all(requests).then((results) => {
      if (controller.signal.aborted) return;
      setSnapshots((current) => {
        const next = { ...current };
        results.forEach(({ code, payload }) => { next[code] = payload; });
        return next;
      });
    }).finally(() => {
      if (!controller.signal.aborted) {
        setLoadingCodes((current) => ({ ...current, [selected]: false }));
      }
    });

    // Keep the focused instrument fresh while the page remains open.  The
    // watchlist quotes are intentionally lighter-weight; only the selected
    // instrument receives a full minute refresh.
    const refreshTimer = window.setInterval(() => {
      void loadMarket(selected, "trial-realtime", controller.signal).then((payload) => {
        if (!payload || controller.signal.aborted) return;
        setSnapshots((current) => ({ ...current, [selected]: payload }));
      });
    }, 30_000);

    return () => { controller.abort(); window.clearInterval(refreshTimer); };
  }, [selected]);

  const market = snapshots[selected] ?? null;
  const quote = market?.quote ?? null;
  const loading = Boolean(loadingCodes[selected]) || (selected in snapshots ? false : true);
  const fallbackStock = watchlist.find((item) => item.code === selected) ?? watchlist[0];
  const stockName = quote?.name || fallbackStock.name;
  const stockPrice = positive(quote?.price) ? quote.price : null;
  const stockChange = finite(quote?.changePercent) ? quote.changePercent : null;

  const minuteRows = useMemo(() => makeSeries(market?.minutes ?? []), [market]);
  const metrics = useMemo(() => buildRabbitStudioMetrics(
    minuteRows.map(({ time, price, volume }) => ({ time, price, volume: finite(volume) ? volume : undefined })),
    quote?.previousClose ?? null,
    { recentWindowBars: 30 },
  ) as {
    available: boolean;
    latest?: { time: string; price: number; changePct: number | null } | null;
    vwap?: { value: number; label: string; isFallback: boolean } | null;
    dayRange?: {
      high?: { price: number } | null;
      low?: { price: number } | null;
      spread: number;
      amplitudePct: number | null;
      pricePositionPct: number;
      position: { label: string };
    } | null;
    supportResistance?: { support?: { price: number } | null; resistance?: { price: number } | null } | null;
    tSpace?: { recentGrossSpread: number; recentGrossSpreadPct: number | null } | null;
    rhythm: { label: string; explanation: string };
  }, [minuteRows, quote?.previousClose]);

  // Quote high/low are the session's source-of-truth extremes.  Minute rows
  // can be trimmed or delayed at the tail, so they are only a fallback here.
  const dayHigh = positive(quote?.high) ? quote.high : positive(metrics.dayRange?.high?.price) ? metrics.dayRange.high.price : null;
  const dayLow = positive(quote?.low) ? quote.low : positive(metrics.dayRange?.low?.price) ? metrics.dayRange.low.price : null;
  const daySpread = positive(dayHigh) && positive(dayLow) ? Math.max(0, dayHigh - dayLow) : null;
  const amplitudePct = finite(daySpread) && daySpread >= 0 && positive(quote?.previousClose)
    ? (daySpread / quote.previousClose) * 100
    : finite(metrics.dayRange?.amplitudePct) ? metrics.dayRange.amplitudePct : null;
  const positionPct = positive(stockPrice) && positive(dayHigh) && positive(dayLow) && dayHigh > dayLow
    ? ((stockPrice - dayLow) / (dayHigh - dayLow)) * 100
    : metrics.available ? metrics.dayRange?.pricePositionPct ?? null : null;
  const currentPosition = positionLabel(positionPct);
  // All prominent copy uses the display-only metrics contract.  The SVG may
  // still retain its source-row average curve, but it must never cause a
  // different number to appear in the headline, metric strip, or rhythm copy.
  const vwapValue = positive(metrics.vwap?.value) ? metrics.vwap.value : null;
  const hasWeightedVwap = Boolean(vwapValue && !metrics.vwap?.isFallback);
  const averageReferenceName = hasWeightedVwap ? "VWAP" : "均价参考";
  const chartAverageLabel = hasWeightedVwap ? "VWAP 均价" : vwapValue ? "逐行均价参考" : "均价待同步";
  const vwapDeviation = positive(stockPrice) && positive(vwapValue) ? ((stockPrice - vwapValue) / vwapValue) * 100 : null;
  const rhythmLabel = rangeLabel(amplitudePct);
  const rhythmExplanation = amplitudePct === null
    ? "日内振幅待补全；仅描述已发生的日内节奏。"
    : `日内振幅 ${amplitudePct.toFixed(2)}%，最新价${currentPosition}，${vwapValue ? (vwapDeviation !== null && Math.abs(vwapDeviation) <= 0.1 ? `贴近${averageReferenceName}` : vwapDeviation !== null && vwapDeviation > 0 ? `位于${averageReferenceName}上方` : `位于${averageReferenceName}下方`) : "均价待计算"}；仅描述已发生的日内节奏。`;
  const recentSupport = positive(metrics.supportResistance?.support?.price) ? metrics.supportResistance.support.price : null;
  const recentResistance = positive(metrics.supportResistance?.resistance?.price) ? metrics.supportResistance.resistance.price : null;

  const visibleRows = useMemo(() => {
    if (timeframe === "完整分时") return minuteRows;
    if (timeframe === "近120分") return minuteRows.slice(-120);
    return aggregateFiveMinute(minuteRows).slice(-72);
  }, [minuteRows, timeframe]);

  const signalPoints = useMemo(() => studioSignals(signalFeed.alerts, selected, tradingDateKey()) as Array<{id: string; time: string; price: number; side: string; level: string; score: number | null; label: string; reason: string}>, [signalFeed.alerts, selected]);
  const displayedSignals = useMemo(() => signalPoints.filter(point => {
    const first = visibleRows[0]?.time.replace(':', '');
    const last = visibleRows.at(-1)?.time.replace(':', '');
    return first && last && point.time >= first && point.time <= last;
  }).slice(-8), [signalPoints, visibleRows]);
  const activeSignal = displayedSignals.find(point => point.id === selectedSignal);

  const chartModel = useMemo(() => {
    if (visibleRows.length < 2) return {
      points: [] as Array<[number, number]>,
      vwapPoints: [] as Array<[number, number]>,
      rows: fallbackSeries,
      min: null as number | null,
      max: null as number | null,
      labels: [] as Array<{ label: string; index: number }>,
    };
    const referenceValues = [
      ...visibleRows.flatMap((row) => [row.price, row.vwap ?? row.price]),
      dayHigh,
      dayLow,
      recentSupport,
      recentResistance,
      ...displayedSignals.map(point => point.price),
    ].filter(positive);
    const rawMin = Math.min(...referenceValues);
    const rawMax = Math.max(...referenceValues);
    const rawSpan = rawMax - rawMin;
    const padding = rawSpan > 0 ? rawSpan * 0.1 : Math.max(rawMax * 0.004, 0.01);
    const min = rawMin - padding;
    const max = rawMax + padding;
    const span = max - min || 1;
    const y = (value: number) => 87 - ((value - min) / span) * 70;
    const x = (index: number) => 4 + (index * 92) / Math.max(visibleRows.length - 1, 1);
    return {
      points: visibleRows.map((row, index): [number, number] => [x(index), y(row.price)]),
      vwapPoints: visibleRows.map((row, index): [number, number] => [x(index), y(row.vwap ?? row.price)]),
      rows: visibleRows,
      min,
      max,
      y,
      labels: quantileLabels(visibleRows),
    };
  }, [dayHigh, dayLow, recentResistance, recentSupport, visibleRows, displayedSignals]);

  const chartPath = chartModel.points.map(([x, y]) => `${x},${y}`).join(" ");
  const vwapPath = visibleRows.some((row) => positive(row.vwap))
    ? chartModel.vwapPoints.map(([x, y]) => `${x},${y}`).join(" ")
    : "";
  const filledPath = chartPath ? `M ${chartPath.replace(/ /g, " L ")} L 96,98 L 4,98 Z` : "";
  const hoverPoint = hoverIndex !== null ? chartModel.points[hoverIndex] : null;
  const hoverRow = hoverIndex !== null ? chartModel.rows[hoverIndex] : null;
  const hoverTooltipLeft = hoverPoint ? Math.min(82, Math.max(8, hoverPoint[0])) : 0;

  const handleChartMove = (event: MouseEvent<SVGSVGElement>) => {
    if (chartModel.rows.length < 2) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHoverIndex(Math.round(ratio * (chartModel.rows.length - 1)));
  };

  const marketState = loading
    ? "正在同步行情"
    : market?.quote
      ? market.delayed ? "行情已同步 · 延迟" : "行情已同步"
      : "行情暂不可用";
  const isAvailable = Boolean(market?.quote && stockPrice);
  const professionalHref = `/?code=${encodeURIComponent(selected)}`;
  const journalKey = `rabbit-studio-journal:${tradingDateKey()}:${selected}`;

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      try { setJournal(window.localStorage.getItem(journalKey)); } catch { setJournal(null); }
      setJournalSaved(false);
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [journalKey]);

  const saveJournal = (value: string) => {
    setJournal(value);
    setJournalSaved(true);
    try { window.localStorage.setItem(journalKey, value); } catch { setJournalSaved(false); }
  };

  const selectStock = (code: string) => {
    if (code === selected) return;
    setLoadingCodes((current) => ({ ...current, [code]: true }));
    setHoverIndex(null);
    setSelectedOverride(code);
  };

  return (
    <main className="rabbit-studio" data-rabbit-skin="daylight">
      <div className="rs-ambient rs-ambient-a" />
      <div className="rs-ambient rs-ambient-b" />

      <header className="rs-header">
        <a className="rs-brand" href="#workspace" aria-label="兔兔看盘工作台">
          <span className="rs-logo-wrap"><Image src="/rabbit-logo-compact.png" alt="" width={32} height={32} priority unoptimized /></span>
          <span><strong>兔兔看盘</strong><small>为自己，温柔地做决定</small></span>
        </a>
        <nav className="rs-nav" aria-label="工作台导航">
          <a className="active" href="#workspace">今日工作台</a>
          <a href="#watchlist">我的观察</a>
          <a href="#journal">轻量复盘</a>
        </nav>
        <div className="rs-header-tools">
          <span className="rs-mode"><i />温暖护航模式</span>
          <Link className="rs-pro-switch" href={professionalHref}>沉浸专业模式 <b>→</b></Link>
        </div>
      </header>

      <div className="rs-workspace" id="workspace">
        <aside className="rs-left-rail" id="watchlist">
          <section className="rs-hello">
            <span className="rs-eyebrow">GOOD MORNING</span>
            <h1>慢一点，<br /><em>也会走得更稳。</em></h1>
            <p>今天只做看得懂的交易。</p>
          </section>

          <section className="rs-watch-section" aria-label="我的自选">
            <header><span>我的自选</span><small>{watchlist.length} 只</small></header>
            <div className="rs-watchlist">
              {watchlist.map((item) => {
                const itemQuote = snapshots[item.code]?.quote;
                const itemPrice = positive(itemQuote?.price) ? itemQuote.price : null;
                const itemChange = finite(itemQuote?.changePercent) ? itemQuote.changePercent : null;
                const itemRange = positive(itemQuote?.high) && positive(itemQuote?.low) && positive(itemQuote?.previousClose)
                  ? ((itemQuote.high - itemQuote.low) / itemQuote.previousClose) * 100
                  : null;
                const itemLoading = item.code === selected && loading;
                return (
                  <button key={item.code} className={`rs-watch ${selected === item.code ? "selected" : ""}`} onClick={() => selectStock(item.code)} aria-pressed={selected === item.code}>
                    <span className="rs-watch-symbol"><b>{item.name}</b><small>{item.code}</small></span>
                    <span className="rs-watch-quote">
                      <b>{itemLoading && !itemPrice ? "…" : formatPrice(itemPrice)}</b>
                      <small className={itemChange !== null && itemChange >= 0 ? "up" : "down"}>{formatPercent(itemChange)}</small>
                      <em>{itemRange === null ? "— · 待同步" : `振幅 ${itemRange.toFixed(2)}% · 差 ¥${formatPrice(itemQuote && positive(itemQuote.high) && positive(itemQuote.low) ? itemQuote.high - itemQuote.low : null)}`}</em>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rs-ritual-card" aria-label="今日看盘小提示">
            <span className="rs-ritual-icon">✦</span>
            <div><span>兔兔提醒</span><b>先确认位置，再决定动作</b><p>没有正式信号时，观察也是好决策。</p></div>
          </section>
        </aside>

        <section className="rs-content">
          <div className="rs-stage-heading">
            <div><span className="rs-eyebrow">TODAY&apos;S FOCUS</span><h2>把复杂行情，变成一眼可懂的节奏</h2></div>
            <a className="rs-guide" href="#journal"><span>?</span> 如何看这里</a>
          </div>

          <article className="rs-quote-bar">
            <div className="rs-quote-identity"><span className="rs-symbol-dot" /><div><b>{stockName}</b><small>{selected} · A 股 · 开盘 {formatPrice(quote?.open)}</small></div></div>
            <div className="rs-quote-price"><strong>{formatPrice(stockPrice)}</strong><span className={stockChange !== null && stockChange >= 0 ? "up" : "down"}>{formatPercent(stockChange)}</span></div>
            <div className="rs-data-state" role="status" aria-live="polite"><span className={loading ? "pending" : isAvailable ? "live" : "demo"}><i />{marketState}</span><small>{isAvailable ? `${formatTime(minuteRows.at(-1)?.time)} · ${formatFetchedAt(market?.fetchedAt)}` : "切换标的后自动更新"}</small></div>
          </article>

          <section className="rs-metric-strip" aria-label="日内关键数据">
            <div><span>日内振幅</span><strong>{formatPercent(amplitudePct, false)}</strong><small>高低差 ¥{formatPrice(daySpread)}</small></div>
            <div><span>今日低点</span><strong>{formatPrice(dayLow)}</strong><small>已发生价格</small></div>
            <div><span>今日高点</span><strong>{formatPrice(dayHigh)}</strong><small>已发生价格</small></div>
            <div><span>{hasWeightedVwap ? "VWAP 均价" : "均价参考"}</span><strong>{formatPrice(vwapValue)}</strong><small>{vwapValue ? `${hasWeightedVwap ? "偏离" : "价格平均 · 偏离"} ${formatPercent(vwapDeviation)}` : "均价待同步"}</small></div>
            <div><span>当前区间位置</span><strong>{finite(positionPct) ? `${Math.round(positionPct)}%` : "--"}</strong><small>{currentPosition}</small></div>
            <div><span>日内 T 空间</span><strong>¥{formatPrice(daySpread)}</strong><small>高低毛价差 · 不含成本</small></div>
          </section>
          <p className="rs-reference-note"><span>近期观察参考</span> 支撑 {formatPrice(recentSupport)} · 压力 {formatPrice(recentResistance)} <small>仅取已发生的近 30 根分钟高低点，不是买卖指令</small></p>

          <div className="rs-terminal-grid">
            <div className="rs-chart-column">
              <article className="rs-chart-card rs-card">
                <header className="rs-card-heading">
                  <div><span className="rs-eyebrow">INTRADAY RHYTHM</span><h3>日内节奏</h3></div>
                  <div className="rs-timeframe" role="group" aria-label="日内图表视图">
                    {timeframes.map((item) => <button key={item} type="button" className={timeframe === item ? "active" : ""} onClick={() => { setTimeframe(item); setHoverIndex(null); }} aria-pressed={timeframe === item}>{item}</button>)}
                  </div>
                </header>
                <div className="rs-signal-toolbar"><button type="button" aria-pressed={signalsVisible} onClick={() => setSignalsVisible(value => !value)}>{signalsVisible ? '隐藏提示点' : '显示提示点'}</button><span>{signalFeed.status}{signalFeed.alerts.length > 0 ? ` · 当前视图 ${displayedSignals.length} 个` : ''}</span></div>
                <div className="rs-chart-metrics"><span><i className="rose" />价格</span><span><i className="gold" />{chartAverageLabel}</span><span><i className="line" />日内高低参考</span><span className="rs-chart-change">{metrics.available ? `日内涨跌 ${formatPercent(metrics.latest?.changePct)}` : "等待分钟数据"}</span></div>
                <figure className="rs-chart-wrap">
                  <div className="rs-chart-axis" aria-hidden="true"><span>{formatPrice(chartModel.max)}</span><span>{formatPrice(chartModel.max !== null && chartModel.min !== null ? (chartModel.max + chartModel.min) / 2 : null)}</span><span>{formatPrice(chartModel.min)}</span></div>
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${stockName} ${timeframe} 日内价格、${averageReferenceName}与区间参考`} onMouseMove={handleChartMove} onMouseLeave={() => setHoverIndex(null)}>
                    <defs><linearGradient id="rabbitStudioFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#ce6882" stopOpacity=".2" /><stop offset="1" stopColor="#ce6882" stopOpacity="0" /></linearGradient></defs>
                    {[17, 40, 63, 86].map((y) => <line key={y} x1="4" x2="96" y1={y} y2={y} className="rs-gridline" />)}
                    {positive(dayHigh) && chartModel.y && <><line x1="4" x2="96" y1={chartModel.y(dayHigh)} y2={chartModel.y(dayHigh)} className="rs-reference high" /><text x="95" y={chartModel.y(dayHigh) - 1} textAnchor="end" className="rs-reference-label">高 {formatPrice(dayHigh)}</text></>}
                    {positive(dayLow) && chartModel.y && <><line x1="4" x2="96" y1={chartModel.y(dayLow)} y2={chartModel.y(dayLow)} className="rs-reference low" /><text x="95" y={chartModel.y(dayLow) - 1} textAnchor="end" className="rs-reference-label">低 {formatPrice(dayLow)}</text></>}
                    {positive(recentSupport) && chartModel.y && <line x1="4" x2="96" y1={chartModel.y(recentSupport)} y2={chartModel.y(recentSupport)} className="rs-reference support" />}
                    {positive(recentResistance) && chartModel.y && <line x1="4" x2="96" y1={chartModel.y(recentResistance)} y2={chartModel.y(recentResistance)} className="rs-reference resistance" />}
                    {filledPath && <path d={filledPath} fill="url(#rabbitStudioFill)" />}
                    {chartPath && <polyline points={chartPath} className="rs-price-line" />}
                    {vwapPath && <polyline points={vwapPath} className="rs-vwap-line" />}
                    {hoverPoint && <><line x1={hoverPoint[0]} x2={hoverPoint[0]} y1="8" y2="92" className="rs-crosshair" /><circle cx={hoverPoint[0]} cy={hoverPoint[1]} r="2.2" className="rs-hover-point" /></>}
                  </svg>
                  {signalsVisible && displayedSignals.map(point => {
                    const index = visibleRows.findIndex(row => row.time.replace(':', '') >= point.time);
                    const x = chartModel.points[Math.max(0, index)]?.[0];
                    if (x === undefined || !chartModel.y) return null;
                    return <button key={point.id} type="button" className={`rs-signal-dot ${point.side} ${point.level}`} style={{ left: `${x}%`, top: `calc((100% - 23px) * ${chartModel.y(point.price) / 100})` }} onClick={() => setSelectedSignal(point.id)} aria-label={`${formatTime(point.time)} ${point.label}${point.score === null ? '' : ` ${point.score}分`}，查看依据`} title={`${point.label} · ${formatTime(point.time)}`}>{point.side === 'buy' ? 'B' : 'S'}</button>;
                  })}
                  {!chartModel.rows.length && <div className="rs-chart-empty">{loading ? "正在准备分钟数据…" : "暂无可用分钟数据"}<small>轻量模式不会用演示曲线替代真实行情</small></div>}
                  {hoverRow && hoverPoint && <div className="rs-chart-tooltip" style={{ left: `${hoverTooltipLeft}%` }}><b>{formatTime(hoverRow.time)}</b><span>价格 ¥{formatPrice(hoverRow.price)}</span><span>{hasWeightedVwap ? "VWAP" : "逐行均价"} ¥{formatPrice(hoverRow.vwap)}</span><span>成交量 {finite(hoverRow.volume) ? hoverRow.volume.toLocaleString("zh-CN") : "--"}</span></div>}
                  <figcaption>{chartModel.labels.map((item) => <span key={`${item.label}-${item.index}`}>{item.label}</span>)}</figcaption>
                </figure>
                {signalsVisible && <div className="rs-signal-list">{displayedSignals.length ? displayedSignals.map(point => <button type="button" key={point.id} className={point.side} aria-pressed={activeSignal?.id === point.id} onClick={() => setSelectedSignal(point.id)}>{formatTime(point.time)} {point.label}{point.score === null ? '' : ` ${point.score}分`}</button>) : <span>{signalFeed.status === '已同步账户最近信号' ? '当前时段暂无已记录的候买、候卖或正式信号' : signalFeed.status}</span>}</div>}
                {signalsVisible && activeSignal && <section className="rs-signal-detail"><b>{activeSignal.label} · {formatTime(activeSignal.time)} · ¥{formatPrice(activeSignal.price)}{activeSignal.score === null ? '' : ` · ${activeSignal.score}分`}</b><p>{activeSignal.reason}</p><small>评分表示条件符合程度。订单流、MACD 依据仅在原信号提供时展示。</small><button type="button" onClick={() => setSelectedSignal(null)}>收起依据</button></section>}
                <footer className="rs-chart-footer"><span>只描述已发生的价格节奏，不自动生成买卖结论。</span><Link href={professionalHref}>展开专业图表 <b>→</b></Link></footer>
              </article>

              <section className="rs-rhythm-card rs-card" aria-label="当前做T节奏">
                <div><span className="rs-eyebrow">当前节奏</span><h3>{loading ? "正在同步，先不急着判断" : rhythmLabel}</h3><p>{loading ? "等行情完整到达后，再看位置与均价关系。" : `${rhythmExplanation}${finite(daySpread) && positive(stockPrice) && dayHigh && dayLow ? ` 距日低 ¥${formatPrice(stockPrice - dayLow)}，距日高 ¥${formatPrice(dayHigh - stockPrice)}。` : ""}`}</p></div>
                <span className="rs-rhythm-badge">观察中</span>
              </section>

              <section className="rs-journal-card rs-card" id="journal">
                <div><span className="rs-eyebrow">LIGHT JOURNAL</span><h3>收盘前，记录一下你的感受</h3><p>记录保存在这台设备，仅用于轻量复盘，尚未同步专业交易日志。</p>{journalSaved && <small className="rs-journal-saved" role="status">✓ 已保存到本机 · {journal}</small>}</div>
                <div className="rs-journal-actions" role="group" aria-label="记录今日交易感受">
                  {["我等到了", "我有点着急", "继续观察"].map((item) => <button key={item} type="button" className={journal === item ? "selected" : ""} onClick={() => saveJournal(item)}>{journal === item ? "✓ " : ""}{item}</button>)}
                  <Link className="rs-journal-link" href={professionalHref}>查看专业复盘 →</Link>
                </div>
              </section>
            </div>

            <aside className="rs-assistant-rail" aria-label="今日做T助手">
              <section className="rs-focus-card rs-card">
                <header><div><span className="rs-eyebrow">ONE CLEAR THING</span><h3>先看位置，再决定动作</h3></div><span className="rs-safety-pill">稳健</span></header>
                <p>{isAvailable ? `现价位于${currentPosition}，${vwapValue ? `距 ${averageReferenceName} ${formatPercent(vwapDeviation)}` : "均价待同步"}。` : "行情尚未完整到达，轻量模式暂不替你判断。"}</p>
                <div className="rs-focus-steps"><span><i>1</i> 看方向</span><span><i>2</i> 等位置</span><span><i>3</i> 再决定</span></div>
                <Link className="rs-primary-action" href={professionalHref}>进入专业操盘台 <b>→</b></Link>
                <small>图表同步账户信号，完整订单流与执行操作可在专业模式查看。</small>
              </section>

              <section className="rs-data-card rs-card">
                <header><div><span className="rs-eyebrow">DATA CARE</span><h3>数据状态</h3></div><span className={isAvailable ? "ready" : "waiting"}>{isAvailable ? "行情" : "待同步"}</span></header>
                <div className="rs-data-lines"><p><span>行情</span><b>{isAvailable ? (market?.delayed ? "已连接 · 延迟" : "已连接") : loading ? "更新中" : "暂不可用"}</b></p><p><span>分时</span><b>{minuteRows.length ? `${minuteRows.length} 根` : "待同步"}</b></p><p><span>均价</span><b>{vwapValue ? (hasWeightedVwap ? "成交量加权 · VWAP" : "价格平均参考 · 非VWAP") : "待同步"}</b></p><p><span>正式信号</span><b>专业模式独立判断</b></p></div>
                <small>{market?.provider ? `行情源：${market.provider}` : "轻量模式不模拟、不放大数据。"} {market?.quality?.label ? `· ${market.quality.label}` : ""}</small>
              </section>

              <details className="rs-companion-details">
                <summary><span><span className="rs-eyebrow">YOUR QUIET GUIDE</span><b>兔兔陪你把心放稳</b></span><span className="rs-detail-arrow">⌄</span></summary>
                <div className="rs-companion-body"><Image src="/rabbit-daylight-pair.webp" alt="两只兔兔" width={104} height={104} loading="lazy" /><p>交易不是考试。慢一点，也是在靠近更好的自己。</p><ul><li>确认今天的方向</li><li>等一个舒服的位置</li><li>只在正式信号出现后决策</li></ul></div>
              </details>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
