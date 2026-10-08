import test from "node:test";
import assert from "node:assert/strict";
import { compactChartDisplayLabel, compactForecastDetail, compactForecastMeta, compactForceNote, compactMainForceAmount, compactObservationNextStep, compactObservationStatus, compactObservationTag, compactOpeningStructure } from "../lib/trading-desk-display.mjs";

test("compact guidance labels preserve WATCH versus action semantics", () => {
  assert.equal(compactObservationStatus("COUNTER_T_WATCH"), "候卖");
  assert.equal(compactObservationStatus("POSITIVE_T_WATCH"), "候买");
  assert.equal(compactObservationStatus("WAIT_CONFIRMATION"), "等确认");
  assert.equal(compactObservationStatus("INVALID"), "待数据");
});

test("common long guidance reasons become concise display tags", () => {
  assert.equal(compactObservationTag("高位T环境出现"), "高位");
  assert.equal(compactObservationTag("价格位于近期区间偏高位置"), "高位");
  assert.equal(compactObservationTag("量能放大，需观察价格是否继续响应"), "量增");
  assert.equal(compactObservationTag("动能边际减弱"), "偏弱");
});

test("next-step and forecast labels shorten only their presentation", () => {
  assert.equal(compactObservationNextStep("等待转弱与结构确认"), "等确认");
  assert.equal(compactObservationNextStep("等待价格突破"), "等突破");
  assert.equal(compactObservationNextStep("等待回撤确认"), "等回踩");
  assert.equal(compactForecastMeta(" · 研究 73"), "73");
  assert.equal(compactForecastMeta(" · 高风险"), "风险");
  assert.equal(compactForecastDetail("¥28.92–29.66"), "¥28.92–29.66");
  assert.equal(compactOpeningStructure("低开承压 · 等待修复"), "低开承压");
  assert.equal(compactChartDisplayLabel("触发 · 50分"), "触发 50");
  assert.equal(compactMainForceAmount(11629000), "+1163万");
  assert.equal(compactForceNote("等待 L2 成交与价格共同确认"), "待L2");
});
