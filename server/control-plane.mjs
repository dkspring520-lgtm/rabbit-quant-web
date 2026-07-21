import { createServer } from "node:http";
import { createControlStore } from "./control-store.mjs";
import { runSmartTReplay } from "../lib/smart-t-engine.mjs";
import { selectLatestAlertableObservation } from "../lib/live-monitor-alerts.mjs";

const port = Number(process.env.CONTROL_PORT || 3010);
const databasePath = process.env.CONTROL_DB_PATH || "/data/rabbit-control.sqlite";
const marketOrigin = (process.env.MARKET_DATA_ORIGIN || "http://web:3000").replace(/\/$/, "");
const store = createControlStore(databasePath);
const COOKIE = "rabbit_control_session";
const scanState = { running: false, lastStartedAt: null, lastCompletedAt: null, monitored: 0, inserted: 0, logged: 0, marketErrors: 0, error: null };

function json(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), ...headers });
  res.end(body);
}

function readCookie(req, name) {
  const cookies = String(req.headers.cookie || "").split(";");
  for (const item of cookies) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function sessionCookie(token, expiresAt) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
}

function clearCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

async function bodyJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw Object.assign(new Error("请求内容过大"), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("请求格式不正确"), { status: 400 }); }
}

function requireUser(req) {
  const user = store.authenticate(readCookie(req, COOKIE));
  if (!user) throw Object.assign(new Error("请先登录"), { status: 401 });
  return user;
}

function requireAdmin(req) {
  const user = requireUser(req);
  if (user.role !== "admin") throw Object.assign(new Error("需要管理员权限"), { status: 403 });
  return user;
}

function shanghaiClock() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  const hhmm = `${parts.hour}${parts.minute}`;
  return { ...parts, hhmm, date: `${parts.year}${parts.month}${parts.day}` };
}

function isTradingWindow(clock = shanghaiClock()) {
  if (["Sat", "Sun"].includes(clock.weekday)) return false;
  return (clock.hhmm >= "0925" && clock.hhmm <= "1132") || (clock.hhmm >= "1258" && clock.hhmm <= "1502");
}

function minuteDistance(left, right) {
  const clean = value => String(value ?? "").replace(/\D/g, "").slice(0, 4);
  const a = clean(left); const b = clean(right);
  if (a.length !== 4 || b.length !== 4) return 999;
  return Math.abs((Number(a.slice(0, 2)) * 60 + Number(a.slice(2))) - (Number(b.slice(0, 2)) * 60 + Number(b.slice(2))));
}

function monitorOptions(monitor, quote) {
  const position = monitor.position || {};
  const plannedBase = Math.max(0, Number(position.plannedBase ?? position.openingShares ?? 0) || 0);
  const openingShares = Math.max(0, Number(position.openingShares ?? plannedBase) || 0);
  const sellable = Math.min(openingShares, Math.max(0, Number(position.sellable ?? openingShares) || 0));
  return {
    capital: 200_000, baseShares: openingShares, sellable, feeRate: .025, slippage: .02,
    minCommission: true, slippageMode: "percent", forceCloseTime: "1450", profile: monitor.profile || "平衡",
    previousClose: quote?.previousClose ?? null, randomValue: 0,
  };
}

function blockedReason(result) {
  const diagnostics = result?.diagnostics || {};
  const reasons = [
    ["cashBlocked", "可用资金或可卖底仓不足"],
    ["costBlocked", "预计波动尚不能覆盖费用和滑点"],
    ["regimeBlocked", "当前趋势结构与候选方向冲突"],
    ["strongTrendBlocked", "强趋势环境禁止逆势开仓"],
    ["counterTrendQualityBlocked", "逆势反转质量不足"],
    ["scoreBlocked", "趋势、量价和位置综合分未达正式门槛"],
    ["structureBlocked", "尚未形成可确认的峰谷结构"],
    ["qualityBlocked", "成交量或价格确认不足"],
    ["timingBlocked", "当前时间不在允许的新开仓窗口"],
    ["openingChaseBlocked", "开盘波动过快，已拦截追涨杀跌"],
    ["orderFlowBlocked", "盘口/主动买卖量确认不足"],
  ].filter(([key]) => Number(diagnostics[key] || 0) > 0).sort((a, b) => Number(diagnostics[b[0]]) - Number(diagnostics[a[0]]));
  if (reasons.length) return `${reasons[0][1]}（本轮拦截 ${diagnostics[reasons[0][0]]} 次）`;
  if (Number(diagnostics.candidates || 0) > 0) return `已有 ${diagnostics.candidates} 个候选，但尚未同时通过趋势、量价、成本与风控`;
  return "当前分钟尚未形成达到提醒门槛的因果候选";
}

function evaluateCausalMonitor(monitor, market, clock) {
  const minutes = Array.isArray(market?.minutes) ? market.minutes : [];
  if (!minutes.length) return { alert: null, audit: { marketTime: clock.hhmm, price: market?.quote?.price ?? null, result: "no_data", reason: "行情源未返回有效分时点", provider: market?.provider ?? null } };
  const result = runSmartTReplay(minutes, monitorOptions(monitor, market.quote));
  const action = result.actions?.at(-1);
  const observation = selectLatestAlertableObservation(result.observations || []);
  const latestPoint = minutes.at(-1);
  const auditBase = { marketTime: latestPoint?.time || clock.hhmm, price: market?.quote?.price ?? latestPoint?.price ?? null, provider: market.provider ?? null };
  const formalIsNew = action && minuteDistance(action.time, clock.hhmm) <= 2;
  const candidateIsNew = observation && minuteDistance(observation.time, clock.hhmm) <= 2;
  if (formalIsNew) {
    const phase = action.meta?.phase === "exit" ? "闭环" : "执行";
    const alert = {
      code: monitor.code,
      level: "formal",
      title: `${monitor.name} · ${action.direction || "做T"}${phase}提醒`,
      message: `${action.time} ${action.side} ${Number(action.price).toFixed(2)}，${action.reason || "V4 因果条件已确认"}`,
      eventKey: `${clock.date}:${monitor.code}:formal:${action.cycleId}:${action.meta?.phase || "entry"}:${action.time}`,
      marketTime: action.time,
      payload: { action, diagnostics: result.diagnostics, provider: market.provider },
    };
    return { alert, audit: { ...auditBase, marketTime: action.time, result: "formal", reason: action.reason || "V4 因果条件已确认", eventKey: alert.eventKey } };
  }
  if (candidateIsNew) {
    const alert = {
      code: monitor.code,
      level: observation.stage === "candidate" ? "candidate" : "watch",
      title: `${monitor.name} · ${observation.confirmationLabel || "候选观察"}`,
      message: `${observation.time} ${observation.reason || "价格与 VWAP 出现显著偏离，等待确认"}`,
      eventKey: `${clock.date}:${monitor.code}:${observation.stage}:${observation.direction}:${observation.time}:${Math.round(Number(observation.price) * 100)}`,
      marketTime: observation.time,
      payload: { observation, diagnostics: result.diagnostics, provider: market.provider },
    };
    return { alert, audit: { ...auditBase, marketTime: observation.time, result: observation.stage === "candidate" ? "candidate" : "watch", reason: observation.reason || "价格与 VWAP 出现显著偏离，等待确认", eventKey: alert.eventKey } };
  }
  return { alert: null, audit: { ...auditBase, result: "no_signal", reason: blockedReason(result), eventKey: null } };
}

function latestCausalAlert(monitor, market, clock) { return evaluateCausalMonitor(monitor, market, clock).alert; }

async function fetchMarket(code) {
  const response = await fetch(`${marketOrigin}/api/market-data?code=${encodeURIComponent(code)}&mode=trial-realtime`, {
    signal: AbortSignal.timeout(12_000), headers: { "user-agent": "RabbitQuantControl/1.0" },
  });
  if (!response.ok) throw new Error(`行情 ${code} 返回 ${response.status}`);
  return response.json();
}

async function scanMonitors({ force = false } = {}) {
  if (scanState.running || (!force && !isTradingWindow())) return { ...scanState, skipped: true };
  scanState.running = true;
  scanState.lastStartedAt = new Date().toISOString();
  scanState.error = null;
  scanState.inserted = 0;
  scanState.logged = 0;
  scanState.marketErrors = 0;
  try {
    const monitors = store.listActiveMonitors();
    const byCode = new Map();
    for (const monitor of monitors) {
      if (!byCode.has(monitor.code)) byCode.set(monitor.code, []);
      byCode.get(monitor.code).push(monitor);
    }
    scanState.monitored = monitors.length;
    const markets = new Map();
    await Promise.all([...byCode.keys()].map(async code => {
      try { markets.set(code, await fetchMarket(code)); }
      catch (error) { markets.set(code, { error: error instanceof Error ? error.message : String(error) }); }
    }));
    const clock = shanghaiClock();
    for (const monitor of monitors) {
      const market = markets.get(monitor.code);
      if (!market || market.error) {
        scanState.marketErrors += 1;
        store.recordMonitorScan(monitor.userId, { code: monitor.code, name: monitor.name, marketDate: clock.date, marketTime: clock.hhmm, price: null, result: "market_error", reason: market?.error || "行情请求失败", provider: null });
        scanState.logged += 1;
        continue;
      }
      const evaluation = evaluateCausalMonitor(monitor, market, clock);
      const alert = evaluation.alert;
      if (alert && store.addAlert(monitor.userId, alert)) scanState.inserted += 1;
      store.recordMonitorScan(monitor.userId, { code: monitor.code, name: monitor.name, marketDate: clock.date, ...evaluation.audit });
      scanState.logged += 1;
    }
    scanState.lastCompletedAt = new Date().toISOString();
    return { ...scanState, skipped: false };
  } catch (error) {
    scanState.error = error instanceof Error ? error.message : String(error);
    return { ...scanState, skipped: false };
  } finally { scanState.running = false; }
}

async function dispatch(req, res) {
  const url = new URL(req.url || "/", "http://control.local");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  try {
    if (req.method === "OPTIONS") return json(res, 204, {});
    if (req.method === "GET" && path === "/health") return json(res, 200, { ok: true, database: true, scanner: scanState, tradingWindow: isTradingWindow() });
    if (req.method === "POST" && path === "/auth/register") {
      const body = await bodyJson(req);
      store.register(body);
      const auth = store.login(body);
      return json(res, 201, { user: auth.user }, { "set-cookie": sessionCookie(auth.token, auth.expiresAt) });
    }
    if (req.method === "POST" && path === "/auth/login") {
      const auth = store.login(await bodyJson(req));
      return json(res, 200, { user: auth.user }, { "set-cookie": sessionCookie(auth.token, auth.expiresAt) });
    }
    if (req.method === "POST" && path === "/auth/logout") {
      store.logout(readCookie(req, COOKIE));
      return json(res, 200, { ok: true }, { "set-cookie": clearCookie() });
    }
    if (req.method === "GET" && path === "/auth/session") return json(res, 200, { user: requireUser(req) });
    if (req.method === "POST" && path === "/auth/reset-request") {
      const body = await bodyJson(req); store.requestReset(body.username);
      return json(res, 200, { ok: true, message: "申请已记录；管理员可在会员后台生成 30 分钟有效的重置码。" });
    }
    if (req.method === "POST" && path === "/auth/reset") {
      const body = await bodyJson(req); store.resetPassword(body.token, body.password);
      return json(res, 200, { ok: true, message: "密码已更新，请重新登录。" }, { "set-cookie": clearCookie() });
    }
    if (req.method === "GET" && path === "/profile") return json(res, 200, store.getProfile(requireUser(req).id));
    if (req.method === "PUT" && path === "/profile") return json(res, 200, store.putProfile(requireUser(req).id, (await bodyJson(req)).data));
    if (req.method === "GET" && path === "/monitors") {
      const user=requireUser(req); const limit=user.role==="admin"?30:5;
      return json(res, 200, { monitors: store.listMonitors(user.id).slice(0,limit), limit });
    }
    if (req.method === "PUT" && path === "/monitors") {
      const user=requireUser(req); const limit=user.role==="admin"?30:5;
      return json(res, 200, { monitors: store.replaceMonitors(user.id, (await bodyJson(req)).monitors, { maxMonitors: limit }), limit });
    }
    if (req.method === "GET" && path === "/alerts") return json(res, 200, { alerts: store.listAlerts(requireUser(req).id, { afterId: url.searchParams.get("afterId"), limit: url.searchParams.get("limit") }) });
    if (req.method === "GET" && path === "/alert-log") return json(res, 200, { logs: store.listMonitorScans(requireUser(req).id, { code: url.searchParams.get("code"), limit: url.searchParams.get("limit") }) });
    if (req.method === "POST" && /^\/alerts\/\d+\/delivery$/.test(path)) {
      const user = requireUser(req); const id = Number(path.split("/")[2]);
      return json(res, 200, { delivery: store.markAlertDelivery(user.id, id, await bodyJson(req)) });
    }
    if (req.method === "POST" && /^\/alerts\/\d+\/ack$/.test(path)) {
      store.acknowledgeAlert(requireUser(req).id, Number(path.split("/")[2])); return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && path === "/scanner/run") { requireAdmin(req); return json(res, 200, await scanMonitors({ force: true })); }
    if (req.method === "GET" && path === "/admin/members") { requireAdmin(req); return json(res, 200, { members: store.listMembers() }); }
    if (req.method === "PATCH" && /^\/admin\/members\/[^/]+$/.test(path)) {
      requireAdmin(req); const id = path.split("/")[3]; return json(res, 200, { user: store.setMemberStatus(id, (await bodyJson(req)).status) });
    }
    if (req.method === "POST" && /^\/admin\/members\/[^/]+\/reset$/.test(path)) {
      requireAdmin(req); const id = path.split("/")[3]; return json(res, 200, store.issueReset(id));
    }
    return json(res, 404, { error: "接口不存在" });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error("[control]", error);
    return json(res, status, { error: error instanceof Error ? error.message : "服务异常" });
  }
}

const server = createServer(dispatch);
server.listen(port, "0.0.0.0", () => console.log(`[control] listening on 0.0.0.0:${port}; database=${databasePath}`));
const timer = setInterval(() => void scanMonitors(), Math.max(5_000, Number(process.env.MONITOR_INTERVAL_MS || 15_000)));
timer.unref();
process.on("SIGTERM", () => { clearInterval(timer); server.close(() => { store.close(); process.exit(0); }); });

export { scanMonitors, latestCausalAlert, evaluateCausalMonitor, isTradingWindow };
