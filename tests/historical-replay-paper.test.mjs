import assert from "node:assert/strict";
import test from "node:test";
import { HistoricalReplayEngine, createSignalSample, SampleResolver } from "../lib/paper-trading/index.mjs";

const dataset = { date: "2026-09-30", minutes: Array.from({ length: 12 }, (_, i) => ({ time: String(1000 + i).padStart(4, "0"), price: 10 + i * 0.01, volume: 1000 })) };
const signalSource = ({ index }) => index === 0 ? { side: "BUY", quantity: 100, score: 72 } : { side: "WAIT", quantity: 0 };

test("replay processes bars causally and creates traceable samples", () => {
  const replay = new HistoricalReplayEngine({ symbol: "601899", dataset, signalSource, initialCash: 10000, candidateId: "c1", modelVersion: "m1", datasetVersion: "d1" });
  const result = replay.run(); assert.equal(result.signals.length, 12); assert.equal(result.fills[0].status, "FILLED"); assert.equal(result.samples[0].factorSnapshot["price.return_5m"], null); assert.equal(result.samples[0].candidateId, "c1");
});
test("future mutation cannot change prior factor snapshot or signal", () => {
  const first = new HistoricalReplayEngine({ symbol: "601899", dataset, signalSource, initialCash: 10000 }).run();
  const changed = { ...dataset, minutes: dataset.minutes.map((point, i) => i > 5 ? { ...point, price: 99 } : point) };
  const second = new HistoricalReplayEngine({ symbol: "601899", dataset: changed, signalSource, initialCash: 10000 }).run();
  assert.deepEqual(first.signals.slice(0, 6), second.signals.slice(0, 6)); assert.deepEqual(first.samples[0].factorSnapshot, second.samples[0].factorSnapshot);
});
test("resolver only exposes returns once replay reaches the window", () => {
  const replay = new HistoricalReplayEngine({ symbol: "601899", dataset, signalSource, initialCash: 10000 }); replay.run(); const samples = replay.resolveSamples();
  assert.ok(Math.abs(samples[0].future1mReturn - 0.001) < 1e-12); assert.ok(Math.abs(samples[0].future10mReturn - 0.01) < 1e-12); assert.equal(samples[0].lifecycle, "RESOLVED");
});
test("replay preserves T+1 rejection", () => {
  const source = ({ index }) => index === 0 ? { side: "BUY", quantity: 100 } : index === 1 ? { side: "SELL", quantity: 100 } : { side: "WAIT" };
  const replay = new HistoricalReplayEngine({ symbol: "601899", dataset, signalSource: source, initialCash: 10000, initialPosition: 0, initialSellablePosition: 0 }); const result = replay.run(); assert.equal(result.fills.find(fill => fill.side === "SELL").status, "REJECTED");
});
test("sample lifecycle moves CREATED to OBSERVING to RESOLVED", () => {
  const created = createSignalSample({ sampleId: "s1", signalId: "sig1", entryPrice: 10, signal: "BUY", lifecycle: "CREATED" });
  assert.equal(created.lifecycle, "CREATED");
  const observing = new SampleResolver().advance([{ ...created, entryIndex: 0, lifecycle: "OBSERVING" }], dataset.minutes, 3)[0];
  assert.equal(observing.lifecycle, "OBSERVING");
  const resolved = new SampleResolver().advance([observing], dataset.minutes, 10)[0];
  assert.equal(resolved.lifecycle, "RESOLVED"); assert.ok(Math.abs(resolved.future10mReturn - 0.01) < 1e-12);
});
