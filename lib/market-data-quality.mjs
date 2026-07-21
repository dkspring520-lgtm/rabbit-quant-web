const PROVIDER_LABELS = Object.freeze({
  "tencent-public": "腾讯公开行情",
  "sina-public": "新浪公开行情",
  "eastmoney-public": "东方财富公开行情",
});

function shanghaiParts(now) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function cleanMinute(value) {
  const text = String(value ?? "").replace(/\D/g, "").slice(0, 4);
  return /^\d{4}$/.test(text) ? text : null;
}

function minuteNumber(value) {
  const text = cleanMinute(value);
  return text ? Number(text.slice(0, 2)) * 60 + Number(text.slice(2)) : null;
}

function marketPhase(parts) {
  if (["Sat", "Sun"].includes(parts.weekday)) return "closed";
  const hhmm = `${parts.hour}${parts.minute}`;
  if (hhmm >= "0915" && hhmm < "0930") return "auction";
  if (hhmm >= "0930" && hhmm <= "1130") return "morning";
  if (hhmm > "1130" && hhmm < "1300") return "lunch";
  if (hhmm >= "1300" && hhmm <= "1500") return "afternoon";
  if (hhmm > "1500" && hhmm <= "1530") return "after-hours";
  return "closed";
}

function expectedMinuteCount(hhmm, phase) {
  const current = minuteNumber(hhmm);
  if (current === null) return 0;
  if (phase === "morning") return Math.max(1, current - (9 * 60 + 30) + 1);
  if (phase === "afternoon") return 121 + Math.max(1, current - 13 * 60 + 1);
  return 0;
}

function minuteLag(hhmm, lastMinute, phase) {
  const current = minuteNumber(hhmm);
  const latest = minuteNumber(lastMinute);
  if (current === null || latest === null) return null;
  if (phase === "afternoon" && latest <= 11 * 60 + 30) return current - latest - 90;
  return Math.max(0, current - latest);
}

export function assessMarketDataQuality({
  provider,
  sourceTimestamp = null,
  fetchedAt = new Date().toISOString(),
  minutes = [],
  now = new Date(),
  requestedRealtime = false,
  quoteFailures = [],
  minuteFailures = [],
} = {}) {
  const parts = shanghaiParts(now);
  const hhmm = `${parts.hour}${parts.minute}`;
  const phase = marketPhase(parts);
  const continuousTrading = phase === "morning" || phase === "afternoon";
  const sourceMillis = sourceTimestamp ? Date.parse(sourceTimestamp) : Number.NaN;
  const quoteAgeSeconds = Number.isFinite(sourceMillis) ? Math.round((now.getTime() - sourceMillis) / 1000) : null;
  const validMinutes = Array.isArray(minutes) ? minutes.filter((point) => cleanMinute(point?.time) && Number.isFinite(Number(point?.price)) && Number(point.price) > 0) : [];
  const lastMinute = cleanMinute(validMinutes.at(-1)?.time);
  const lagMinutes = continuousTrading ? minuteLag(hhmm, lastMinute, phase) : null;
  const expectedMinutes = expectedMinuteCount(hhmm, phase);
  const missingMinutes = continuousTrading ? Math.max(0, expectedMinutes - validMinutes.length) : 0;
  const fallbackUsed = Boolean(provider && provider !== "tencent-public");
  const reasons = [];

  if (requestedRealtime && continuousTrading) {
    if (!Number.isFinite(sourceMillis)) reasons.push("报价时间无法验证");
    else if (quoteAgeSeconds < -30) reasons.push("报价时间异常");
    else if (quoteAgeSeconds > 90) reasons.push(`报价已延迟 ${quoteAgeSeconds} 秒`);
    if (!validMinutes.length) reasons.push("当日分时尚无有效数据");
    else if (lagMinutes !== null && lagMinutes > 3) reasons.push(`分时落后约 ${lagMinutes} 分钟`);
    if (missingMinutes > 5) reasons.push(`当日分时缺少约 ${missingMinutes} 个分钟点`);
  }
  if (fallbackUsed) reasons.push(`主行情源已降级到 ${PROVIDER_LABELS[provider] ?? provider}`);

  const signalEligible = requestedRealtime && continuousTrading && reasons.every((reason) => !/\u65e0\u6cd5\u9a8c\u8bc1|\u5f02\u5e38|\u5ef6\u8fdf|\u5c1a\u65e0|\u843d\u540e|\u7f3a\u5c11/.test(reason));
  const status = !continuousTrading
    ? "closed"
    : signalEligible
      ? (fallbackUsed ? "degraded" : "live")
      : "blocked";

  return {
    status,
    signalEligible,
    phase,
    provider: provider ?? null,
    providerLabel: PROVIDER_LABELS[provider] ?? provider ?? "未知数据源",
    fallbackUsed,
    sourceTimestamp,
    fetchedAt,
    quoteAgeSeconds,
    minuteCount: validMinutes.length,
    expectedMinuteCount: expectedMinutes,
    missingMinutes,
    lastMinute,
    minuteLag: lagMinutes,
    reasons,
    failures: [...quoteFailures, ...minuteFailures],
  };
}

export { marketPhase };
