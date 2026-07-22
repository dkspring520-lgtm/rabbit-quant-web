import test from "node:test";
import assert from "node:assert/strict";
import { evaluateZijinExperimentalReminder } from "../lib/zijin-experimental-reminder.mjs";

const rows = (values) => values.map(([time, price, volume]) => ({ time, price, volume }));

const positivePrefix = rows([
  ["0930", 10.00, 100], ["0931", 10.02, 100], ["0932", 10.04, 100],
  ["0933", 10.06, 100], ["0934", 10.08, 100], ["0935", 10.10, 100],
  ["0936", 10.12, 250], ["0937", 9.98, 100], ["0938", 9.96, 100],
  ["0939", 9.98, 100],
]);

test("Zijin 2-3x volume VWAP turn emits one causal experimental reminder", () => {
  const result = evaluateZijinExperimentalReminder(positivePrefix);
  assert.ok(result);
  assert.equal(result.direction, "正T");
  assert.equal(result.asOfTime, "0939");
  assert.equal(result.executable, false);
  assert.equal(result.affectsV4, false);
  assert.match(result.title, /实验观察/);
  assert.match(result.plan, /下一分钟模拟成交/);
});

test("ordinary volume does not create the experimental reminder", () => {
  const ordinary = positivePrefix.map((point) => ({ ...point, volume: 100 }));
  assert.equal(evaluateZijinExperimentalReminder(ordinary), null);
});

test("future minutes cannot move the real-time signal and no second reminder is emitted", () => {
  const atSignal = evaluateZijinExperimentalReminder(positivePrefix);
  const afterSignal = evaluateZijinExperimentalReminder([
    ...positivePrefix,
    { time:"0940", price:10.20, volume:900 },
    { time:"0941", price:9.70, volume:900 },
  ]);
  assert.equal(atSignal?.asOfTime, "0939");
  assert.equal(afterSignal, null);
});

test("a 1-3x relaxed band is not silently used", () => {
  const weak = positivePrefix.map((point) => point.time === "0936" ? { ...point, volume: 150 } : point);
  assert.equal(evaluateZijinExperimentalReminder(weak), null);
});
