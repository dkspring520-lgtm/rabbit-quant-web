import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  appendIntegrity,
  computeVisibleFeatures,
  createShadowState,
  evaluateShadowCandidate,
  processVisibleMinute,
  SHADOW_CONSTANTS,
  SHADOW_MODELS,
} from "../lib/zijin-shadow-ab.mjs";

const compose = await readFile(new URL("../compose.web.yml", import.meta.url), "utf8");
const observer = await readFile(new URL("../scripts/zijin-shadow-ab-observer.mjs", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/research/zijin-shadow-ab/route.ts", import.meta.url), "utf8");

const minutes = [
  { time: "0930", price: 99.00, volume: 100 },
  { time: "0931", price: 99.03, volume: 100 },
  { time: "0932", price: 99.10, volume: 100 },
  { time: "0933", price: 99.20, volume: 220 },
  { time: "0934", price: 99.25, volume: 180 },
  { time: "0935", price: 100.40, volume: 240 },
];

const peers = Array.from({ length: 6 }, (_, peerIndex) => ({
  code: `peer-${peerIndex}`,
  minutes: minutes.map((point, index) => ({ ...point, price: 50 + peerIndex + index * 0.05 })),
}));

test("A/B features are causal and ignore later minutes", () => {
  const before = computeVisibleFeatures({ minutes, index: 3, previousClose: 100, peers });
  const changedFuture = minutes.map((point, index) => index > 3 ? { ...point, price: point.price * 10 } : point);
  const after = computeVisibleFeatures({ minutes: changedFuture, index: 3, previousClose: 100, peers });
  assert.deepEqual(after, before);
  assert.equal(before.visibleMinuteCount, 4);
  assert.equal(before.time, "0933");
});

test("strict A and coverage B independently produce forward candidates", () => {
  assert.deepEqual(SHADOW_MODELS.A.parameters, { gapAbsPct: 0.6, repairPct: 0.16, confirmationVotesRequired: 1 });
  assert.deepEqual(SHADOW_MODELS.B.parameters, { maximumVwapDistancePct: 0.3, minimumPeerBreadth: 0.5, minimumVolumeRatio: 0.7, confirmationVotesRequired: 2 });
  const features = computeVisibleFeatures({ minutes, index: 3, previousClose: 100, peers });
  assert.equal(evaluateShadowCandidate("A", features).passed, true);
  assert.equal(evaluateShadowCandidate("B", features).passed, true);
});

test("candidate fills only on next visible minute and then resolves after costs", () => {
  const state = createShadowState("2026-07-21T01:32:00.000Z");
  const candidateEvents = processVisibleMinute(state, { marketDate: "20260721", minutes, index: 3, previousClose: 100, peers });
  assert.deepEqual(candidateEvents.map((event) => event.event), ["candidate", "candidate"]);
  assert.equal(state.models.A.today.entries, 0);

  const entryEvents = processVisibleMinute(state, { marketDate: "20260721", minutes, index: 4, previousClose: 100, peers });
  assert.deepEqual(entryEvents.map((event) => event.event), ["entry", "entry"]);
  assert.equal(entryEvents[0].price, 99.25);

  const exitEvents = processVisibleMinute(state, { marketDate: "20260721", minutes, index: 5, previousClose: 100, peers });
  assert.deepEqual(exitEvents.map((event) => event.event), ["exit", "exit"]);
  assert.equal(state.models.A.total.resolvedTrades, 1);
  assert.equal(state.models.A.total.wins, 1);
  assert.ok(state.models.A.total.netPct >= SHADOW_CONSTANTS.MIN_NET_TARGET_PCT);
});

test("audit records form an append-only SHA-256 chain", () => {
  const first = appendIntegrity({ event: "candidate", model: "A" });
  const second = appendIntegrity({ event: "entry", model: "A" }, first.hash);
  assert.equal(first.previousHash, "GENESIS");
  assert.equal(second.previousHash, first.hash);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.notEqual(first.hash, second.hash);
});

test("production shadow observer is isolated, restartable and never sends V4 alerts", () => {
  assert.match(compose, /shadow:/);
  assert.match(compose, /container_name: rabbit-quant-zijin-shadow/);
  assert.match(compose, /restart: unless-stopped/);
  assert.match(compose, /zijin-shadow-ab-events\.jsonl/);
  assert.match(observer, /affectsV4: false/);
  assert.match(observer, /sendsAlerts: false/);
  assert.match(observer, /indices = \[lastIndex\]/);
  assert.match(observer, /ZIJIN_SHADOW_IDLE_POLL_MS/);
  assert.match(route, /Cache-Control.*no-store/);
});
