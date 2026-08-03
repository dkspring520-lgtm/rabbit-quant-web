import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/authenticated-app.tsx", import.meta.url), "utf8");

test("signed-in members can redeem one-time activation codes", () => {
  assert.match(page, /\/api\/control\/membership\/redeem/);
  assert.match(page, /aria-label="会员激活码兑换"/);
  assert.match(page, /输入 RQ- 开头的激活码/);
  assert.match(page, /onRedeemed=\{setAccountMembership\}/);
});

test("admins can generate plan-specific activation codes", () => {
  assert.match(page, /\/api\/control\/admin\/membership-codes/);
  assert.match(page, /planId:codePlan,count:codeCount,validForDays:180/);
  assert.match(page, /激活码只在本次生成时明文显示/);
  assert.match(page, /测试天卡 · ¥4\.9/);
  assert.match(page, /月卡 · ¥99/);
  assert.match(page, /年卡 · ¥298/);
});
