import assert from "node:assert/strict";
import test from "node:test";
import { buildResearchObservationPoints, exportResearchRows, replayBaselineSession } from "../lib/rl-research/index.mjs";

function minutes(count = 24) {
  return Array.from({ length: count }, (_, index) => {
    const minute = 30 + index;
    return { time: `09${String(minute).padStart(2, "0")}`, price: 10 + index * 0.01, volume: 1000, amount: 10000 };
  });
}

test("baseline replay adapter uses existing Smart-T without changing production signal code", () => {
  const result = replayBaselineSession({ symbol: "601899", session: { date: "20260930", previousClose: 10, minutes: minutes() }, options: { baseShares: 1000, sellable: 1000 } });
  assert.equal(result.source, "baseline");
  assert.equal(result.modelVersion, "V2.9");
  assert.ok(Array.isArray(result.samples));
  assert.ok(result.performance && typeof result.performance.sampleCount === "number");
});

test("research export contains no live-only execution side effects", () => {
  const rows = exportResearchRows([{ schemaVersion: "1.0.0", symbol: "601899", date: "20260930", time: "0930", source: "experimental", modelVersion: "RL-V0.1", signal: "WAIT", signalScore: null, marketState: "range", factorSnapshot: {}, futureReturns: {}, pnl: null, isWin: null, secret: "drop" }]);
  assert.equal(rows.length, 1);
  assert.equal("secret" in rows[0], false);
  assert.equal(rows[0].source, "experimental");
});

test("research observations stay hidden until sample floor and are never executable", () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({ signal: "BUY", modelVersion: "V2.9", marketState: "range", time: `09${String(30 + index).padStart(2, "0")}`, isWin: index < 12, pnl: index < 12 ? 0.01 : -0.01 }));
  assert.deepEqual(buildResearchObservationPoints(rows, { minimumSamples: 21 }), []);
  const points = buildResearchObservationPoints(rows, { minimumSamples: 20 });
  assert.equal(points.length, 1);
  assert.equal(points[0].executable, false);
  assert.match(points[0].detail, /仅作研究参考/);
});
