import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../app/api/trading-desk-snapshot/route.ts", import.meta.url), "utf8");

test("操盘台快照在一次响应中合并行情、环境和事件雷达", () => {
  assert.match(route, /getMarketData/);
  assert.match(route, /getMarketContext/);
  assert.match(route, /getEventRadar/);
  assert.match(route, /market: marketResult\.payload/);
  assert.match(route, /context: contextResult\.payload/);
  assert.match(route, /eventRadar: radarResult\.payload/);
});

test("操盘台快照允许部分数据源失败", () => {
  assert.match(route, /marketResult\.payload \|\| contextResult\.payload \|\| radarResult\.payload/);
  assert.match(route, /errors/);
});
