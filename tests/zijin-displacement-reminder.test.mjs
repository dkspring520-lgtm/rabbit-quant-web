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

test("stable tier id supports one reminder per displacement episode", () => {
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

test("adds a causal pullback progression after an upper displacement", () => {
  const result = evaluateZijinDisplacementWatch(
    buildPoints([31.2, 31.2, 31.2, 31.2, 31.72, 31.66, 31.60]),
  );
  assert.equal(result?.stage, "displacement-progress");
  assert.equal(result?.direction, "反T");
  assert.match(result?.label ?? "", /冲高回落加速/);
  assert.match(result?.reason ?? "", /不是正式卖点/);
});

test("upgrades pullback progression when two recent L2 minutes confirm sell pressure", () => {
  const points = buildPoints([31.2, 31.2, 31.2, 31.2, 31.72, 31.66, 31.60])
    .map((point, index) => index < 5 ? point : ({
      ...point,
      l2: {
        status: { connected: true, authorized: true, stale: false },
        flow: {
          activeBuyVolume60s: 40,
          activeSellVolume60s: 60,
          activeBuyRatio60s: 0.40,
          netActiveNotional60s: -1_000_000,
          bigOrderNetNotional60s: -500_000,
        },
      },
    }));
  const result = evaluateZijinDisplacementWatch(points);
  assert.equal(result?.stage, "displacement-l2-confirmation");
  assert.match(result?.label ?? "", /卖压确认/);
  assert.equal(result?.l2.confirmed, true);
});

test("progress event id stays stable while the same excursion continues", () => {
  const first = evaluateZijinDisplacementWatch(
    buildPoints([31.2, 31.2, 31.2, 31.2, 31.72, 31.66, 31.60]),
  );
  const second = evaluateZijinDisplacementWatch(
    buildPoints([31.2, 31.2, 31.2, 31.2, 31.72, 31.66, 31.60, 31.57]),
  );
  assert.equal(first?.id, second?.id);
});

test("closing call auction jump is not labelled as a normal displacement repair", () => {
  const points = buildPoints([31.2, 31.2, 31.2, 31.2, 31.3, 31.35]);
  points.at(-1).time = "15:00";
  points.at(-1).price = 31.8;
  assert.equal(evaluateZijinDisplacementWatch(points), null);
});
