import assert from "node:assert/strict";
import test from "node:test";
import { compactChartLabelKey, compactChartLabelKeys } from "../lib/compact-chart-labels.mjs";

test("phone chart keeps no more than three candidate text labels", () => {
  const observations = [
    { time: "0934", direction: "正T", stage: "candidate", score: 72 },
    { time: "0938", direction: "正T", stage: "candidate", score: 79 },
    { time: "0941", direction: "反T", stage: "candidate", score: 74 },
    { time: "0945", direction: "反T", stage: "candidate", score: 82 },
    { time: "0952", direction: "正T", stage: "candidate", score: 76 },
  ];
  const keys = compactChartLabelKeys(observations, 3);
  assert.equal(keys.size, 3);
  assert.equal(keys.has("0938:正T"), true);
  assert.equal(keys.has("0945:反T"), true);
});

test("phone chart never promotes watch-only dots into text labels", () => {
  const watch = { time: "0936", direction: "正T", stage: "watch", score: 99 };
  const candidate = { time: "0948", direction: "反T", stage: "candidate", score: 70 };
  const keys = compactChartLabelKeys([watch, candidate], 3);
  assert.equal(keys.has(compactChartLabelKey(watch)), false);
  assert.equal(keys.has(compactChartLabelKey(candidate)), true);
});
