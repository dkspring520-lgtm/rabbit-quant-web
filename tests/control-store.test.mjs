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

    assert.equal(store.addAlert(member.id, { code: "601899", level: "candidate", title: "低位候选", message: "等待确认", eventKey: "601899:20260718:0940:buy" }), true);
    assert.equal(store.addAlert(member.id, { code: "601899", level: "candidate", title: "重复", message: "不应重复", eventKey: "601899:20260718:0940:buy" }), false);
    const alerts = store.listAlerts(member.id);
    assert.equal(alerts.length, 1);
    store.acknowledgeAlert(member.id, alerts[0].id);
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
