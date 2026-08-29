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
type AlertKind = "formal" | "v29" | "v1" | "replay-observation" | "replay-candidate" | "other";
type ChartMode = "minute" | "live" | "replay";
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
type HorizonSummary = {
  minutes: 5 | 15 | 30;
  probability: number | null;
  confidence: number | null;
  direction: string;
};
type ResearchSummary = {
  direction: string;
  confidence: number | null;
  action: string;
  invalidations: string[];
  updatedAt: string;
  horizons: HorizonSummary[];
};
type OutlookTone = "up" | "down" | "flat";
type OpeningOutlook = {
  label: string;
  tone: OutlookTone;
  score: number | null;
  evidenceCount: number;
  evidenceTotal: number;
  reason: string;
};
type MediumStructureSummary = {
  label: string;
  tone: OutlookTone;
  confidence: number | null;
  note: string;
};
type BreakingNoticeTone = "positive" | "negative" | "warning" | "neutral";
type BreakingNotice = {
  id: string;
  title: string;
  source: string;
  time: string;
  level: string;
  tone: BreakingNoticeTone;
  rank: number;
};

const DEFAULT_CODE = "601899";
const POLL_MS = 1_000;
const ALERT_POLL_MS = 5_000;
const MARKET_CONTEXT_POLL_MS = 10_000;
const RESEARCH_POLL_MS = 60_000;
const REPLAY_DATE = "2026-08-28";
const ZIJIN_REPLAY_POINTS: PricePoint[] = [
  ["09:30", 34.5, 34.5], ["09:35", 34.12, 34.0802], ["09:40", 34.01, 34.0745], ["09:45", 34.04, 34.0525],
  ["09:48", 33.91, 34.0366], ["09:50", 33.85, 34.0216], ["09:54", 33.71, 33.9728], ["09:55", 33.72, 33.9647],
  ["10:00", 33.79, 33.9442], ["10:05", 33.85, 33.9334], ["10:10", 33.92, 33.9291], ["10:15", 33.95, 33.9307],
  ["10:20", 34.03, 33.931], ["10:25", 34.19, 33.9477], ["10:30", 34.3, 33.9661], ["10:35", 34.48, 34.0029],
  ["10:39", 34.6, 34.0232], ["10:40", 34.6, 34.0328], ["10:45", 34.4, 34.0511], ["10:50", 34.3, 34.0565],
  ["10:55", 34.37, 34.0634], ["11:00", 34.42, 34.0706], ["11:05", 34.56, 34.0819], ["11:10", 34.44, 34.0906],
  ["11:15", 34.4, 34.0942], ["11:20", 34.48, 34.0988], ["11:25", 34.62, 34.1116], ["11:28", 34.64, 34.1219],
  ["11:30", 34.63, 34.1248], ["13:00", 34.63, 34.1248], ["13:05", 34.39, 34.1336], ["13:08", 34.41, 34.1348],
  ["13:10", 34.45, 34.1357], ["13:15", 34.48, 34.1398], ["13:20", 34.59, 34.1458], ["13:25", 34.55, 34.152],
  ["13:30", 34.6, 34.1569], ["13:33", 34.61, 34.1609], ["13:35", 34.52, 34.162], ["13:40", 34.45, 34.1653],
  ["13:45", 34.43, 34.1672], ["13:46", 34.42, 34.1675], ["13:50", 34.45, 34.169], ["13:55", 34.53, 34.1719],
  ["14:00", 34.5, 34.1746], ["14:05", 34.46, 34.177], ["14:10", 34.48, 34.1795], ["14:15", 34.57, 34.1841],
  ["14:18", 34.62, 34.191], ["14:20", 34.59, 34.1926], ["14:25", 34.58, 34.1976], ["14:30", 34.63, 34.2035],
  ["14:31", 34.64, 34.2052], ["14:35", 34.6, 34.2087], ["14:40", 34.58, 34.2127], ["14:45", 34.55, 34.2172],
  ["14:50", 34.6, 34.2252], ["14:55", 34.62, 34.2359], ["15:00", 34.65, 34.2499],
].map(([time, price, replayVwap]) => ({ time: String(time), price: Number(price), vwap: Number(replayVwap) }));
const ZIJIN_REPLAY_ALERTS: SignalAlert[] = [
  { id: "replay-20260828-0940", code: DEFAULT_CODE, marketTime: "09:40", price: 34.01, title: "候卖", message: "位置不足；趋势冲突；净价差和盈亏比未过线", source: "昨日回放", direction: "反T", side: "sell", level: "replay-observation" },
  { id: "replay-20260828-0948", code: DEFAULT_CODE, marketTime: "09:48", price: 33.91, title: "候卖", message: "位置不足；趋势冲突；没有可覆盖成本的价差", source: "昨日回放", direction: "反T", side: "sell", level: "replay-observation" },
  { id: "replay-20260828-0950", code: DEFAULT_CODE, marketTime: "09:50", price: 33.85, title: "候买", message: "仅达到VWAP偏离线；等待止跌、量能回升和结构转强", source: "昨日回放", direction: "正T", side: "buy", level: "replay-observation" },
  { id: "replay-20260828-1300", code: DEFAULT_CODE, marketTime: "13:00", price: 34.63, title: "候卖", message: "午间首点成交量为零；等待滞涨和微型结构转弱", source: "昨日回放", direction: "反T", side: "sell", level: "replay-observation" },
  { id: "replay-20260828-1308", code: DEFAULT_CODE, marketTime: "13:08", price: 34.41, title: "候卖", message: "方向和触发分不足；上行周期冲突；避免低位追卖", source: "昨日回放", direction: "反T", side: "sell", level: "replay-observation" },
  { id: "replay-20260828-1335", code: DEFAULT_CODE, marketTime: "13:35", price: 34.52, title: "反T候选", message: "三项打分通过，但90分钟价格路径与30分钟VWAP仍同步上行；仅观察", source: "昨日回放", direction: "反T", side: "sell", level: "replay-candidate" },
];

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
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
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
  if (Number.isFinite(timestamp)) return Math.max(0, Math.round((Date.now() - timestamp) / 100) / 10);
  const sourceClock = timeValue(raw);
  if (sourceClock === null) return null;
  const now = new Date();
  const currentClock = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  return Math.max(0, currentClock - sourceClock);
}

function formatSourceAge(seconds: number | null): string {
  if (seconds === null) return "等待源时间";
  if (seconds < 1) return "刚刚";
  if (seconds < 60) return `${Math.round(seconds)}秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}小时${minutes ? `${minutes}分` : ""}前`;
  }
  return `${Math.floor(seconds / 86400)}天前`;
}

function percentValue(value: unknown): number | null {
  const parsed = number(value);
  if (parsed === null) return null;
  const normalized = Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
  return Math.max(0, Math.min(100, normalized));
}

function researchRoots(payload: AnyRecord): AnyRecord[] {
  return [
    payload,
    record(payload.data),
    record(payload.assignment),
    record(payload.report),
    record(payload.result),
    record(path(payload, "data", "assignment")),
    record(path(payload, "data", "report")),
  ].filter(root => Object.keys(root).length > 0);
}

function readHorizonSummary(payload: AnyRecord, minutes: 5 | 15 | 30): HorizonSummary {
  const roots = researchRoots(payload);
  const keys = [`${minutes}m`, `${minutes}min`, `${minutes}分钟`, String(minutes)];
  const containers = roots.flatMap(root => [
    record(root.horizons),
    record(root.forecasts),
    record(root.predictions),
    record(root.probabilities),
    record(path(root, "outlook", "horizons")),
    record(path(root, "intraday", "horizons")),
  ]);
  const directRows = containers.flatMap(container => keys.map(key => container[key]));
  const arrayRows = roots.flatMap(root => [
    ...array(root.horizons),
    ...array(root.forecasts),
    ...array(root.predictions),
    ...array(path(root, "outlook", "horizons")),
  ]).map(record).filter(row => {
    const label = firstText(row.horizon, row.timeframe, row.period, row.label);
    return new RegExp(`(^|\\D)${minutes}(?:\\s*(?:m|min|分钟))?($|\\D)`, "i").test(label);
  });
  const rows = [...directRows.map(record), ...arrayRows].filter(row => Object.keys(row).length > 0);
  const rawProbability = firstNumber(
    ...roots.flatMap(root => keys.map(key => path(root, "probabilities", key))),
    ...rows.flatMap(row => [row.probability, row.upProbability, row.riseProbability, row.directionProbability]),
  );
  const rawConfidence = firstNumber(...rows.flatMap(row => [row.confidence, row.structuralConfidence, row.score]));
  return {
    minutes,
    probability: percentValue(rawProbability),
    confidence: percentValue(rawConfidence),
    direction: firstText(...rows.flatMap(row => [row.direction, row.label, row.outlook])),
  };
}

function readResearchSummary(payload: AnyRecord): ResearchSummary {
  const roots = researchRoots(payload);
  const invalidations = roots.flatMap(root => [
    ...array(root.invalidations),
    ...array(root.invalidationConditions),
    ...array(root.failureConditions),
    ...array(path(root, "decision", "invalidations")),
    root.invalidation,
    root.invalidationCondition,
    path(root, "decision", "invalidation"),
  ]).map(text).filter(Boolean);
  return {
    direction: firstText(...roots.flatMap(root => [root.todayDirection, root.dailyDirection, root.closeDirection, path(root, "direction", "label"), path(root, "outlook", "direction")])),
    confidence: percentValue(firstNumber(...roots.flatMap(root => [root.confidence, root.structuralConfidence, path(root, "direction", "confidence"), path(root, "outlook", "confidence")]))),
    action: firstText(...roots.flatMap(root => [root.currentAction, root.action, root.advice, path(root, "decision", "action"), path(root, "outlook", "action")])),
    invalidations: [...new Set(invalidations)].slice(0, 2),
    updatedAt: firstText(...roots.flatMap(root => [root.asOf, root.updatedAt, root.generatedAt, root.date])),
    horizons: [5, 15, 30].map(minutes => readHorizonSummary(payload, minutes as 5 | 15 | 30)),
  };
}

function noticeValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const row = record(value);
  const nested = [...array(row.items), ...array(row.list), ...array(row.rows), ...array(row.data)];
  if (nested.length) return nested;
  return text(value) || Object.keys(row).length ? [value] : [];
}

function readBreakingNotices(
  researchPayload: AnyRecord,
  marketContext: AnyRecord,
  desk: AnyRecord,
  market: AnyRecord,
  connection: ConnectionState,
  errorMessage: string,
): BreakingNotice[] {
  const roots = [
    ...researchRoots(researchPayload),
    marketContext,
    record(marketContext.data),
    desk,
    record(desk.data),
    record(desk.context),
    record(desk.marketContext),
    market,
    record(market.data),
  ].filter(root => Object.keys(root).length > 0);
  const values = roots.flatMap(root => [
    ...noticeValues(root.announcements),
    ...noticeValues(root.announcement),
    ...noticeValues(root.news),
    ...noticeValues(root.events),
    ...noticeValues(root.event),
    ...noticeValues(root.headlines),
    ...noticeValues(root.warnings),
    ...noticeValues(root.riskAlerts),
    ...noticeValues(path(root, "outlook", "news")),
    ...noticeValues(path(root, "outlook", "events")),
  ]);
  const notices = values.map((value, index): BreakingNotice | null => {
    const row = record(value);
    const title = firstText(row.title, row.headline, row.message, row.summary, row.description, row.content, row.name, value)
      .replace(/\s+/g, " ")
      .slice(0, 160);
    if (!title) return null;
    const directionText = firstText(row.direction, row.sentiment, row.impact, row.tone, row.level, row.severity, title);
    const signal = directionalSignal(directionText);
    const warning = /警告|预警|风险|异常|紧急|重大|warning|critical/i.test(`${directionText} ${title}`);
    const tone: BreakingNoticeTone = signal === -1 ? "negative" : signal === 1 ? "positive" : warning ? "warning" : "neutral";
    const major = /重大|紧急|严重|停牌|处罚|事故|critical|high/i.test(`${firstText(row.level, row.severity, row.type)} ${title}`);
    const level = major ? "重大" : warning ? "警告" : tone === "positive" || tone === "negative" ? "重要" : "关注";
    const rank = major ? 4 : warning ? 3 : tone === "positive" || tone === "negative" ? 2 : 1;
    return {
      id: firstText(row.id, row.newsId, row.eventId) || `${title}-${index}`,
      title,
      source: firstText(row.source, row.provider, row.publisher, row.platform, row.exchange) || "公告监控",
      time: clockLabel(firstText(row.publishedAt, row.publishTime, row.createdAt, row.updatedAt, row.time)),
      level,
      tone,
      rank,
    };
  }).filter((item): item is BreakingNotice => item !== null);

  if (connection !== "live") {
    notices.push({
      id: "realtime-data-warning",
      title: errorMessage || "实时数据链路正在重连，当前判断可能滞后",
      source: "数据链路",
      time: clockLabel(new Date().toISOString()),
      level: "数据警告",
      tone: "warning",
      rank: 5,
    });
  }

  const unique = new Map<string, BreakingNotice>();
  notices.forEach(item => {
    const key = item.title.toLowerCase();
    const previous = unique.get(key);
    if (!previous || item.rank > previous.rank) unique.set(key, item);
  });
  const result = [...unique.values()].sort((a, b) => b.rank - a.rank || (timeValue(b.time) || 0) - (timeValue(a.time) || 0)).slice(0, 8);
  if (result.length) return result;
  return [{
    id: "notice-monitor-standby",
    title: "持续监控中，暂无重大利好、利空或风险事件",
    source: "公告监控",
    time: "实时",
    level: "监控",
    tone: "neutral",
    rank: 0,
  }];
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

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function directionalSignal(value: unknown): number | null {
  const label = text(value);
  if (!label) return null;
  if (/利空|偏空|负面|消极|下行|看空|弱|风险/.test(label)) return -1;
  if (/利好|偏多|正面|积极|上行|看多|强/.test(label)) return 1;
  if (/中性|平稳|无明显|分化/.test(label)) return 0;
  return null;
}

function readOpeningOutlook(crossMarkets: CrossMarketQuote[], contextRows: AnyRecord[], researchPayload: AnyRecord): OpeningOutlook {
  const factors: Array<{ label: string; signal: number; weight: number; detail: string }> = [];
  const metalSettings: Record<CrossMarketKey, { weight: number; scale: number }> = {
    copper: { weight: .42, scale: 1.5 },
    gold: { weight: .32, scale: 1.2 },
    silver: { weight: .1, scale: 2 },
  };

  crossMarkets.forEach(item => {
    if (item.change === null || item.state === "missing" || item.state === "stale") return;
    const setting = metalSettings[item.key];
    const signal = clamp(item.change / setting.scale, -1, 1);
    factors.push({
      label: item.label,
      signal,
      weight: setting.weight,
      detail: `${item.label} ${formatPercent(item.change)}${signal > .08 ? "支撑" : signal < -.08 ? "拖累" : "影响有限"}`,
    });
  });

  const treasuryRow = contextRows.find(row => /美债|美国(?:10年|十年).*债|us\s*10y|ust\s*10|treasury|tnx/i.test(firstText(row.label, row.name, row.symbol, row.code, row.id)));
  if (treasuryRow) {
    const bps = firstNumber(treasuryRow.changeBps, treasuryRow.change_bp, treasuryRow.bpsChange);
    const change = bps ?? firstNumber(treasuryRow.changePercent, treasuryRow.change_pct, treasuryRow.pct, treasuryRow.change);
    if (change !== null) {
      const normalizedMove = clamp(change / (bps !== null ? 8 : .8), -1, 1);
      factors.push({
        label: "美债",
        signal: -normalizedMove,
        weight: .16,
        detail: `美债收益率${change > 0 ? "上行承压" : change < 0 ? "回落支撑" : "平稳"}`,
      });
    }
  }

  const roots = researchRoots(researchPayload);
  const newsRows = roots.flatMap(root => [record(root.news), record(root.events), record(path(root, "outlook", "news"))]).filter(row => Object.keys(row).length > 0);
  const newsDirection = firstText(
    ...roots.flatMap(root => [root.newsDirection, root.eventDirection, root.newsSentiment, root.eventSentiment]),
    ...newsRows.flatMap(row => [row.direction, row.sentiment, row.label]),
  );
  const newsSignal = directionalSignal(newsDirection);
  if (newsSignal !== null) {
    factors.push({
      label: "消息",
      signal: newsSignal,
      weight: .2,
      detail: `消息面${newsSignal > 0 ? "偏利好" : newsSignal < 0 ? "偏利空" : "中性"}`,
    });
  }

  const evidenceTotal = 5;
  if (!factors.length) {
    return { label: "证据不足", tone: "flat", score: null, evidenceCount: 0, evidenceTotal, reason: "等待金银铜、美债和消息数据" };
  }
  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const score = factors.reduce((sum, factor) => sum + factor.signal * factor.weight, 0) / totalWeight;
  const copper = crossMarkets.find(item => item.key === "copper" && item.state !== "missing" && item.state !== "stale");
  const copperChange = copper?.change ?? null;
  const copperShock = copperChange !== null && Math.abs(copperChange) >= 1.2;
  let label = "偏平开";
  let tone: OutlookTone = "flat";
  if (score <= -.28) { label = "偏低开"; tone = "down"; }
  else if (score >= .28) { label = "偏高开"; tone = "up"; }
  else if (copperShock && copperChange < 0) { label = "分化偏弱"; tone = "down"; }
  else if (copperShock && copperChange > 0) { label = "分化偏强"; tone = "up"; }
  const ranked = [...factors].sort((a, b) => Math.abs(b.signal * b.weight) - Math.abs(a.signal * a.weight));
  const missing: string[] = [];
  if (!treasuryRow || !factors.some(factor => factor.label === "美债")) missing.push("美债");
  if (newsSignal === null) missing.push("消息");
  const reason = `${ranked.slice(0, 2).map(factor => factor.detail).join("；")}${missing.length ? `；${missing.join("、")}待接入` : ""}`;
  return { label, tone, score, evidenceCount: factors.length, evidenceTotal, reason };
}

function readMediumStructure(payload: AnyRecord, desk: AnyRecord): MediumStructureSummary {
  const roots = researchRoots(payload);
  const rows = roots.flatMap(root => [
    record(root.mediumTerm),
    record(root.marketRegime),
    record(root.marketStage),
    record(root.structureStage),
    record(path(root, "outlook", "mediumTerm")),
    record(path(root, "structure", "mediumTerm")),
  ]).filter(row => Object.keys(row).length > 0);
  const rawLabel = firstText(
    ...roots.flatMap(root => [root.mediumTermRegime, root.mediumTermDirection, root.marketStage, root.structureStage, root.cycleStage]),
    ...rows.flatMap(row => [row.label, row.regime, row.stage, row.direction]),
    path(desk, "structure", "mediumTerm"),
    path(desk, "regime", "mediumTerm"),
  );
  if (!rawLabel) {
    return { label: "待日周线数据", tone: "flat", confidence: null, note: "当前仅有日内数据，不臆测中期位置" };
  }
  const confidence = percentValue(firstNumber(
    ...rows.flatMap(row => [row.confidence, row.score]),
    ...roots.flatMap(root => [root.mediumTermConfidence, root.structureConfidence]),
  ));
  const note = firstText(...rows.flatMap(row => [row.summary, row.reason, row.evidence])) || "来自每日结构研究";
  if (/筑底|底部/.test(rawLabel)) return { label: "底部筑底", tone: "flat", confidence, note };
  if (/高位|顶部|派发|过热|警惕/.test(rawLabel)) return { label: "高位警惕", tone: "down", confidence, note };
  if (/上升|上涨|多头/.test(rawLabel)) return { label: "上升趋势", tone: "up", confidence, note };
  if (/下跌|下降|空头/.test(rawLabel)) return { label: "下跌趋势", tone: "down", confidence, note };
  if (/震荡|盘整|横盘/.test(rawLabel)) return { label: "中期震荡", tone: "flat", confidence, note };
  return { label: rawLabel, tone: "flat", confidence, note };
}

function directionFromData(market: AnyRecord, desk: AnyRecord, research: ResearchSummary): { label: string; tone: "up" | "down" | "flat"; confidence: number | null; note: string } {
  const explicit = firstText(
    path(desk, "direction", "label"),
    path(desk, "decision", "direction"),
    path(desk, "market", "direction"),
    path(desk, "context", "gate", "label"),
    research.direction,
  );
  const score = firstNumber(
    path(desk, "direction", "confidence"),
    path(desk, "decision", "confidence"),
    path(desk, "context", "gate", "score"),
    research.confidence,
  );
  const normalizedScore = score !== null && score <= 1 ? score * 100 : score;
  const change = firstNumber(path(market, "quote", "changePercent"), path(market, "quote", "change_pct"));
  if (/弱|空|跌|下行|利空/.test(explicit) || (explicit === "" && change !== null && change < -0.35)) {
    return { label: "偏弱", tone: "down", confidence: normalizedScore, note: "等待反弹，不追正T" };
  }
  if (/强|多|涨|上行|利好/.test(explicit) || (explicit === "" && change !== null && change > 0.35)) {
    return { label: "偏强", tone: "up", confidence: normalizedScore, note: "等待回踩，不追反T" };
  }
  return { label: "震荡", tone: "flat", confidence: normalizedScore, note: "等待方向和盘口同时确认" };
}

function modeFromAlerts(alerts: SignalAlert[], desk: AnyRecord, tone: "up" | "down" | "flat"): string {
  const source = alerts.slice(0, 8).map(item => `${item.title || ""} ${item.message || ""} ${item.direction || ""}`).join(" ");
  const explicit = firstText(path(desk, "strategy", "mode"), path(desk, "decision", "mode"), path(desk, "mode"));
  const value = `${explicit} ${source}`;
  if (/反T/.test(value)) return "反T优先";
  if (/正T/.test(value)) return "正T优先";
  return tone === "down" ? "反T优先" : tone === "up" ? "正T优先" : "观望";
}

function alertClass(alert: SignalAlert): AlertKind {
  if (alert.level === "replay-candidate") return "replay-candidate";
  if (alert.level === "replay-observation") return "replay-observation";
  const value = `${alert.source || ""} ${alert.title || ""} ${alert.message || ""}`.toLowerCase();
  if (/v2[.]?9|v29|影子/.test(value)) return "v29";
  if (/v1|重建|菱形/.test(value)) return "v1";
  if (/formal|正式|闭环|信号/.test(value) || alert.level === "signal") return "formal";
  return "other";
}

function alertLabel(alert: SignalAlert): string {
  const kind = alertClass(alert);
  if (kind === "replay-candidate") return "候选";
  if (kind === "replay-observation") return "观察";
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

function extractL2(source: AnyRecord, fallback: AnyRecord): { pressure: number | null; ofi: number | null; activeBuy: number | null; activeSell: number | null; spread: number | null; absorption: string; status: string } {
  const roots = [source, path(source, "orderflow"), path(source, "l2"), path(source, "orderBook"), fallback, path(fallback, "orderflow")];
  const find = (...keys: string[]) => firstNumber(...roots.flatMap(root => keys.map(key => record(root)[key])));
  const rawPressure = find("buyPressure", "buy_pressure", "imbalance", "obi", "pressure");
  const pressure = rawPressure === null ? null : rawPressure >= -1 && rawPressure <= 1 ? (rawPressure + 1) * 50 : Math.max(0, Math.min(100, rawPressure));
  const ofi = find("ofi", "orderFlowImbalance", "order_flow_imbalance");
  const activeBuy = find("activeBuy", "active_buy", "主动买入", "buyAmount");
  const activeSell = find("activeSell", "active_sell", "主动卖出", "sellAmount");
  const spread = find("spread", "价差");
  const absorptionValue = roots.map(root => record(root)).find(root => ["buyAbsorption", "bidAbsorption", "absorption"].some(key => root[key] !== undefined));
  const rawAbsorption = absorptionValue ? absorptionValue.buyAbsorption ?? absorptionValue.bidAbsorption ?? absorptionValue.absorption : undefined;
  const absorption = typeof rawAbsorption === "boolean" ? (rawAbsorption ? "有" : "无") : text(rawAbsorption);
  const state = firstText(...roots.map(root => path(root, "status")), ...roots.map(root => path(root, "availability")));
  return { pressure, ofi, activeBuy, activeSell, spread, absorption, status: state || (pressure !== null || ofi !== null ? "在线" : "暂无L2") };
}

function alertSide(alert: SignalAlert): "buy" | "sell" | "neutral" {
  const value = `${alert.side || ""} ${alert.direction || ""} ${alert.title || ""} ${alert.message || ""}`;
  if (/卖|反T|减仓|高抛/.test(value)) return "sell";
  if (/买|正T|加仓|低吸/.test(value)) return "buy";
  return "neutral";
}

function conciseAlertTitle(alert: SignalAlert): string {
  const value = `${alert.title || ""} ${alert.message || ""} ${alert.direction || ""}`;
  if (/买盘.*增强|承接.*增强/.test(value)) return "买盘增强，暂缓卖出";
  if (/反弹.*失败|冲高.*失败|回落.*确认/.test(value)) return "反弹失败，重新评估";
  if (/否决|失效/.test(value)) return `${alertLabel(alert)}条件失效`;
  const side = alertSide(alert);
  const stage = /确认|触发|执行/.test(value) ? "确认" : /候选|观察|等待|候/.test(value) ? "候选" : "变化";
  if (side === "sell") return `${alertLabel(alert)}反T${stage}`;
  if (side === "buy") return `${alertLabel(alert)}正T${stage}`;
  return `${alertLabel(alert)}状态变化`;
}

function markerLabel(alert: SignalAlert): string {
  if (alert.level === "replay-candidate" || alert.level === "replay-observation") return alert.title || "观察";
  const source = alertClass(alert) === "formal" ? "正" : alertClass(alert) === "v29" ? "2.9" : alertClass(alert) === "v1" ? "V1" : "观";
  const side = alertSide(alert);
  return `${source}${side === "buy" ? "买" : side === "sell" ? "卖" : "变"}`;
}

function keyTimelineAlerts(alerts: SignalAlert[]): SignalAlert[] {
  const chronological = [...alerts].reverse().filter(alert => alertClass(alert) !== "other" || /增强|失败|暂缓|重新评估|失效|否决/.test(`${alert.title || ""} ${alert.message || ""}`));
  const kept: SignalAlert[] = [];
  const lastByKey = new Map<string, SignalAlert>();
  for (const alert of chronological) {
    const key = `${alertClass(alert)}:${conciseAlertTitle(alert)}`;
    const previous = lastByKey.get(key);
    const previousTime = previous ? timeValue(previous.marketTime || previous.createdAt) : null;
    const currentTime = timeValue(alert.marketTime || alert.createdAt);
    const closeInTime = previousTime !== null && currentTime !== null && currentTime - previousTime < 10 * 60;
    const previousPrice = previous ? number(previous.price) : null;
    const currentPrice = number(alert.price);
    const closeInPrice = previousPrice === null || currentPrice === null || Math.abs(currentPrice - previousPrice) / Math.max(previousPrice, 0.01) < 0.003;
    if (previous && closeInTime && closeInPrice) continue;
    kept.push(alert);
    lastByKey.set(key, alert);
  }
  return kept;
}

function sessionPosition(value: unknown): number | null {
  const seconds = timeValue(value);
  if (seconds === null) return null;
  const morningStart = 9 * 3600 + 30 * 60;
  const morningEnd = 11 * 3600 + 30 * 60;
  const afternoonStart = 13 * 3600;
  const afternoonEnd = 15 * 3600;
  if (seconds <= morningStart) return 0;
  if (seconds <= morningEnd) return (seconds - morningStart) / (4 * 3600);
  if (seconds < afternoonStart) return 0.5;
  if (seconds <= afternoonEnd) return 0.5 + (seconds - afternoonStart) / (4 * 3600);
  return 1;
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
  const [dailyAssignment, setDailyAssignment] = useState<AnyRecord>({});
  const [alerts, setAlerts] = useState<SignalAlert[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [errorMessage, setErrorMessage] = useState("");
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [sourceTimestamp, setSourceTimestamp] = useState<string>("");
  const [liveTicks, setLiveTicks] = useState<LiveTick[]>([]);
  const [chartMode, setChartMode] = useState<ChartMode>("minute");
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
    setDailyAssignment({});
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
    const pullResearch = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 5_000);
      try {
        const payload = await getJson(`/api/research/zijin-daily-assignment?code=${encodeURIComponent(code)}`, controller.signal);
        if (!cancelled) setDailyAssignment(payload);
      } catch {
        // Slow research is optional; fast market and order-flow data continue independently.
      } finally {
        window.clearTimeout(timeout);
      }
    };
    void pullResearch();
    const timer = window.setInterval(() => void pullResearch(), RESEARCH_POLL_MS);
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
  const researchSummary = useMemo(() => readResearchSummary(dailyAssignment), [dailyAssignment]);
  const points = useMemo(() => {
    const historical = readMarketPoints(market);
    const ticks = liveTicks.map(item => ({ time: item.time, price: item.price, live: true, timestamp: item.timestamp }));
    return [...historical, ...ticks].slice(-500);
  }, [market, liveTicks]);
  const minutePoints = useMemo(() => {
    const minutes = new Map<string, PricePoint>();
    points.forEach(point => {
      const minute = point.time.match(/^\d{2}:\d{2}/)?.[0] || point.time;
      const previous = minutes.get(minute);
      minutes.set(minute, {
        ...previous,
        ...point,
        time: minute,
        live: false,
        vwap: point.vwap ?? previous?.vwap,
        volume: point.volume ?? previous?.volume,
      });
    });
    return [...minutes.values()].slice(-242);
  }, [points]);
  const secondChart = useMemo(() => {
    const samples = liveTicks.slice(-180);
    if (!samples.length) return null;
    const width = 920;
    const height = 104;
    const padX = 18;
    const padY = 16;
    const values = samples.map(item => item.price);
    const dataLow = Math.min(...values);
    const dataHigh = Math.max(...values);
    const range = Math.max(dataHigh - dataLow, Math.max((values.at(-1) || 0) * 0.0003, 0.01));
    const low = dataLow - range * 0.35;
    const high = dataHigh + range * 0.35;
    const x = (index: number) => padX + index / Math.max(samples.length - 1, 1) * (width - padX * 2);
    const y = (value: number) => height - padY - (value - low) / (high - low) * (height - padY * 2);
    return {
      width,
      height,
      polyline: samples.map((item, index) => `${x(index).toFixed(1)},${y(item.price).toFixed(1)}`).join(" "),
      count: samples.length,
      start: samples[0]?.time || "—",
      end: samples.at(-1)?.time || "—",
      last: samples.at(-1)?.price ?? null,
      moved: dataHigh > dataLow,
    };
  }, [liveTicks]);
  const direction = useMemo(() => directionFromData(market, desk, researchSummary), [market, desk, researchSummary]);
  const mode = useMemo(() => modeFromAlerts(alerts, desk, direction.tone), [alerts, desk, direction.tone]);
  const hasRealtimeDirectionConfidence = firstNumber(
    path(desk, "direction", "confidence"),
    path(desk, "decision", "confidence"),
    path(desk, "context", "gate", "score"),
  ) !== null;
  const confidenceLabel = hasRealtimeDirectionConfidence ? "实时把握度" : researchSummary.confidence !== null ? "结构置信" : "把握度";
  const l2Metrics = useMemo(() => extractL2(l2, desk), [l2, desk]);
  const timelineAlerts = useMemo(() => keyTimelineAlerts(alerts), [alerts]);
  const currentPrice = firstNumber(quote.price, quote.last);
  const changePercent = firstNumber(quote.changePercent, quote.change_pct);
  const vwap = firstNumber(path(market, "quote", "vwap"), path(market, "vwap"), [...points].reverse().find(item => item.vwap !== null && item.vwap !== undefined)?.vwap);
  const isReplay = chartMode === "replay" && code === DEFAULT_CODE;
  const isMinute = chartMode === "minute" || (chartMode === "replay" && code !== DEFAULT_CODE);
  const chartPoints = isReplay ? ZIJIN_REPLAY_POINTS : isMinute ? minutePoints : points;
  const chartAlerts = isReplay ? ZIJIN_REPLAY_ALERTS : timelineAlerts;
  const chartVwap = isReplay ? ZIJIN_REPLAY_POINTS.at(-1)?.vwap ?? null : vwap;
  const sourceDelay = sourceAgeSeconds(sourceTimestamp);
  const stockName = firstText(quote.name, market.name, code === "601899" ? "紫金矿业" : "监控标的");
  const today = dateLabel(firstText(market.sampleDate, market.date, sourceTimestamp));
  const currentAction = firstText(
    path(desk, "decision", "action"),
    path(desk, "strategy", "action"),
    path(desk, "action", "label"),
    researchSummary.action,
  ) || direction.note;
  const invalidation = firstText(
    path(desk, "decision", "invalidation"),
    path(desk, "strategy", "invalidation"),
    path(desk, "risk", "invalidation"),
    ...researchSummary.invalidations,
  ) || (direction.tone === "down"
    ? "重新站上VWAP并且买盘持续增强"
    : direction.tone === "up"
      ? "跌破VWAP并且主动卖盘持续增强"
      : "脱离震荡区间且订单流持续同向");
  const buyPressure = l2Metrics.pressure;
  const sellPressure = buyPressure === null ? null : 100 - buyPressure;
  const ofiLabel = l2Metrics.ofi === null ? "待L2" : l2Metrics.ofi > 0.05 ? "偏多" : l2Metrics.ofi < -0.05 ? "偏空" : "中性";
  const activeOrderLabel = l2Metrics.activeBuy === null || l2Metrics.activeSell === null
    ? "待L2"
    : l2Metrics.activeSell > l2Metrics.activeBuy * 1.08
      ? "主动卖单占优"
      : l2Metrics.activeBuy > l2Metrics.activeSell * 1.08
        ? "主动买单占优"
        : "买卖接近";
  const absorptionLabel = l2Metrics.absorption || "待L2";
  const flowConclusion = buyPressure === null && l2Metrics.ofi === null
    ? "盘口证据待补"
    : sellPressure !== null && sellPressure >= 60 && (l2Metrics.ofi ?? 0) < 0 && activeOrderLabel === "主动卖单占优"
      ? "反弹力度不足"
      : buyPressure !== null && buyPressure >= 60 && (l2Metrics.ofi ?? 0) > 0 && activeOrderLabel === "主动买单占优"
        ? "承接正在增强"
        : "多空仍在拉锯";
  const contextRows = useMemo(() => readContextRows(market, desk, marketContext), [market, desk, marketContext]);
  const crossMarkets = useMemo(() => readCrossMarkets(market, desk, marketContext, sourceTimestamp), [desk, market, marketContext, sourceTimestamp]);
  const openingOutlook = useMemo(() => readOpeningOutlook(crossMarkets, contextRows, dailyAssignment), [contextRows, crossMarkets, dailyAssignment]);
  const mediumStructure = useMemo(() => readMediumStructure(dailyAssignment, desk), [dailyAssignment, desk]);
  const breakingNotices = useMemo(
    () => readBreakingNotices(dailyAssignment, marketContext, desk, market, connection, errorMessage),
    [connection, dailyAssignment, desk, errorMessage, market, marketContext],
  );
  const tickerTone = breakingNotices.some(item => item.tone === "warning")
    ? "warning"
    : breakingNotices.some(item => item.tone === "negative")
      ? "negative"
      : breakingNotices.some(item => item.tone === "positive") ? "positive" : "neutral";
  const hasRealNotice = breakingNotices.some(item => item.id !== "notice-monitor-standby");
  const sectorRows = useMemo(() => contextRows.filter(row => commodityKey(firstText(row.label, row.name, row.symbol, row.code, row.id)) === null).slice(0, 3), [contextRows]);
  const commoditySummary = useMemo(() => {
    const copper = crossMarkets.find(item => item.key === "copper" && item.state !== "missing" && item.state !== "stale");
    const copperChange = copper?.change ?? null;
    if (copperChange !== null && copperChange <= -1.2) return { label: "铜价显著走弱", tone: "down", detail: "已计入次日开盘预判" };
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
    if (!chartPoints.length) return null;
    const width = 920;
    const height = 360;
    const padX = 42;
    const padY = 30;
    const values = chartPoints.map(item => item.price);
    const structureValues = chartPoints.filter(item => !item.live).map(item => item.price);
    const distribution = (structureValues.length ? structureValues : values).sort((a, b) => a - b);
    const quantile = (ratio: number) => distribution[Math.min(distribution.length - 1, Math.max(0, Math.round((distribution.length - 1) * ratio)))];
    const rawRange = Math.max(Math.max(...distribution) - Math.min(...distribution), Math.max(distribution[0] * 0.001, 0.01));
    const bandHalf = Math.max(rawRange * 0.035, distribution[0] * 0.0005);
    const supportCenter = quantile(0.2);
    const resistanceCenter = quantile(0.8);
    const support = { low: supportCenter - bandHalf, high: supportCenter + bandHalf };
    const resistance = { low: resistanceCenter - bandHalf, high: resistanceCenter + bandHalf };
    const vwapValue = chartVwap ?? null;
    const markerAlerts = chartAlerts.filter(alert => alertClass(alert) !== "other");
    const markerPrices = markerAlerts.map(alert => number(alert.price)).filter((value): value is number => value !== null);
    const allValues = [...values, support.low, support.high, resistance.low, resistance.high, ...markerPrices, ...(vwapValue === null ? [] : [vwapValue])];
    const dataLow = Math.min(...allValues);
    const dataHigh = Math.max(...allValues);
    const dataRange = Math.max(dataHigh - dataLow, Math.max(dataHigh * 0.001, 0.01));
    const low = dataLow - dataRange * 0.08;
    const high = dataHigh + dataRange * 0.08;
    const range = high - low;
    const x = (index: number) => {
      const position = sessionPosition(chartPoints[index]?.time);
      return padX + (position ?? index / Math.max(chartPoints.length - 1, 1)) * (width - padX * 2);
    };
    const y = (value: number) => height - padY - ((value - low) / range) * (height - padY * 2);
    const firstLiveIndex = chartPoints.findIndex(item => item.live);
    const historicalEnd = firstLiveIndex < 0 ? chartPoints.length : firstLiveIndex;
    const historyPolyline = chartPoints.slice(0, historicalEnd).map((item, index) => `${x(index).toFixed(1)},${y(item.price).toFixed(1)}`).join(" ");
    const liveStart = firstLiveIndex > 0 ? firstLiveIndex - 1 : Math.max(firstLiveIndex, 0);
    const livePolyline = firstLiveIndex < 0 ? "" : chartPoints.slice(liveStart).map((item, offset) => `${x(liveStart + offset).toFixed(1)},${y(item.price).toFixed(1)}`).join(" ");
    const vwapPolyline = isReplay ? chartPoints.map((item, index) => item.vwap === null || item.vwap === undefined ? "" : `${x(index).toFixed(1)},${y(item.vwap).toFixed(1)}`).filter(Boolean).join(" ") : "";
    const vwapY = isReplay || vwapValue === null ? null : y(vwapValue);
    const markerLanes = new Map<string, number>();
    const markerRows = markerAlerts.map(alert => {
      const targetTime = timeValue(alert.marketTime || alert.createdAt);
      let index = chartPoints.length - 1;
      if (targetTime !== null) {
        let bestDistance = Number.POSITIVE_INFINITY;
        chartPoints.forEach((point, pointIndex) => {
          const pointTime = timeValue(point.time);
          if (pointTime === null) return;
          const distance = Math.abs(pointTime - targetTime);
          if (distance < bestDistance) { bestDistance = distance; index = pointIndex; }
        });
      }
      const markerPrice = number(alert.price) ?? chartPoints[index]?.price ?? currentPrice ?? low;
      const cx = x(index);
      const cy = y(markerPrice);
      const side = alertSide(alert);
      const laneKey = `${Math.round(cx / 44)}:${side}`;
      const lane = markerLanes.get(laneKey) || 0;
      markerLanes.set(laneKey, lane + 1);
      const desiredOffset = (side === "sell" ? -1 : 1) * (24 + Math.min(lane, 2) * 17);
      const labelOffset = Math.max(padY + 8 - cy, Math.min(height - padY - 8 - cy, desiredOffset));
      return { alert, index, cx, cy, kind: alertClass(alert), side, labelOffset };
    });
    const band = (item: { low: number; high: number }) => ({ y: y(item.high), height: Math.max(2, y(item.low) - y(item.high)), value: (item.low + item.high) / 2 });
    return { width, height, padX, padY, y, low, high, dataLow, dataHigh, historyPolyline, livePolyline, vwapPolyline, vwapY, markerRows, support: band(support), resistance: band(resistance) };
  }, [chartAlerts, chartPoints, chartVwap, currentPrice, isReplay]);

  const applyCode = () => {
    const next = codeInput.trim();
    if (/^\d{6}$/.test(next)) {
      setChartMode("minute");
      setCode(next);
      window.history.replaceState(null, "", `/realtime-lab?code=${next}`);
    }
  };

  const sourceIsStale = sourceDelay !== null && sourceDelay > 60;
  const latencyLabel = connection === "live" ? formatSourceAge(sourceDelay) : connection === "auth" ? "需登录" : "重试中";

  return (
    <main className="realtime-lab">
      <section className={`decision-card ${openingOutlook.tone}`} aria-label="当前决策摘要">
        <div className="decision-card-head">
          <div className="instrument">
            <span className="eyebrow">DOUBLE RABBIT · TRADING DESK</span>
            <strong>{stockName}</strong>
            <span>{code} · {today}</span>
          </div>
          <div className="decision-tools">
            <div className={`health-pill ${sourceIsStale ? "stale" : ""}`}><i className={connection === "live" ? sourceIsStale ? "stale" : "ok" : "bad"} />{connection === "live" ? sourceIsStale ? "行情未更新" : "实时" : connection === "auth" ? "需登录" : "连接异常"}<small>{latencyLabel}</small></div>
            <div className="symbol-picker compact">
              <label className="sr-only" htmlFor="realtime-code">监控标的</label>
              <div>
                <input id="realtime-code" aria-label="股票代码" value={codeInput} inputMode="numeric" maxLength={6} onChange={event => setCodeInput(event.target.value.replace(/\D/g, ""))} onKeyDown={event => { if (event.key === "Enter") applyCode(); }} />
                <button type="button" onClick={applyCode}>切换</button>
              </div>
            </div>
          </div>
        </div>
        <div className="decision-layout">
          <div className="outlook-stack" aria-label="多周期方向判断">
            <div className={`outlook-item ${openingOutlook.tone}`}>
              <span>次日开盘</span><strong>{openingOutlook.label}</strong><small>{openingOutlook.score === null ? `证据 ${openingOutlook.evidenceCount}/${openingOutlook.evidenceTotal}` : `证据 ${openingOutlook.evidenceCount}/${openingOutlook.evidenceTotal} · 方向强度 ${Math.round(Math.abs(openingOutlook.score) * 100)}%`}</small>
            </div>
            <div className={`outlook-item ${mediumStructure.tone}`}>
              <span>中期位置</span><strong>{mediumStructure.label}</strong><small>{mediumStructure.confidence === null ? "等待日周线引擎" : `结构置信 ${Math.round(mediumStructure.confidence)}%`}</small>
            </div>
            <div className={`outlook-item ${direction.tone}`}>
              <span>盘中方向</span><strong>{direction.label}</strong><small>{mode} · {direction.confidence === null ? "把握度待补" : `${confidenceLabel} ${Math.round(direction.confidence)}%`}</small>
            </div>
          </div>
          <div className="decision-facts">
            <div className="fact-primary"><span>当前动作</span><b>{currentAction}</b></div>
            <div className="fact-risk"><span>失效条件</span><b>{invalidation}</b></div>
            <div><span>数据状态</span><b>{connection === "live" ? sourceIsStale ? `接口在线 · 最后行情 ${latencyLabel}` : `实时 · 最新行情 ${latencyLabel}` : errorMessage || "正在重连"}</b></div>
            <div className="fact-evidence" title={openingOutlook.reason}><span>盘前依据</span><b>{openingOutlook.reason}</b></div>
            <div className="fact-evidence" title={mediumStructure.note}><span>中期依据</span><b>{mediumStructure.note}</b></div>
          </div>
          <div className="decision-quote"><small>最新价</small><strong>{formatPrice(currentPrice)}</strong><span className={changePercent !== null && changePercent >= 0 ? "positive" : "negative"}>{formatPercent(changePercent)}</span><em>VWAP {formatPrice(vwap)}</em></div>
          <div className="horizon-panel" aria-label="未来多周期评估">
            <div className="horizon-heading"><span>未来窗口</span><small>概率与结构置信分开显示</small></div>
            <div className="horizon-grid">
              {researchSummary.horizons.map(horizon => {
                const meter = horizon.probability ?? horizon.confidence ?? 0;
                return <div className={horizon.probability === null ? "uncalibrated" : "calibrated"} key={horizon.minutes}>
                  <span>{horizon.minutes}分钟</span>
                  <strong>{horizon.probability === null ? "待校准" : `${Math.round(horizon.probability)}%`}</strong>
                  <i><em style={{ width: `${Math.round(meter)}%` }} /></i>
                  <small>{horizon.probability !== null ? `${horizon.direction || direction.label}模型概率` : horizon.confidence !== null ? `结构置信 ${Math.round(horizon.confidence)}%` : "暂无有效样本"}</small>
                </div>;
              })}
            </div>
          </div>
        </div>
      </section>

      <section className={`news-ticker ${tickerTone}`} aria-label="重大公告与风险警告">
        <div className="ticker-label"><i /><span>公告警戒</span></div>
        <div className="ticker-viewport" role="status" aria-live="polite">
          <div className={`ticker-track ${breakingNotices.length > 1 ? "scrolling" : "static"}`}>
            {[0, ...(breakingNotices.length > 1 ? [1] : [])].map(copy => <div className="ticker-group" aria-hidden={copy === 1 ? "true" : undefined} key={copy}>
              {breakingNotices.map(item => <span className={`ticker-item ${item.tone}`} title={`${item.source} · ${item.title}`} key={`${copy}-${item.id}`}>
                <b>{item.level}</b>{item.time !== "—" && <time>{item.time}</time>}<strong>{item.title}</strong><em>{item.source}</em>
              </span>)}
            </div>)}
          </div>
        </div>
        <div className="ticker-count">{hasRealNotice ? `${breakingNotices.length} 条重要信息` : "实时监控"}</div>
      </section>

      <section className="lab-grid">
        <article className="panel chart-panel">
          <header className="panel-header chart-header"><div><span className="panel-kicker">INTRADAY / EXECUTION MAP</span><h2>{isReplay ? `${REPLAY_DATE} 昨日回放` : isMinute ? "1分钟日内图" : "秒级实时观察"}</h2></div><div className="chart-header-tools"><div className="chart-mode-switch" aria-label="图表模式"><button type="button" className={isMinute ? "active" : ""} aria-pressed={isMinute} onClick={() => setChartMode("minute")}>1分钟</button><button type="button" className={chartMode === "live" ? "active" : ""} aria-pressed={chartMode === "live"} onClick={() => setChartMode("live")}>秒级观察</button>{code === DEFAULT_CODE && <button type="button" className={isReplay ? "active" : ""} aria-pressed={isReplay} onClick={() => setChartMode("replay")}>昨日回放</button>}</div><div className="legend">{isReplay ? <><span><i className="legend-price" />5分钟抽样</span><span><i className="legend-vwap" />动态VWAP</span><span><i className="legend-band" />支撑/压力</span></> : isMinute ? <><span><i className="legend-price" />1分钟价格</span><span><i className="legend-vwap" />VWAP</span><span><i className="legend-band" />支撑/压力</span></> : <><span><i className="legend-price" />全天分钟线</span><span><i className="legend-live" />近3分钟放大</span><span><i className="legend-vwap" />VWAP</span><span><i className="legend-band" />支撑/压力</span></>}</div></div></header>
          {isReplay ? <div className="signal-chart-legend replay"><span><i className="shape replay-observation" />观察</span><span><i className="shape replay-candidate" />候选</span><small>回放数据，不是实时信号 · 完整242点回放压缩为6个观测点</small></div> : <div className="signal-chart-legend"><span><i className="shape formal" />正式</span><span><i className="shape v29" />V2.9</span><span><i className="shape v1" />V1</span><small>信号从本地账本恢复，刷新后仍保留</small></div>}
          {chart ? <div className="chart-wrap"><svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`${stockName}日内价格图`} preserveAspectRatio="none">
            <rect className="support-band" x={chart.padX} y={chart.support.y} width={chart.width - chart.padX * 2} height={chart.support.height} />
            <rect className="resistance-band" x={chart.padX} y={chart.resistance.y} width={chart.width - chart.padX * 2} height={chart.resistance.height} />
            {[0, .25, .5, .75, 1].map(position => <line className="grid-line vertical" key={position} x1={chart.padX + position * (chart.width - chart.padX * 2)} x2={chart.padX + position * (chart.width - chart.padX * 2)} y1={chart.padY} y2={chart.height - chart.padY} />)}
            <line className="grid-line" x1={chart.padX} x2={chart.width - chart.padX} y1={chart.padY} y2={chart.padY} />
            <line className="grid-line" x1={chart.padX} x2={chart.width - chart.padX} y1={chart.height / 2} y2={chart.height / 2} />
            <line className="grid-line" x1={chart.padX} x2={chart.width - chart.padX} y1={chart.height - chart.padY} y2={chart.height - chart.padY} />
            <text className="band-label support" x={chart.padX + 7} y={chart.support.y + 12}>结构支撑 {formatPrice(chart.support.value)}</text>
            <text className="band-label resistance" x={chart.padX + 7} y={chart.resistance.y + 12}>结构压力 {formatPrice(chart.resistance.value)}</text>
            {chart.vwapY !== null && <><line className="vwap-line" x1={chart.padX} x2={chart.width - chart.padX} y1={chart.vwapY} y2={chart.vwapY} /><text className="vwap-label" x={chart.width - chart.padX - 5} y={chart.vwapY - 5} textAnchor="end">VWAP {formatPrice(vwap)}</text></>}
            {chart.vwapPolyline && <polyline className="vwap-polyline" points={chart.vwapPolyline} />}
            {chart.historyPolyline && <polyline className="price-polyline" points={chart.historyPolyline} />}
            {chart.livePolyline && <polyline className="live-polyline" points={chart.livePolyline} />}
            {chart.markerRows.map(marker => <g key={marker.alert.id} className={`chart-marker ${marker.kind} ${marker.side}`} transform={`translate(${marker.cx},${marker.cy})`}>
              <line className="marker-stem" x1="0" x2="0" y1="0" y2={marker.labelOffset} />
              {marker.kind === "v1" || marker.kind === "replay-candidate" ? <rect x="-5" y="-5" width="10" height="10" transform="rotate(45)" /> : <circle r={marker.kind === "replay-observation" ? "5" : "7"} />}
              <text y={marker.labelOffset + (marker.labelOffset > 0 ? 13 : -7)} textAnchor="middle">{markerLabel(marker.alert)}</text>
            </g>)}
            <text className="price-axis-label" x={chart.width - 4} y={chart.y(chart.high) + 4} textAnchor="end">{formatPrice(chart.high)}</text>
            <text className="price-axis-label" x={chart.width - 4} y={chart.y(chart.low) - 4} textAnchor="end">{formatPrice(chart.low)}</text>
          </svg><div className="chart-axis"><span>09:30</span><span>10:30</span><span>11:30 / 13:00</span><span>14:00</span><span>15:00</span></div></div> : <div className="empty-state">等待行情数据…</div>}
          {chartMode === "live" && <div className="second-chart"><div className="second-chart-head"><span><i />近3分钟秒级观察窗</span>{secondChart && <><b>{secondChart.count} 个采样 · {clockLabel(secondChart.start)}—{clockLabel(secondChart.end)}</b><em>{formatPrice(secondChart.last)}</em></>}</div>{secondChart ? <><svg viewBox={`0 0 ${secondChart.width} ${secondChart.height}`} role="img" aria-label="近3分钟秒级价格"><line x1="18" x2={secondChart.width - 18} y1={secondChart.height / 2} y2={secondChart.height / 2} /><polyline points={secondChart.polyline} /></svg><small className={secondChart.moved ? "moving" : "flat"}>{secondChart.moved ? "秒级报价已有变化" : "报价暂未变化；休市或上游尚未产生新报价"}</small></> : <div className="second-chart-empty">正在收集秒级报价…</div>}</div>}
          <div className="price-stats"><div><span>VWAP</span><b>{formatPrice(chartVwap)}</b></div><div><span>结构支撑</span><b>{chart ? formatPrice(chart.support.value) : "—"}</b></div><div><span>结构压力</span><b>{chart ? formatPrice(chart.resistance.value) : "—"}</b></div><div><span>日高</span><b>{formatPrice(isReplay && chart ? chart.dataHigh : firstNumber(quote.high))}</b></div><div><span>日低</span><b>{formatPrice(isReplay && chart ? chart.dataLow : firstNumber(quote.low))}</b></div></div>
        </article>

        <article className="panel flow-panel">
          <header className="panel-header"><div><span className="panel-kicker">MARKET MICROSTRUCTURE / L2</span><h2>盘口状态</h2></div><span className={`mini-status ${l2Metrics.status === "在线" ? "ok" : "muted"}`}>{l2Metrics.status}</span></header>
          <div className="pressure">
            <div className="pressure-head"><span>买卖压力</span><b className={sellPressure !== null && sellPressure >= 55 ? "negative" : buyPressure !== null && buyPressure >= 55 ? "positive" : ""}>{sellPressure === null ? "待L2" : sellPressure >= (buyPressure ?? 0) ? `卖方 ${Math.round(sellPressure)}%` : `买方 ${Math.round(buyPressure ?? 0)}%`}</b></div>
            <div className="pressure-track"><i className="sell" style={{ width: `${sellPressure ?? 50}%` }} /><i className="buy" style={{ width: `${buyPressure ?? 50}%` }} /></div>
            <div className="pressure-label"><span>卖方 {sellPressure === null ? "—" : `${Math.round(sellPressure)}%`}</span><span>买方 {buyPressure === null ? "—" : `${Math.round(buyPressure)}%`}</span></div>
          </div>
          <div className="flow-facts">
            <div><span>OFI</span><b className={ofiLabel === "偏多" ? "positive" : ofiLabel === "偏空" ? "negative" : ""}>{ofiLabel}</b><small>{l2Metrics.ofi === null ? "等待订单流" : l2Metrics.ofi.toFixed(2)}</small></div>
            <div><span>主动成交</span><b>{activeOrderLabel}</b><small>{l2Metrics.activeBuy === null || l2Metrics.activeSell === null ? "等待逐笔数据" : `买 ${l2Metrics.activeBuy.toLocaleString()} / 卖 ${l2Metrics.activeSell.toLocaleString()}`}</small></div>
            <div><span>买一吸收</span><b>{absorptionLabel}</b><small>{absorptionLabel === "待L2" ? "不把缺失数据判成无" : "来自盘口吸收字段"}</small></div>
            <div><span>买卖价差</span><b>{l2Metrics.spread === null ? "待L2" : l2Metrics.spread.toFixed(3)}</b><small>仅作执行质量参考</small></div>
          </div>
          <div className={`flow-verdict ${flowConclusion.includes("增强") ? "up" : flowConclusion.includes("不足") ? "down" : "flat"}`}><i /><div><span>盘口结论</span><strong>{flowConclusion}</strong><small>盘口只负责确认或否决，不单独触发交易</small></div></div>

          <div className="auxiliary-block">
            <div className="auxiliary-title"><span>金属联动</span><b className={commoditySummary.tone === "up" ? "positive" : commoditySummary.tone === "down" ? "negative" : ""}>{commoditySummary.label}</b></div>
            <div className="compact-market-list">{crossMarkets.map(item => <div key={item.key}><span>{item.label}<small>{item.state === "missing" ? "未接入" : clockLabel(item.updatedAt)}</small></span><b>{formatPrice(item.price, item.price !== null && item.price < 10 ? 3 : 2)}</b><em className={item.change !== null && item.change >= 0 ? "positive" : "negative"}>{formatPercent(item.change)}</em></div>)}</div>
            {!!sectorRows.length && <div className="sector-strip">{sectorRows.map((row, index) => { const change = firstNumber(row.changePercent, row.change_pct, row.change); return <span key={`${text(row.id)}-${index}`}>{firstText(row.label, row.name, row.symbol) || "相关市场"}<b className={change !== null && change >= 0 ? "positive" : "negative"}>{formatPercent(change)}</b></span>; })}</div>}
          </div>
        </article>
      </section>

      <section className="panel signal-panel">
        <header className="panel-header"><div><span className="panel-kicker">KEY CHANGES ONLY</span><h2>{isReplay ? "昨日观测点复盘" : "关键信号时间轴"}</h2></div>{isReplay ? <div className="signal-legend"><span><i className="dot replay-observation" />观察</span><span><i className="dot replay-candidate" />候选</span></div> : <div className="signal-legend"><span><i className="dot formal" />正式</span><span><i className="dot v29" />V2.9</span><span><i className="dot v1" />V1</span></div>}</header>
        {chartAlerts.length ? <div className="signal-list">{chartAlerts.slice(-12).map(alert => <div className={`signal-row ${alertClass(alert)} ${alertSide(alert)}`} key={alert.id}><span className="signal-dot" /><time>{clockLabel(alert.marketTime || alert.createdAt)}</time><strong>{alertLabel(alert)}</strong><b title={alert.message}>{isReplay ? alert.message : conciseAlertTitle(alert)}</b><em>{alert.price === null || alert.price === undefined ? "—" : formatPrice(alert.price)}</em></div>)}</div> : <div className="empty-state signal-empty">暂无关键变化；重复提醒会自动合并，已出现的信号会常驻保存。</div>}
      </section>

      <footer className="realtime-footer"><span>行情更新：{lastUpdate ? new Date(lastUpdate).toLocaleTimeString("zh-CN", { hour12: false }) : "等待中"}</span><span>源时间：{sourceTimestamp ? clockLabel(sourceTimestamp) : "—"}</span><span>研究更新：{researchSummary.updatedAt ? clockLabel(researchSummary.updatedAt) : "等待中"}</span><span>{isReplay ? `${REPLAY_DATE} 回放数据；只读，不是实时信号` : isMinute ? "1分钟日内图；当前分钟持续更新；只读，不自动下单" : "1分钟历史 + 约1秒实时观察；只读，不自动下单"}</span></footer>
    </main>
  );
}
