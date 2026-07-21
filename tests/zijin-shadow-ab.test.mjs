import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  appendIntegrity,
  computeVisibleFeatures,
  createShadowState,
  deriveShadowStatus,
  evaluateShadowCandidate,
  processVisibleMinute,
  SHADOW_CONSTANTS,
  SHADOW_MODELS,
  upgradeShadowState,
} from "../lib/zijin-shadow-ab.mjs";

const compose = await readFile(new URL("../compose.web.yml", import.meta.url), "utf8");
const observer = await readFile(new URL("../scripts/zijin-shadow-ab-observer.mjs", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/research/zijin-shadow-ab/route.ts", import.meta.url), "utf8");
const round12Protocol = JSON.parse(await readFile(new URL("../scripts/zijin-round12-protocol.json", import.meta.url), "utf8"));
const round13Protocol = JSON.parse(await readFile(new URL("../scripts/zijin-round13-protocol.json", import.meta.url), "utf8"));

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

test("round-12 features are causal and match the frozen live fields", () => {
  const prices = [100, 102, 101.5, 99, 100, 100.2, 100.1, 99.7, 99.6, 98.4];
  const reverseMinutes = prices.map((price, index) => ({ time: `09${String(30 + index).padStart(2, "0")}`, price, volume: 100 }));
  const peerPrices = [50, 52, 51.5, 49, 49.8, 49.7, 49.4, 49, 48.9, 48.8];
  const reversePeers = Array.from({ length: 6 }, (_, peerIndex) => ({
    code: `reverse-peer-${peerIndex}`,
    minutes: peerPrices.map((price, index) => ({ time: reverseMinutes[index].time, price: price + peerIndex * 0.1, volume: 100 })),
  }));
  const before = computeVisibleFeatures({ minutes: reverseMinutes, index: 7, previousClose: 100, peers: reversePeers });
  const changedFuture = reverseMinutes.map((point, index) => index > 7 ? { ...point, price: point.price * 20 } : point);
  const after = computeVisibleFeatures({ minutes: changedFuture, index: 7, previousClose: 100, peers: reversePeers });
  assert.deepEqual(after, before);
  assert.ok(before.intradayPosition <= 0.4412);
  assert.ok(before.zijinAlphaVwapPct >= 0.3034);
  assert.ok(before.return5Pct <= -0.1104);
  assert.equal(evaluateShadowCandidate("C", before).passed, true);
});

test("shadow status follows the Shanghai session instead of the last cached minute", () => {
  assert.equal(deriveShadowStatus("20260720", new Date("2026-07-20T21:40:00.000Z")), "waiting");
  assert.equal(deriveShadowStatus("20260721", new Date("2026-07-21T01:20:00.000Z")), "waiting");
  assert.equal(deriveShadowStatus("20260721", new Date("2026-07-21T01:40:00.000Z")), "observing");
  assert.equal(deriveShadowStatus("20260721", new Date("2026-07-21T07:00:00.000Z")), "closed");
  assert.equal(deriveShadowStatus("20260720", new Date("2026-07-21T02:00:00.000Z")), "degraded");
});

test("strict A and coverage B independently produce forward candidates", () => {
  assert.deepEqual(SHADOW_MODELS.A.parameters, { gapAbsPct: 0.6, repairPct: 0.16, confirmationVotesRequired: 1 });
  assert.deepEqual(SHADOW_MODELS.B.parameters, { maximumVwapDistancePct: 0.3, minimumPeerBreadth: 0.5, minimumVolumeRatio: 0.7, confirmationVotesRequired: 2 });
  const features = computeVisibleFeatures({ minutes, index: 3, previousClose: 100, peers });
  assert.equal(evaluateShadowCandidate("A", features).passed, true);
  assert.equal(evaluateShadowCandidate("B", features).passed, true);
});

test("legacy A/B state upgrades in place and preserves its evidence", () => {
  const legacy = createShadowState("2026-07-21T01:32:00.000Z");
  delete legacy.models.C;
  legacy.schemaVersion = 1;
  legacy.models.A.total.resolvedTrades = 3;
  legacy.integrity.eventCount = 9;
  const upgraded = upgradeShadowState(legacy);
  assert.equal(upgraded.schemaVersion, 2);
  assert.equal(upgraded.models.A.total.resolvedTrades, 3);
  assert.equal(upgraded.integrity.eventCount, 9);
  assert.equal(upgraded.models.C.id, "round12-reverse-relative-weakness");
  assert.equal(upgraded.models.C.side, "short");
  assert.equal(upgraded.models.D.id, "round13-reverse-high-anchor");
  assert.equal(upgraded.models.D.side, "short");
  assert.equal(upgraded.prospectiveGate.minimumResolvedTrades, 30);
  assert.equal(upgraded.prospectiveGate.minimumWinRate, 0.65);
});

test("round-13 rejects low-position reverse sells and accepts a causal high anchor", () => {
  const base = {
    time: "1010",
    return3Pct: -0.12,
    previousReturn3Pct: 0.08,
    ma5Slope3Pct: 0.03,
    previousMa5Slope3Pct: 0.04,
    intradayPosition: 0.82,
    vwapBiasPct: 0.42,
    zijinAlphaVwapPct: 0.24,
    volumeRatio: 1.1,
    peerCoverage: 1,
  };
  assert.equal(evaluateShadowCandidate("D", base).passed, true);
  const lowPosition = { ...base, intradayPosition: 0.35 };
  const rejected = evaluateShadowCandidate("D", lowPosition);
  assert.equal(rejected.passed, false);
  assert.ok(rejected.failures.some((reason) => reason.includes("高位区")));
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

test("round-12 reverse candidate sells next minute and profits only after price falls", () => {
  const prices = [100, 102, 101.5, 99, 100, 100.2, 100.1, 99.7, 99.6, 98.4];
  const reverseMinutes = prices.map((price, index) => ({ time: `09${String(30 + index).padStart(2, "0")}`, price, volume: 100 }));
  const peerPrices = [50, 52, 51.5, 49, 49.8, 49.7, 49.4, 49, 48.9, 48.8];
  const reversePeers = Array.from({ length: 6 }, (_, peerIndex) => ({
    code: `reverse-peer-${peerIndex}`,
    minutes: peerPrices.map((price, index) => ({ time: reverseMinutes[index].time, price: price + peerIndex * 0.1, volume: 100 })),
  }));
  const state = createShadowState("2026-07-21T01:32:00.000Z");
  const candidate = processVisibleMinute(state, { marketDate: "20260721", minutes: reverseMinutes, index: 7, previousClose: 100, peers: reversePeers });
  assert.equal(candidate.filter((event) => event.model === "C")[0]?.event, "candidate");
  const entry = processVisibleMinute(state, { marketDate: "20260721", minutes: reverseMinutes, index: 8, previousClose: 100, peers: reversePeers });
  assert.deepEqual(entry.filter((event) => event.model === "C").map((event) => [event.event, event.side, event.price]), [["entry", "short", 99.6]]);
  const exit = processVisibleMinute(state, { marketDate: "20260721", minutes: reverseMinutes, index: 9, previousClose: 100, peers: reversePeers });
  const reverseExit = exit.find((event) => event.model === "C");
  assert.equal(reverseExit?.event, "exit");
  assert.equal(reverseExit?.side, "short");
  assert.ok(reverseExit?.netPct >= SHADOW_CONSTANTS.MIN_NET_TARGET_PCT);
  assert.equal(state.models.C.total.wins, 1);
});

test("round-12 protocol forbids historical proof, V4 mutation and automatic promotion", () => {
  assert.equal(round12Protocol.researchDisclosure.historicalSelectionAffected, true);
  assert.equal(round12Protocol.researchDisclosure.open2026History, false);
  assert.equal(round12Protocol.researchDisclosure.affectsV4, false);
  assert.equal(round12Protocol.researchDisclosure.automaticPromotion, false);
  assert.equal(round12Protocol.prospectiveGate.minimumWinRate, 0.65);
  assert.equal(round12Protocol.prospectiveGate.minimumResolvedTrades, 30);
});

test("round-13 is preregistered, prospective-only and isolated from V4", () => {
  assert.equal(round13Protocol.researchDisclosure.newEconomicHypothesis, true);
  assert.equal(round13Protocol.researchDisclosure.usesTodayToTuneThresholds, false);
  assert.equal(round13Protocol.researchDisclosure.backfillAfterRegistration, false);
  assert.equal(round13Protocol.researchDisclosure.affectsV4, false);
  assert.equal(round13Protocol.researchDisclosure.sendsAlerts, false);
  assert.equal(round13Protocol.researchDisclosure.automaticPromotion, false);
  assert.equal(round13Protocol.prospectiveGate.minimumResolvedTrades, 30);
  assert.equal(round13Protocol.prospectiveGate.minimumWinRate, 0.65);
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
