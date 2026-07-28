import assert from "node:assert/strict";
import test from "node:test";

import { buildZijinReplayCandidates } from "../lib/zijin-replay-candidates.mjs";

function minutes(prices) {
  return prices.map((price, index) => ({
    time: `09${String(30 + index).padStart(2, "0")}`,
    price,
    volume: 1_000,
  }));
}

test("Zijin replay gives each causal reference a visible non-executable research label", () => {
  const points = buildZijinReplayCandidates(minutes([
    10, 9.98, 9.95, 9.97, 10.01, 10.04, 10.02, 10.08, 10.12, 10.09,
    10.05, 10.02, 10.04, 10.07, 10.03, 10.01, 10.06, 10.08, 10.04, 10.03,
    10.02, 10.05, 10.07, 10.06, 10.04, 10.03, 10.05, 10.08, 10.06, 10.05,
    10.04, 10.03,
  ]));

  assert.ok(points.length >= 2);
  assert.ok(points.some((point) => point.confirmationLabel === "反弹观察"));
  assert.ok(points.some((point) => point.confirmationLabel === "回落观察"));
  assert.ok(points.every((point) => point.executable === false));
  assert.ok(points.every((point) => point.coverageOnly === true));
  assert.ok(points.every((point) => point.stage === "watch"));
  assert.ok(points.every((point) => point.blockers.some((blocker) => blocker.includes("不下单、不计胜率或收益"))));
});

test("a real engine candidate remains unchanged for Zijin replay", () => {
  const source = minutes(Array.from({ length: 32 }, (_, index) => 10 + index * 0.01));
  const candidate = {
    time: "0942", price: 10.12, direction: "反T", score: 4, threshold: 4,
    edge: 0.7, executable: false, stage: "candidate", blockers: [], reason: "engine candidate",
  };
  const points = buildZijinReplayCandidates(source, [candidate]);

  assert.equal(points.find((point) => point.direction === "反T"), candidate);
});

test("research markers keep their causal confirmation times without becoming trade candidates", () => {
  const source = minutes(Array.from({ length: 60 }, (_, index) => 10 + index * 0.01));
  const observations = [
    { time: "0940", price: 10.1, direction: "反T", score: 0, threshold: 0, edge: 0, executable: false, stage: "watch", blockers: [], reason: "sell reference" },
    { time: "0950", price: 10.2, direction: "正T", score: 0, threshold: 0, edge: 0, executable: false, stage: "watch", blockers: [], reason: "buy reference" },
  ];

  const points = buildZijinReplayCandidates(source, observations);
  assert.ok(points.some((point) => point.time === "0940"));
  assert.ok(points.some((point) => point.time === "0950"));
  assert.ok(points.every((point) => point.stage !== "candidate"));
});
