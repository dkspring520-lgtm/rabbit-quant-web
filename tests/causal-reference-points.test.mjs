import assert from "node:assert/strict";
import test from "node:test";

import { buildCausalReferencePoints } from "../lib/causal-reference-points.mjs";

function minutes(prices) {
  return prices.map((price, index) => ({
    time: `09${String(30 + index).padStart(2, "0")}`,
    price,
    volume: 1_000,
  }));
}

test("completed stock day receives one or two causal references on each side", () => {
  const points = buildCausalReferencePoints(minutes([
    10, 9.98, 9.95, 9.97, 10.01, 10.04, 10.02, 10.08, 10.12, 10.09,
    10.05, 10.02, 10.04, 10.07, 10.03, 10.01, 10.06, 10.08, 10.04, 10.03,
    10.02, 10.05, 10.07, 10.06, 10.04, 10.03, 10.05, 10.08, 10.06, 10.05,
    10.04, 10.03,
  ]));

  assert.ok(points.length >= 2 && points.length <= 4);
  assert.deepEqual(new Set(points.map((point) => point.direction)), new Set(["正T", "反T"]));
  assert.ok([...new Set(points.map((point) => point.direction))].every((direction) => points.filter((point) => point.direction === direction).length <= 2));
  assert.ok(points.every((point) => point.executable === false));
  assert.ok(points.every((point) => !/候补买点|候补卖点/.test(point.confirmationLabel)));
});

test("reference is stamped on confirmation minute instead of earlier pivot", () => {
  const source = minutes([10, 9.98, 9.94, 9.95, 9.97, 10.00, 10.03, 10.05, 10.03, 10.01, 9.99, 10.02]);
  const [buy] = buildCausalReferencePoints(source).filter((point) => point.direction === "正T");

  assert.notEqual(buy.time, buy.pivotTime);
  assert.ok(source.findIndex((point) => point.time === buy.time) > source.findIndex((point) => point.time === buy.pivotTime));
});

test("existing formal candidate wins over generated watch reference", () => {
  const source = minutes(Array.from({ length: 32 }, (_, index) => 10 + index * 0.01));
  const candidate = {
    time: "0942", price: 10.12, direction: "反T", score: 4, threshold: 4,
    edge: 0.7, executable: false, stage: "candidate", blockers: [], reason: "engine candidate",
  };
  const points = buildCausalReferencePoints(source, [candidate]);

  assert.equal(points.find((point) => point.direction === "反T"), candidate);
  assert.ok(points.length >= 2 && points.length <= 4);
});

test("all generated references are emitted after their earlier reference minute", () => {
  const source = minutes(Array.from({ length: 54 }, (_, index) => 10 + Math.sin(index / 2) * 0.08));
  const points = buildCausalReferencePoints(source);
  const indexOf = (time) => source.findIndex((point) => point.time === time);

  assert.ok(points.length >= 2 && points.length <= 4);
  assert.ok(points.every((point) => indexOf(point.time) >= indexOf(point.pivotTime)));
  assert.ok(["正T", "反T"].every((direction) => points.filter((point) => point.direction === direction).length <= 2));
});

test("future suffix cannot move an already emitted causal reference", () => {
  const prefix = minutes([10, 9.98, 9.94, 9.95, 9.97, 10.00, 10.03, 10.05, 10.03, 10.01, 9.99, 10.02]);
  const full = [...prefix, ...minutes([10.08, 10.12, 10.04, 10.01, 10.09]).map((point, index) => ({ ...point, time: `10${String(index).padStart(2, "0")}` }))];
  const prefixBuy = buildCausalReferencePoints(prefix).find((point) => point.direction === "正T");
  const fullBuy = buildCausalReferencePoints(full).find((point) => point.direction === "正T");

  assert.equal(fullBuy.time, prefixBuy.time);
  assert.equal(fullBuy.pivotTime, prefixBuy.pivotTime);
});

test("completed-day references include afternoon engine observations", () => {
  const source = [
    ...minutes(Array.from({ length: 32 }, (_, index) => 10 + Math.sin(index / 2) * 0.08)),
    ...Array.from({ length: 32 }, (_, index) => ({
      time: `13${String(index).padStart(2, "0")}`,
      price: 10 + Math.sin(index / 2) * 0.09,
      volume: 1_000,
    })),
  ];
  const observations = [
    { time: "0942", price: 10.03, direction: "正T", score: 6, stage: "candidate", executable: false },
    { time: "1004", price: 10.07, direction: "正T", score: 5, stage: "candidate", executable: false },
    { time: "1320", price: 9.98, direction: "正T", score: 3, stage: "candidate", executable: false },
    { time: "0948", price: 10.08, direction: "反T", score: 6, stage: "candidate", executable: false },
    { time: "1316", price: 10.06, direction: "反T", score: 3, stage: "candidate", executable: false },
  ];
  const points = buildCausalReferencePoints(source, observations);

  for (const direction of ["正T", "反T"]) {
    const side = points.filter((point) => point.direction === direction);
    assert.equal(side.length, 2);
    assert.ok(side.some((point) => point.time < "1300"));
    assert.ok(side.some((point) => point.time >= "1300"));
  }
});
