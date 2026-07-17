import test from "node:test";
import assert from "node:assert/strict";

import { evaluateZijinOpeningPlaybook } from "../lib/zijin-opening-playbook.mjs";

const points = (rows) => rows.map(([time, price, volume = 100]) => ({ time, price, volume }));

test("09:30 starts scanning but fewer than four points never assigns a direction", () => {
  const result = evaluateZijinOpeningPlaybook(points([
    ["09:30", 29.00, 100],
    ["09:31", 28.92, 110],
    ["09:32", 28.86, 120],
  ]), { previousClose: 29 });

  assert.equal(result.status, "waiting");
  assert.equal(result.direction, null);
  assert.equal(result.asOfTime, "09:32");
  assert.match(result.reasons.join(" "), /09:30 已开始实时扫描/);
});

test("an opening candidate can appear at 09:33 without reading later minutes", () => {
  const result = evaluateZijinOpeningPlaybook(points([
    ["09:30", 29.00, 100],
    ["09:31", 28.70, 100],
    ["09:32", 28.84, 150],
    ["09:33", 29.05, 230],
  ]), { previousClose: 29 });

  assert.equal(result.asOfTime, "09:33");
  assert.equal(result.status, "candidate");
  assert.equal(result.direction, "正T");
});

test("a low-recovery plus VWAP and volume confirmation forms a positive-T candidate", () => {
  const result = evaluateZijinOpeningPlaybook(points([
    ["09:30", 29.00, 100],
    ["09:31", 28.88, 100],
    ["09:32", 28.78, 110],
    ["09:33", 28.82, 120],
    ["09:34", 28.90, 140],
    ["09:35", 28.96, 220],
  ]), { previousClose: 29 });

  assert.equal(result.status, "candidate");
  assert.equal(result.direction, "正T");
  assert.ok(result.score >= 75);
  assert.ok(result.metrics.openingRangePct >= 0.65);
  assert.ok(result.metrics.recoveryFromLowPct >= 0.32);
  assert.ok(result.metrics.distanceToVwapPct > -0.1);
  assert.ok(result.metrics.volumeRatio >= 1.05);
  assert.match(result.reasons.at(-1), /候选观察层.*不生成正式成交/);
});

test("a high-pullback plus VWAP loss and volume confirmation forms a reverse-T candidate", () => {
  const result = evaluateZijinOpeningPlaybook(points([
    ["09:30", 29.00, 100],
    ["09:31", 29.10, 100],
    ["09:32", 29.22, 110],
    ["09:33", 29.18, 120],
    ["09:34", 29.08, 140],
    ["09:35", 29.01, 220],
  ]), { previousClose: 29 });

  assert.equal(result.status, "candidate");
  assert.equal(result.direction, "反T");
  assert.ok(result.score >= 75);
  assert.ok(result.metrics.pullbackFromHighPct >= 0.32);
  assert.ok(result.metrics.distanceToVwapPct < 0.1);
});

test("high range without directional confirmation remains watch with explicit reasons", () => {
  const result = evaluateZijinOpeningPlaybook(points([
    ["09:30", 29.00, 100],
    ["09:31", 28.78, 100],
    ["09:32", 29.04, 110],
    ["09:33", 28.83, 100],
    ["09:34", 29.02, 100],
    ["09:35", 28.91, 100],
  ]), { previousClose: 29 });

  assert.equal(result.status, "watch");
  assert.match(result.reasons.join(" "), /方向连续性不足|量比|方向分歧/);
  assert.match(result.reasons.at(-1), /不生成正式买卖/);
});

test("missing volume cannot be promoted into a fabricated candidate", () => {
  const result = evaluateZijinOpeningPlaybook(points([
    ["09:30", 29.00, 0],
    ["09:31", 28.88, 0],
    ["09:32", 28.78, 0],
    ["09:33", 28.82, 0],
    ["09:34", 28.90, 0],
    ["09:35", 28.96, 0],
  ]), { previousClose: 29 });

  assert.equal(result.status, "watch");
  assert.equal(result.metrics.volumeRatio, null);
  assert.match(result.reasons.join(" "), /不用伪造量比/);
});

test("after 10:30 is blocked so later prices cannot be backfilled as an opening signal", () => {
  const result = evaluateZijinOpeningPlaybook(points([
    ["09:30", 29.00, 100],
    ["09:31", 28.88, 100],
    ["09:32", 28.78, 110],
    ["09:33", 28.82, 120],
    ["09:34", 28.90, 140],
    ["09:35", 28.96, 220],
    ["10:31", 30.50, 9999],
  ]), { previousClose: 29 });

  assert.equal(result.status, "blocked");
  assert.equal(result.direction, null);
  assert.match(result.reasons.join(" "), /禁止把后续走势倒灌/);
});

test("an extreme observed prefix is risk-blocked instead of forced into a direction", () => {
  const result = evaluateZijinOpeningPlaybook(points([
    ["09:30", 29.00, 100],
    ["09:31", 28.70, 100],
    ["09:32", 27.60, 100],
    ["09:33", 28.10, 100],
    ["09:34", 28.60, 100],
    ["09:35", 29.20, 100],
  ]), { previousClose: 29 });

  assert.equal(result.status, "blocked");
  assert.equal(result.direction, null);
  assert.ok(result.metrics.openingRangePct >= 4.5);
  assert.match(result.reasons.join(" "), /异常波动阈值/);
});

test("candidate evaluation exposes only the supplied prefix and ignores malformed/non-session rows", () => {
  const prefix = points([
    ["09:30", 29.00, 100],
    ["09:31", 28.88, 100],
    ["09:32", 28.78, 110],
    ["09:33", 28.82, 120],
    ["09:34", 28.90, 140],
    ["09:35", 28.96, 220],
  ]);
  prefix.push({ time: "08:00", price: 1, volume: 999999 });
  prefix.push({ time: "09:36", price: Number.NaN, volume: 999999 });

  const result = evaluateZijinOpeningPlaybook(prefix, { previousClose: 29 });
  assert.equal(result.status, "candidate");
  assert.equal(result.asOfTime, "09:35");
  assert.equal(result.usedPoints, 6);
  assert.equal(result.metrics.latestPrice, 28.96);
});
