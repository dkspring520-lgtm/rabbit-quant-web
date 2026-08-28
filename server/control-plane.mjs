import { createServer } from "node:http";
import { createCipheriv, createHash, createPrivateKey, createPublicKey, createSign, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import { createControlStore } from "./control-store.mjs";
import { runSmartTReplay } from "../lib/smart-t-engine.mjs";
import { resolveBacktestStrategyExperiment } from "../lib/zijin-strategy-experiments.mjs";
import { selectLatestAlertableObservation } from "../lib/live-monitor-alerts.mjs";
import { resolveAlertDelivery } from "../lib/alert-delivery-policy.mjs";
import { evaluateScannerHealth } from "../lib/server-monitor-health.mjs";
import { advanceScannerWatchdog } from "../lib/scanner-watchdog.mjs";
import { watchlistLimitForRole } from "../lib/watchlist-limits.mjs";
import { normalizeClientFormalAlert } from "../lib/client-formal-alert.mjs";

const port = Number(process.env.CONTROL_PORT || 3010);
const databasePath = process.env.CONTROL_DB_PATH || "/data/rabbit-control.sqlite";
const marketOrigin = (process.env.MARKET_DATA_ORIGIN || "http://web:3000").replace(/\/$/, "");
const monitorIntervalMs = Math.max(5_000, Number(process.env.MONITOR_INTERVAL_MS || 15_000));
const serviceStartedAt = Date.now();
const store = createControlStore(databasePath);
const COOKIE = "rabbit_control_session";
const scanState = { running: false, lastStartedAt: null, lastCompletedAt: null, monitored: 0, inserted: 0, logged: 0, marketErrors: 0, error: null };
let watchdogFailures = 0;
let shuttingDown = false;

const PUSH_VAPID_SETTING = "web_push_vapid_v1";

function base64Url(value) { return Buffer.from(value).toString("base64url"); }
function fromBase64Url(value) { return Buffer.from(String(value || ""), "base64url"); }
function publicKeyBytes(jwk) { return Buffer.concat([Buffer.from([4]), fromBase64Url(jwk.x), fromBase64Url(jwk.y)]); }

function vapidKeys() {
  const stored = store.getServiceSetting(PUSH_VAPID_SETTING);
  if (stored?.publicJwk?.x && stored?.publicJwk?.y && stored?.privateJwk?.d) return stored;
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const value = { publicJwk: pair.publicKey.export({ format: "jwk" }), privateJwk: pair.privateKey.export({ format: "jwk" }) };
  return store.putServiceSetting(PUSH_VAPID_SETTING, value);
}

function pushPublicKey() { return base64Url(publicKeyBytes(vapidKeys().publicJwk)); }

function hkdf(ikm, salt, info, length) { return Buffer.from(hkdfSync("sha256", ikm, salt, info, length)); }

function encryptPushPayload(subscription, payload) {
  const clientPublic = fromBase64Url(subscription.p256dh);
  if (clientPublic.length !== 65 || clientPublic[0] !== 4) throw new Error("推送公钥无效");
  const clientPublicJwk = { kty: "EC", crv: "P-256", x: base64Url(clientPublic.subarray(1, 33)), y: base64Url(clientPublic.subarray(33, 65)) };
  const clientPublicKey = createPublicKey({ key: clientPublicJwk, format: "jwk" });
  const serverPair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const serverPublic = publicKeyBytes(serverPair.publicKey.export({ format: "jwk" }));
  const sharedSecret = diffieHellman({ privateKey: serverPair.privateKey, publicKey: clientPublicKey });
  const authSecret = fromBase64Url(subscription.auth);
  const prk = hkdf(sharedSecret, authSecret, Buffer.concat([Buffer.from("WebPush: info\0"), clientPublic, serverPublic]), 32);
  const salt = randomBytes(16);
  const contentKey = hkdf(prk, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(prk, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = createCipheriv("aes-128-gcm", contentKey, nonce);
  const plaintext = Buffer.concat([Buffer.from(JSON.stringify(payload), "utf8"), Buffer.from([2])]);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.concat([salt, Buffer.from([0, 0, 16, 0, serverPublic.length]), serverPublic]);
  return Buffer.concat([header, encrypted]);
}

function vapidAuthorization(endpoint) {
  const keys = vapidKeys();
  const header = base64Url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = base64Url(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: "mailto:notify@zhuandianmi.com" }));
  const signer = createSign("SHA256"); signer.update(`${header}.${payload}`); signer.end();
  const signature = signer.sign({ key: createPrivateKey({ key: keys.privateJwk, format: "jwk" }), dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${payload}.${base64Url(signature)}, k=${pushPublicKey()}`;
}

async function deliverPushToUser(userId, alert) {
  const subscriptions = store.listPushSubscriptions(userId);
  if (!subscriptions.length) return { delivered: 0, failed: 0 };
  const payload = {
    title: `双兔助手 · ${String(alert.title || "新提醒").slice(0, 60)}`,
    body: String(alert.message || "有新的做T提醒，请打开操盘台查看。").slice(0, 180),
    tag: `rabbit-${String(alert.eventKey || Date.now()).slice(-120)}`,
    url: "/?view=desk",
    level: alert.level || "candidate",
  };
  const results = await Promise.all(subscriptions.map(async subscription => {
    try {
      const response = await fetch(subscription.endpoint, {
        method: "POST", body: encryptPushPayload(subscription, payload), signal: AbortSignal.timeout(10_000),
        headers: { "TTL": alert.level === "formal" ? "900" : "300", "Urgency": alert.level === "formal" ? "high" : "normal", "Content-Type": "application/octet-stream", "Content-Encoding": "aes128gcm", "Authorization": vapidAuthorization(subscription.endpoint) },
      });
      if (!response.ok) throw Object.assign(new Error(`推送服务返回 ${response.status}`), { status: response.status });
      store.recordPushDelivery(subscription.endpoint, { success: true });
      return true;
    } catch (error) {
      const status = Number(error?.status) || 0;
      if (status === 404 || status === 410) store.removePushSubscription(userId, subscription.endpoint);
      else store.recordPushDelivery(subscription.endpoint, { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }));
  return { delivered: results.filter(Boolean).length, failed: results.filter(value => !value).length };
}

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

function referralSourceHash(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.socket.remoteAddress || "")
    .split(",")[0].trim();
  if (!forwarded) return "";
  return createHash("sha256").update(`rabbit-referral-v1:${forwarded}`).digest("hex");
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
  const experiment = resolveBacktestStrategyExperiment(monitor.code, "closure-first");
  return {
    capital: 200_000, baseShares: openingShares, sellable, feeRate: .025, slippage: .02,
    minCommission: true, slippageMode: "percent", forceCloseTime: "1450", profile: experiment.profile || monitor.profile || "平衡",
    previousClose: quote?.previousClose ?? null, randomValue: 0,
    profileOverrides: experiment.profileOverrides,
    positionSizeMode: experiment.positionSizeMode,
    volatilityMode: experiment.volatilityMode,
    strategyVersion: experiment.label,
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
  if (market?.quality?.signalEligible === false) {
    const reason = Array.isArray(market.quality.reasons) && market.quality.reasons.length
      ? market.quality.reasons.join("；")
      : "当前行情不满足实时信号质量要求";
    return { alert: null, audit: { marketTime: market.quality.lastMinute || clock.hhmm, price: market?.quote?.price ?? null, result: "data_blocked", reason: `行情质量门禁：${reason}`, provider: market?.provider ?? null } };
  }
  if (!minutes.length) return { alert: null, audit: { marketTime: clock.hhmm, price: market?.quote?.price ?? null, result: "no_data", reason: "行情源未返回有效分时点", provider: market?.provider ?? null } };
  const result = runSmartTReplay(minutes, monitorOptions(monitor, market.quote));
  const action = result.actions?.at(-1);
  const observation = selectLatestAlertableObservation(result.observations || []);
  const coverageObservation = [...(result.observations || [])].reverse().find((item) => item?.coverageOnly);
  const latestPoint = minutes.at(-1);
  const auditBase = { marketTime: latestPoint?.time || clock.hhmm, price: market?.quote?.price ?? latestPoint?.price ?? null, provider: market.provider ?? null };
  const formalIsNew = action && minuteDistance(action.time, clock.hhmm) <= 2;
  const candidateIsNew = observation && minuteDistance(observation.time, clock.hhmm) <= 2;
  const coverageIsNew = coverageObservation && minuteDistance(coverageObservation.time, clock.hhmm) <= 2;
  if (formalIsNew) {
    const sideLabel = /卖/.test(String(action.side || ""))
      ? "卖出"
      : action.direction === "反T"
        ? "买回"
        : "买入";
    const alert = {
      code: monitor.code,
      level: "formal",
      title: `${monitor.name} · ${action.direction || "做T"}${sideLabel} · 正式`,
      message: `${action.time} ${action.side} ${Number(action.price).toFixed(2)}，${action.reason || "V4 因果条件已确认"}`,
      eventKey: `${clock.date}:${monitor.code}:formal:${action.cycleId}:${action.meta?.phase || "entry"}:${action.time}`,
      marketDate: clock.date,
      marketTime: action.time,
      payload: { action, diagnostics: result.diagnostics, provider: market.provider, quality: market.quality ?? null },
    };
    return { alert, audit: { ...auditBase, marketTime: action.time, result: "formal", reason: action.reason || "V4 因果条件已确认", eventKey: alert.eventKey } };
  }
  if (candidateIsNew) {
    const candidateLabel = observation.direction === "反T" ? "高位候选观察" : observation.direction === "正T" ? "低位候选观察" : "候选观察";
    const alert = {
      code: monitor.code,
      level: observation.stage === "candidate" ? "candidate" : "watch",
      title: `${monitor.name} · ${candidateLabel}`,
      message: `${observation.time} ${observation.reason || "价格与 VWAP 出现显著偏离，等待确认"}`,
      eventKey: `${clock.date}:${monitor.code}:${observation.stage}:${observation.direction}:${observation.time}:${Math.round(Number(observation.price) * 100)}`,
      marketDate: clock.date,
      marketTime: observation.time,
      payload: { observation, diagnostics: result.diagnostics, provider: market.provider, quality: market.quality ?? null },
    };
    return { alert, audit: { ...auditBase, marketTime: observation.time, result: observation.stage === "candidate" ? "candidate" : "watch", reason: observation.reason || "价格与 VWAP 出现显著偏离，等待确认", eventKey: alert.eventKey } };
  }
  if (coverageIsNew) {
    return { alert: null, audit: {
      ...auditBase,
      marketTime: coverageObservation.time,
      result: "coverage",
      reason: "全覆盖研究候选，仅供监控参考；不发提醒、不进入胜率或收益。",
      eventKey: `${clock.date}:${monitor.code}:coverage:${coverageObservation.direction}:${coverageObservation.time}`,
    } };
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
      const delivery = alert
        ? resolveAlertDelivery({ previous: store.latestAlertForCode(monitor.userId, monitor.code), next: alert })
        : null;
      const deliverableAlert = delivery?.deliver ? delivery.alert : null;
      if (deliverableAlert && store.addAlert(monitor.userId, deliverableAlert)) {
        scanState.inserted += 1;
        void deliverPushToUser(monitor.userId, deliverableAlert).catch(error => console.error("[control] push delivery", error));
      }
      const audit = alert && !deliverableAlert
        ? { ...evaluation.audit, result: "alert_suppressed", reason: `提醒限频：${delivery?.reason || "重复候选"}`, eventKey: null }
        : deliverableAlert?.level === "risk" && alert?.level === "formal"
          ? { ...evaluation.audit, result: "direction_conflict", reason: deliverableAlert.message, eventKey: deliverableAlert.eventKey }
          : evaluation.audit;
      store.recordMonitorScan(monitor.userId, { code: monitor.code, name: monitor.name, marketDate: clock.date, ...audit });
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
    if (req.method === "GET" && path === "/health") {
      const tradingWindow = isTradingWindow();
      const scannerHealth = evaluateScannerHealth(scanState, { serviceStartedAt, intervalMs: monitorIntervalMs, tradingWindow });
      return json(res, scannerHealth.healthy ? 200 : 503, {
        ok: scannerHealth.healthy,
        database: true,
        scanner: { ...scanState, health: scannerHealth },
        tradingWindow,
      });
    }
    if (req.method === "POST" && path === "/auth/register") {
      const body = await bodyJson(req);
      store.register({ ...body, referralSourceHash: referralSourceHash(req) });
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
      const user=requireUser(req); const limit=watchlistLimitForRole(user.role,user.membership?.active===true,user.membership?.planId);
      return json(res, 200, { monitors: store.listMonitors(user.id).slice(0,limit), limit });
    }
    if (req.method === "PUT" && path === "/monitors") {
      const user=requireUser(req); const limit=watchlistLimitForRole(user.role,user.membership?.active===true,user.membership?.planId);
      return json(res, 200, { monitors: store.replaceMonitors(user.id, (await bodyJson(req)).monitors, { maxMonitors: limit }), limit });
    }
    if (req.method === "GET" && path === "/alerts") return json(res, 200, { alerts: store.listAlerts(requireUser(req).id, { afterId: url.searchParams.get("afterId"), limit: url.searchParams.get("limit") }) });
    if (req.method === "POST" && path === "/alerts") {
      const user = requireUser(req);
      const alert = normalizeClientFormalAlert(await bodyJson(req), { monitors: store.listMonitors(user.id) });
      const stored = store.addAlert(user.id, alert);
      return json(res, stored ? 201 : 200, { stored, deduplicated: !stored, eventKey: alert.eventKey });
    }
    if (req.method === "GET" && path === "/push/public-key") {
      const user = requireUser(req);
      return json(res, 200, { publicKey: pushPublicKey(), enabled: store.listPushSubscriptions(user.id).length > 0 });
    }
    if (req.method === "POST" && path === "/push/subscriptions") {
      const user = requireUser(req);
      return json(res, 201, store.savePushSubscription(user.id, (await bodyJson(req)).subscription));
    }
    if (req.method === "DELETE" && path === "/push/subscriptions") {
      const user = requireUser(req);
      return json(res, 200, { removed: store.removePushSubscription(user.id, (await bodyJson(req)).endpoint) });
    }
    if (req.method === "POST" && path === "/push/test") {
      const user = requireUser(req);
      const result = await deliverPushToUser(user.id, { title: "后台推送测试", message: "后台系统通知已连通；正式信号出现时会在这里提醒。", eventKey: `test:${Date.now()}`, level: "formal" });
      return json(res, 200, { ok: result.delivered > 0, ...result });
    }
    if (req.method === "GET" && path === "/alert-log") return json(res, 200, { logs: store.listMonitorScans(requireUser(req).id, { code: url.searchParams.get("code"), limit: url.searchParams.get("limit") }) });
    if (req.method === "POST" && /^\/alerts\/\d+\/delivery$/.test(path)) {
      const user = requireUser(req); const id = Number(path.split("/")[2]);
      return json(res, 200, { delivery: store.markAlertDelivery(user.id, id, await bodyJson(req)) });
    }
    if (req.method === "POST" && /^\/alerts\/\d+\/ack$/.test(path)) {
      store.acknowledgeAlert(requireUser(req).id, Number(path.split("/")[2])); return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && path === "/scanner/run") { requireAdmin(req); return json(res, 200, await scanMonitors({ force: true })); }
    if (req.method === "GET" && path === "/referrals/leaderboard") {
      requireUser(req);
      return json(res, 200, { leaderboard: store.referralLeaderboard(url.searchParams.get("limit")) });
    }
    if (req.method === "POST" && path === "/membership/redeem") {
      const user = requireUser(req);
      return json(res, 200, store.redeemMembershipCode(user.id, (await bodyJson(req)).code));
    }
    if (req.method === "GET" && path === "/admin/members") { requireAdmin(req); return json(res, 200, { members: store.listMembers() }); }
    if (req.method === "GET" && path === "/admin/membership-codes") {
      requireAdmin(req);
      return json(res, 200, { codes: store.listMembershipCodes({ limit: url.searchParams.get("limit") }) });
    }
    if (req.method === "POST" && path === "/admin/membership-codes") {
      const admin = requireAdmin(req);
      return json(res, 201, { codes: store.createMembershipCodes(admin.id, await bodyJson(req)) });
    }
    if (req.method === "PATCH" && /^\/admin\/members\/[^/]+$/.test(path)) {
      requireAdmin(req); const id = path.split("/")[3]; return json(res, 200, { user: store.setMemberStatus(id, (await bodyJson(req)).status) });
    }
    if (req.method === "POST" && /^\/admin\/members\/[^/]+\/reset$/.test(path)) {
      requireAdmin(req); const id = path.split("/")[3]; return json(res, 200, store.issueReset(id));
    }
    if (req.method === "POST" && /^\/admin\/members\/[^/]+\/membership$/.test(path)) {
      requireAdmin(req); const id = path.split("/")[3]; const body = await bodyJson(req);
      return json(res, 200, { membership: store.grantMembership(id, body.days, "admin_grant", null, body.planId) });
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
const timer = setInterval(() => void scanMonitors(), monitorIntervalMs);
timer.unref();
const watchdogTimer = setInterval(() => {
  const health = evaluateScannerHealth(scanState, {
    serviceStartedAt,
    intervalMs: monitorIntervalMs,
    tradingWindow: isTradingWindow(),
  });
  const watchdog = advanceScannerWatchdog(watchdogFailures, health);
  watchdogFailures = watchdog.failures;
  if (!watchdog.restart || shuttingDown) return;
  shuttingDown = true;
  console.error(`[control] scanner watchdog restart: ${watchdog.reason}`);
  clearInterval(timer);
  clearInterval(watchdogTimer);
  server.close(() => { store.close(); process.exit(1); });
  setTimeout(() => process.exit(1), 5_000).unref();
}, monitorIntervalMs);
watchdogTimer.unref();
process.on("SIGTERM", () => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(timer);
  clearInterval(watchdogTimer);
  server.close(() => { store.close(); process.exit(0); });
});

export { scanMonitors, latestCausalAlert, evaluateCausalMonitor, isTradingWindow };
