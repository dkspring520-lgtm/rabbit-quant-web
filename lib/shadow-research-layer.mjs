/**
 * Jev/PanWatch-inspired research sidecar.
 *
 * This module is deliberately isolated from the formal signal and risk paths:
 * it only normalizes already-observed evidence and returns research metadata.
 */
import { evaluateWeb4Microstructure } from "./web4-microstructure.mjs";
import { evaluateZijinOrderFlowRadar } from "./zijin-order-flow-engine.mjs";
import { evaluateZijinRepairCandidate } from "./zijin-repair-candidate.mjs";
import { evaluateZijinShadowExperiments } from "./zijin-shadow-experiments.mjs";

export const SHADOW_RESEARCH_VERSION = "2026.09-shadow-research-v2";

export const SHADOW_RESEARCH_POLICY = Object.freeze({
  mode: "shadow-only",
  researchOnly: true,
  affectsFormalSignal: false,
  affectsRiskGate: false,
  canExecute: false,
});

const PHASES = new Set(["preopen", "intraday", "postclose"]);
const MAX_AGE_MS = Object.freeze({ preopen: 24 * 60 * 60_000, intraday: 30 * 60_000, postclose: 24 * 60 * 60_000 });

function finiteDate(value) {
  const date = new Date(value ?? "");
  return Number.isFinite(date.getTime()) ? date : null;
}

function phaseFor(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const time = hour * 100 + minute;
  return time < 930 ? "preopen" : time <= 1500 ? "intraday" : "postclose";
}

function routeTask({ kind, sentiment, severity }) {
  if (kind === "event" && (severity === "critical" || sentiment === "negative")) return "risk-review";
  if (kind === "market-context") return "cross-market-review";
  if (sentiment === "positive") return "catalyst-review";
  return "observation-review";
}

function normalizeEvidence(item, { code, phase, nowMs }) {
  const observedAt = item.observedAt ?? item.publishedAt ?? item.sourceTimestamp;
  const date = finiteDate(observedAt);
  if (!date || !PHASES.has(phase)) return null;
  const ageMs = nowMs - date.getTime();
  const maxAge = MAX_AGE_MS[phase];
  if (ageMs < -5 * 60_000 || ageMs > maxAge) return null;
  const sentiment = ["positive", "negative", "neutral"].includes(item.sentiment) ? item.sentiment : "neutral";
  const title = String(item.title ?? item.label ?? "研究证据").trim();
  if (!title) return null;
  return {
    id: String(item.id ?? `${code}:${title}:${date.toISOString()}`),
    code,
    phase,
    kind: item.kind ?? "observation",
    title,
    detail: String(item.detail ?? item.summary ?? item.reason ?? "已观察数据，等待人工复核").trim(),
    sentiment,
    severity: item.severity ?? "info",
    source: String(item.source ?? item.provider ?? "内部研究").trim(),
    observedAt: date.toISOString(),
    freshnessMinutes: Math.max(0, Math.round(ageMs / 60_000)),
    taskRoute: routeTask({ kind: item.kind, sentiment, severity: item.severity }),
    strategyImpact: "shadow-only",
  };
}

function uniqueEvidence(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.kind}|${item.title.replace(/\s+/g, "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildShadowResearchLayer({ code, market = null, context = null, events = null, minutes = [], historicalSessions = [], l2 = null, marketDate = null, phase = null, now = new Date() } = {}) {
  const normalizedCode = String(code ?? "").trim();
  const nowDate = finiteDate(now) ?? new Date();
  const nowMs = nowDate.getTime();
  const resolvedPhase = PHASES.has(phase) ? phase : phaseFor(nowDate);
  const raw = [];

  for (const event of events?.items ?? []) {
    raw.push({
      ...event,
      kind: "event",
      title: event.title,
      detail: event.reason ?? event.summary,
      observedAt: event.publishedAt,
      source: event.source,
    });
  }
  for (const item of context?.items ?? []) {
    raw.push({
      ...item,
      kind: "market-context",
      title: item.label,
      detail: `${item.changePercent > 0 ? "+" : ""}${Number(item.changePercent ?? 0).toFixed(2)}% · ${item.provider}`,
      sentiment: Number(item.changePercent) > 0 ? "positive" : Number(item.changePercent) < 0 ? "negative" : "neutral",
      observedAt: item.sourceTimestamp,
      source: item.provider,
    });
  }
  if (market?.quote?.code && Number.isFinite(Number(market.quote.changePercent))) {
    raw.push({
      id: `quote-${market.quote.code}`,
      kind: "market-context",
      title: "个股实时行情",
      detail: `${Number(market.quote.changePercent) > 0 ? "+" : ""}${Number(market.quote.changePercent).toFixed(2)}% · 仅记录已出现行情`,
      sentiment: Number(market.quote.changePercent) > 0 ? "positive" : Number(market.quote.changePercent) < 0 ? "negative" : "neutral",
      source: "market-data",
      observedAt: market.sourceTimestamp ?? market.fetchedAt ?? nowDate.toISOString(),
    });
  }

  // These evaluators are causal and research-only. They are intentionally
  // converted to evidence here instead of being passed into formal scoring.
  if (normalizedCode === "601899" && Array.isArray(minutes) && minutes.length) {
    const index = minutes.length - 1;
    const observedAt = market?.sourceTimestamp ?? market?.fetchedAt ?? nowDate.toISOString();
    const repair = evaluateZijinRepairCandidate(minutes);
    if (["candidate", "watch"].includes(repair.status)) {
      raw.push({
        id: `repair-${repair.asOfTime}`,
        kind: "price-structure",
        title: repair.title ?? "低位修复观察",
        detail: [...(repair.reasons ?? []), `状态：${repair.status === "candidate" ? "候选观察" : "继续观察"}`].join("；"),
        sentiment: "positive",
        severity: "info",
        source: "zijin-repair-candidate",
        observedAt,
      });
    }

    const experiments = evaluateZijinShadowExperiments({ minutes, index });
    for (const [id, result] of Object.entries(experiments.experiments ?? {})) {
      const rows = result?.buy || result?.sell ? [result.buy, result.sell] : [result];
      for (const item of rows) {
        if (!item || !["candidate", "watch"].includes(item.status) || !Number(item.score)) continue;
        raw.push({
          id: `experiment-${id}-${item.asOfTime ?? index}`,
          kind: "causal-experiment",
          title: item.direction ? `${item.direction}${item.status === "candidate" ? "实验候选" : "实验观察"}` : "影子实验观察",
          detail: `${item.reason ?? "条件正在累积"} · ${item.score}/${item.maxScore ?? "?"} 分`,
          sentiment: item.direction === "反T" ? "negative" : "positive",
          severity: "info",
          source: `zijin-shadow:${id}`,
          observedAt,
        });
      }
    }

    const orderFlow = evaluateZijinOrderFlowRadar({ minutes, index, stale: false });
    if (orderFlow.available && orderFlow.label) {
      raw.push({
        id: `order-flow-${orderFlow.asOfTime ?? index}`,
        kind: "order-flow",
        title: orderFlow.label,
        detail: (orderFlow.evidence ?? []).slice(0, 3).join("；"),
        sentiment: orderFlow.direction === "反T" ? "negative" : "positive",
        severity: "info",
        source: "zijin-order-flow-engine",
        observedAt,
      });
    }

    const microstructure = evaluateWeb4Microstructure({
      points: minutes,
      historicalSessions,
      liveL2: l2 ?? minutes.at(-1),
      asOfDate: marketDate,
      stale: false,
    });
    if (microstructure.available && microstructure.label && microstructure.state !== "waiting") {
      raw.push({
        id: `microstructure-${minutes.at(-1)?.time ?? index}`,
        kind: "microstructure",
        title: microstructure.label,
        detail: (microstructure.evidence ?? []).slice(0, 3).join("；"),
        sentiment: microstructure.direction === "反T" ? "negative" : "positive",
        severity: "info",
        source: "web4-microstructure",
        observedAt,
      });
    }
  }

  const evidence = uniqueEvidence(raw.map((item) => normalizeEvidence(item, { code: normalizedCode, phase: resolvedPhase, nowMs })).filter(Boolean)).slice(0, 12);
  const counts = {
    total: evidence.length,
    positive: evidence.filter((item) => item.sentiment === "positive").length,
    negative: evidence.filter((item) => item.sentiment === "negative").length,
    neutral: evidence.filter((item) => item.sentiment === "neutral").length,
  };
  const top = [...evidence].sort((left, right) => (left.sentiment === "negative" ? -1 : 1) - (right.sentiment === "negative" ? -1 : 1) || left.freshnessMinutes - right.freshnessMinutes).slice(0, 3);
  return {
    version: SHADOW_RESEARCH_VERSION,
    policy: SHADOW_RESEARCH_POLICY,
    code: normalizedCode,
    phase: resolvedPhase,
    generatedAt: nowDate.toISOString(),
    counts,
    evidence,
    top,
    summary: evidence.length ? `影子研究 ${counts.total} 条：利好 ${counts.positive}、利空 ${counts.negative}、中性 ${counts.neutral}` : "当前时段暂无新研究证据",
    formalSignalInputChanged: false,
    formalRiskGateChanged: false,
  };
}

export { phaseFor };
