import { aShareMinuteSlot, isAShareRegularTradingMinute } from "./intraday-axis.mjs";

/**
 * Deterministic diagnostics for the AI monitor entry point.
 *
 * This module deliberately does not produce a buy/sell decision. It audits
 * data freshness, intraday geometry, signal causality, and service health so
 * the UI can explain whether its existing decision engine has trustworthy
 * inputs.
 */

const toFinite = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const cleanTime = value => {
  const raw = String(value ?? "").trim();
  if (/^\d{4}$/.test(raw)) return raw;
  if (/[T ]\d{2}:?\d{2}/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(parsed);
      const hour = parts.find(part => part.type === "hour")?.value;
      const minute = parts.find(part => part.type === "minute")?.value;
      if (hour && minute) return hour + minute;
    }
  }
  const compactSession = raw.match(/(?:^|[-_])((?:[01]\d|2[0-3])[0-5]\d)(?:$|[-_])/);
  if (compactSession) return compactSession[1];
  const clock = raw.match(/(?:^|[^\d])([01]\d|2[0-3]):?([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?(?:$|[^\d])/);
  if (clock) return `${clock[1]}${clock[2]}`;
  return "";
};

const minuteNumber = value => {
  const time = cleanTime(value);
  if (!/^\d{4}$/.test(time)) return null;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(2));
};

const isRegularMinute = value => isAShareRegularTradingMinute(value);

const formatTime = value => {
  const time = cleanTime(value);
  return /^\d{4}$/.test(time) ? `${time.slice(0, 2)}:${time.slice(2)}` : "时间未知";
};

const statusForRemote = result => {
  if (!result || result.ok === false) return "blocked";
  if (result.status === 503 || result.httpStatus >= 500) return "warning";
  if (result.status === 401 || result.status === 403 || result.httpStatus === 401 || result.httpStatus === 403) return "warning";
  return "healthy";
};

function addCheck(checks, check) {
  checks.push({
    id: String(check.id),
    label: String(check.label),
    status: check.status ?? "warning",
    detail: String(check.detail ?? ""),
    evidence: Array.isArray(check.evidence) ? check.evidence.filter(Boolean).map(String) : [],
    layer: check.layer ?? "fast",
    latencyMs: toFinite(check.latencyMs),
    httpStatus: toFinite(check.httpStatus),
    asOf: check.asOf ?? null,
  });
}
function inspectMinutes(snapshot, checks) {
  const minutes = Array.isArray(snapshot.minutes) ? snapshot.minutes : [];
  if (!minutes.length) {
    addCheck(checks, {
      id: "intraday-data",
      label: "日内分钟线",
      status: "insufficient",
      detail: "没有可复核的分钟数据，暂不判断今天的图和信号。",
      layer: "fast",
    });
    return { minutes, lastTime: "", validCount: 0, futureCount: 0 };
  }

  const valid = minutes.filter(point => isRegularMinute(point?.time) && toFinite(point?.price) > 0);
  const invalidCount = minutes.length - valid.length;
  const duplicateTimes = new Set();
  const seen = new Set();
  let unsorted = false;
  let futureCount = 0;
  const asOfMinute = minuteNumber(snapshot.asOfTime ?? snapshot.lastExchangeTime ?? minutes.at(-1)?.time);
  let gapCount = 0;
  let previousMinute = null;
  let previousSlot = null;
  for (const point of minutes) {
    const currentMinute = minuteNumber(point?.time);
    if (currentMinute === null) continue;
    const currentSlot = aShareMinuteSlot(point?.time);
    if (seen.has(cleanTime(point.time))) duplicateTimes.add(cleanTime(point.time));
    seen.add(cleanTime(point.time));
    if (previousMinute !== null && currentMinute < previousMinute) unsorted = true;
    if (asOfMinute !== null && currentMinute > asOfMinute) futureCount += 1;
    if (previousSlot !== null && currentSlot - previousSlot > 1) gapCount += 1;
    previousMinute = currentMinute;
    previousSlot = currentSlot;
  }

  const timeIssues = [];
  if (invalidCount) timeIssues.push(`${invalidCount} 个点时间或价格无效`);
  if (duplicateTimes.size) timeIssues.push(`${duplicateTimes.size} 个分钟重复`);
  if (unsorted) timeIssues.push("时间轴未按先后排序");
  if (gapCount) timeIssues.push(`${gapCount} 处分钟缺口`);
  if (futureCount) timeIssues.push(`${futureCount} 个点超过当前数据时间`);

  addCheck(checks, {
    id: "intraday-axis",
    label: "日内时间轴",
    status: futureCount || unsorted ? "blocked" : timeIssues.length ? "warning" : "healthy",
    detail: timeIssues.length ? timeIssues.join("；") : `已检查 ${valid.length} 个有效分钟点，未发现未来数据。`,
    evidence: [
      valid.length ? `${formatTime(valid[0]?.time)}–${formatTime(valid.at(-1)?.time)}` : "无有效点",
      gapCount ? `缺口 ${gapCount} 处` : "午休断点按 A 股规则处理",
    ],
    layer: "fast",
    asOf: minutes.at(-1)?.time ?? null,
  });

  return { minutes, lastTime: cleanTime(minutes.at(-1)?.time), validCount: valid.length, futureCount };
}

function inspectPriceAndVwap(snapshot, minuteInfo, checks) {
  const minutes = minuteInfo.minutes;
  if (!minutes.length) return;
  const prices = minutes.map(point => toFinite(point?.price)).filter(value => value !== null && value > 0);
  const quotePrice = toFinite(snapshot.quote?.price);
  const lastPrice = prices.at(-1);
  const vwap = toFinite(snapshot.vwap) ?? toFinite(minutes.at(-1)?.averagePrice);
  const reasons = [];
  if (quotePrice !== null && lastPrice !== null && lastPrice > 0) {
    const driftPct = Math.abs(quotePrice - lastPrice) / lastPrice * 100;
    if (driftPct > 0.8) reasons.push(`现价与最后分钟价偏离 ${driftPct.toFixed(2)}%`);
  }
  if (vwap === null) reasons.push("VWAP 尚未形成");
  const status = reasons.some(reason => reason.includes("偏离")) ? "warning" : reasons.length ? "insufficient" : "healthy";
  addCheck(checks, {
    id: "price-vwap",
    label: "价格与 VWAP",
    status,
    detail: reasons.length ? reasons.join("；") : `最后价 ¥${lastPrice?.toFixed(2) ?? "--"}，VWAP ¥${vwap?.toFixed(2) ?? "--"}。`,
    evidence: [
      quotePrice === null ? "现价缺失" : `现价 ¥${quotePrice.toFixed(2)}`,
      vwap === null ? "均价缺失" : `均价 ¥${vwap.toFixed(2)}`,
    ],
    layer: "fast",
    asOf: minuteInfo.lastTime || null,
  });
}

function inspectSignals(snapshot, minuteInfo, checks) {
  const signals = [
    ...(Array.isArray(snapshot.formalActions) ? snapshot.formalActions.map(item => ({ ...item, kind: "formal" })) : []),
    ...(Array.isArray(snapshot.observations) ? snapshot.observations.map(item => ({ ...item, kind: item.stage === "candidate" ? "candidate" : "observation" })) : []),
    ...(Array.isArray(snapshot.shadowSignals) ? snapshot.shadowSignals.map(item => ({ ...item, kind: "shadow" })) : []),
  ];
  if (!signals.length) {
    addCheck(checks, {
      id: "signal-causality",
      label: "信号因果链",
      status: "insufficient",
      detail: "今天还没有可核对的正式、候选或影子信号。",
      layer: "fast",
    });
    return { signals, futureCount: 0, duplicates: 0 };
  }
  const asOfMinute = minuteNumber(snapshot.asOfTime ?? minuteInfo.lastTime);
  const keys = new Set();
  let duplicates = 0;
  let futureCount = 0;
  for (const signal of signals) {
    const time = cleanTime(signal.time ?? signal.asOfTime);
    const key = `${signal.kind}:${time}:${signal.side ?? signal.direction ?? ""}:${Number(signal.price ?? 0).toFixed(2)}`;
    if (keys.has(key)) duplicates += 1;
    keys.add(key);
    const signalMinute = minuteNumber(time);
    if (asOfMinute !== null && signalMinute !== null && signalMinute > asOfMinute) futureCount += 1;
  }
  const kinds = new Set(signals.map(signal => signal.kind));
  const issues = [];
  if (futureCount) issues.push(`${futureCount} 个信号时间晚于行情最新时间`);
  if (duplicates) issues.push(`${duplicates} 个信号与同一事件重复`);
  const layerEvidence = kinds.has("shadow") && kinds.has("formal")
    ? "正式与影子层已分开，不把影子结果当正式动作"
    : null;
  addCheck(checks, {
    id: "signal-causality",
    label: "信号因果链",
    status: futureCount ? "blocked" : duplicates ? "warning" : "healthy",
    detail: issues.length ? issues.join("；") : `已核对 ${signals.length} 个信号，时间不晚于最新行情。`,
    evidence: [
      ...[...kinds].map(kind => kind === "formal" ? "正式" : kind === "candidate" ? "候选" : kind === "shadow" ? "影子研究" : "观察"),
      ...(layerEvidence ? [layerEvidence] : []),
    ],
    layer: "fast",
    asOf: minuteInfo.lastTime || null,
  });
  return { signals, futureCount, duplicates };
}

function inspectL2(snapshot, checks) {
  if (!snapshot.requiresL2) return;
  const l2 = snapshot.l2 ?? {};
  const live = snapshot.marketLive !== false;
  if (!live) {
    addCheck(checks, { id: "l2", label: "L2 / 订单流", status: "healthy", detail: "当前是复盘或休市模式，L2 不参与实时判断。", layer: "fast" });
    return;
  }
  const stale = l2.stale === true || l2.status?.stale === true || snapshot.l2Stale === true;
  const connected = l2.status?.connected === true || l2.connected === true;
  addCheck(checks, {
    id: "l2",
    label: "L2 / 订单流",
    status: stale ? "warning" : connected ? "healthy" : "insufficient",
    detail: stale ? "L2 已过期；普通行情仍可独立检查，订单流观察暂停。" : connected ? "L2 连接与时间戳可用。" : "L2 尚未连接；不影响普通行情，但不能把订单流当作证据。",
    evidence: [connected ? "连接" : "未连接", stale ? "过期" : "时间戳有效"],
    layer: "fast",
    asOf: l2.lastExchangeTime ?? null,
  });
}

function inspectResearch(snapshot, checks) {
  const research = snapshot.shadowResearch;
  if (!research) return;
  const policy = research.policy ?? {};
  addCheck(checks, {
    id: "research-layer",
    label: "影子研究层",
    status: policy.researchOnly === true && policy.affectsFormalSignal === false ? "healthy" : "warning",
    detail: policy.researchOnly === true && policy.affectsFormalSignal === false
      ? "研究证据已隔离，不会改写正式信号。"
      : "研究层边界字段缺失，需要核查是否误入实时信号。",
    evidence: [policy.researchOnly === true ? "research-only" : "research-only 未确认", policy.affectsFormalSignal === false ? "不影响正式信号" : "影响边界未确认"],
    layer: "research",
    asOf: research.generatedAt ?? null,
  });
}

export function diagnoseAiMonitorSnapshot(snapshot = {}) {
  const checks = [];
  const minuteInfo = inspectMinutes(snapshot, checks);
  inspectPriceAndVwap(snapshot, minuteInfo, checks);
  const signalInfo = inspectSignals(snapshot, minuteInfo, checks);
  inspectL2(snapshot, checks);
  inspectResearch(snapshot, checks);

  const statuses = checks.map(check => check.status);
  const status = statuses.includes("blocked")
    ? "blocked"
    : statuses.includes("warning")
      ? "warning"
      : statuses.includes("insufficient")
        ? "insufficient"
        : "healthy";
  const hardIssues = checks.filter(check => check.status === "blocked");
  const softIssues = checks.filter(check => check.status === "warning");
  const insufficient = checks.filter(check => check.status === "insufficient");
  // A missing minute series is not a low-confidence signal; it is an
  // unscorable diagnostic state. Keep that distinction visible in the UI.
  const score = minuteInfo.validCount === 0
    ? null
    : Math.max(0, Math.min(100, 100 - hardIssues.length * 35 - softIssues.length * 14 - insufficient.length * 8));
  const headline = status === "healthy"
    ? "链路和日内图基本正常"
    : status === "blocked"
      ? "暂不判断：发现会影响可信度的问题"
      : status === "insufficient"
        ? "数据不足：先补齐行情再复盘"
        : "可以观察，但有项目需要核查";
  const firstIssue = [...hardIssues, ...softIssues, ...insufficient][0];
  const summary = status === "healthy"
    ? `已核对 ${minuteInfo.validCount} 个分钟点和 ${signalInfo.signals.length} 个信号，未发现未来数据或明显错位。`
    : firstIssue?.detail ?? "诊断未完成。";
  const actions = status === "blocked"
    ? ["暂停依据异常数据做决定", "刷新行情后重新诊断"]
    : status === "insufficient"
      ? ["等待分钟数据或连接恢复", "不要把空白当作没有信号"]
      : status === "warning"
        ? ["先看问题项的证据时间", "确认后再考虑正式信号"]
        : ["继续观察正式信号", "收盘后再看完整闭环"];
  return {
    version: 1,
    status,
    headline,
    summary,
    score,
    checks,
    actions,
    asOf: snapshot.asOf ?? snapshot.asOfTime ?? new Date().toISOString(),
    dataQuality: {
      minuteCount: minuteInfo.validCount,
      signalCount: signalInfo.signals.length,
      futureDataCount: minuteInfo.futureCount + signalInfo.futureCount,
      duplicateSignalCount: signalInfo.duplicates,
    },
    boundaries: {
      formalSignalUnchanged: true,
      shadowResearchOnly: true,
      canExecute: false,
    },
  };
}

export function mergeAiMonitorDiagnosis(localDiagnosis, remoteChecks = []) {
  const remote = Array.isArray(remoteChecks) ? remoteChecks : [];
  const base = localDiagnosis ?? diagnoseAiMonitorSnapshot({});
  const checks = [...remote, ...(base.checks ?? [])];
  const status = checks.some(check => check.status === "blocked")
    ? "blocked"
    : checks.some(check => check.status === "warning")
      ? "warning"
      : checks.some(check => check.status === "insufficient")
        ? "insufficient"
        : "healthy";
  const issue = checks.find(check => check.status === "blocked")
    ?? checks.find(check => check.status === "warning")
    ?? checks.find(check => check.status === "insufficient");
  return {
    ...base,
    status,
    headline: status === "healthy" ? "整条链路和日内图基本正常" : status === "blocked" ? "链路或图表存在阻断项" : status === "insufficient" ? "数据不足，暂不下结论" : "链路可用，但有项目需要核查",
    summary: status === "healthy" ? base.summary : issue?.detail ?? base.summary,
    checks,
    score: typeof base.score === "number"
      ? Math.max(0, Math.min(100, base.score - remote.filter(check => check.status === "blocked").length * 25 - remote.filter(check => check.status === "warning").length * 8))
      : null,
    asOf: new Date().toISOString(),
  };
}

export function normalizeAiMonitorRemoteCheck({ id, label, response, payload, error, latencyMs }) {
  const httpStatus = response?.status ?? null;
  if (error) return { id, label, status: "blocked", detail: `${label}请求失败：${error.message ?? String(error)}`, evidence: ["网络或服务未响应"], layer: "fast", latencyMs, httpStatus };
  const remoteStatus = statusForRemote({ ok: response?.ok, status: response?.status, httpStatus });
  if (payload == null) {
    const emptyResponse = response?.ok === true;
    return {
      id,
      label,
      status: emptyResponse ? "insufficient" : remoteStatus,
      detail: emptyResponse ? `${label}返回空或非 JSON 响应，无法核验内容。` : `${label}响应 ${httpStatus ?? "未知"}，未返回可解析内容。`,
      evidence: [httpStatus ? `HTTP ${httpStatus}` : "无状态码"],
      layer: "fast",
      latencyMs,
      httpStatus,
      asOf: null,
    };
  }
  const payloadError = payload?.error ?? payload?.errors?.[0];
  const status = payloadError && remoteStatus === "healthy" ? "warning" : remoteStatus;
  const detail = payloadError ? `${label}返回异常：${payloadError}` : `${label}响应 ${httpStatus ?? "未知"}`;
  return { id, label, status, detail, evidence: [httpStatus ? `HTTP ${httpStatus}` : "无状态码"], layer: "fast", latencyMs, httpStatus, asOf: payload?.fetchedAt ?? payload?.checkedAt ?? null };
}
