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
    ...(Array.isArray(check.duplicateGroups) ? { duplicateGroups: check.duplicateGroups } : {}),
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
      label: "分时数据完整性",
      status: "insufficient",
      detail: "还没拿到今天的分时数据，暂时检查不了图表和提醒。",
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
  if (invalidCount) timeIssues.push(`${invalidCount} 条分时记录的时间或价格不完整`);
  if (duplicateTimes.size) timeIssues.push(`${duplicateTimes.size} 个时间点重复出现`);
  if (unsorted) timeIssues.push("分时数据没有按时间排列");
  if (gapCount) timeIssues.push(`${gapCount} 处分时数据中断`);
  if (futureCount) timeIssues.push(`${futureCount} 条分时记录的时间晚于最新行情`);

  addCheck(checks, {
    id: "intraday-axis",
    label: "分时数据顺序",
    status: futureCount || unsorted ? "blocked" : timeIssues.length ? "warning" : "healthy",
    detail: timeIssues.length ? timeIssues.join("；") : `今天的分时数据顺序正常，共 ${valid.length} 条。`,
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
    label: "现价和当天均价",
    status,
    detail: reasons.length
      ? reasons.map(reason => reason.includes("偏离") ? reason.replace("现价与最后分钟价偏离", "现价和最新分时价格相差") : reason.replace("VWAP 尚未形成", "当天均价还没算出来")).join("；")
      : `最新价 ¥${lastPrice?.toFixed(2) ?? "--"}，当天均价 ¥${vwap?.toFixed(2) ?? "--"}。`,
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
    ...(Array.isArray(snapshot.formalActions) ? snapshot.formalActions.map(item => ({ ...item, kind: "formal", sourceLabel: item.sourceLabel ?? "正式提醒" })) : []),
    ...(Array.isArray(snapshot.observations) ? snapshot.observations.map(item => ({
      ...item,
      kind: item.stage === "candidate" ? "candidate" : "observation",
      sourceLabel: item.sourceLabel ?? (item.strategy === "closure" ? "日内闭环" : item.strategy === "observation" ? "日内观察" : "图表观察"),
    })) : []),
    ...(Array.isArray(snapshot.shadowSignals) ? snapshot.shadowSignals.map(item => ({ ...item, kind: "shadow", sourceLabel: item.sourceLabel ?? "影子研究" })) : []),
  ];
  if (!signals.length) {
    addCheck(checks, {
      id: "signal-causality",
      label: "提醒记录是否重复",
      status: "insufficient",
      detail: "今天还没有正式提醒或观察点可核对。",
      layer: "fast",
    });
    return { signals, futureCount: 0, duplicates: 0, duplicateGroups: [], unverifiableCount: 0 };
  }
  const asOfMinute = minuteNumber(snapshot.asOfTime ?? minuteInfo.lastTime);
  const groupsByKey = new Map();
  let duplicates = 0;
  let futureCount = 0;
  let unverifiableCount = 0;
  for (const signal of signals) {
    const time = cleanTime(signal.time || signal.asOfTime);
    const stableEventId = [signal.eventKey, signal.observationId, signal.candidateKey, signal.watchKey]
      .find(value => value != null && String(value).trim());
    const price = toFinite(signal.price);
    const direction = String(signal.side || signal.direction || "").trim().toLowerCase();
    // Prefer event identities emitted by the signal producers. Only use the
    // approximate fallback when all three identifying fields are present;
    // otherwise unrelated incomplete records used to collapse into one key.
    const key = stableEventId != null
      ? `${signal.kind}:${signal.sourceLabel}:${signal.strategy ?? "unknown-strategy"}:${signal.observationKind ?? "unknown-observation"}:event:${String(stableEventId).trim()}`
      : time && price !== null && price > 0 && direction
        ? `${signal.kind}:approx:${signal.strategy ?? "unknown-strategy"}:${signal.observationKind ?? "unknown-observation"}:${signal.stage ?? "unknown-stage"}:${time}:${direction}:${price.toFixed(2)}`
        : null;
    if (!key) unverifiableCount += 1;
    else {
      const group = groupsByKey.get(key) ?? [];
      group.push({ ...signal, normalizedTime: time, normalizedPrice: price });
      groupsByKey.set(key, group);
      if (group.length > 1) duplicates += 1;
    }
    const signalMinute = minuteNumber(time);
    if (asOfMinute !== null && signalMinute !== null && signalMinute > asOfMinute) futureCount += 1;
  }
  const kindLabels = { formal: "正式提醒", candidate: "候选提醒", observation: "图上观察点", shadow: "试验信号" };
  const duplicateGroups = [...groupsByKey.values()]
    .filter(group => group.length > 1)
    .map(group => {
      const first = group[0];
      const sourceCounts = new Map();
      group.forEach(signal => sourceCounts.set(signal.sourceLabel, (sourceCounts.get(signal.sourceLabel) ?? 0) + 1));
      return {
        time: first.normalizedTime ? formatTime(first.normalizedTime) : "时间未知",
        type: kindLabels[first.kind] ?? "信号",
        direction: String(first.side ?? first.direction ?? "").trim() || null,
        price: first.normalizedPrice,
        copies: group.length,
        sources: [...sourceCounts].map(([source, count]) => count > 1 ? `${source} ×${count}` : source),
      };
    });
  const kinds = new Set(signals.map(signal => signal.kind));
  const issues = [];
  if (futureCount) issues.push(`${futureCount} 条信号的时间晚于最新行情`);
  if (duplicateGroups.length) issues.push(`发现 ${duplicateGroups.length} 个重复事件，合计多出 ${duplicates} 条记录；这是记录重复，不代表多出独立买卖机会，也不会改写正式信号`);
  if (unverifiableCount) issues.push(`${unverifiableCount} 条信号资料不全，暂时无法确认是否重复`);
  const layerEvidence = kinds.has("shadow") && kinds.has("formal")
    ? "正式提醒与试验信号分开，不会混成正式买卖信号"
    : null;
  addCheck(checks, {
    id: "signal-causality",
    label: "提醒记录是否重复",
    status: futureCount ? "blocked" : duplicateGroups.length ? "warning" : unverifiableCount ? "insufficient" : "healthy",
    detail: issues.length ? issues.join("；") : `核对了 ${signals.length} 条提醒和观察记录，没有发现重复。`,
    duplicateGroups,
    evidence: [
      ...[...kinds].map(kind => kindLabels[kind] ?? "观察信号"),
      ...(layerEvidence ? [layerEvidence] : []),
      ...(unverifiableCount ? [`${unverifiableCount} 条信息不全，未计入重复数`] : []),
    ],
    layer: "fast",
    asOf: minuteInfo.lastTime || null,
  });
  return { signals, futureCount, duplicates, duplicateGroups, unverifiableCount };
}

function inspectL2(snapshot, checks) {
  if (!snapshot.requiresL2) return;
  const l2 = snapshot.l2 ?? {};
  const live = snapshot.marketLive !== false;
  if (!live) {
    addCheck(checks, { id: "l2", label: "盘口数据", status: "healthy", detail: "现在不是实时交易时段，盘口数据不参与检查。", layer: "fast" });
    return;
  }
  const stale = l2.stale === true || l2.status?.stale === true || snapshot.l2Stale === true;
  const connected = l2.status?.connected === true || l2.connected === true;
  addCheck(checks, {
    id: "l2",
    label: "盘口数据",
    status: stale ? "warning" : connected ? "healthy" : "insufficient",
    detail: stale ? "盘口数据更新较慢，暂时不把它作为参考；普通行情仍可检查。" : connected ? "盘口数据已连接，可以查看。" : "盘口数据还没连接；普通行情检查不受影响。",
    evidence: [connected ? "已连接" : "未连接", stale ? "更新较慢" : "最近有更新"],
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
    label: "研究信息与正式提醒隔离",
    status: policy.researchOnly === true && policy.affectsFormalSignal === false ? "healthy" : "warning",
    detail: policy.researchOnly === true && policy.affectsFormalSignal === false
      ? "试验中的信号与正式提醒分开，不会改变正式提醒。"
      : "暂时无法确认试验信号是否与正式提醒分开。",
    evidence: [policy.researchOnly === true ? "仅作试验观察" : "试验隔离未确认", policy.affectsFormalSignal === false ? "不影响正式提醒" : "对正式提醒的影响未确认"],
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
  const headline = status === "healthy"
    ? "数据看起来正常"
    : status === "blocked"
      ? "时间对不上，先别依据这份图判断"
      : status === "insufficient"
        ? "数据不全，暂时看不准"
        : "有一项需要你确认";
  const firstIssue = checks.find(check => check.status === "blocked")
    ?? checks.find(check => check.status === "warning")
    ?? checks.find(check => check.status === "insufficient");
  const summary = status === "healthy"
    ? "今天的分时数据和提醒记录看起来正常。"
    : firstIssue?.detail ?? "诊断未完成。";
  const actions = status === "blocked"
    ? ["先不要依据这份数据判断", "等行情时间恢复后再检查"]
    : status === "insufficient"
      ? ["补齐缺少的数据后再看", "这不代表没有正式信号"]
      : status === "warning"
        ? ["先看下面标出的具体记录", "这项检查不会改写正式信号"]
        : ["网站和图表数据目前可用", "这项检查不替代正式信号"];
  return {
    version: 1,
    status,
    headline,
    summary,
    checks,
    actions,
    asOf: snapshot.asOf ?? snapshot.asOfTime ?? new Date().toISOString(),
    dataQuality: {
      minuteCount: minuteInfo.validCount,
      signalCount: signalInfo.signals.length,
      futureDataCount: minuteInfo.futureCount + signalInfo.futureCount,
      duplicateSignalCount: signalInfo.duplicates,
      duplicateEventCount: signalInfo.duplicateGroups.length,
      unverifiableSignalCount: signalInfo.unverifiableCount,
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
  const headline = status === "healthy" ? "网站和数据看起来正常"
    : status === "blocked" ? "时间对不上，先别依据这份图判断"
      : status === "insufficient" ? "数据不全，暂时看不准" : "有一项需要你确认";
  return {
    ...base,
    status,
    headline,
    summary: status === "healthy" ? base.summary : issue?.detail ?? base.summary,
    checks,
    asOf: new Date().toISOString(),
  };
}

export function normalizeAiMonitorRemoteCheck({ id, label, response, payload, error, latencyMs }) {
  const httpStatus = response?.status ?? null;
  if (error) return { id, label, status: "blocked", detail: `暂时连不上${label}，这项检查没完成。`, evidence: ["可能是连接中断或服务暂不可用", error.message ?? String(error)], layer: "fast", latencyMs, httpStatus };
  const remoteStatus = statusForRemote({ ok: response?.ok, status: response?.status, httpStatus });
  if (payload == null) {
    const emptyResponse = response?.ok === true;
    return {
      id,
      label,
      status: emptyResponse ? "insufficient" : remoteStatus,
      detail: emptyResponse ? `${label}没有返回可读取的数据，暂时无法核对。` : `${label}响应异常（${httpStatus ? `HTTP ${httpStatus}` : "状态未知"}），暂时无法核对。`,
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
