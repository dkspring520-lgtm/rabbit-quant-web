import test from "node:test";
import assert from "node:assert/strict";
import { normalizeClientFormalAlert } from "../lib/client-formal-alert.mjs";

const monitors = [{ code: "601899", name: "紫金矿业" }];
const now = new Date("2026-08-28T12:00:00Z");

test('formal markers reject malformed clocks instead of rolling them into a trading minute', () => {
  const normalize = time => normalizeClientFormalAlert({
    code: '601899', marketDate: '20260828',
    action: { time, price: 34, direction: '正T', side: '买入', confirmationScore: 60 },
  }, { monitors, now });
  for (const time of ['0960', '1099', '1360', '101035', 'text1035', '10::35']) {
    assert.throws(() => normalize(time), /时间无效/, time);
  }
  for (const time of ['1035', '10:35']) assert.equal(normalize(time).marketTime, '1035');
});

test('a scored reverse-T buyback accepts the engine buy side without changing direction', () => {
  const input = { code: '601899', marketDate: '20260828', action: { time: '1035', price: 34, direction: '反T', side: '买入', confirmationScore: 76 } };
  const alert = normalizeClientFormalAlert(input, { monitors, now });
  assert.equal(alert.level, 'formal');
  assert.equal(alert.payload.action.side, '买入');
  assert.equal(alert.payload.action.direction, '反T');
  assert.match(alert.title, /买回/);
  assert.throws(() => normalizeClientFormalAlert({ ...input, action: { ...input.action, confirmationScore: 59 } }, { monitors, now }), /60-100/);
});

test('risk exits synchronize without inventing a formal score', () => {
  for (const flag of ['stop', 'timeExit', 'forceExit']) {
    for (const [direction, side] of [['正T', '卖出'], ['反T', '买入']]) {
      const input = { code: '601899', marketDate: '20260828', action: { time: '1035', price: 34, direction, side, meta: { phase: 'exit', [flag]: true } } };
      const alert = normalizeClientFormalAlert(input, { monitors, now });
      assert.equal(alert.level, 'risk');
      assert.equal(alert.payload.action.confirmationScore, undefined);
      assert.match(alert.eventKey, /risk-exit/);
      assert.throws(() => normalizeClientFormalAlert({ ...input, action: { ...input.action, meta: { phase: 'entry', [flag]: true } } }, { monitors, now }), /60-100/);
    }
  }
});

test("formal score boundaries apply to both buy and sell signals", () => {
  for (const [direction, side] of [["正T", "买入"], ["反T", "卖出"]]) {
    const normalize = confirmationScore => normalizeClientFormalAlert({
      code: "601899", marketDate: "2026-08-28",
      action: { time: "1035", price: 34.42, direction, side, confirmationScore },
    }, { monitors, now });
    for (const score of [undefined, null, "", "76", [76], {}, true, 0, 59, 59.99, 101, NaN, Infinity, -Infinity]) {
      assert.throws(() => normalize(score), /60-100分/, `must reject ${String(score)} for ${side}`);
    }
    for (const score of [60, 76, 100]) {
      assert.equal(normalize(score).payload.action.confirmationScore, score);
    }
  }
});

test("normalizes a client formal action into a server alert", () => {
  const alert = normalizeClientFormalAlert({
    code: "601899",
    marketDate: "2026-08-28",
    action: { time: "1035", price: 34.42, side: "买入", direction: "正T", reason: "量价确认", confirmationScore: 76 },
  }, { monitors, now });
  assert.equal(alert.level, "formal");
  assert.equal(alert.marketDate, "2026-08-28");
  assert.equal(alert.eventKey, "20260828:601899:formal:client-v4:正T:买入:1035");
  assert.deepEqual(alert.payload.action, { time: "1035", price: 34.42, side: "买入", direction: "正T", reason: "量价确认", confirmationScore: 76 });
});

test("rejects unmonitored stocks and invalid action pairs", () => {
  assert.throws(() => normalizeClientFormalAlert({
    code: "601012", marketDate: "2026-08-28", action: { time: "1035", price: 12.4, side: "买入", direction: "正T", confirmationScore: 60 },
  }, { monitors, now }), /当前账户监控股票/);
  assert.throws(() => normalizeClientFormalAlert({
    code: "601899", marketDate: "2026-08-28", action: { time: "1035", price: 34.42, side: "买回", direction: "正T", confirmationScore: 60 },
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
