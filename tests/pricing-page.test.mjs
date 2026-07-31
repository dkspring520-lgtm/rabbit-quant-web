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
  assert.match(pricing, /支付接口尚未接入，暂由管理员人工开通/);
  assert.match(pricing, /不自动续费/);
  assert.match(pricing, /自动下单不在任何套餐内/);
  assert.match(pricing, /当前 L2 深度体系只对紫金矿业 601899 开放/);
});

test("public landing links to the membership pricing page", () => {
  assert.match(landing, /href="\/pricing"/);
  assert.match(landing, /免费版长期可用/);
});
