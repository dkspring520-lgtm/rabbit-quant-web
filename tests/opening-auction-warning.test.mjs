import test from "node:test";
import assert from "node:assert/strict";
import { openingAuctionWarning } from "../lib/opening-auction-warning.mjs";

const input = { phase: "auction", exchangeTime: "20260921-092300", date: "20260921", time: "0923", connected: true, stale: false, imbalance: -0.4, open: 11, previousClose: 10 };
test("auction pressure warns without confirming high-open weakness", () => {
  assert.equal(openingAuctionWarning(input).label, "竞价卖压预警 · 待开盘确认");
  assert.equal(openingAuctionWarning({...input, imbalance: 0.4}).label, "竞价承接偏强 · 待开盘确认");
});
test("missing, stale, future and prior-day auction evidence cannot warn", () => {
  for (const change of [{stale:true}, {connected:false}, {imbalance:null}, {date:"20260922"}, {time:"0922"}, {time:"0925"}, {exchangeTime:"20260921-091900"}]) {
    assert.equal(openingAuctionWarning({...input,...change}).label, "盘前预警 · 等待有效竞价数据");
  }
});
test("09:25 confirms gap only; continuous session exits auction logic", () => {
  assert.equal(openingAuctionWarning({...input, phase:"auction-result", time:"0925", exchangeTime:"20260921-092500"}).label, "高开已确认 · 等待开盘走势确认");
  assert.equal(openingAuctionWarning({...input, phase:"trading"}), null);
});
