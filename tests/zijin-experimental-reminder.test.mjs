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
  assert.equal(result.regime, "UP");
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

test("a weak VWAP regime slope stays below the prospective V2 gate", () => {
  const reminder = evaluateZijinExperimentalReminder(positivePrefix, {
    minimumRegimeSlopePct: 99,
  });
  assert.equal(reminder, null);
});

test("later ordinary minutes cannot move the real-time candidate", () => {
  const atSignal = evaluateZijinExperimentalReminder(positivePrefix);
  const afterSignal = evaluateZijinExperimentalReminder([
    ...positivePrefix,
    { time:"0940", price:9.99, volume:100 },
    { time:"0941", price:10.00, volume:100 },
  ]);
  assert.equal(atSignal?.asOfTime, "0939");
  assert.equal(afterSignal, null);
});

test("a new low after a positive-T turn emits a causal experimental exit", () => {
  const result = evaluateZijinExperimentalReminder([
    ...positivePrefix,
    { time:"0940", price:10.00, volume:100 },
    { time:"0941", price:9.97, volume:100 },
    { time:"0942", price:9.98, volume:100 },
    { time:"0943", price:9.94, volume:100 },
  ], { invalidationGraceMinutes:3, invalidationBufferPct:0.10 });
  assert.equal(result?.stage, "experimental-exit");
  assert.equal(result?.direction, "正T");
  assert.equal(result?.exitReason, "TURN_INVALIDATED");
  assert.equal(result?.entryTime, "0940");
  assert.equal(result?.asOfTime, "0943");
});

test("seven minutes without covering estimated costs ends the observation", () => {
  const result = evaluateZijinExperimentalReminder([
    ...positivePrefix,
    { time:"0940", price:9.99, volume:100 },
    { time:"0941", price:10.00, volume:100 },
    { time:"0942", price:9.99, volume:100 },
    { time:"0943", price:10.00, volume:100 },
    { time:"0944", price:9.99, volume:100 },
    { time:"0945", price:10.00, volume:100 },
    { time:"0946", price:9.99, volume:100 },
    { time:"0947", price:10.00, volume:100 },
  ]);
  assert.equal(result?.stage, "experimental-exit");
  assert.equal(result?.exitReason, "NO_PROGRESS");
  assert.equal(result?.elapsedMinutes, 7);
  assert.ok(result.bestNetProgressPct < 0);
});

test("falling VWAP regime routes only to reverse-T", () => {
  const reversePrefix = rows([
    ["0930", 10.00, 100], ["0931", 9.98, 100], ["0932", 9.96, 100],
    ["0933", 9.94, 100], ["0934", 9.92, 100], ["0935", 9.90, 100],
    ["0936", 9.88, 250], ["0937", 10.05, 100], ["0938", 10.10, 100],
    ["0939", 10.08, 100],
  ]);
  const result = evaluateZijinExperimentalReminder(reversePrefix);
  assert.equal(result?.direction, "反T");
  assert.equal(result?.regime, "DOWN");
});

test("a 1-3x relaxed band is not silently used", () => {
  const weak = positivePrefix.map((point) => point.time === "0936" ? { ...point, volume: 150 } : point);
  assert.equal(evaluateZijinExperimentalReminder(weak), null);
});
