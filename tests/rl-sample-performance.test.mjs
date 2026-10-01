import assert from "node:assert/strict";
import test from "node:test";
import { buildSignalSamples, evaluateSignalSamples } from "../lib/rl-research/index.mjs";

const minutes = [10, 10.1, 10.2, 9.8, 10.4, 10.5].map((price, index) => ({ time: `09${String(30 + index).padStart(2, "0")}`, price }));

test("signal samples calculate only available future horizons after replay", () => {
  const samples = buildSignalSamples({ symbol: "601899", date: "20260930", minutes, signals: [
    { index: 0, signal: "BUY", score: 83, factors: { vwapBias: -0.02 } },
    { index: 5, signal: "SELL", score: 65 },
  ], horizons: [1, 3, 5] });
  assert.equal(samples.length, 2);
  assert.ok(Math.abs(samples[0].futureReturns["1m"] - 0.01) < 1e-12);
  assert.equal(samples[0].isWin, true);
  assert.equal(samples[1].futureReturns["1m"], null);
  assert.equal(samples[1].isWin, null);
  assert.deepEqual(samples[0].factorSnapshot, { vwapBias: -0.02 });
});

test("performance engine reports score bands and model separation", () => {
  const samples = [
    { signal: "BUY", signalScore: 83, source: "baseline", modelVersion: "V2.9", marketState: "range", pnl: 0.01 },
    { signal: "BUY", signalScore: 65, source: "experimental", modelVersion: "RL-V0.1", marketState: "range", pnl: -0.005 },
    { signal: "SELL", signalScore: 72, source: "baseline", modelVersion: "V2.9", marketState: "trend", pnl: 0.002 },
  ];
  const report = evaluateSignalSamples(samples);
  assert.equal(report.overall.samples, 3);
  assert.equal(report.byScoreBand["80+"].wins, 1);
  assert.ok(report.byModel["experimental:RL-V0.1"]);
  assert.equal(report.byMarketState.trend.samples, 1);
});
