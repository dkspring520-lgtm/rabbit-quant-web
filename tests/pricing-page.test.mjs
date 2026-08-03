import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pricing = await readFile(new URL("../app/pricing/page.tsx", import.meta.url), "utf8");
const landing = await readFile(new URL("../app/public-landing.tsx", import.meta.url), "utf8");

test("pricing publishes one real membership tier that matches the boolean membership model", () => {
  assert.match(pricing, /Smart-T 会员/);
  assert.match(pricing, /¥\{memberPrice\}/);
  assert.match(pricing, /24 小时体验票/);
  assert.doesNotMatch(pricing, /旗舰会员|专业会员/);
});

test("pricing states the current commercial and execution boundaries", () => {
  assert.match(pricing, /管理员人工确认的测试激活码/);
  assert.match(pricing, /登录后可自行兑换/);
  assert.match(pricing, /不自动续费/);
  assert.match(pricing, /自动下单不在任何套餐内/);
  assert.match(pricing, /高级实时行情增强优先支持核心研究标的/);
  assert.doesNotMatch(pricing, /紫金(?:矿业)? L2|L2 十档与逐笔订单流/);
});

test("pricing publishes the activation-code day, month and year prices", () => {
  assert.match(pricing, /cycle === "yearly" \? "298" : "99"/);
  assert.match(pricing, /¥4\.9/);
  assert.match(pricing, /登录后兑换激活码/);
  assert.match(pricing, /激活码怎样使用/);
});

test("public landing links to the membership pricing page", () => {
  assert.match(landing, /href="\/pricing"/);
  assert.match(landing, /免费版长期可用/);
});
