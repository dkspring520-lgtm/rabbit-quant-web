"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";

type AnyRecord = Record<string, unknown>;
type PricePoint = { time: string; price: number; vwap?: number | null; volume?: number | null; live?: boolean; timestamp?: number };
type LiveTick = { time: string; price: number; timestamp: number };
type SignalAlert = {
  id: string;
  code?: string;
  marketTime?: string;
  createdAt?: string;
  price?: number | null;
  title?: string;
  message?: string;
  source?: string;
  direction?: string;
  side?: string;
  level?: string;
};
type ConnectionState = "connecting" | "live" | "stale" | "offline" | "auth";
type CrossMarketKey = "gold" | "silver" | "copper";
type CrossMarketQuote = {
  key: CrossMarketKey;
  label: string;
  symbol: string;
  price: number | null;
  change: number | null;
  source: string;
  updatedAt: string;
  state: "live" | "stale" | "partial" | "missing";
};

const DEFAULT_CODE = "601899";
const POLL_MS = 1_000;
const ALERT_POLL_MS = 5_000;
const MARKET_CONTEXT_POLL_MS = 10_000;

function record(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const result = text(value);
    if (result) return result;
  }
  return "";
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const result = number(value);
    if (result !== null) return result;
  }
  return null;
}

function path(root: unknown, ...keys: string[]): unknown {
  let current: unknown = root;
  for (const key of keys) current = record(current)[key];
  return current;
}

function formatPrice(value: number | null, digits = 2): string {
  return value === null ? "—" : value.toFixed(digits);
}

function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function clockLabel(value: unknown): string {
  const raw = text(value);
  if (!raw) return "—";
  const match = raw.match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) return `${match[1]}:${match[2]}${match[3] ? `:${match[3]}` : ""}`;
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 6) return `${digits.slice(-6, -4)}:${digits.slice(-4, -2)}:${digits.slice(-2)}`;
  if (digits.length === 4) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  return raw.slice(-8);
}

function timeValue(value: unknown): number | null {
  const label = clockLabel(value);
  const match = label.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function dateLabel(value: unknown): string {
  const raw = text(value);
  if (!raw) return "—";
  const match = raw.match(/(20\d{2})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : raw.slice(0, 10);
}

function sourceAgeSeconds(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  if (Number.isFinite(timestamp)) return Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  const sourceClock = timeValue(raw);
  if (sourceClock === null) return null;
  const now = new Date();
  const currentClock = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  return Math.max(0, currentClock - sourceClock);
}

function readContextRows(market: AnyRecord, desk: AnyRecord, marketContext: AnyRecord = {}): AnyRecord[] {
  return [
    ...array(marketContext.items),
    ...array(path(desk, "context", "items")),
    ...array(path(desk, "marketContext", "items")),
    ...array(path(desk, "crossMarket", "items")),
    ...array(path(desk, "futures")),
    ...array(path(market, "context", "items")),
  ].map(record);
}

function commodityKey(value: unknown): CrossMarketKey | null {
  const normalized = text(value).toLowerCase();
  if (/黄金|沪金|comex.?gold|\bgold\b|\bgc(?:\d|\b)|\bau(?:\d|\b)/i.test(normalized)) return "gold";
  if (/白银|沪银|comex.?silver|\bsilver\b|\bsi(?:\d|\b)|\bag(?:\d|\b)/i.test(normalized)) return "silver";
  if (/沪铜|伦铜|lme.?铜|comex.?copper|\bcopper\b|\bhg(?:\d|\b)|\bcu(?:\d|\b)/i.test(normalized)) return "copper";
  return null;
}

function readCrossMarkets(market: AnyRecord, desk: AnyRecord, marketContext: AnyRecord, fallbackTime: string): CrossMarketQuote[] {
  const definitions: Array<{ key: CrossMarketKey; label: string; symbol: string; aliases: string[] }> = [
    { key: "gold", label: "黄金", symbol: "AU / GC", aliases: ["gold", "au", "gc"] },
    { key: "silver", label: "白银", symbol: "AG / SI", aliases: ["silver", "ag", "si"] },
    { key: "copper", label: "铜", symbol: "CU / HG", aliases: ["copper", "cu", "hg"] },
  ];
  const rows = readContextRows(market, desk, marketContext);
  const objectRoots = [marketContext, record(path(desk, "context")), record(path(desk, "crossMarket")), record(path(desk, "futures")), record(path(market, "context"))];

  return definitions.map(definition => {
    const matched = rows
      .filter(row => commodityKey(firstText(row.label, row.name, row.symbol, row.code, row.id)) === definition.key)
      .sort((a, b) => {
        const score = (row: AnyRecord) => {
          const identity = firstText(row.label, row.name, row.symbol, row.code, row.id).toLowerCase();
          return (/etf/.test(identity) ? -10 : 0) + (/连续|comex|lme|nf_|hf_/.test(identity) ? 8 : 0) + (text(row.group) === "related" ? 2 : 0);
        };
        return score(b) - score(a);
      })[0];
    const keyed = objectRoots.flatMap(root => definition.aliases.map(alias => record(root[alias]))).find(row => Object.keys(row).length > 0);
    const row = matched || keyed || {};
    const price = firstNumber(row.price, row.last, row.close, row.value, path(row, "quote", "price"));
    const change = firstNumber(row.changePercent, row.change_pct, row.pct, row.change, path(row, "quote", "changePercent"));
    const updatedAt = firstText(row.sourceTimestamp, row.updatedAt, row.fetchedAt, row.time, fallbackTime);
    const age = sourceAgeSeconds(updatedAt);
    const hasData = price !== null || change !== null;
    const state: CrossMarketQuote["state"] = !hasData
      ? "missing"
      : age !== null && age > 180
        ? "stale"
        : price === null || change === null
          ? "partial"
          : "live";
    return {
      key: definition.key,
      label: definition.label,
      symbol: firstText(row.symbol, row.code, row.id) || definition.symbol,
      price,
      change,
      source: firstText(row.provider, row.source, row.exchange) || (hasData ? "主站行情" : "等待行情源"),
      updatedAt,
      state,
    };
  });
}

function directionFromData(market: AnyRecord, desk: AnyRecord): { label: string; tone: "up" | "down" | "flat"; confidence: number | null; note: string } {
  const explicit = firstText(
    path(desk, "direction", "label"),
    path(desk, "decision", "direction"),
    path(desk, "market", "direction"),
    path(desk, "context", "gate", "label"),
  );
  const score = firstNumber(
    path(desk, "direction", "confidence"),
    path(desk, "decision", "confidence"),
    path(desk, "context", "gate", "score"),
  );
  const normalizedScore = score !== null && score <= 1 ? score * 100 : score;
  const change = firstNumber(path(market, "quote", "changePercent"), path(market, "quote", "change_pct"));
  if (/弱|空|跌|下行|利空/.test(explicit) || (explicit === "" && change !== null && change < -0.35)) {
    return { label: "偏弱", tone: "down", confidence: normalizedScore, note: "反弹优先观察，不追高" };
  }
  if (/强|多|涨|上行|利好/.test(explicit) || (explicit === "" && change !== null && change > 0.35)) {
    return { label: "偏强", tone: "up", confidence: normalizedScore, note: "回踩确认后再考虑正T" };
  }
  return { label: "震荡", tone: "flat", confidence: normalizedScore, note: "等待方向和盘口同时确认" };
}

function modeFromAlerts(alerts: SignalAlert[], desk: AnyRecord): string {
  const source = alerts.slice(0, 8).map(item => `${item.title || ""} ${item.message || ""} ${item.direction || ""}`).join(" ");
  const explicit = firstText(path(desk, "strategy", "mode"), path(desk, "decision", "mode"), path(desk, "mode"));
  const value = `${explicit} ${source}`;
  if (/反T/.test(value)) return "反T优先";
  if (/正T/.test(value)) return "正T优先";
  return "观望";
}

function alertClass(alert: SignalAlert): "formal" | "v29" | "v1" | "other" {
  const value = `${alert.source || ""} ${alert.title || ""} ${alert.message || ""}`.toLowerCase();
  if (/v2[.]?9|v29|影子/.test(value)) return "v29";
  if (/v1|重建|菱形/.test(value)) return "v1";
  if (/formal|正式|闭环|信号/.test(value) || alert.level === "signal") return "formal";
  return "other";
}

function alertLabel(alert: SignalAlert): string {
  const kind = alertClass(alert);
  if (kind === "formal") return "正式";
  if (kind === "v29") return "V2.9";
  if (kind === "v1") return "V1";
  return "观察";
}

function readMarketPoints(market: AnyRecord): PricePoint[] {
  const source = array(market.minutes).length ? array(market.minutes) : array(market.bars);
  const points: PricePoint[] = source.flatMap(item => {
    const row = record(item);
    const price = firstNumber(row.price, row.close, row.last);
    if (price === null) return [];
    return [{
      time: clockLabel(firstText(row.time, row.datetime, row.timestamp)),
      price,
      vwap: firstNumber(row.vwap, row.averagePrice, row.avgPrice, row.avg),
      volume: firstNumber(row.volume, row.vol),
      timestamp: number(row.timestamp) ?? undefined,
    }];
  });
  return points.filter(item => item.time !== "—").slice(-240);
}

function extractL2(source: AnyRecord, fallback: AnyRecord): { pressure: number | null; ofi: number | null; activeBuy: number | null; activeSell: number | null; spread: number | null; status: string } {
  const roots = [source, path(source, "orderflow"), path(source, "l2"), path(source, "orderBook"), fallback, path(fallback, "orderflow")];
  const find = (...keys: string[]) => firstNumber(...roots.flatMap(root => keys.map(key => record(root)[key])));
  const pressure = find("buyPressure", "buy_pressure", "imbalance", "obi", "pressure");
  const ofi = find("ofi", "orderFlowImbalance", "order_flow_imbalance");
  const activeBuy = find("activeBuy", "active_buy", "主动买入", "buyAmount");
  const activeSell = find("activeSell", "active_sell", "主动卖出", "sellAmount");
  const spread = find("spread", "价差");
  const state = firstText(...roots.map(root => path(root, "status")), ...roots.map(root => path(root, "availability")));
  return { pressure, ofi, activeBuy, activeSell, spread, status: state || (pressure !== null || ofi !== null ? "在线" : "暂无L2") };
}

function mergeAlerts(previous: SignalAlert[], incoming: SignalAlert[]): SignalAlert[] {
  const map = new Map<string, SignalAlert>();
  for (const item of [...previous, ...incoming]) map.set(String(item.id), item);
  return [...map.values()].sort((a, b) => {
    const at = Date.parse(a.createdAt || "") || timeValue(a.marketTime) || 0;
    const bt = Date.parse(b.createdAt || "") || timeValue(b.marketTime) || 0;
    return bt - at;
  }).slice(0, 120);
}

async function getJson(url: string, signal: AbortSignal): Promise<AnyRecord> {
  const response = await fetch(url, { credentials: "include", cache: "no-store", signal });
  if (!response.ok) {
    const error = new Error(response.status === 401 ? "AUTH_REQUIRED" : `HTTP_${response.status}`);
    throw error;
  }
  const payload: unknown = await response.json();
  return record(payload);
}

export default function RealtimeLabPage() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [codeInput, setCodeInput] = useState(DEFAULT_CODE);
  const [market, setMarket] = useState<AnyRecord>({});
  const [desk, setDesk] = useState<AnyRecord>({});
  const [l2, setL2] = useState<AnyRecord>({});
  const [marketContext, setMarketContext] = useState<AnyRecord>({});
  const [alerts, setAlerts] = useState<SignalAlert[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [errorMessage, setErrorMessage] = useState("");
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [sourceTimestamp, setSourceTimestamp] = useState<string>("");
  const [liveTicks, setLiveTicks] = useState<LiveTick[]>([]);
  const alertCursor = useRef(0);
  const marketInFlight = useRef(false);

  useEffect(() => {
    try {
      const stored = new URLSearchParams(window.location.search).get("code");
      if (stored && /^\d{6}$/.test(stored)) {
        setCode(stored);
        setCodeInput(stored);
      }
    } catch {}
  }, []);

  useEffect(() => {
    setMarket({});
    setDesk({});
    setL2({});
    setMarketContext({});
    setLiveTicks([]);
    setAlerts([]);
    alertCursor.current = 0;
    try {
      const saved = localStorage.getItem(`rabbit-realtime-lab-alerts:${code}`);
      if (saved) setAlerts(JSON.parse(saved) as SignalAlert[]);
    } catch {}
  }, [code]);

  const pullMarket = useCallback(async () => {
    if (marketInFlight.current) return;
    marketInFlight.current = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2_200);
    try {
      const query = encodeURIComponent(code);
      const [marketResult, deskResult, l2Result] = await Promise.allSettled([
        getJson(`/api/market-data?code=${query}`, controller.signal),
        getJson(`/api/trading-desk-snapshot?code=${query}`, controller.signal),
        getJson(`/api/research/zijin-l2-orderflow?code=${query}`, controller.signal),
      ]);
      const primaryUnavailable = marketResult.status === "rejected" && deskResult.status === "rejected";
      if (primaryUnavailable) {
        const authRequired = [marketResult, deskResult].some(result => result.status === "rejected" && result.reason instanceof Error && result.reason.message === "AUTH_REQUIRED");
        setConnection(authRequired ? "auth" : "stale");
        setErrorMessage(authRequired ? "请先登录主站" : "行情接口暂时不可用，保留最后一次数据");
        return;
      }
      const nextMarket = marketResult.status === "fulfilled"
        ? marketResult.value
        : deskResult.status === "fulfilled" ? record(deskResult.value.market) : {};
      const nextDesk = deskResult.status === "fulfilled" ? deskResult.value : {};
      if (Object.keys(nextMarket).length) setMarket(nextMarket);
      if (Object.keys(nextDesk).length) setDesk(nextDesk);
      if (l2Result.status === "fulfilled") setL2(l2Result.value);
      const quote = record(nextMarket.quote);
      const price = firstNumber(quote.price, quote.last);
      if (price !== null) {
        const now = Date.now();
        const tick: LiveTick = { timestamp: now, price, time: new Date(now).toLocaleTimeString("en-GB", { hour12: false }) };
        setLiveTicks(current => [...current, tick].slice(-180));
      }
      const source = firstText(nextMarket.sourceTimestamp, nextMarket.fetchedAt, nextDesk.fetchedAt);
      setSourceTimestamp(source);
      setLastUpdate(Date.now());
      setConnection("live");
      setErrorMessage("");
    } catch (error) {
      const message = error instanceof Error && error.message === "AUTH_REQUIRED" ? "请先登录主站" : "实时连接异常，正在重试";
      setConnection(message === "请先登录主站" ? "auth" : "stale");
      setErrorMessage(message);
    } finally {
      window.clearTimeout(timeout);
      marketInFlight.current = false;
    }
  }, [code]);

  useEffect(() => {
    void pullMarket();
    const timer = window.setInterval(() => void pullMarket(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [pullMarket]);

  useEffect(() => {
    let cancelled = false;
    const pullContext = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 3_500);
      try {
        const payload = await getJson(`/api/market-context?code=${encodeURIComponent(code)}`, controller.signal);
        if (!cancelled) setMarketContext(payload);
      } catch {
        // Keep the latest cross-market snapshot; every card exposes its own freshness state.
      } finally {
        window.clearTimeout(timeout);
      }
    };
    void pullContext();
    const timer = window.setInterval(() => void pullContext(), MARKET_CONTEXT_POLL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    const pullAlerts = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 2_500);
      try {
        const payload = await getJson(`/api/control/alerts?afterId=${alertCursor.current}&limit=100`, controller.signal);
        if (cancelled) return;
        const incoming = array(payload.alerts).map(item => {
          const row = record(item);
          return {
            id: text(row.id) || `${text(row.createdAt)}-${text(row.marketTime)}-${text(row.title)}`,
            code: firstText(row.code, row.stockCode),
            marketTime: firstText(row.marketTime, row.time),
            createdAt: text(row.createdAt),
            price: firstNumber(row.price, path(row, "action", "price")),
            title: firstText(row.title, path(row, "action", "side")),
            message: firstText(row.message, row.reason, path(row, "action", "reason")),
            source: firstText(row.source, path(row, "action", "source")),
            direction: firstText(row.direction, path(row, "action", "direction")),
            side: firstText(row.side, path(row, "action", "side")),
            level: firstText(row.level, row.type),
          } satisfies SignalAlert;
        }).filter(item => !item.code || item.code === code);
        if (incoming.length) {
          const newest = incoming.reduce((max, item) => Math.max(max, Number(item.id) || 0), alertCursor.current);
          alertCursor.current = newest;
          setAlerts(current => {
            const merged = mergeAlerts(current, incoming);
            try { localStorage.setItem(`rabbit-realtime-lab-alerts:${code}`, JSON.stringify(merged)); } catch {}
            return merged;
          });
        }
      } catch {
        // The panel remains useful without the optional alert history endpoint.
      } finally {
        window.clearTimeout(timeout);
      }
    };
    void pullAlerts();
    const timer = window.setInterval(() => void pullAlerts(), ALERT_POLL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [code]);

  const quote = useMemo(() => record(market.quote), [market]);
  const points = useMemo(() => {
    const historical = readMarketPoints(market);
    const ticks = liveTicks.map(item => ({ time: item.time, price: item.price, live: true, timestamp: item.timestamp }));
    return [...historical, ...ticks].slice(-300);
  }, [market, liveTicks]);
  const direction = useMemo(() => directionFromData(market, desk), [market, desk]);
  const mode = useMemo(() => modeFromAlerts(alerts, desk), [alerts, desk]);
  const l2Metrics = useMemo(() => extractL2(l2, desk), [l2, desk]);
  const currentPrice = firstNumber(quote.price, quote.last);
  const previousClose = firstNumber(quote.previousClose, quote.prevClose);
  const changePercent = firstNumber(quote.changePercent, quote.change_pct);
  const vwap = firstNumber(path(market, "quote", "vwap"), path(market, "vwap"), [...points].reverse().find(item => item.vwap !== null && item.vwap !== undefined)?.vwap);
  const sourceDelay = sourceAgeSeconds(sourceTimestamp);
  const stockName = firstText(quote.name, market.name, code === "601899" ? "紫金矿业" : "监控标的");
  const today = dateLabel(firstText(market.sampleDate, market.date, sourceTimestamp));
  const contextRows = useMemo(() => readContextRows(market, desk, marketContext), [market, desk, marketContext]);
  const crossMarkets = useMemo(() => readCrossMarkets(market, desk, marketContext, sourceTimestamp), [desk, market, marketContext, sourceTimestamp]);
  const otherContextRows = useMemo(() => contextRows.filter(row => commodityKey(firstText(row.label, row.name, row.symbol, row.code, row.id)) === null), [contextRows]);
  const commoditySummary = useMemo(() => {
    const gate = record(marketContext.gate);
    const gateLabel = firstText(gate.label);
    if (gateLabel) {
      const gateTone = /风险|偏弱|暂停|限制/.test(`${gateLabel} ${firstText(gate.action)}`) ? "down" : /偏强|积极|顺风/.test(gateLabel) ? "up" : "flat";
      return { label: gateLabel, tone: gateTone, detail: firstText(gate.action) || "仅作紫金方向辅助" };
    }
    const changes = crossMarkets.map(item => item.change).filter((value): value is number => value !== null);
    if (changes.length < 2) return { label: "联动证据不足", tone: "flat", detail: "至少需要两类金属行情" };
    const average = changes.reduce((sum, value) => sum + value, 0) / changes.length;
    if (average > 0.25) return { label: "金属共振偏强", tone: "up", detail: "仅作紫金方向辅助" };
    if (average < -0.25) return { label: "金属共振偏弱", tone: "down", detail: "仅作紫金方向辅助" };
    return { label: "金属表现分化", tone: "flat", detail: "暂不提供方向加分" };
  }, [crossMarkets, marketContext]);

  const chart = useMemo(() => {
    if (!points.length) return null;
    const width = 920;
    const height = 330;
    const padX = 34;
    const padY = 24;
    const values = points.map(item => item.price);
    const vwapValue = vwap ?? null;
    const allValues = vwapValue === null ? values : [...values, vwapValue];
    const low = Math.min(...allValues);
    const high = Math.max(...allValues);
    const range = Math.max(high - low, Math.max(high * 0.001, 0.01));
    const x = (index: number) => padX + (index / Math.max(points.length - 1, 1)) * (width - padX * 2);
    const y = (value: number) => height - padY - ((value - low) / range) * (height - padY * 2);
    const firstLiveIndex = points.findIndex(item => item.live);
    const historicalEnd = firstLiveIndex < 0 ? points.length : firstLiveIndex;
    const historyPolyline = points.slice(0, historicalEnd).map((item, index) => `${x(index).toFixed(1)},${y(item.price).toFixed(1)}`).join(" ");
    const liveStart = firstLiveIndex > 0 ? firstLiveIndex - 1 : Math.max(firstLiveIndex, 0);
    const livePolyline = firstLiveIndex < 0 ? "" : points.slice(liveStart).map((item, offset) => `${x(liveStart + offset).toFixed(1)},${y(item.price).toFixed(1)}`).join(" ");
    const vwapY = vwapValue === null ? null : y(vwapValue);
    const markerRows = alerts.slice(0, 12).map(alert => {
      const targetTime = timeValue(alert.marketTime || alert.createdAt);
      let index = points.length - 1;
      if (targetTime !== null) {
        let bestDistance = Number.POSITIVE_INFINITY;
        points.forEach((point, pointIndex) => {
          const pointTime = timeValue(point.time);
          if (pointTime === null) return;
          const distance = Math.abs(pointTime - targetTime);
          if (distance < bestDistance) { bestDistance = distance; index = pointIndex; }
        });
      }
      const markerPrice = number(alert.price) ?? points[index]?.price ?? currentPrice ?? low;
      return { alert, index, cx: x(index), cy: y(markerPrice), kind: alertClass(alert) };
    });
    return { width, height, padY, x, y, low, high, historyPolyline, livePolyline, vwapY, markerRows };
  }, [alerts, currentPrice, points, vwap]);

  const applyCode = () => {
    const next = codeInput.trim();
    if (/^\d{6}$/.test(next)) {
      setCode(next);
      window.history.replaceState(null, "", `/realtime-lab?code=${next}`);
    }
  };

  const latencyLabel = connection === "live" ? (sourceDelay === null ? "已连接" : `${sourceDelay}s`) : connection === "auth" ? "需登录" : "重试中";

  return (
    <main className="realtime-lab">
      <header className="realtime-header">
        <div>
          <span className="eyebrow">DOUBLE RABBIT · MARKET INTELLIGENCE</span>
          <h1>专业实时观察台</h1>
          <p>行情、订单流与跨市场联动 · 只读观察，不提交订单</p>
        </div>
        <div className="header-actions">
          <div className="terminal-badges"><span>股票 · 1S</span><span>期货 · 10S</span><span>READ ONLY</span></div>
          <div className="symbol-picker">
            <label htmlFor="realtime-code">监控标的</label>
            <div>
              <input id="realtime-code" value={codeInput} inputMode="numeric" maxLength={6} onChange={event => setCodeInput(event.target.value.replace(/\D/g, ""))} onKeyDown={event => { if (event.key === "Enter") applyCode(); }} />
              <button type="button" onClick={applyCode}>切换</button>
            </div>
          </div>
        </div>
      </header>

      <section className={`decision-card ${direction.tone}`} aria-label="当前决策摘要">
        <div className="decision-main">
          <div className="instrument"><strong>{stockName}</strong><span>{code} · {today}</span></div>
          <div className="decision-row"><b>{direction.label}</b><span>{mode}</span><small>{direction.confidence === null ? "把握度待补" : `${Math.round(direction.confidence)}% 把握度`}</small></div>
          <p>{direction.note}</p>
        </div>
        <div className="decision-quote"><small>最新价</small><strong>{formatPrice(currentPrice)}</strong><span className={changePercent !== null && changePercent >= 0 ? "positive" : "negative"}>{formatPercent(changePercent)}</span></div>
        <div className="health-pill"><i className={connection === "live" ? "ok" : "bad"} />{connection === "live" ? "实时" : connection === "auth" ? "需登录" : "连接异常"}<small>{latencyLabel}</small></div>
      </section>

      {errorMessage && <div className="notice" role="status"><span>ⓘ</span>{errorMessage}</div>}

      <section className="panel market-radar" aria-label="金银铜跨市场监控">
        <header className="panel-header radar-header">
          <div><span className="panel-kicker">CROSS-MARKET RADAR</span><h2>金银铜联动</h2></div>
          <div className={`radar-verdict ${commoditySummary.tone}`}><i /><span><strong>{commoditySummary.label}</strong><small>{commoditySummary.detail}</small></span></div>
        </header>
        <div className="futures-grid">
          {crossMarkets.map(item => {
            const tone = item.change === null ? "flat" : item.change >= 0 ? "up" : "down";
            const width = item.change === null ? 0 : Math.min(100, Math.max(8, Math.abs(item.change) * 28));
            return <article className={`future-card ${tone}`} key={item.key}>
              <div className="future-card-head"><span><b>{item.label}</b><small>{item.symbol}</small></span><em className={`feed-state ${item.state}`}>{item.state === "live" ? "实时" : item.state === "stale" ? "最近行情" : item.state === "partial" ? "部分数据" : "未接入"}</em></div>
              <div className="future-quote"><strong>{formatPrice(item.price, item.price !== null && item.price < 10 ? 3 : 2)}</strong><b className={tone === "up" ? "positive" : tone === "down" ? "negative" : ""}>{formatPercent(item.change)}</b></div>
              <div className="future-move"><i style={{ width: `${width}%` }} /></div>
              <footer><span>{item.source}</span><time>{item.updatedAt ? clockLabel(item.updatedAt) : "等待数据"}</time></footer>
            </article>;
          })}
        </div>
        <p className="radar-note">跨市场行情仅用于解释商品共振与预期差，不会单独触发正T或反T。</p>
      </section>

      <section className="lab-grid">
        <article className="panel chart-panel">
          <header className="panel-header"><div><span className="panel-kicker">PRICE STRUCTURE</span><h2>价格结构</h2></div><div className="legend"><span><i className="legend-price" />价格</span><span><i className="legend-vwap" />VWAP</span><span><i className="legend-live" />实时观察线</span></div></header>
          {chart ? <div className="chart-wrap"><svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`${stockName}日内价格图`} preserveAspectRatio="none">
            <line className="grid-line" x1="34" x2="886" y1={chart.padY} y2={chart.padY} />
            <line className="grid-line" x1="34" x2="886" y1={chart.height / 2} y2={chart.height / 2} />
            <line className="grid-line" x1="34" x2="886" y1={chart.height - chart.padY} y2={chart.height - chart.padY} />
            {chart.vwapY !== null && <line className="vwap-line" x1="34" x2="886" y1={chart.vwapY} y2={chart.vwapY} />}
            {chart.historyPolyline && <polyline className="price-polyline" points={chart.historyPolyline} />}
            {chart.livePolyline && <polyline className="live-polyline" points={chart.livePolyline} />}
            {chart.markerRows.map(marker => <g key={marker.alert.id} className={`chart-marker ${marker.kind}`} transform={`translate(${marker.cx},${marker.cy})`}>{marker.kind === "v1" ? <rect x="-5" y="-5" width="10" height="10" transform="rotate(45)" /> : <circle r="7" />}<text y="-12" textAnchor="middle">{alertLabel(marker.alert)}</text></g>)}
          </svg><div className="chart-axis"><span>{points[0]?.time || "—"}</span><span>{points[Math.floor(points.length / 2)]?.time || "—"}</span><span>{points.at(-1)?.time || "—"}</span></div></div> : <div className="empty-state">等待行情数据…</div>}
          <div className="price-stats"><div><span>VWAP</span><b>{formatPrice(vwap)}</b></div><div><span>今开</span><b>{formatPrice(firstNumber(quote.open))}</b></div><div><span>日高</span><b>{formatPrice(firstNumber(quote.high))}</b></div><div><span>日低</span><b>{formatPrice(firstNumber(quote.low))}</b></div><div><span>昨收</span><b>{formatPrice(previousClose)}</b></div></div>
        </article>

        <article className="panel flow-panel">
          <header className="panel-header"><div><span className="panel-kicker">ORDER FLOW / L2</span><h2>盘口与资金</h2></div><span className={`mini-status ${l2Metrics.status === "在线" ? "ok" : "muted"}`}>{l2Metrics.status}</span></header>
          <div className="pressure"><div className="pressure-head"><span>买卖压力</span><b>{l2Metrics.pressure === null ? "—" : `${Math.round(l2Metrics.pressure)}%`}</b></div><div className="pressure-track"><i style={{ width: `${Math.max(0, Math.min(100, l2Metrics.pressure ?? 50))}%` }} /></div><div className="pressure-label"><span>卖压</span><span>买压</span></div></div>
          <div className="metric-grid"><div><span>OFI</span><b className={l2Metrics.ofi !== null && l2Metrics.ofi >= 0 ? "positive" : "negative"}>{l2Metrics.ofi === null ? "—" : l2Metrics.ofi.toFixed(2)}</b></div><div><span>主动买入</span><b>{l2Metrics.activeBuy === null ? "—" : l2Metrics.activeBuy.toLocaleString()}</b></div><div><span>主动卖出</span><b>{l2Metrics.activeSell === null ? "—" : l2Metrics.activeSell.toLocaleString()}</b></div><div><span>买卖价差</span><b>{l2Metrics.spread === null ? "—" : l2Metrics.spread.toFixed(3)}</b></div></div>
          <div className="flow-verdict"><i className={direction.tone === "up" ? "up" : direction.tone === "down" ? "down" : "flat"} /><div><strong>{l2Metrics.status === "暂无L2" ? "暂不使用盘口确认" : direction.tone === "up" ? "买盘正在确认" : direction.tone === "down" ? "卖压仍需观察" : "盘口方向不明确"}</strong><small>{l2Metrics.status === "暂无L2" ? "数据恢复后再纳入信号判断" : "只作为辅助证据，不单独触发交易"}</small></div></div>
        </article>

        <article className="panel context-panel">
          <header className="panel-header"><div><span className="panel-kicker">INDEX / SECTOR CONTEXT</span><h2>指数与板块</h2></div><span className="mini-status muted">辅助层</span></header>
          <div className="context-list">{otherContextRows.slice(0, 8).map((row, index) => { const change = firstNumber(row.changePercent, row.change_pct, row.change); return <div key={`${text(row.id)}-${index}`}><span>{firstText(row.label, row.name, row.symbol) || "相关市场"}</span><b className={change !== null && change >= 0 ? "positive" : "negative"}>{formatPercent(change)}</b><small>{firstText(row.sourceTimestamp, row.provider) || "—"}</small></div>; })}</div>
          {!otherContextRows.length && <div className="empty-inline">等待指数与有色板块数据</div>}
        </article>

        <article className="panel risk-panel">
          <header className="panel-header"><div><span className="panel-kicker">RISK / EXECUTION</span><h2>风险与执行</h2></div><span className="mini-status ok">不下单</span></header>
          <div className="risk-list"><div><span>当前持仓</span><b>{firstNumber(path(desk, "position", "shares"), path(desk, "holding", "shares")) === null ? "—" : `${firstNumber(path(desk, "position", "shares"), path(desk, "holding", "shares"))} 股`}</b></div><div><span>可卖数量</span><b>{firstNumber(path(desk, "position", "availableShares"), path(desk, "holding", "availableShares")) === null ? "—" : `${firstNumber(path(desk, "position", "availableShares"), path(desk, "holding", "availableShares"))} 股`}</b></div><div><span>目标/止损</span><b>{firstText(path(desk, "risk", "target"), path(desk, "risk", "stop")) || "由正式策略提供"}</b></div><div><span>日内风险</span><b>{firstText(path(desk, "risk", "status"), path(desk, "riskStatus")) || "待数据"}</b></div></div>
          <p className="risk-note">本面板只展示风险状态，不会提交订单；买入当日的 A 股数量仍受 T+1 规则约束。</p>
        </article>
      </section>

      <section className="panel signal-panel">
        <header className="panel-header"><div><span className="panel-kicker">SIGNAL TIMELINE</span><h2>信号时间轴</h2></div><div className="signal-legend"><span><i className="dot formal" />正式</span><span><i className="dot v29" />V2.9</span><span><i className="dot v1" />V1</span></div></header>
        {alerts.length ? <div className="signal-list">{alerts.slice(0, 16).map(alert => <div className={`signal-row ${alertClass(alert)}`} key={alert.id}><span className="signal-dot" /><time>{clockLabel(alert.marketTime || alert.createdAt)}</time><strong>{alertLabel(alert)}</strong><b>{firstText(alert.title, alert.side) || "观察"}</b><span>{firstText(alert.message, alert.direction) || "条件变化，等待下一次确认"}</span><em>{alert.price === null || alert.price === undefined ? "—" : formatPrice(alert.price)}</em></div>)}</div> : <div className="empty-state signal-empty">暂无正式或影子信号；面板会保留当天已出现的记录。</div>}
      </section>

      <footer className="realtime-footer"><span>行情更新：{lastUpdate ? new Date(lastUpdate).toLocaleTimeString("zh-CN", { hour12: false }) : "等待中"}</span><span>源时间：{sourceTimestamp ? clockLabel(sourceTimestamp) : "—"}</span><span>价格线实时刷新约 1 秒；历史数据仍保持原始分钟粒度</span></footer>
    </main>
  );
}
