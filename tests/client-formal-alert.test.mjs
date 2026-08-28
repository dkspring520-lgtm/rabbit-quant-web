import test from "node:test";
import assert from "node:assert/strict";
import { normalizeClientFormalAlert } from "../lib/client-formal-alert.mjs";

const monitors = [{ code: "601899", name: "紫金矿业" }];
const now = new Date("2026-08-28T12:00:00Z");

test("normalizes a client formal action into a server alert", () => {
  const alert = normalizeClientFormalAlert({
    code: "601899",
    marketDate: "2026-08-28",
    action: { time: "1035", price: 34.42, side: "买入", direction: "正T", reason: "量价确认" },
  }, { monitors, now });
  assert.equal(alert.level, "formal");
  assert.equal(alert.marketDate, "2026-08-28");
  assert.equal(alert.eventKey, "20260828:601899:formal:client-v4:正T:买入:1035");
  assert.deepEqual(alert.payload.action, { time: "1035", price: 34.42, side: "买入", direction: "正T", reason: "量价确认" });
});

test("rejects unmonitored stocks and invalid action pairs", () => {
  assert.throws(() => normalizeClientFormalAlert({
    code: "601012", marketDate: "2026-08-28", action: { time: "1035", price: 12.4, side: "买入", direction: "正T" },
  }, { monitors, now }), /当前账户监控股票/);
  assert.throws(() => normalizeClientFormalAlert({
    code: "601899", marketDate: "2026-08-28", action: { time: "1035", price: 34.42, side: "买回", direction: "正T" },
  }, { monitors, now }), /方向与动作不一致/);
});

test("rejects stale dates, non-session times, and invalid prices", () => {
  assert.throws(() => normalizeClientFormalAlert({
    code: "601899", marketDate: "2026-08-01", action: { time: "1035", price: 34.42, side: "买入", direction: "正T" },
  }, { monitors, now }), /最近7天/);
  assert.throws(() => normalizeClientFormalAlert({
    code: "601899", marketDate: "2026-08-28", action: { time: "1200", price: 34.42, side: "买入", direction: "正T" },
  }, { monitors, now }), /交易时段/);
  assert.throws(() => normalizeClientFormalAlert({
    code: "601899", marketDate: "2026-08-28", action: { time: "1035", price: 0, side: "买入", direction: "正T" },
  }, { monitors, now }), /价格无效/);
});
