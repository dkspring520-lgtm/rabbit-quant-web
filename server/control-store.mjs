import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DAY = 24 * 60 * 60 * 1000;

function nowIso() { return new Date().toISOString(); }
function normalizeLogin(value) { return String(value ?? "").trim().toLowerCase(); }
function tokenHash(value) { return createHash("sha256").update(value).digest("hex"); }
function safeJson(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

function passwordDigest(password, salt = randomBytes(16).toString("hex")) {
  const digest = scryptSync(String(password), salt, 64).toString("hex");
  return { salt, digest };
}

function passwordMatches(password, salt, expected) {
  const actual = Buffer.from(passwordDigest(password, salt).digest, "hex");
  const target = Buffer.from(expected, "hex");
  return actual.length === target.length && timingSafeEqual(actual, target);
}

export function createControlStore(databasePath, options = {}) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS monitors (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      profile TEXT NOT NULL DEFAULT '平衡',
      position TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, code)
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      level TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      event_key TEXT NOT NULL,
      market_time TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      delivery_status TEXT NOT NULL DEFAULT 'stored',
      delivery_channel TEXT,
      delivered_at TEXT,
      delivery_error TEXT,
      acknowledged_at TEXT,
      UNIQUE(user_id, event_key)
    );
    CREATE INDEX IF NOT EXISTS alerts_user_created_idx ON alerts(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS monitor_scan_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      market_date TEXT NOT NULL,
      market_time TEXT NOT NULL,
      price REAL,
      result TEXT NOT NULL,
      reason TEXT NOT NULL,
      provider TEXT,
      event_key TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, code, market_date, market_time)
    );
    CREATE INDEX IF NOT EXISTS monitor_scan_user_created_idx ON monitor_scan_logs(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS reset_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      token_hash TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      used_at TEXT
    );
  `);

  const monitorColumns = db.prepare("PRAGMA table_info(monitors)").all();
  if (!monitorColumns.some(column => column.name === "sort_order")) {
    db.exec("ALTER TABLE monitors ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  }
  const alertColumns = db.prepare("PRAGMA table_info(alerts)").all();
  const alertMigrations = [
    ["delivery_status", "ALTER TABLE alerts ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'stored'"],
    ["delivery_channel", "ALTER TABLE alerts ADD COLUMN delivery_channel TEXT"],
    ["delivered_at", "ALTER TABLE alerts ADD COLUMN delivered_at TEXT"],
    ["delivery_error", "ALTER TABLE alerts ADD COLUMN delivery_error TEXT"],
  ];
  for (const [name, sql] of alertMigrations) {
    if (!alertColumns.some(column => column.name === name)) db.exec(sql);
  }

  const configuredAdmin = normalizeLogin(options.adminUsername ?? process.env.RABBIT_ADMIN_USER ?? "dkspring520@outlook.com");

  function getUserById(id) { return db.prepare("SELECT * FROM users WHERE id=?").get(id); }
  function getUserByLogin(username) { return db.prepare("SELECT * FROM users WHERE username=?").get(normalizeLogin(username)); }

  function register({ username, password, displayName }) {
    const login = normalizeLogin(username);
    const secret = String(password ?? "");
    if (!/^[^\s]{3,80}$/.test(login)) throw Object.assign(new Error("账号需为 3–80 个非空字符"), { status: 400 });
    if (secret.length < 8 || secret.length > 128) throw Object.assign(new Error("密码需为 8–128 位"), { status: 400 });
    if (getUserByLogin(login)) throw Object.assign(new Error("该账号已注册"), { status: 409 });
    const createdAt = nowIso();
    const id = randomBytes(16).toString("hex");
    const { salt, digest } = passwordDigest(secret);
    const role = login === configuredAdmin ? "admin" : "member";
    db.prepare("INSERT INTO users(id,username,display_name,password_hash,password_salt,role,status,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id, login, String(displayName ?? username).trim().slice(0, 40) || login, digest, salt, role, "active", createdAt);
    return publicUser(getUserById(id));
  }

  function login({ username, password, remember = true }) {
    const row = getUserByLogin(username);
    if (!row || !passwordMatches(String(password ?? ""), row.password_salt, row.password_hash)) {
      throw Object.assign(new Error("账号或密码不正确"), { status: 401 });
    }
    if (row.status !== "active") throw Object.assign(new Error("账号已暂停，请联系管理员"), { status: 403 });
    const token = randomBytes(32).toString("base64url");
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + (remember ? 30 : 1) * DAY).toISOString();
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(createdAt);
    db.prepare("INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)")
      .run(tokenHash(token), row.id, createdAt, expiresAt);
    db.prepare("UPDATE users SET last_login_at=? WHERE id=?").run(createdAt, row.id);
    return { token, expiresAt, user: publicUser({ ...row, last_login_at: createdAt }) };
  }

  function authenticate(token) {
    if (!token) return null;
    const row = db.prepare(`SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id
      WHERE sessions.token_hash=? AND sessions.expires_at>? AND users.status='active'`).get(tokenHash(token), nowIso());
    return publicUser(row);
  }

  function logout(token) { if (token) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token)); }

  function getProfile(userId) {
    const row = db.prepare("SELECT data,updated_at FROM profiles WHERE user_id=?").get(userId);
    return row ? { data: safeJson(row.data, {}), updatedAt: row.updated_at } : { data: {}, updatedAt: null };
  }

  function putProfile(userId, data) {
    const updatedAt = nowIso();
    db.prepare(`INSERT INTO profiles(user_id,data,updated_at) VALUES(?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`)
      .run(userId, JSON.stringify(data ?? {}), updatedAt);
    return { data: data ?? {}, updatedAt };
  }

  function listMonitors(userId) {
    return db.prepare("SELECT * FROM monitors WHERE user_id=? ORDER BY sort_order ASC, updated_at DESC").all(userId).map(row => ({
      code: row.code, name: row.name, enabled: Boolean(row.enabled), profile: row.profile,
      position: safeJson(row.position, {}), updatedAt: row.updated_at,
    }));
  }

  function replaceMonitors(userId, monitors, { maxMonitors = 30 } = {}) {
    const limit = Math.max(1, Math.min(30, Number(maxMonitors) || 30));
    const list = Array.isArray(monitors) ? monitors.slice(0, limit) : [];
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM monitors WHERE user_id=?").run(userId);
      const insert = db.prepare("INSERT INTO monitors(user_id,code,name,enabled,profile,position,sort_order,updated_at) VALUES(?,?,?,?,?,?,?,?)");
      const updatedAt = nowIso();
      for (const [index, item] of list.entries()) {
        const code = String(item?.code ?? "").replace(/\D/g, "").slice(0, 6);
        if (!/^\d{6}$/.test(code)) continue;
        insert.run(userId, code, String(item?.name ?? code).slice(0, 30), item?.enabled === false ? 0 : 1,
          ["稳健", "平衡", "灵敏"].includes(item?.profile) ? item.profile : "平衡", JSON.stringify(item?.position ?? {}), index, updatedAt);
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return listMonitors(userId);
  }

  function listActiveMonitors() {
    const perUserCount = new Map();
    return db.prepare(`SELECT monitors.*,users.status,users.role FROM monitors JOIN users ON users.id=monitors.user_id
      WHERE monitors.enabled=1 AND users.status='active'
      ORDER BY monitors.user_id ASC, monitors.sort_order ASC, monitors.updated_at DESC`).all().filter(row => {
      const count = perUserCount.get(row.user_id) ?? 0;
      const limit = row.role === "admin" ? 30 : 5;
      if (count >= limit) return false;
      perUserCount.set(row.user_id, count + 1);
      return true;
    }).map(row => ({
      userId: row.user_id, code: row.code, name: row.name, profile: row.profile, position: safeJson(row.position, {}),
    }));
  }

  function addAlert(userId, alert) {
    const createdAt = nowIso();
    const result = db.prepare(`INSERT OR IGNORE INTO alerts(user_id,code,level,title,message,event_key,market_time,payload,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(userId, alert.code, alert.level, alert.title, alert.message, alert.eventKey,
        alert.marketTime ?? null, JSON.stringify(alert.payload ?? {}), createdAt);
    return result.changes > 0;
  }

  function listAlerts(userId, { afterId = 0, limit = 50 } = {}) {
    return db.prepare("SELECT * FROM alerts WHERE user_id=? AND id>? ORDER BY id DESC LIMIT ?")
      .all(userId, Number(afterId) || 0, Math.min(100, Math.max(1, Number(limit) || 50))).map(row => ({
        id: row.id, code: row.code, level: row.level, title: row.title, message: row.message,
        eventKey: row.event_key, marketTime: row.market_time, payload: safeJson(row.payload, {}),
        createdAt: row.created_at, acknowledgedAt: row.acknowledged_at,
        deliveryStatus: row.delivery_status, deliveryChannel: row.delivery_channel,
        deliveredAt: row.delivered_at, deliveryError: row.delivery_error,
      }));
  }

  function markAlertDelivery(userId, id, { status = "displayed", channel = "in-app", error = "" } = {}) {
    const normalizedStatus = ["stored", "displayed", "notified", "failed"].includes(status) ? status : "displayed";
    const deliveredAt = normalizedStatus === "failed" ? null : nowIso();
    db.prepare(`UPDATE alerts SET delivery_status=?,delivery_channel=?,delivered_at=?,delivery_error=?
      WHERE id=? AND user_id=?`).run(normalizedStatus, String(channel).slice(0, 40), deliveredAt, String(error).slice(0, 240) || null, Number(id), userId);
    return db.prepare("SELECT id,delivery_status,delivery_channel,delivered_at,delivery_error FROM alerts WHERE id=? AND user_id=?").get(Number(id), userId);
  }

  function recordMonitorScan(userId, scan) {
    const createdAt = nowIso();
    db.prepare(`INSERT INTO monitor_scan_logs(user_id,code,name,market_date,market_time,price,result,reason,provider,event_key,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id,code,market_date,market_time) DO UPDATE SET
        price=excluded.price,result=excluded.result,reason=excluded.reason,provider=excluded.provider,
        event_key=excluded.event_key,created_at=excluded.created_at`)
      .run(userId, String(scan.code), String(scan.name ?? scan.code).slice(0, 30), String(scan.marketDate), String(scan.marketTime),
        Number.isFinite(Number(scan.price)) ? Number(scan.price) : null, String(scan.result), String(scan.reason).slice(0, 500),
        scan.provider ? String(scan.provider).slice(0, 80) : null, scan.eventKey ? String(scan.eventKey).slice(0, 240) : null, createdAt);
    db.prepare("DELETE FROM monitor_scan_logs WHERE created_at<?").run(new Date(Date.now() - 7 * DAY).toISOString());
  }

  function listMonitorScans(userId, { code = "", limit = 100 } = {}) {
    const cleanCode = String(code).replace(/\D/g, "").slice(0, 6);
    const rows = cleanCode
      ? db.prepare("SELECT * FROM monitor_scan_logs WHERE user_id=? AND code=? ORDER BY id DESC LIMIT ?").all(userId, cleanCode, Math.min(300, Math.max(1, Number(limit) || 100)))
      : db.prepare("SELECT * FROM monitor_scan_logs WHERE user_id=? ORDER BY id DESC LIMIT ?").all(userId, Math.min(300, Math.max(1, Number(limit) || 100)));
    return rows.map(row => ({
      id: row.id, code: row.code, name: row.name, marketDate: row.market_date, marketTime: row.market_time,
      price: row.price, result: row.result, reason: row.reason, provider: row.provider, eventKey: row.event_key, createdAt: row.created_at,
    }));
  }

  function acknowledgeAlert(userId, id) {
    db.prepare("UPDATE alerts SET acknowledged_at=? WHERE id=? AND user_id=?").run(nowIso(), Number(id), userId);
  }

  function listMembers() {
    return db.prepare(`SELECT users.*,COUNT(DISTINCT monitors.code) AS monitor_count,COUNT(DISTINCT alerts.id) AS alert_count
      FROM users LEFT JOIN monitors ON monitors.user_id=users.id LEFT JOIN alerts ON alerts.user_id=users.id
      GROUP BY users.id ORDER BY users.created_at DESC`).all().map(row => ({ ...publicUser(row), monitorCount: row.monitor_count, alertCount: row.alert_count }));
  }

  function setMemberStatus(id, status) {
    if (!['active', 'paused'].includes(status)) throw Object.assign(new Error("状态参数不正确"), { status: 400 });
    db.prepare("UPDATE users SET status=? WHERE id=? AND role!='admin'").run(status, id);
    if (status !== "active") db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
    return publicUser(getUserById(id));
  }

  function requestReset(username) {
    const login = normalizeLogin(username);
    const user = getUserByLogin(login);
    db.prepare("INSERT INTO reset_requests(user_id,username,created_at) VALUES(?,?,?)").run(user?.id ?? null, login, nowIso());
  }

  function issueReset(userId) {
    const row = getUserById(userId);
    if (!row) throw Object.assign(new Error("会员不存在"), { status: 404 });
    const token = randomBytes(18).toString("base64url");
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    db.prepare("INSERT INTO reset_requests(user_id,username,token_hash,created_at,expires_at) VALUES(?,?,?,?,?)")
      .run(userId, row.username, tokenHash(token), createdAt, expiresAt);
    return { token, expiresAt, username: row.username };
  }

  function resetPassword(token, password) {
    const secret = String(password ?? "");
    if (secret.length < 8 || secret.length > 128) throw Object.assign(new Error("密码需为 8–128 位"), { status: 400 });
    const row = db.prepare("SELECT * FROM reset_requests WHERE token_hash=? AND used_at IS NULL AND expires_at>?")
      .get(tokenHash(String(token ?? "")), nowIso());
    if (!row?.user_id) throw Object.assign(new Error("重置链接无效或已过期"), { status: 400 });
    const { salt, digest } = passwordDigest(secret);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE users SET password_hash=?,password_salt=?,status='active' WHERE id=?").run(digest, salt, row.user_id);
      db.prepare("UPDATE reset_requests SET used_at=? WHERE id=?").run(nowIso(), row.id);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(row.user_id);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  return { db, register, login, authenticate, logout, getProfile, putProfile, listMonitors, replaceMonitors,
    listActiveMonitors, addAlert, listAlerts, acknowledgeAlert, markAlertDelivery, recordMonitorScan, listMonitorScans, listMembers, setMemberStatus,
    requestReset, issueReset, resetPassword, close: () => db.close() };
}
