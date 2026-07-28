import test from "node:test";
import assert from "node:assert/strict";

import { evaluateZijinDisplacementWatch } from "../lib/zijin-displacement-reminder.mjs";

const buildPoints = (prices) =>
  prices.map((price, index) => ({
    time: `09:${String(30 + index).padStart(2, "0")}`,
    price,
    volume: 100,
  }));

test("creates a non-executable upper displacement watch", () => {
  const result = evaluateZijinDisplacementWatch(
    buildPoints([31.2, 31.22, 31.21, 31.25, 31.3, 31.72]),
  );
  assert.equal(result?.direction, "反T");
  assert.equal(result?.executable, false);
  assert.match(result?.label ?? "", /高位偏离/);
  assert.match(result?.reason ?? "", /不是卖点/);
});

test("does not alert for ordinary movement near VWAP", () => {
  const result = evaluateZijinDisplacementWatch(
    buildPoints([31.2, 31.21, 31.19, 31.22, 31.2, 31.23]),
  );
  assert.equal(result, null);
});

test("stable tier id supports one reminder per displacement level", () => {
  const first = evaluateZijinDisplacementWatch(
    buildPoints([31.2, 31.2, 31.2, 31.2, 31.2, 31.5]),
    { minimumBiasPct: 0.5 },
  );
  const second = evaluateZijinDisplacementWatch(
    buildPoints([31.2, 31.2, 31.2, 31.2, 31.2, 31.52]),
    { minimumBiasPct: 0.5 },
  );
  assert.equal(first?.id, second?.id);
});

test("future suffix cannot change an earlier causal result", () => {
  const prefix = buildPoints([31.2, 31.2, 31.2, 31.2, 31.2, 31.6]);
  const before = evaluateZijinDisplacementWatch(prefix);
  const fullDay = [...prefix, ...buildPoints([30.9, 30.8]).map((point, index) => ({
    ...point,
    time: `10:0${index}`,
  }))];
  const replayedPrefix = evaluateZijinDisplacementWatch(fullDay.slice(0, prefix.length));
  assert.deepEqual(replayedPrefix, before);
});
