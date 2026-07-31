import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("lower-frequency product pages share one simplified navigation category", () => {
  assert.match(page, /\['首页','操盘台','单股智研','量化工具','模拟回测','邀请中心'\]/);
  assert.match(page, /function QuantToolsView/);
  assert.match(page, /title:'多股持仓'/);
  assert.match(page, /view:'策略市场'/);
  assert.match(page, /view:'持仓对账'/);
  assert.match(page, /view:'智能训练'/);
  assert.match(page, /activeView === "量化工具"/);
});

test("signed-in home presents a compact pricing entry", () => {
  assert.match(page, /className="home-pricing"/);
  assert.match(page, /Smart-T 会员/);
  assert.match(page, /¥39/);
  assert.match(page, /年付 ¥365/);
  assert.match(page, /24小时体验票/);
  assert.match(page, /href="\/pricing"/);
});
