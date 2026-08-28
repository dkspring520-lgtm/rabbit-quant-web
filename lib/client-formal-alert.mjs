const SHANGHAI_DATE = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function requestError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function normalizeMarketDate(value) {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, 8);
  if (!/^\d{8}$/.test(digits)) throw requestError("交易日期无效");
  const normalized = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const parsed = new Date(`${normalized}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime()) || SHANGHAI_DATE.format(parsed) !== normalized) throw requestError("交易日期无效");
  return normalized;
}

function normalizeMarketTime(value) {
  const time = String(value ?? "").replace(/\D/g, "").slice(-4);
  if (!/^\d{4}$/.test(time)) throw requestError("信号时间无效");
  const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(2));
  const inSession = (minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30)
    || (minutes >= 13 * 60 && minutes <= 15 * 60);
  if (!inSession) throw requestError("信号时间不在A股交易时段");
  return time;
}

function assertRecentMarketDate(marketDate, now) {
  const current = new Date(`${SHANGHAI_DATE.format(now)}T00:00:00+08:00`);
  const target = new Date(`${marketDate}T00:00:00+08:00`);
  const ageDays = Math.round((current.getTime() - target.getTime()) / 86_400_000);
  if (ageDays < 0 || ageDays > 7) throw requestError("只能同步最近7天的正式信号");
}

export function normalizeClientFormalAlert(input, { monitors = [], now = new Date() } = {}) {
  const code = String(input?.code ?? "").replace(/\D/g, "").slice(0, 6);
  if (!/^\d{6}$/.test(code)) throw requestError("股票代码无效");
  const monitor = monitors.find(item => String(item?.code ?? "") === code);
  if (!monitor) throw requestError("只能同步当前账户监控股票的信号", 403);

  const marketDate = normalizeMarketDate(input?.marketDate);
  assertRecentMarketDate(marketDate, now);
  const time = normalizeMarketTime(input?.action?.time ?? input?.marketTime);
  const price = Number(input?.action?.price ?? input?.price);
  if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) throw requestError("信号价格无效");

  const direction = input?.action?.direction;
  const side = input?.action?.side;
  if (!["正T", "反T"].includes(direction)) throw requestError("做T方向无效");
  if (!["买入", "卖出", "买回"].includes(side)) throw requestError("信号动作无效");
  const validPair = direction === "正T" ? side === "买入" || side === "卖出" : side === "卖出" || side === "买回";
  if (!validPair) throw requestError("做T方向与动作不一致");

  const reason = String(input?.action?.reason ?? "客户端正式信号同步").replace(/\s+/g, " ").trim().slice(0, 400);
  const dateKey = marketDate.replace(/-/g, "");
  const eventKey = `${dateKey}:${code}:formal:client-v4:${direction}:${side}:${time}`;
  const actionLabel = direction === "反T" ? (side === "卖出" ? "先卖" : "买回") : (side === "卖出" ? "卖出" : "买入");

  return {
    code,
    level: "formal",
    title: `${String(monitor.name ?? code).slice(0, 40)} · ${direction}${actionLabel} · 正式`,
    message: `${time} ${side} ${price.toFixed(2)}，${reason || "客户端正式信号同步"}`,
    eventKey,
    marketDate,
    marketTime: time,
    payload: {
      source: "client-v4",
      marketDate,
      action: { time, price, side, direction, reason },
    },
  };
}
