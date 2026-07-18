import test from "node:test";
import assert from "node:assert/strict";
import { isStockRelatedNews, parseTencentSourceTimestamp, sinaDomesticReference } from "../lib/external-source-parsers.mjs";

test("Tencent timestamps support A-share compact and Hong Kong slash formats", () => {
  assert.equal(parseTencentSourceTimestamp("20260717161402"), "2026-07-17T16:14:02+08:00");
  assert.equal(parseTencentSourceTimestamp("2026/07/17 16:08:15"), "2026-07-17T16:08:15+08:00");
  assert.equal(parseTencentSourceTimestamp(""), null);
});

test("Sina domestic futures use previous settlement instead of empty settlement field", () => {
  const fields = [];
  fields[9] = "0.000";
  fields[10] = "103720.000";
  assert.equal(sinaDomesticReference(fields), 103720);
});

test("public news search rejects unrelated stock stories", () => {
  assert.equal(isStockRelatedNews({ code:"601899", name:"紫金矿业", title:"兆易创新被狂抛82亿元" }), false);
  assert.equal(isStockRelatedNews({ code:"601899", name:"紫金矿业", title:"紫金矿业发布季度报告" }), true);
  assert.equal(isStockRelatedNews({ code:"601899", name:"紫金矿业", title:"大宗交易", summary:"601899 今日发生交易" }), true);
});
