import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeBatchSeed,
  randomizedUniqueQueue,
  sampleWithSeed,
} from "../lib/batch-sampler.mjs";

const stockPool = Array.from({ length: 40 }, (_, index) => ({
  code: String(600000 + index),
  name: `stock-${index}`,
}));

test("the same seed produces the same reproducible sample", () => {
  const first = sampleWithSeed(stockPool, 10, "2026-07-16:batch-1");
  const second = sampleWithSeed(stockPool, 10, "2026-07-16:batch-1");

  assert.deepEqual(second, first);
  assert.deepEqual(first.map((stock) => stock.code), [
    "600026",
    "600036",
    "600031",
    "600004",
    "600024",
    "600003",
    "600010",
    "600033",
    "600007",
    "600032",
  ]);
});

test("different seeds normally produce different samples", () => {
  const first = sampleWithSeed(stockPool, 10, "batch-alpha");
  const second = sampleWithSeed(stockPool, 10, "batch-beta");

  assert.notDeepEqual(second, first);
});

test("sampling does not mutate the input and never repeats unique positions", () => {
  const before = stockPool.slice();
  const sample = sampleWithSeed(stockPool, 10, 20260716);

  assert.deepEqual(stockPool, before);
  assert.equal(new Set(sample).size, 10);
});

test("a count larger than the pool is safely truncated", () => {
  const sample = sampleWithSeed(stockPool, 10_000, 99n);

  assert.equal(sample.length, stockPool.length);
  assert.equal(new Set(sample).size, stockPool.length);
  assert.deepEqual(stockPool.map((stock) => stock.code),
    Array.from({ length: 40 }, (_, index) => String(600000 + index)));
});

test("zero, negative and fractional counts are normalized safely", () => {
  assert.deepEqual(sampleWithSeed(stockPool, 0, "count"), []);
  assert.deepEqual(sampleWithSeed(stockPool, -5, "count"), []);
  assert.equal(sampleWithSeed(stockPool, 3.9, "count").length, 3);
  assert.equal(sampleWithSeed(stockPool, Infinity, "count").length, stockPool.length);
});

test("empty string, numeric and bigint seeds have stable normalized values", () => {
  assert.equal(normalizeBatchSeed(""), normalizeBatchSeed(""));
  assert.equal(normalizeBatchSeed(42), normalizeBatchSeed(42));
  assert.equal(normalizeBatchSeed(42n), normalizeBatchSeed(42n));
  assert.notEqual(normalizeBatchSeed("42"), normalizeBatchSeed(42));
  assert.throws(() => normalizeBatchSeed({}), /seed must be/);
});

test("item validation and value de-duplication remain the caller's concern", () => {
  const duplicate = { code: "601899" };
  const mixedPool = [duplicate, duplicate, null, "invalid", { code: "603993" }];
  const sample = sampleWithSeed(mixedPool, mixedPool.length, "mixed");

  assert.equal(sample.length, mixedPool.length);
  assert.equal(sample.filter((item) => item === duplicate).length, 2);
  assert.ok(sample.includes(null));
  assert.ok(sample.includes("invalid"));
});

test("non-array input is rejected without attempting business normalization", () => {
  assert.throws(() => sampleWithSeed(new Set(stockPool), 10, "seed"), /items must be an array/);
});

test("recent stock codes are pushed behind fresh full-market choices", () => {
  const recent = stockPool.slice(0, 10).map((stock) => stock.code);
  const queue = randomizedUniqueQueue(stockPool, "next-batch", recent);

  assert.equal(queue.length, stockPool.length);
  assert.equal(new Set(queue.map((stock) => stock.code)).size, stockPool.length);
  assert.equal(queue.slice(0, 10).filter((stock) => recent.includes(stock.code)).length, 0);
  assert.deepEqual(new Set(queue.slice(-10).map((stock) => stock.code)), new Set(recent));
});

test("randomized queue removes duplicate business keys before sampling", () => {
  const queue = randomizedUniqueQueue([
    { code: "601899", name: "first" },
    { code: "601899", name: "duplicate" },
    { code: "603993", name: "second" },
    null,
  ], "dedupe");

  assert.equal(queue.length, 2);
  assert.deepEqual(new Set(queue.map((stock) => stock.code)), new Set(["601899", "603993"]));
});
