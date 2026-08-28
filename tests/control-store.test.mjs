import test from "node:test";
import assert from "node:assert/strict";
import { createControlStore } from "../server/control-store.mjs";

test("server accounts, sessions and cross-device profile data", () => {
  const store = createControlStore(":memory:", { adminUsername: "owner@example.com" });
  try {
    const admin = store.register({ username: "owner@example.com", password: "OwnerPass123!", displayName: "站长" });
    const member = store.register({ username: "member@example.com", password: "MemberPass123!", displayName: "测试会员" });
    assert.equal(admin.role, "admin");
    assert.equal(member.role, "member");
    assert.throws(() => store.register({ username: "member@example.com", password: "MemberPass123!" }), /已注册/);
    assert.throws(() => store.login({ username: member.username, password: "wrong-password" }), /不正确/);

    const session = store.login({ username: member.username, password: "MemberPass123!", remember: false });
    assert.equal(store.authenticate(session.token)?.id, member.id);
    assert.equal(store.authenticate("not-a-token"), null);

    store.putProfile(member.id, { preferences: { risk: "稳健" }, alertSettings: { sound: true } });
    assert.deepEqual(store.getProfile(member.id).data, { preferences: { risk: "稳健" }, alertSettings: { sound: true } });

    const monitors = store.replaceMonitors(member.id, [
      { code: "601899", name: "紫金矿业", profile: "平衡", position: { plannedBase: 3000, sellable: 3000 } },
      { code: "bad", name: "无效代码" },
    ]);
    assert.equal(monitors.length, 1);
    assert.equal(monitors[0].code, "601899");
    assert.equal(store.listActiveMonitors().length, 1);

    const endpoint = "https://push.example.test/subscription-1";
    const subscription = { endpoint, keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) } };
    assert.equal(store.savePushSubscription(member.id, subscription).enabled, true);
    assert.equal(store.listPushSubscriptions(member.id).length, 1);
    store.recordPushDelivery(endpoint, { success: true });
    assert.ok(store.listPushSubscriptions(member.id)[0].lastSuccessAt);
    assert.equal(store.removePushSubscription(member.id, endpoint), true);

    const ordered = store.replaceMonitors(member.id, [
      { code: "600003", name: "第三只" },
      { code: "600001", name: "第一只" },
      { code: "600002", name: "第二只" },
      { code: "600004", name: "第四只" },
      { code: "600005", name: "第五只" },
      { code: "600006", name: "第六只" },
    ], { maxMonitors: 5 });
    assert.deepEqual(ordered.map(item => item.code), ["600003", "600001", "600002", "600004", "600005"]);
    assert.deepEqual(store.listActiveMonitors().map(item => item.code), ["600003", "600001", "600002", "600004", "600005"]);

    assert.equal(store.addAlert(member.id, { code: "601899", level: "candidate", title: "低位候选", message: "等待确认", eventKey: "601899:20260718:0940:buy", marketDate: "2026-07-18" }), true);
    assert.equal(store.addAlert(member.id, { code: "601899", level: "candidate", title: "重复", message: "不应重复", eventKey: "601899:20260718:0940:buy" }), false);
    const alerts = store.listAlerts(member.id);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].marketDate, "2026-07-18");
    assert.equal(store.latestAlertForCode(member.id, "601899")?.eventKey, "601899:20260718:0940:buy");
    assert.equal(alerts[0].deliveryStatus, "stored");
    const delivery = store.markAlertDelivery(member.id, alerts[0].id, { status: "notified", channel: "in-app+system" });
    assert.equal(delivery.delivery_status, "notified");
    assert.equal(store.listAlerts(member.id)[0].deliveryChannel, "in-app+system");
    store.acknowledgeAlert(member.id, alerts[0].id);
    store.recordMonitorScan(member.id, { code: "601899", name: "紫金矿业", marketDate: "20260719", marketTime: "0941", price: 28.36, result: "no_signal", reason: "量价确认不足", provider: "tencent-public" });
    store.recordMonitorScan(member.id, { code: "601899", name: "紫金矿业", marketDate: "20260719", marketTime: "0941", price: 28.38, result: "candidate", reason: "均价下方观察等待确认", provider: "tencent-public", eventKey: "601899:20260718:0940:buy" });
    const scanLogs = store.listMonitorScans(member.id, { code: "601899" });
    assert.equal(scanLogs.length, 1);
    assert.equal(scanLogs[0].result, "candidate");
    assert.equal(scanLogs[0].price, 28.38);
    assert.equal(scanLogs[0].deliveryStatus, "notified");
    assert.equal(scanLogs[0].deliveryChannel, "in-app+system");
    assert.ok(store.listMembers().find(item => item.id === member.id)?.alertCount >= 1);

    store.logout(session.token);
    assert.equal(store.authenticate(session.token), null);
  } finally {
    store.close();
  }
});

test("member pause and password reset revoke existing sessions", () => {
  const store = createControlStore(":memory:", { adminUsername: "owner@example.com" });
  try {
    store.register({ username: "owner@example.com", password: "OwnerPass123!" });
    const member = store.register({ username: "member@example.com", password: "OldPassword123!" });
    const firstSession = store.login({ username: member.username, password: "OldPassword123!" });
    store.setMemberStatus(member.id, "paused");
    assert.equal(store.authenticate(firstSession.token), null);
    assert.throws(() => store.login({ username: member.username, password: "OldPassword123!" }), /暂停/);

    store.setMemberStatus(member.id, "active");
    const secondSession = store.login({ username: member.username, password: "OldPassword123!" });
    const reset = store.issueReset(member.id);
    store.resetPassword(reset.token, "NewPassword123!");
    assert.equal(store.authenticate(secondSession.token), null);
    assert.throws(() => store.login({ username: member.username, password: "OldPassword123!" }), /不正确/);
    assert.equal(store.login({ username: member.username, password: "NewPassword123!" }).user.id, member.id);
    assert.throws(() => store.resetPassword(reset.token, "AnotherPassword123!"), /无效|过期/);
  } finally {
    store.close();
  }
});

test("one-time activation codes extend membership and cannot be reused", () => {
  const store = createControlStore(":memory:", { adminUsername: "owner@example.com" });
  try {
    const admin = store.register({ username: "owner@example.com", password: "OwnerPass123!" });
    const member = store.register({ username: "member@example.com", password: "MemberPass123!" });
    const before = Date.parse(member.membership.expiresAt);
    const [issued] = store.createMembershipCodes(admin.id, { planId: "monthly", count: 1, validForDays: 180 });

    assert.match(issued.code, /^RQ-M-/);
    assert.equal(issued.days, 31);
    assert.equal(store.listMembershipCodes()[0].code, undefined);

    const redeemed = store.redeemMembershipCode(member.id, issued.code);
    assert.equal(redeemed.planId, "monthly");
    assert.equal(redeemed.membership.active, true);
    assert.ok(Date.parse(redeemed.membership.expiresAt) >= before + 31 * 24 * 60 * 60 * 1000 - 1000);
    assert.equal(store.listMembershipCodes()[0].status, "redeemed");
    assert.throws(() => store.redeemMembershipCode(member.id, issued.code), /已被使用/);
  } finally {
    store.close();
  }
});

test("admin status changes cannot revoke admin sessions or membership access", () => {
  const store = createControlStore(":memory:", { adminUsername: "owner@example.com" });
  try {
    const admin = store.register({ username: "owner@example.com", password: "OwnerPass123!" });
    const member = store.register({ username: "member@example.com", password: "MemberPass123!" });
    const adminSession = store.login({ username: admin.username, password: "OwnerPass123!" });
    store.setMemberStatus(admin.id, "paused");
    assert.equal(store.authenticate(adminSession.token)?.role, "admin");
    assert.equal(store.login({ username: admin.username, password: "OwnerPass123!" }).user.membership.active, true);

    store.db.prepare("UPDATE memberships SET expires_at=? WHERE user_id=?").run("2000-01-01T00:00:00.000Z", member.id);
    assert.equal(store.login({ username: member.username, password: "MemberPass123!" }).user.membership.active, false);
  } finally {
    store.close();
  }
});

test("referrals credit seven days once and hold duplicate sources for review", () => {
  const store = createControlStore(":memory:", { adminUsername: "owner@example.com" });
  try {
    const inviter = store.register({ username: "inviter@example.com", password: "InvitePass123!", displayName: "邀请人" });
    const before = Date.parse(inviter.membership.expiresAt);
    const invitee = store.register({
      username: "invitee@example.com", password: "InviteePass123!", displayName: "新用户",
      referralCode: inviter.membership.referralCode, referralSourceHash: "same-network",
    });
    assert.equal(invitee.membership.active, true);
    const afterFirst = store.login({ username: inviter.username, password: "InvitePass123!" }).user;
    assert.equal(afterFirst.membership.referralCredits, 1);
    assert.equal(afterFirst.membership.referralRewardDays, 7);
    assert.ok(Date.parse(afterFirst.membership.expiresAt) >= before + 7 * 24 * 60 * 60 * 1000 - 1000);
    assert.deepEqual(store.referralLeaderboard(), [{ rank: 1, displayName: "邀**", credits: 1 }]);

    store.register({
      username: "review@example.com", password: "ReviewPass123!", displayName: "同源用户",
      referralCode: inviter.membership.referralCode, referralSourceHash: "same-network",
    });
    const afterReview = store.login({ username: inviter.username, password: "InvitePass123!" }).user;
    assert.equal(afterReview.membership.referralCredits, 1);
    assert.equal(afterReview.membership.referralReviews, 1);
    assert.deepEqual(store.referralLeaderboard(), [{ rank: 1, displayName: "邀**", credits: 1 }]);
    const granted = store.grantMembership(inviter.id, 7, "admin_grant");
    assert.equal(granted.referralCredits, 1);
    assert.equal(granted.active, true);
  } finally {
    store.close();
  }
});
