import test from "node:test";
import assert from "node:assert/strict";
import { CausalKdj, calculateKdjSeries, KDJ_CONTRACT_VERSION } from "../lib/indicators/causal-kdj.mjs";
import { IndicatorEngine } from "../lib/indicators/indicator-engine.mjs";
import { FactorEngine, auditFutureInvariance } from "../lib/factor-research/factor-engine.mjs";
import { buildKdjFeatures, buildKdjFeatureSeries, buildV04Features, buildLegacyV04Features, LEGACY_V04_KDJ_CONTRACT } from "../lib/rl-research/trainer/feature-label-study.mjs";

function bars(closes, start = "2026-10-13T09:31:00+08:00", step = 1) {
  return closes.map((close, index) => {
    const end = Date.parse(start) + index * step * 60000;
    const local = new Date(end + 8 * 3600000).toISOString();
    return { timestamp: new Date(end).toISOString(), barEndTime: new Date(end).toISOString(),
      time: local.slice(11, 16).replace(":", ""), isComplete: true,
      open: close, high: 12, low: 8, close, price: close, volume: 100 };
  });
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test("default nine-bar warmup does not update the 50 seeds before the first full window", () => {
  const result = calculateKdjSeries(bars(Array(9).fill(12)));
  assert.ok(result.slice(0, 8).every(row => row.value === null && row.metadata.status === "WARMUP"));
  near(result[8].value.k, 200 / 3);
  near(result[8].value.d, 500 / 9);
  near(result[8].value.j, 800 / 9);
  assert.equal(result[8].metadata.warmupBars, 8);
});

test("hand-calculated consecutive values retain recursive memory beyond one rolling window", () => {
  const result = calculateKdjSeries(bars([10, 11, 12, 11, 9, 8]), { period: 3 });
  near(result[2].value.k, 200 / 3);
  near(result[2].value.d, 500 / 9);
  near(result[3].value.k, 625 / 9);
  near(result[3].value.d, 1625 / 27);
  near(result[4].value.k, 1475 / 27);
  near(result[4].value.d, 4725 / 81);
  near(result[5].value.k, 2950 / 81);
  near(result[5].value.d, 12400 / 243);
});

test("rising, falling, sideways and flat ranges remain explicit", () => {
  const up = calculateKdjSeries(bars([8, 9, 10, 11, 12]), { period: 3 }).at(-1).value;
  const down = calculateKdjSeries(bars([12, 11, 10, 9, 8]), { period: 3 }).at(-1).value;
  assert.ok(up.j > up.k && up.k > up.d);
  assert.ok(down.j < down.k && down.k < down.d);
  const flat = bars(Array(12).fill(10)).map(row => ({ ...row, open: 10, high: 10, low: 10 }));
  assert.deepEqual(calculateKdjSeries(flat).at(-1).value, { k: 50, d: 50, j: 50 });
  const zeroRsv = calculateKdjSeries(bars([8]), { period: 1 })[0];
  assert.equal(zeroRsv.metadata.rsv, 0);
  near(zeroRsv.value.k, 100 / 3);
});

test("missing/nonfinite OHLC resets and rewarms; zero prices and price proxies are rejected", () => {
  for (const missing of [null, undefined, NaN, Infinity, "", "10", false, 0]) {
    const input = bars(Array(7).fill(12));
    input[3].high = missing;
    const result = calculateKdjSeries(input, { period: 3 });
    assert.equal(result[3].value, null);
    assert.equal(result[3].metadata.status, "INVALID");
    assert.equal(result[4].value, null);
    assert.equal(result[5].value, null);
    near(result[6].value.k, 200 / 3);
  }
  const proxy = bars([10])[0];
  proxy.inputKind = "PRICE_PROXY";
  assert.equal(calculateKdjSeries([proxy], { period: 1 })[0].metadata.reason, "PRICE_PROXY_NOT_ALLOWED");
  assert.equal(calculateKdjSeries([{ ...bars([10])[0], low: 11 }], { period: 1 })[0].metadata.reason, "OHLC_ORDER_INVALID");
});

test("forming and future-visible higher-timeframe bars cannot enter state or consume their final update", () => {
  const stream = new CausalKdj({ period: 1, timeframeMinutes: 5 });
  const row = bars([12], "2026-10-13T09:35:00+08:00", 5)[0];
  assert.equal(stream.update({ ...row, isComplete: false }).metadata.reason, "BAR_NOT_CONFIRMED_COMPLETE");
  assert.equal(stream.update(row, { asOf: "2026-10-13T09:34:59+08:00" }).metadata.reason, "BAR_NOT_YET_VISIBLE");
  assert.equal(stream.update({ ...row, availableAt: "2026-10-13T09:35:02+08:00" }, { asOf: row.barEndTime }).value, null);
  near(stream.update(row, { asOf: row.barEndTime }).value.k, 200 / 3);
});

test("future append and mutation cannot change a historical prefix", () => {
  const prefix = bars([8, 9, 10, 11, 12, 11]);
  const future = bars([8, 12, 9], "2026-10-13T09:37:00+08:00");
  assert.deepEqual(calculateKdjSeries([...prefix, ...future], { period: 3 }).slice(0, prefix.length), calculateKdjSeries(prefix, { period: 3 }));
});

test("multiple chunks on the same stream exactly equal continuous batch output", () => {
  const input = bars([8, 9, 10, 11, 12, 11, 10, 9, 8, 10, 12]);
  const stream = new CausalKdj({ period: 3 });
  const chunks = [...stream.updateSeries(input.slice(0, 2)), ...stream.updateSeries(input.slice(2, 7)), ...stream.updateSeries(input.slice(7))];
  assert.deepEqual(chunks, calculateKdjSeries(input, { period: 3 }));
});

test("A-share lunch preserves state; overnight resets to warmup and seed 50", () => {
  const input = [...bars([12, 12, 12], "2026-10-13T11:28:00+08:00"),
    ...bars([12], "2026-10-13T13:01:00+08:00"), ...bars([12, 12, 12], "2026-10-14T09:31:00+08:00")];
  const result = calculateKdjSeries(input, { period: 3 });
  assert.equal(result[3].metadata.resetReason, null);
  near(result[3].value.k, 700 / 9);
  assert.equal(result[4].metadata.resetReason, "NEW_TRADING_DAY");
  assert.equal(result[4].value, null);
  near(result[6].value.k, 200 / 3);
});

test("unexpected gaps rewarm and duplicate/out-of-order bars never mutate state", () => {
  const stream = new CausalKdj({ period: 1 });
  const input = bars([12, 12]);
  stream.update(input[0]);
  assert.equal(stream.update(input[0]).metadata.reason, "NON_MONOTONIC_BAR_END");
  near(stream.update(input[1]).value.k, 700 / 9);
  const gap = stream.update(bars([12], "2026-10-13T09:35:00+08:00")[0]);
  assert.equal(gap.metadata.resetReason, "UNEXPECTED_BAR_GAP");
  near(gap.value.k, 200 / 3);
});

test("parameter aliases are honored or rejected explicitly; timestamps need an end-label contract", () => {
  const input = bars(Array(12).fill(12));
  for (const options of [{ n: 3 }, { period: 3 }, { length: 3 }]) {
    assert.equal(calculateKdjSeries(input, options).findIndex(row => row.value !== null), 2);
  }
  assert.throws(() => new CausalKdj({ period: 3, length: 9 }), /Conflicting/);
  assert.throws(() => new CausalKdj({ signal: 4 }), /fixed at 3/);
  assert.throws(() => new CausalKdj({ period: "9" }), /integer/);
  const undeclared = input.map(({ barEndTime, isComplete, ...row }) => row);
  assert.ok(calculateKdjSeries(undeclared).every(row => row.value === null));
  assert.ok(calculateKdjSeries(undeclared, { completedBars: true }).every(row => row.value === null));
  assert.ok(calculateKdjSeries(undeclared, { completedBars: true, timestampRole: "end" }).at(-1).value);
});

test("indicator, factor and new research feature entry points agree on canonical KDJ and parameters", () => {
  const input = bars([8, 9, 10, 11, 12, 11, 10, 9, 8, 9, 10]);
  const options = { length: 3 };
  const original = structuredClone(input);
  const expected = calculateKdjSeries(input, options);
  const indicator = new IndicatorEngine({ adapter: { calculate() { throw new Error("KDJ must not use the external provider"); } } }).calculateSeries("KDJ_9", input, { parameters: options });
  const factors = new FactorEngine().computeSession({ date: "20261013", minutes: input }, { factorIds: ["technical.kdj_j9"], kdj: options });
  const features = buildKdjFeatureSeries(input, options);
  for (let i = 0; i < input.length; i++) {
    assert.deepEqual(indicator.series[i].value, expected[i].value);
    assert.equal(factors.rows[i].factors["technical.kdj_j9"], expected[i].value ? expected[i].value.j / 50 - 1 : null);
    assert.deepEqual([features[i].kdjK, features[i].kdjD, features[i].kdjJ], expected[i].value ? Object.values(expected[i].value) : [null, null, null]);
    assert.equal(factors.rows[i].factorMetadata["technical.kdj_j9"].contractVersion, KDJ_CONTRACT_VERSION);
  }
  assert.deepEqual(buildKdjFeatures(input, 5, options), features[5]);
  assert.equal(indicator.metadata.warmupBars, 2);
  assert.deepEqual(input, original);
  assert.equal(auditFutureInvariance({ date: "20261013", minutes: input }, { factorIds: ["technical.kdj_j9"] }).pass, true);
});

test("factor normalization cannot launder price proxies into OHLC KDJ", () => {
  const input = bars(Array(12).fill(12)).map(({ open, high, low, close, ...row }) => row);
  const factor = new FactorEngine().computeSession({ date: "20261013", minutes: input }, { factorIds: ["technical.kdj_j9"] });
  assert.ok(factor.rows.every(row => row.factors["technical.kdj_j9"] === null));
  assert.ok(factor.rows.every(row => row.factorMetadata["technical.kdj_j9"].reason === "COMPLETE_POSITIVE_OHLC_REQUIRED"));
});

test("legacy V0.4 RSV14 remains isolated with unchanged exports and null D/J", () => {
  const input = bars(Array(20).fill(10));
  const legacy = buildV04Features(input, 19);
  assert.deepEqual(legacy, buildLegacyV04Features(input, 19));
  assert.equal(legacy.kdjK, 50);
  assert.equal(legacy.kdjD, null);
  assert.equal(legacy.kdjJ, null);
  assert.match(LEGACY_V04_KDJ_CONTRACT, /legacy.*rsv14/);
  assert.equal(buildKdjFeatures(input, 19).featureVersion, KDJ_CONTRACT_VERSION);
  assert.equal(buildKdjFeatures(input, 19).kdjD, 50);
});

test("factor session adapters reject silent sorting, duplicates and cross-date merging for declared completed bars", () => {
  const input = bars([10, 11, 12]);
  const engine = new FactorEngine();
  const options = { factorIds: ["technical.kdj_j9"] };
  for (const minutes of [[input[1], input[0]], [input[0], input[0]]]) {
    assert.throws(() => engine.computeSession({ date: "20261013", minutes }, options), /ordered unique/);
  }
  assert.throws(() => engine.computeSession({ date: "20261013", minutes: bars([10], "2026-10-14T09:31:00+08:00") }, options), /cannot merge trading dates/);
});

test("end-labelled historical session contract forwards completion and parameter settings without inferring OHLC", () => {
  const source = bars([10, 11, 12]).map(({ barEndTime, timestamp, isComplete, ...row }) => row);
  const result = new FactorEngine().computeSession({ date: "20261013", minutes: source,
    kdjContract: { timestampRole: "end", completedBars: true, period: 3 } }, { factorIds: ["technical.kdj_j9"] });
  near(result.rows[2].factors["technical.kdj_j9"], (800 / 9) / 50 - 1);
  assert.ok(result.rows.slice(0, 2).every(row => row.factors["technical.kdj_j9"] === null));
});

test("indicator uses canonical end times and ordering without stringifying fallback array indexes", () => {
  const input = bars(Array(12).fill(12)).map(({ timestamp, time, ...row }) => row);
  const engine = new IndicatorEngine();
  const result = engine.calculateSeries("KDJ_9", input);
  assert.deepEqual(result.series.map(row => row.value), calculateKdjSeries(input).map(row => row.value));
  const duplicate = [...input, input.at(-1)];
  assert.equal(engine.calculate("KDJ_9", duplicate).metadata.reason, "NON_MONOTONIC_BAR_END");
  assert.deepEqual(engine.calculateSeries("KDJ_9", duplicate, { asOfIndex: 8 }).series.map(row => row.value), result.series.slice(0, 9).map(row => row.value));
  assert.equal(calculateKdjSeries([{ ...input[0], barEndTime: 1e30 }])[0].metadata.reason, "BAR_TIME_CONTRACT_MISSING_OR_INVALID");
});
