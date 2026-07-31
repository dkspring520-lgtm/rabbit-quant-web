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

