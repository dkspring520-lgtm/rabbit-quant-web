import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { membershipPlan } from "../lib/membership-plans.mjs";
import { watchlistLimitForRole } from "../lib/watchlist-limits.mjs";

const DAY = 24 * 60 * 60 * 1000;

function nowIso() { return new Date().toISOString(); }
function normalizeLogin(value) { return String(value ?? "").trim().toLowerCase(); }
function tokenHash(value) { return createHash("sha256").update(value).digest("hex"); }
function safeJson(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function publicUser(row, membership = null) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    membership,
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
      market_date TEXT,
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
    CREATE TABLE IF NOT EXISTS service_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_success_at TEXT,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id, updated_at DESC);
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
    CREATE TABLE IF NOT EXISTS memberships (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      referral_code TEXT NOT NULL UNIQUE,
      plan_id TEXT NOT NULL DEFAULT 'monthly',
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS membership_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      days INTEGER NOT NULL,
      reason TEXT NOT NULL,
      reference_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS membership_grants_user_idx ON membership_grants(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS membership_codes (
      code_hash TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      days INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','redeemed','revoked')),
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      redeemed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      redeemed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS membership_codes_status_idx ON membership_codes(status, created_at DESC);
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inviter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invitee_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      referral_code TEXT NOT NULL,
      source_hash TEXT,
      status TEXT NOT NULL CHECK(status IN ('credited','review')),
      reward_days INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      rewarded_at TEXT
    );
    CREATE INDEX IF NOT EXISTS referrals_inviter_idx ON referrals(inviter_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS referrals_source_idx ON referrals(source_hash, created_at DESC);
  `);

  const monitorColumns = db.prepare("PRAGMA table_info(monitors)").all();
  if (!monitorColumns.some(column => column.name === "sort_order")) {
    db.exec("ALTER TABLE monitors ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  }
  const alertColumns = db.prepare("PRAGMA table_info(alerts)").all();
  const alertMigrations = [
    ["market_date", "ALTER TABLE alerts ADD COLUMN market_date TEXT"],
    ["delivery_status", "ALTER TABLE alerts ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'stored'"],
    ["delivery_channel", "ALTER TABLE alerts ADD COLUMN delivery_channel TEXT"],
    ["delivered_at", "ALTER TABLE alerts ADD COLUMN delivered_at TEXT"],
    ["delivery_error", "ALTER TABLE alerts ADD COLUMN delivery_error TEXT"],
  ];
  for (const [name, sql] of alertMigrations) {
    if (!alertColumns.some(column => column.name === name)) db.exec(sql);
  }
  const membershipColumns = db.prepare("PRAGMA table_info(memberships)").all();
  const membershipPlanColumnAdded = !membershipColumns.some(column => column.name === "plan_id");
  if (membershipPlanColumnAdded) {
    db.exec("ALTER TABLE memberships ADD COLUMN plan_id TEXT NOT NULL DEFAULT 'monthly'");
    const existingMemberships = db.prepare("SELECT user_id FROM memberships").all();
    const latestGrant = db.prepare("SELECT days,reason FROM membership_grants WHERE user_id=? ORDER BY created_at DESC LIMIT 1");
    const updatePlan = db.prepare("UPDATE memberships SET plan_id=? WHERE user_id=?");
    for (const row of existingMemberships) {
      const grant = latestGrant.get(row.user_id);
      const inferredPlan = String(grant?.reason ?? "").includes(":yearly") || Number(grant?.days) >= 366 ? "yearly" : "monthly";
      updatePlan.run(inferredPlan, row.user_id);
    }
  }

  const configuredAdmin = normalizeLogin(options.adminUsername ?? process.env.RABBIT_ADMIN_USER ?? "dkspring520@outlook.com");

  function getUserById(id) { return db.prepare("SELECT * FROM users WHERE id=?").get(id); }
  function getUserByLogin(username) { return db.prepare("SELECT * FROM users WHERE username=?").get(normalizeLogin(username)); }

  function referralCode() {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = `RQ${randomBytes(5).toString("hex").toUpperCase()}`;
      if (!db.prepare("SELECT 1 FROM memberships WHERE referral_code=?").get(code)) return code;
    }
    throw new Error("邀请码生成失败，请稍后重试");
  }

  function normalizePlanId(value) { return membershipPlan(value)?.id ?? null; }
  function membershipRow(userId) { return db.prepare("SELECT * FROM memberships WHERE user_id=?").get(userId); }
  function membershipSummary(userId, role = "member") {
    const row = membershipRow(userId);
    const expiresAt = row?.expires_at || null;
    const active = role === "admin" || Boolean(expiresAt && Date.parse(expiresAt) > Date.now());
    const referral = db.prepare(`SELECT
      SUM(CASE WHEN status='credited' THEN 1 ELSE 0 END) AS credited_count,
      SUM(CASE WHEN status='review' THEN 1 ELSE 0 END) AS review_count,
      SUM(CASE WHEN status='credited' THEN reward_days ELSE 0 END) AS reward_days
      FROM referrals WHERE inviter_id=?`).get(userId) || {};
    return {
      active,
      planId: normalizePlanId(row?.plan_id),
      expiresAt,
      referralCode: row?.referral_code || null,
      referralCredits: Number(referral.credited_count || 0),
      referralReviews: Number(referral.review_count || 0),
      referralRewardDays: Number(referral.reward_days || 0),
    };
  }
  function serializeUser(row) { return row ? publicUser(row, membershipSummary(row.id, row.role)) : null; }
  function createMembership(userId, days, reason, planId = "monthly") {
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + days * DAY).toISOString();
    const safePlanId = normalizePlanId(planId) ?? (Number(days) >= 366 ? "yearly" : "monthly");
    db.prepare("INSERT INTO memberships(user_id,referral_code,plan_id,expires_at,updated_at) VALUES(?,?,?,?,?)")
      .run(userId, referralCode(), safePlanId, expiresAt, createdAt);
    db.prepare("INSERT INTO membership_grants(user_id,days,reason,created_at) VALUES(?,?,?,?)")
      .run(userId, days, reason, createdAt);
  }
  function grantMembership(userId, days, reason, referenceUserId = null, planId = null) {
    const safeDays = Math.max(1, Math.min(3650, Math.floor(Number(days) || 0)));
    const user = getUserById(userId);
    if (!user) throw Object.assign(new Error("会员不存在"), { status: 404 });
    const row = membershipRow(userId);
    const requestedPlanId = normalizePlanId(planId);
    if (!row) createMembership(userId, safeDays, reason, requestedPlanId);
    else {
      const current = Date.parse(row.expires_at);
      const base = Number.isFinite(current) && current > Date.now() ? current : Date.now();
      const expiresAt = new Date(base + safeDays * DAY).toISOString();
      const nextPlanId = requestedPlanId ?? normalizePlanId(row.plan_id) ?? (safeDays >= 366 ? "yearly" : "monthly");
      db.prepare("UPDATE memberships SET plan_id=?,expires_at=?,updated_at=? WHERE user_id=?").run(nextPlanId, expiresAt, nowIso(), userId);
      db.prepare("INSERT INTO membership_grants(user_id,days,reason,reference_user_id,created_at) VALUES(?,?,?,?,?)")
        .run(userId, safeDays, reason, referenceUserId, nowIso());
    }
    return membershipSummary(userId, user.role);
  }
  function normalizeMembershipCode(value) {
    return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40);
  }
  function createMembershipCodes(createdBy, { planId, count = 1, validForDays = 180 } = {}) {
    const plan = membershipPlan(planId);
    if (!plan) throw Object.assign(new Error("请选择测试天卡、月卡或年卡"), { status: 400 });
    const safeCount = Math.max(1, Math.min(20, Math.floor(Number(count) || 1)));
    const safeValidDays = Math.max(1, Math.min(730, Math.floor(Number(validForDays) || 180)));
    if (!getUserById(createdBy)) throw Object.assign(new Error("管理员账户不存在"), { status: 404 });
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + safeValidDays * DAY).toISOString();
    const codes = [];
    for (let index = 0; index < safeCount; index += 1) {
      let code = "";
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const secret = randomBytes(8).toString("hex").toUpperCase();
        code = `RQ-${plan.prefix}-${secret.match(/.{1,4}/g).join("-")}`;
        const hash = tokenHash(normalizeMembershipCode(code));
        try {
          db.prepare("INSERT INTO membership_codes(code_hash,plan_id,days,status,created_by,created_at,expires_at) VALUES(?,?,?,'active',?,?,?)")
            .run(hash, plan.id, plan.durationDays, createdBy, createdAt, expiresAt);
          break;
        } catch (error) {
          code = "";
          if (attempt === 11) throw error;
        }
      }
      codes.push({ code, planId: plan.id, planLabel: plan.label, days: plan.durationDays, createdAt, expiresAt });
    }
    return codes;
  }
  function listMembershipCodes({ limit = 100 } = {}) {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    return db.prepare(`SELECT membership_codes.*, creator.username AS creator_username, redeemer.username AS redeemer_username
      FROM membership_codes
      JOIN users creator ON creator.id=membership_codes.created_by
      LEFT JOIN users redeemer ON redeemer.id=membership_codes.redeemed_by
      ORDER BY membership_codes.created_at DESC LIMIT ?`).all(safeLimit).map(row => {
        const expired = row.status === "active" && row.expires_at && Date.parse(row.expires_at) <= Date.now();
        return {
          planId: row.plan_id,
          planLabel: membershipPlan(row.plan_id)?.label || row.plan_id,
          days: Number(row.days),
          status: expired ? "expired" : row.status,
          createdBy: row.creator_username,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          redeemedBy: row.redeemer_username || null,
          redeemedAt: row.redeemed_at || null,
        };
      });
  }
  function redeemMembershipCode(userId, value) {
    const normalized = normalizeMembershipCode(value);
    if (normalized.length < 12) throw Object.assign(new Error("请输入完整激活码"), { status: 400 });
    const hash = tokenHash(normalized);
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT * FROM membership_codes WHERE code_hash=?").get(hash);
      if (!row) throw Object.assign(new Error("激活码无效，请核对后重试"), { status: 400 });
      if (row.status === "redeemed") throw Object.assign(new Error("该激活码已被使用"), { status: 409 });
      if (row.status !== "active") throw Object.assign(new Error("该激活码已失效"), { status: 409 });
      if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) throw Object.assign(new Error("该激活码已过期"), { status: 409 });
      const redeemedAt = nowIso();
      const result = db.prepare("UPDATE membership_codes SET status='redeemed',redeemed_by=?,redeemed_at=? WHERE code_hash=? AND status='active'")
        .run(userId, redeemedAt, hash);
      if (Number(result.changes || 0) !== 1) throw Object.assign(new Error("激活码已被使用"), { status: 409 });
      const membership = grantMembership(userId, row.days, `activation_code:${row.plan_id}`, null, row.plan_id);
      db.exec("COMMIT");
      return { planId: row.plan_id, planLabel: membershipPlan(row.plan_id)?.label || row.plan_id, days: Number(row.days), membership };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function normalizeReferralCode(value) { return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16); }
  function applyReferral(inviteeId, referralCodeValue, sourceHash) {
    const code = normalizeReferralCode(referralCodeValue);
    if (!code) return { status: "none" };
    const inviter = db.prepare(`SELECT users.* FROM memberships JOIN users ON users.id=memberships.user_id
      WHERE memberships.referral_code=?`).get(code);
    if (!inviter || inviter.id === inviteeId || inviter.status !== "active") return { status: "invalid" };
    const inviterMembership = membershipSummary(inviter.id, inviter.role);
    if (!inviterMembership.active) return { status: "inactive" };
    const cutoff = new Date(Date.now() - 30 * DAY).toISOString();
    const count = Number(db.prepare("SELECT COUNT(*) AS count FROM referrals WHERE inviter_id=? AND status='credited' AND created_at>=?")
      .get(inviter.id, cutoff)?.count || 0);
    const sameSource = sourceHash && db.prepare("SELECT 1 FROM referrals WHERE source_hash=? AND created_at>=? LIMIT 1")
      .get(sourceHash, cutoff);
    const status = count >= 10 || sameSource ? "review" : "credited";
    const createdAt = nowIso();
    db.prepare("INSERT INTO referrals(inviter_id,invitee_id,referral_code,source_hash,status,reward_days,created_at,rewarded_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(inviter.id, inviteeId, code, sourceHash || null, status, status === "credited" ? 7 : 0, createdAt, status === "credited" ? createdAt : null);
    if (status === "credited") grantMembership(inviter.id, 7, "referral", inviteeId);
    return { status, inviterId: inviter.id };
  }

  // Existing registered users receive a one-time 30-day beta entitlement so the
  // referral programme can start without silently excluding current accounts.
  for (const row of db.prepare("SELECT id FROM users").all()) {
    if (!membershipRow(row.id)) createMembership(row.id, 30, "beta_migration");
  }

  function register({ username, password, displayName, referralCode: referralCodeValue, referralSourceHash }) {
    const login = normalizeLogin(username);
    const secret = String(password ?? "");
    if (!/^[^\s]{3,80}$/.test(login)) throw Object.assign(new Error("账号需为 3–80 个非空字符"), { status: 400 });
    if (secret.length < 8 || secret.length > 128) throw Object.assign(new Error("密码需为 8–128 位"), { status: 400 });
    if (getUserByLogin(login)) throw Object.assign(new Error("该账号已注册"), { status: 409 });
    const createdAt = nowIso();
    const id = randomBytes(16).toString("hex");
    const { salt, digest } = passwordDigest(secret);
    const role = login === configuredAdmin ? "admin" : "member";
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO users(id,username,display_name,password_hash,password_salt,role,status,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(id, login, String(displayName ?? username).trim().slice(0, 40) || login, digest, salt, role, "active", createdAt);
      createMembership(id, 7, "registration_trial");
      applyReferral(id, referralCodeValue, String(referralSourceHash || "").slice(0, 128));
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return serializeUser(getUserById(id));
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
    return { token, expiresAt, user: serializeUser({ ...row, last_login_at: createdAt }) };
  }

  function authenticate(token) {
    if (!token) return null;
    const row = db.prepare(`SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id
      WHERE sessions.token_hash=? AND sessions.expires_at>? AND users.status='active'`).get(tokenHash(token), nowIso());
    return serializeUser(row);
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

  function getServiceSetting(key) {
    const row = db.prepare("SELECT setting_value FROM service_settings WHERE setting_key=?").get(String(key));
    return row ? safeJson(row.setting_value, null) : null;
  }

  function putServiceSetting(key, value) {
    const updatedAt = nowIso();
    db.prepare(`INSERT INTO service_settings(setting_key,setting_value,updated_at) VALUES(?,?,?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at`)
      .run(String(key), JSON.stringify(value), updatedAt);
    return value;
  }

  function savePushSubscription(userId, subscription) {
    const endpoint = String(subscription?.endpoint ?? "").trim();
    const p256dh = String(subscription?.keys?.p256dh ?? "").trim();
    const auth = String(subscription?.keys?.auth ?? "").trim();
    if (!/^https:\/\//.test(endpoint) || p256dh.length < 20 || auth.length < 12) {
      throw Object.assign(new Error("推送订阅参数无效"), { status: 400 });
    }
    const updatedAt = nowIso();
    db.prepare(`INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,created_at,updated_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,updated_at=excluded.updated_at,last_error=NULL`)
      .run(userId, endpoint.slice(0, 2000), p256dh.slice(0, 200), auth.slice(0, 200), updatedAt, updatedAt);
    return { enabled: true, count: listPushSubscriptions(userId).length };
  }

  function listPushSubscriptions(userId) {
    return db.prepare("SELECT id,endpoint,p256dh,auth,created_at,updated_at,last_success_at,last_error FROM push_subscriptions WHERE user_id=? ORDER BY updated_at DESC")
      .all(userId).map(row => ({ id: row.id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth, createdAt: row.created_at, updatedAt: row.updated_at, lastSuccessAt: row.last_success_at, lastError: row.last_error }));
  }

  function removePushSubscription(userId, endpoint) {
    return db.prepare("DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?").run(userId, String(endpoint ?? "")).changes > 0;
  }

  function recordPushDelivery(endpoint, { success = false, error = "" } = {}) {
    const normalizedEndpoint = String(endpoint ?? "");
    if (success) {
      db.prepare("UPDATE push_subscriptions SET last_success_at=?,last_error=NULL WHERE endpoint=?").run(nowIso(), normalizedEndpoint);
      return;
    }
    db.prepare("UPDATE push_subscriptions SET last_error=? WHERE endpoint=?").run(String(error).slice(0, 240) || "推送失败", normalizedEndpoint);
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
      const membership = row.role === "admin" ? null : membershipSummary(row.user_id, row.role);
      const limit = watchlistLimitForRole(row.role, membership?.active === true, membership?.planId);
      if (count >= limit) return false;
      perUserCount.set(row.user_id, count + 1);
      return true;
    }).map(row => ({
      userId: row.user_id, code: row.code, name: row.name, profile: row.profile, position: safeJson(row.position, {}),
    }));
  }

  function addAlert(userId, alert) {
    const createdAt = nowIso();
    const result = db.prepare(`INSERT INTO alerts(user_id,code,level,title,message,event_key,market_date,market_time,payload,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,event_key) DO NOTHING`).run(userId, alert.code, alert.level, alert.title, alert.message, alert.eventKey,
        alert.marketDate ?? null, alert.marketTime ?? null, JSON.stringify(alert.payload ?? {}), createdAt);
    return result.changes > 0;
  }

  function listAlerts(userId, { afterId = 0, limit = 50 } = {}) {
    return db.prepare("SELECT * FROM alerts WHERE user_id=? AND id>? ORDER BY id DESC LIMIT ?")
      .all(userId, Number(afterId) || 0, Math.min(100, Math.max(1, Number(limit) || 50))).map(row => ({
        id: row.id, code: row.code, level: row.level, title: row.title, message: row.message,
        eventKey: row.event_key, marketDate: row.market_date, marketTime: row.market_time, payload: safeJson(row.payload, {}),
        createdAt: row.created_at, acknowledgedAt: row.acknowledged_at,
        deliveryStatus: row.delivery_status, deliveryChannel: row.delivery_channel,
        deliveredAt: row.delivered_at, deliveryError: row.delivery_error,
      }));
  }

  function latestAlertForCode(userId, code) {
    const row = db.prepare("SELECT * FROM alerts WHERE user_id=? AND code=? ORDER BY id DESC LIMIT 1")
      .get(userId, String(code).replace(/\D/g, "").slice(0, 6));
    if (!row) return null;
    return {
      id: row.id, code: row.code, level: row.level, title: row.title, message: row.message,
      eventKey: row.event_key, marketDate: row.market_date, marketTime: row.market_time, payload: safeJson(row.payload, {}),
      createdAt: row.created_at,
    };
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
    const select = `SELECT scan.*,alerts.delivery_status,alerts.delivery_channel,alerts.delivered_at,alerts.delivery_error
      FROM monitor_scan_logs AS scan
      LEFT JOIN alerts ON alerts.user_id=scan.user_id AND alerts.event_key=scan.event_key`;
    const rows = cleanCode
      ? db.prepare(`${select} WHERE scan.user_id=? AND scan.code=? ORDER BY scan.id DESC LIMIT ?`).all(userId, cleanCode, Math.min(300, Math.max(1, Number(limit) || 100)))
      : db.prepare(`${select} WHERE scan.user_id=? ORDER BY scan.id DESC LIMIT ?`).all(userId, Math.min(300, Math.max(1, Number(limit) || 100)));
    return rows.map(row => ({
      id: row.id, code: row.code, name: row.name, marketDate: row.market_date, marketTime: row.market_time,
      price: row.price, result: row.result, reason: row.reason, provider: row.provider, eventKey: row.event_key, createdAt: row.created_at,
      deliveryStatus: row.delivery_status, deliveryChannel: row.delivery_channel,
      deliveredAt: row.delivered_at, deliveryError: row.delivery_error,
    }));
  }

  function acknowledgeAlert(userId, id) {
    db.prepare("UPDATE alerts SET acknowledged_at=? WHERE id=? AND user_id=?").run(nowIso(), Number(id), userId);
  }

  function listMembers() {
    return db.prepare(`SELECT users.*,COUNT(DISTINCT monitors.code) AS monitor_count,COUNT(DISTINCT alerts.id) AS alert_count
      FROM users LEFT JOIN monitors ON monitors.user_id=users.id LEFT JOIN alerts ON alerts.user_id=users.id
      GROUP BY users.id ORDER BY users.created_at DESC`).all().map(row => ({ ...serializeUser(row), monitorCount: row.monitor_count, alertCount: row.alert_count }));
  }

  function referralLeaderboard(limit = 5) {
    const safeLimit = Math.min(20, Math.max(1, Math.floor(Number(limit) || 5)));
    return db.prepare(`
      SELECT users.display_name, COUNT(referrals.id) AS credits, MIN(referrals.created_at) AS first_credit_at
      FROM referrals
      JOIN users ON users.id = referrals.inviter_id
      WHERE referrals.status = 'credited' AND users.status = 'active'
      GROUP BY referrals.inviter_id
      ORDER BY credits DESC, first_credit_at ASC
      LIMIT ?
    `).all(safeLimit).map((row, index) => {
      const name = Array.from(String(row.display_name || '会员').trim() || '会员');
      return { rank: index + 1, displayName: `${name[0] || '会'}**`, credits: Number(row.credits || 0) };
    });
  }

  function setMemberStatus(id, status) {
    if (!['active', 'paused'].includes(status)) throw Object.assign(new Error("状态参数不正确"), { status: 400 });
    const target = getUserById(id);
    if (target?.role === "admin") return serializeUser(target);
    db.prepare("UPDATE users SET status=? WHERE id=? AND role!='admin'").run(status, id);
    if (status !== "active") db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
    return serializeUser(getUserById(id));
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

  return { db, register, login, authenticate, logout, getProfile, putProfile, getServiceSetting, putServiceSetting, savePushSubscription, listPushSubscriptions, removePushSubscription, recordPushDelivery, listMonitors, replaceMonitors,
    listActiveMonitors, addAlert, listAlerts, latestAlertForCode, acknowledgeAlert, markAlertDelivery, recordMonitorScan, listMonitorScans, listMembers, referralLeaderboard, setMemberStatus,
    grantMembership, createMembershipCodes, listMembershipCodes, redeemMembershipCode, requestReset, issueReset, resetPassword, close: () => db.close() };
}
