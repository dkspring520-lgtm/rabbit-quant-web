import test from "node:test";
import assert from "node:assert/strict";
import {
  diagnoseAiMonitorSnapshot,
  mergeAiMonitorDiagnosis,
  normalizeAiMonitorRemoteCheck,
} from "../lib/ai-monitor-diagnostics.mjs";

const quote = { code: "601899", name: "紫金矿业", price: 10.2, previousClose: 10, change: .2, changePercent: 2, open: 10, high: 10.3, low: 9.9 };

test("AI monitor accepts the A-share lunch break and keeps the shadow layer isolated", () => {
  const result = diagnoseAiMonitorSnapshot({
    minutes: [
      { time: "0930", price: 10, volume: 100, averagePrice: 10 },
      { time: "0931", price: 10.1, volume: 120, averagePrice: 10.05 },
      { time: "1130", price: 10.15, volume: 100, averagePrice: 10.08 },
      { time: "1300", price: 10.2, volume: 140, averagePrice: 10.1 },
    ],
    quote,
    vwap: 10.1,
    asOfTime: "2026-09-27T13:00:00+08:00",
    formalActions: [{ time: "1130", price: 10.15, side: "买入" }],
    shadowSignals: [{ time: "1130", price: 10.15, direction: "正T" }],
    shadowResearch: { generatedAt: "2026-09-27T13:00:00+08:00", policy: { researchOnly: true, affectsFormalSignal: false } },
  });
  assert.notEqual(result.status, "blocked");
  assert.equal(result.dataQuality.futureDataCount, 0);
  assert.equal(result.boundaries.shadowResearchOnly, true);
  assert.equal(result.checks.find(item => item.id === "intraday-axis").status, "warning");
});
test("AI monitor blocks a minute or signal that is later than the current evidence time", () => {
  const result = diagnoseAiMonitorSnapshot({
    minutes: [
      { time: "0930", price: 10, volume: 100 },
      { time: "0932", price: 10.2, volume: 120 },
    ],
    quote,
    asOfTime: "2026-09-27T09:31:00+08:00",
    formalActions: [{ time: "0932", price: 10.2, side: "买入" }],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.dataQuality.futureDataCount, 2);
  assert.match(result.summary, /超过当前数据时间|晚于最新行情/);
});

test("AI monitor warns on duplicate and missing intraday events", () => {
  const result = diagnoseAiMonitorSnapshot({
    minutes: [
      { time: "0930", price: 10, volume: 100 },
      { time: "0930", price: 10.01, volume: 20 },
      { time: "0932", price: 10.03, volume: 80 },
    ],
    quote,
    asOfTime: "0932",
    formalActions: [
      { time: "0932", price: 10.03, side: "买入" },
      { time: "0932", price: 10.03, side: "买入" },
    ],
  });
  assert.equal(result.status, "warning");
  assert.equal(result.dataQuality.duplicateSignalCount, 1);
  assert.equal(result.dataQuality.duplicateEventCount, 1);
  const signalCheck = result.checks.find(item => item.id === "signal-causality");
  assert.match(signalCheck.detail, /发现 1 个重复事件/);
  assert.deepEqual(signalCheck.duplicateGroups[0], {
    time: "09:32",
    type: "正式提醒",
    direction: "买入",
    price: 10.03,
    copies: 2,
    sources: ["正式提醒 ×2"],
  });
  assert.match(result.checks.find(item => item.id === "intraday-axis").detail, /时间点重复|分时数据中断/);
});

test("AI monitor reports repeated copies of one event with time, type, and source", () => {
  const observation = { time: "1015", price: 10.23, direction: "正T", watchKey: "601899:bottom-watch:1015:1", sourceLabel: "日内观察" };
  const result = diagnoseAiMonitorSnapshot({
    minutes: [{ time: "1015", price: 10.23, volume: 100 }],
    asOfTime: "1015",
    observations: [observation, { ...observation }, { ...observation }, { ...observation }],
  });
  const check = result.checks.find(item => item.id === "signal-causality");
  assert.equal(result.dataQuality.duplicateEventCount, 1);
  assert.equal(result.dataQuality.duplicateSignalCount, 3, "the duplicate count is extra copies, not opportunities");
  assert.deepEqual(check.duplicateGroups[0], {
    time: "10:15",
    type: "图上观察点",
    direction: "正T",
    price: 10.23,
    copies: 4,
    sources: ["日内观察 ×4"],
  });
  assert.match(check.detail, /多出 3 条记录/);
});

test("AI monitor does not merge signals from different categories at the same time and price", () => {
  const result = diagnoseAiMonitorSnapshot({
    minutes: [{ time: "1015", price: 10.23, volume: 100 }],
    asOfTime: "1015",
    formalActions: [{ time: "1015", price: 10.23, side: "买入" }],
    observations: [{ time: "1015", price: 10.23, direction: "正T" }],
  });
  assert.equal(result.dataQuality.duplicateSignalCount, 0);
  assert.equal(result.dataQuality.duplicateEventCount, 0);
});

test("AI monitor keeps same-minute evidence from different strategies separate", () => {
  const result = diagnoseAiMonitorSnapshot({
    minutes: [{ time: "1015", price: 10.23, volume: 100 }],
    asOfTime: "1015",
    observations: [
      { time: "1015", price: 10.23, direction: "正T", strategy: "closure", observationKind: "pivot-bottom" },
      { time: "1015", price: 10.23, direction: "正T", strategy: "observation", observationKind: "macd" },
    ],
  });
  assert.equal(result.dataQuality.duplicateSignalCount, 0);
});

test("AI monitor does not call incomplete records duplicates", () => {
  const result = diagnoseAiMonitorSnapshot({
    minutes: [{ time: "1015", price: 10.23, volume: 100 }],
    asOfTime: "1015",
    observations: [
      { price: null, direction: "正T" },
      { time: "", price: 0, direction: "正T" },
    ],
  });
  const check = result.checks.find(item => item.id === "signal-causality");
  assert.equal(result.dataQuality.duplicateSignalCount, 0);
  assert.equal(result.dataQuality.unverifiableSignalCount, 2);
  assert.equal(check.status, "insufficient");
  assert.match(check.detail, /无法确认是否重复/);
});

test("remote diagnostic failures are merged without changing formal signal boundaries", () => {
  const base = diagnoseAiMonitorSnapshot({ minutes: [], quote: null });
  assert.equal("score" in base, false, "diagnostics should not resemble a trading score");
  const response = new Response(JSON.stringify({ error: "timeout" }), { status: 502 });
  const check = normalizeAiMonitorRemoteCheck({
    id: "market-data",
    label: "行情与分钟线",
    response,
    payload: { error: "timeout" },
    error: null,
    latencyMs: 2500,
  });
  const result = mergeAiMonitorDiagnosis(base, [check]);
  assert.equal(result.status, "blocked");
  assert.equal("score" in result, false);
  assert.equal(result.boundaries.formalSignalUnchanged, true);
  assert.equal(result.boundaries.canExecute, false);
});

test("an HTML or empty 200 response is not reported as a healthy API", () => {
  const check = normalizeAiMonitorRemoteCheck({
    id: "version",
    label: "版本接口",
    response: new Response("<!doctype html>", { status: 200 }),
    payload: null,
    error: null,
    latencyMs: 80,
  });
  assert.equal(check.status, "insufficient");
  assert.match(check.detail, /没有返回可读取的数据/);
});
