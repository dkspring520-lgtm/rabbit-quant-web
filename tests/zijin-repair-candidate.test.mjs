import test from "node:test";
import assert from "node:assert/strict";
import { evaluateZijinRepairCandidate } from "../lib/zijin-repair-candidate.mjs";

function minute(time, price, volume = 100, ratio = null, net = null, bigNet = null) {
  return {
    time,
    price,
    volume,
    averagePrice: 31.40,
    l2: ratio === null ? undefined : {
      status: {connected:true, authorized:true, stale:false},
      flow: {
        activeBuyRatio60s: ratio,
        activeBuyNotional60s: 1_000_000 * ratio,
        activeSellNotional60s: 1_000_000 * (1 - ratio),
        netActiveNotional60s: net,
        bigOrderNetNotional60s: bigNet,
      },
    },
  };
}

function repairSequence({withL2 = true, lowerSecondLow = false} = {}) {
  const prices = [
    ["1015",31.36],["1016",31.31],["1017",31.24],["1018",31.20],
    ["1019",31.24],["1020",31.29],["1021",31.28],["1022",31.25],
    ["1023",31.23],["1024",lowerSecondLow ? 31.14 : 31.19],
    ["1025",31.20],["1026",31.25],["1027",31.30],
  ];
  return prices.map(([time, price], index) => {
    const ratio = withL2 && index >= prices.length - 3 ? 0.58 : withL2 ? 0.43 : null;
    const net = ratio === null ? null : ratio >= 0.52 ? 180_000 : -120_000;
    return minute(time, price, index >= 8 && index <= 9 ? 65 : 100, ratio, net, net);
  });
}

test("promotes a causal second-bottom repair only after momentum, L2 and breakout agree", () => {
  const points = repairSequence();
  const beforeBreakout = evaluateZijinRepairCandidate(points.slice(0, -1));
  const candidate = evaluateZijinRepairCandidate(points);
  assert.notEqual(beforeBreakout.status, "candidate");
  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.title, "修复候选");
  assert.equal(candidate.asOfTime, "1027");
  assert.equal(candidate.checks.l2BuyRecovery, true);
  assert.equal(candidate.executable, false);
});

test("missing L2 is neutral for observation but cannot create a repair candidate", () => {
  const result = evaluateZijinRepairCandidate(repairSequence({withL2:false}));
  assert.equal(result.status, "watch");
  assert.equal(result.checks.l2Available, false);
  assert.match(result.title, /等待L2/);
});

test("a materially lower second low is not treated as a repaired second bottom", () => {
  const result = evaluateZijinRepairCandidate(repairSequence({lowerSecondLow:true}));
  assert.notEqual(result.status, "candidate");
});

test("the repair state remains disabled before 10:15", () => {
  const points = repairSequence().map((point, index) => ({
    ...point,
    time:`10${String(index).padStart(2, "0")}`,
  }));
  const result = evaluateZijinRepairCandidate(points.slice(0, 12));
  assert.equal(result.status, "waiting");
  assert.equal(result.hardConditions.afterStart, false);
});

test("future minutes cannot change a previously evaluated prefix", () => {
  const points = repairSequence();
  const prefix = points.slice(0, -1);
  const first = evaluateZijinRepairCandidate(prefix);
  evaluateZijinRepairCandidate(points);
  const repeated = evaluateZijinRepairCandidate(prefix);
  assert.deepEqual(repeated, first);
});

test("one-minute L2 pulse cannot promote a grinding-bottom repair", () => {
  const points = repairSequence().map((point, index, rows) => {
    if (index < rows.length - 3) return point;
    const ratio = index === rows.length - 1 ? 0.63 : index === rows.length - 2 ? 0.39 : 0.54;
    const net = ratio >= 0.52 ? 220_000 : -180_000;
    return minute(point.time, point.price, point.volume, ratio, net, net);
  });
  const result = evaluateZijinRepairCandidate(points);
  assert.equal(result.status, "watch");
  assert.equal(result.checks.l2BuyRecovery, false);
});

test("a confirmed repair is not repeated after price has already extended", () => {
  const points = repairSequence();
  points.push(
    minute("1028", 31.36, 120, 0.61, 250_000, 180_000),
    minute("1029", 31.45, 130, 0.64, 300_000, 220_000),
  );
  const result = evaluateZijinRepairCandidate(points);
  assert.equal(result.status, "watch");
  assert.equal(result.checks.notExtended, false);
  assert.equal(result.checks.lowZoneWatch, false);
});

test("a repaired pivot stops being a grinding-bottom watch after price leaves the low zone", () => {
  const points = repairSequence();
  points.push(
    minute("1028", 31.37, 120, 0.48, -40_000, -20_000),
    minute("1029", 31.44, 130, 0.47, -60_000, -30_000),
  );
  const result = evaluateZijinRepairCandidate(points);
  assert.equal(result.status, "watch");
  assert.equal(result.checks.lowZoneWatch, false);
});
