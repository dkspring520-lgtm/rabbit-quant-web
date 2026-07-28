import test from "node:test";
import assert from "node:assert/strict";
import {
  aShareMinuteSlot,
  intradayChartX,
  isAShareAfterHoursFixedPriceMinute,
  isAShareRegularTradingMinute,
} from "../lib/intraday-axis.mjs";

test("A 股分时轴按真实交易分钟定位并压缩午休", () => {
  assert.equal(aShareMinuteSlot("09:30"), 0);
  assert.equal(aShareMinuteSlot("10:00"), 30);
  assert.equal(aShareMinuteSlot("10:30"), 60);
  assert.equal(aShareMinuteSlot("11:30"), 120);
  assert.equal(aShareMinuteSlot("13:00"), 120);
  assert.equal(aShareMinuteSlot("14:00"), 180);
  assert.equal(aShareMinuteSlot("14:30"), 210);
  assert.equal(aShareMinuteSlot("15:00"), 240);
  assert.equal(aShareMinuteSlot("093000"), 0);
  assert.equal(aShareMinuteSlot("2026-07-14 14:30:00"), 210);
});

test("未走完的盘中行情不会被拉伸到收盘位置", () => {
  assert.equal(intradayChartX("09:30"), 10);
  assert.equal(intradayChartX("10:00"), 122.5);
  assert.equal(intradayChartX("10:30"), 235);
  assert.equal(intradayChartX("11:30"), 460);
  assert.equal(intradayChartX("13:00"), 460);
  assert.equal(intradayChartX("14:00"), 685);
  assert.equal(intradayChartX("14:30"), 797.5);
  assert.equal(intradayChartX("15:00"), 910);
});

test("连续竞价与盘后固定价格交易分段识别", () => {
  assert.equal(isAShareRegularTradingMinute("09:30"), true);
  assert.equal(isAShareRegularTradingMinute("11:30"), true);
  assert.equal(isAShareRegularTradingMinute("11:31"), false);
  assert.equal(isAShareRegularTradingMinute("13:00"), true);
  assert.equal(isAShareRegularTradingMinute("15:00"), true);
  assert.equal(isAShareRegularTradingMinute("15:06"), false);
  assert.equal(isAShareAfterHoursFixedPriceMinute("15:00"), false);
  assert.equal(isAShareAfterHoursFixedPriceMinute("15:04"), false);
  assert.equal(isAShareAfterHoursFixedPriceMinute("15:05"), true);
  assert.equal(isAShareAfterHoursFixedPriceMinute("15:30"), true);
  assert.equal(isAShareAfterHoursFixedPriceMinute("15:31"), false);
});
