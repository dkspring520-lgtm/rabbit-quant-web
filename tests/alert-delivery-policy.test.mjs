import test from "node:test";
import assert from "node:assert/strict";
import { conciseAlertSpeech, resolveAlertDelivery } from "../lib/alert-delivery-policy.mjs";

const at = "2026-07-28T09:45:00+08:00";
const previous = { code: "601899", level: "candidate", rabbit: "buy", title: "紫金矿业 · 低位观察", createdAt: at };

test("candidate speech never turns a research observation into a buy or sell instruction", () => {
  assert.equal(conciseAlertSpeech({ text: "紫金矿业，正T候选观察", level: "candidate", direction: "buy" }), "紫金矿业，低位观察");
  assert.equal(conciseAlertSpeech({ text: "紫金矿业，反T候选观察", level: "candidate", direction: "sell" }), "紫金矿业，高位观察");
  assert.equal(conciseAlertSpeech({ text: "紫金矿业，正T买入提醒", level: "signal", direction: "buy" }), "紫金矿业，买点提醒");
});

test("opposite candidates for one stock are mutually exclusive for ten minutes", () => {
  const result = resolveAlertDelivery({
    previous,
    next: { code: "601899", level: "candidate", rabbit: "sell", title: "紫金矿业 · 高位观察" },
    nowMs: Date.parse(at) + 5_000,
  });
  assert.equal(result.deliver, false);
  assert.equal(result.reason, "opposite-candidate-suppressed");
});

test("a formal signal can override an earlier candidate but formal seconds-level reversal becomes risk", () => {
  const formal = { code: "601899", level: "formal", payload: { action: { side: "卖出" } }, title: "紫金矿业 · 反T执行", createdAt: at };
  assert.equal(resolveAlertDelivery({ previous, next: formal, nowMs: Date.parse(at) + 5_000 }).deliver, true);
  const conflict = resolveAlertDelivery({
    previous: { ...formal, payload: { action: { side: "买入" } } },
    next: { ...formal, payload: { action: { side: "卖出" } }, eventKey: "formal:2" },
    nowMs: Date.parse(at) + 5_000,
  });
  assert.equal(conflict.deliver, true);
  assert.equal(conflict.alert.level, "risk");
  assert.match(conflict.alert.message, /暂停买卖提醒/);
});
