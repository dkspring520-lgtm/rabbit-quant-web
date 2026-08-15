import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  appendIntegrity,
  buildDynamicTradePolicy,
  buildLiveL2Snapshot,
  causalExternalConsensus,
  causalExternalSnapshot,
  computeVisibleFeatures,
  createShadowState,
  deriveShadowStatus,
  evaluateShadowCandidate,
  processVisibleMinute,
  SHADOW_CONSTANTS,
  SHADOW_MODELS,
  summarizeZijinDirectionPermissionAB,
  summarizeZijinExternalContext,
  summarizeZijinRangeReverseQuality,
  upgradeShadowState,
} from "../lib/zijin-shadow-ab.mjs";

test("direction permission A/B can only request manual review after the shadow thresholds", () => {
  const records=Array.from({length:25},(_,index)=>({
    event:"direction-permission-outcome",
    direction:"正T",
    blocked:false,
    outcomes:[{minutes:30,complete:true,afterCostPct:index<14?.20:-.12}],
  }));
  const report=summarizeZijinDirectionPermissionAB({ledger:records,stockDays:100});
  assert.equal(report.permitted.positiveTWinRate,.56);
  assert.equal(report.cyclesPer100StockDays,25);
  assert.equal(report.promotion.status,"manual-review");
  assert.equal(report.promotion.automaticPromotion,false);
});

const compose = await readFile(new URL("../compose.web.yml", import.meta.url), "utf8");
const observer = await readFile(new URL("../scripts/zijin-shadow-ab-observer.mjs", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/research/zijin-shadow-ab/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/authenticated-app.tsx", import.meta.url), "utf8");
const round12Protocol = JSON.parse(await readFile(new URL("../scripts/zijin-round12-protocol.json", import.meta.url), "utf8"));
const round13Protocol = JSON.parse(await readFile(new URL("../scripts/zijin-round13-protocol.json", import.meta.url), "utf8"));
const round14Protocol = JSON.parse(await readFile(new URL("../scripts/zijin-round14-protocol.json", import.meta.url), "utf8"));
const round15Protocol = JSON.parse(await readFile(new URL("../scripts/zijin-round15-protocol.json", import.meta.url), "utf8"));
const round16Protocol = JSON.parse(await readFile(new URL("../scripts/zijin-round16-protocol.json", import.meta.url), "utf8"));
const round17Protocol = JSON.parse(await readFile(new URL("../scripts/zijin-round17-protocol.json", import.meta.url), "utf8"));

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

test("positive models shadow trade while reverse models are observation only", () => {
  assert.equal(SHADOW_MODELS.A.executionMode, "shadow-trade");
  assert.equal(SHADOW_MODELS.B.executionMode, "shadow-trade");
  assert.equal(SHADOW_MODELS.C.executionMode, "observe-only");
  assert.equal(SHADOW_MODELS.D.executionMode, "observe-only");
  assert.equal(SHADOW_MODELS.E.executionMode, "shadow-trade");
  assert.equal(SHADOW_MODELS.F.executionMode, "shadow-trade");
  assert.equal(SHADOW_MODELS.G.executionMode, "shadow-trade");
  assert.equal(SHADOW_MODELS.H.executionMode, "observe-only");
  assert.equal(SHADOW_MODELS.H.side, "short");
});

test("legacy A/B state upgrades in place and preserves its evidence", () => {
  const legacy = createShadowState("2026-07-21T01:32:00.000Z");
  delete legacy.models.C;
  delete legacy.models.H;
  delete legacy.rangeReverseQuality;
  legacy.schemaVersion = 1;
  legacy.models.A.total.resolvedTrades = 3;
  legacy.integrity.eventCount = 9;
  const upgraded = upgradeShadowState(legacy);
  assert.equal(upgraded.schemaVersion, 5);
  assert.equal(upgraded.models.A.total.resolvedTrades, 3);
  assert.equal(upgraded.integrity.eventCount, 9);
  assert.equal(upgraded.models.C.id, "round12-reverse-relative-weakness");
  assert.equal(upgraded.models.C.side, "short");
  assert.equal(upgraded.models.D.id, "round13-reverse-high-anchor");
  assert.equal(upgraded.models.D.side, "short");
  assert.equal(upgraded.models.E.id, "round14-positive-vwap-negative-deviation");
  assert.equal(upgraded.models.E.side, "long");
  assert.equal(upgraded.models.F.id, "round15-positive-external-resonance");
  assert.equal(upgraded.models.F.side, "long");
  assert.equal(upgraded.models.G.id, "round16-positive-multi-market-consensus");
  assert.equal(upgraded.models.G.side, "long");
  assert.equal(upgraded.models.H.id, "round17-range-reverse-quality-l2");
  assert.equal(upgraded.models.H.side, "short");
  assert.equal(upgraded.rangeReverseQuality.factorId, "round17-range-reverse-quality-l2");
  assert.equal(upgraded.rangeReverseQuality.promotionGate.minimumResolvedSignals, 50);
  assert.equal(upgraded.rangeReverseQuality.promotionGate.minimumWinRate, 0.55);
  assert.equal(upgraded.prospectiveGate.minimumResolvedTrades, 50);
  assert.equal(upgraded.prospectiveGate.minimumResearchCandidateWinRate, 0.65);
  assert.equal(upgraded.prospectiveGate.minimumWinRate, 0.70);
});

test("round-17 requires an exact-minute healthy L2 sell confirmation for a range reverse", () => {
  const base = {
    time: "1010",
    visibleMinuteCount: 24,
    return3Pct: -0.12,
    previousReturn3Pct: 0.04,
    ma5Slope3Pct: -0.02,
    previousMa5Slope3Pct: 0.03,
    intradayPosition: 0.74,
    vwapBiasPct: 0.32,
    volumeRatio: 1.05,
    peerCoverage: 1,
    peerBreadth3: 0.5,
    l2: {
      available: true,
      qualityBlocked: false,
      sellVotes: 2,
    },
    preopenPermission: { active: true, wouldBlock: false },
  };
  assert.equal(evaluateShadowCandidate("H", base).passed, true);
  assert.equal(evaluateShadowCandidate("H", { ...base, l2: { available: false, qualityBlocked: false, sellVotes: 0 } }).passed, false);
  assert.equal(evaluateShadowCandidate("H", { ...base, preopenPermission: { active: true, wouldBlock: true } }).passed, false);
});

function makeL2Snapshot(side = "buy") {
  const buy = side === "buy";
  return {
    status: { connected: true, authorized: true, stale: false },
    flow: {
      activeBuyRatio60s: buy ? 0.60 : 0.40,
      bigOrderNetNotional60s: buy ? 100 : -100,
      transactionCount60s: 15,
    },
    book: {
      bid1Volume: buy ? 2200 : 900,
      ask1Volume: buy ? 900 : 2200,
      nearTouchImbalance: buy ? 0.10 : -0.10,
      spreadBps: 4,
      micropriceEdgeBps: buy ? 1 : -1,
    },
  };
}

test("V3 L2 snapshot requires three causal samples and keeps missing L2 empty", () => {
  const missing = buildLiveL2Snapshot(null, []);
  assert.equal(missing.ofi, null);
  assert.equal(missing.qualityPass, false);
  const history = [makeL2Snapshot("buy"), makeL2Snapshot("buy")];
  const ready = buildLiveL2Snapshot(makeL2Snapshot("buy"), history);
  assert.equal(ready.qualityPass, true);
  assert.equal(ready.validSamples, 3);
  assert.equal(ready.buyPersistence, 3);
  assert.ok(ready.ofi > 0);
  assert.equal(ready.ofiVelocity, 0);
});

test("V3 dynamic policy uses ATR, fixed floor, cost coverage, and book capacity", () => {
  const l2 = buildLiveL2Snapshot(makeL2Snapshot("buy"), [makeL2Snapshot("buy"), makeL2Snapshot("buy")]);
  const policy = buildDynamicTradePolicy(35, { l2, atrPct14: 0.42 }, "long");
  assert.equal(policy.eligible, true);
  assert.ok(policy.quantity >= 100);
  assert.ok(policy.targetGrossPct >= policy.atrTargetPct);
  assert.ok(policy.targetGrossPct >= policy.fixedMovePct);
  assert.ok(policy.targetGrossPct + 1e-5 >= policy.economic.roundTripCostPct * 2);
  const shallow = buildDynamicTradePolicy(35, { l2: buildLiveL2Snapshot(makeL2Snapshot("buy"), [makeL2Snapshot("buy")]), atrPct14: 0.42 }, "long");
  assert.equal(shallow.eligible, false);
  assert.match(shallow.reason, /连续L2/);
});

test("V3 I/J keep independent L2 direction gates", () => {
  const common = {
    time: "1010",
    return3Pct: 0.12,
    previousReturn3Pct: -0.04,
    ma5Slope3Pct: 0.05,
    previousMa5Slope3Pct: -0.01,
    vwapBiasPct: -0.10,
    intradayPosition: 0.25,
    peerCoverage: 1,
    peerBreadth3: 0.50,
    atrPct14: 0.42,
    atrSamples: 14,
    atrReady: true,
    price: 35,
    externalContext: null,
    marketDate: "20260806",
  };
  const buyL2 = buildLiveL2Snapshot(makeL2Snapshot("buy"), [makeL2Snapshot("buy"), makeL2Snapshot("buy")]);
  const sellL2 = buildLiveL2Snapshot(makeL2Snapshot("sell"), [makeL2Snapshot("sell"), makeL2Snapshot("sell")]);
  assert.equal(evaluateShadowCandidate("I", { ...common, l2: buyL2 }).passed, false);
  assert.ok(evaluateShadowCandidate("I", { ...common, l2: buyL2 }).failures.some((reason) => reason.includes("外部因子")));
  const reverse = {
    ...common,
    return3Pct: -0.12,
    previousReturn3Pct: 0.04,
    ma5Slope3Pct: -0.05,
    previousMa5Slope3Pct: 0.01,
    vwapBiasPct: 0.32,
    intradayPosition: 0.74,
  };
  assert.equal(evaluateShadowCandidate("J", { ...reverse, l2: buyL2 }).passed, false);
  assert.ok(evaluateShadowCandidate("J", { ...reverse, l2: buyL2 }).failures.some((reason) => reason.includes("L2卖方")));
  assert.equal(evaluateShadowCandidate("J", { ...reverse, l2: sellL2 }).passed, false);
  assert.ok(evaluateShadowCandidate("J", { ...reverse, l2: sellL2 }).failures.some((reason) => reason.includes("外部因子")));
});

test("round-17 uses a 30-minute after-cost cohort and never auto-promotes", () => {
  const records = Array.from({ length: 50 }, (_, index) => ({
    event: "range-reverse-quality-outcome",
    outcomes: [{ minutes: 30, complete: true, afterCostPct: index < 28 ? 0.20 : -0.10 }],
  }));
  const report = summarizeZijinRangeReverseQuality({ ledger: records, stockDays: 200 });
  assert.equal(report.quality.resolvedSignals, 50);
  assert.equal(report.quality.winRate, 0.56);
  assert.equal(report.signalsPer100StockDays, 25);
  assert.equal(report.promotion.status, "manual-review");
  assert.equal(report.promotion.automaticPromotion, false);
});

test("round-17 appends a forward 5/15/30-minute audit without creating a shadow trade", () => {
  const timeAt = (index) => {
    const minute = 9 * 60 + 30 + index;
    return `${String(Math.floor(minute / 60)).padStart(2, "0")}${String(minute % 60).padStart(2, "0")}`;
  };
  const prices = Array.from({ length: 50 }, (_, index) => (
    index < 13 ? 100 + index * 0.08 : index === 13 ? 101.2 : index === 14 ? 101.3 : 101.3 - (index - 14) * 0.10
  ));
  const forwardMinutes = prices.map((price, index) => ({ time: timeAt(index), price, volume: 100 }));
  const forwardPeers = Array.from({ length: 6 }, (_, peerIndex) => ({
    code: `range-peer-${peerIndex}`,
    minutes: forwardMinutes.map((point, index) => ({
      ...point,
      price: 50 + peerIndex + (index < 13 ? index * 0.01 : 0.13),
    })),
  }));
  const l2 = {
    status: { connected: true, authorized: true, stale: false },
    flow: { activeBuyRatio60s: 0.40, bigOrderNetNotional60s: -100, transactionCount60s: 15 },
    book: { nearTouchImbalance: -0.10, spreadBps: 4, micropriceEdgeBps: -0.5 },
  };
  const state = createShadowState();
  const events = [];
  for (let index = 15; index < 49; index += 1) {
    events.push(...processVisibleMinute(state, {
      marketDate: "20260806",
      minutes: forwardMinutes,
      index,
      previousClose: 100,
      peers: forwardPeers,
      l2,
    }));
  }
  const outcome = events.find((event) => event.event === "range-reverse-quality-outcome");
  assert.ok(outcome);
  assert.deepEqual(outcome.outcomes.map((item) => item.minutes), [5, 15, 30]);
  assert.equal(state.models.H.today.entries, 0);
  assert.equal(state.models.H.today.activeTrade, null);
  assert.equal(state.rangeReverseQuality.today.resolvedSignals, 1);
});

test("legacy commercial gates cannot weaken the current 70 percent graduation rule", () => {
  const legacy = createShadowState("2026-07-21T01:32:00.000Z");
  legacy.prospectiveGate.minimumResolvedTrades = 30;
  legacy.prospectiveGate.minimumResearchCandidateWinRate = 0.50;
  legacy.prospectiveGate.minimumWinRate = 0.65;
  const upgraded = upgradeShadowState(legacy);
  assert.equal(upgraded.prospectiveGate.minimumResolvedTrades, 50);
  assert.equal(upgraded.prospectiveGate.minimumResearchCandidateWinRate, 0.65);
  assert.equal(upgraded.prospectiveGate.minimumWinRate, 0.70);
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

test("round-14 accepts only a causal early VWAP recovery from a low anchor", () => {
  const base = {
    time: "0937",
    return3Pct: 0.20,
    previousReturn3Pct: -0.20,
    ma5Slope3Pct: -0.02,
    previousMa5Slope3Pct: -0.04,
    intradayPosition: 0.23,
    vwapBiasPct: -0.45,
    volumeRatio: 1.0,
    peerBreadth3: 0.67,
    peerCoverage: 1,
  };
  assert.equal(evaluateShadowCandidate("E", base).passed, true);
  const noTurn = evaluateShadowCandidate("E", { ...base, return3Pct: -0.10 });
  assert.equal(noTurn.passed, false);
  assert.ok(noTurn.failures.some((reason) => reason.includes("转强交叉")));
  const nearVwap = evaluateShadowCandidate("E", { ...base, vwapBiasPct: -0.20 });
  assert.equal(nearVwap.passed, false);
  assert.ok(nearVwap.failures.some((reason) => reason.includes("VWAP")));
});

test("round-14 features and decision ignore all later minutes", () => {
  const prices = [100, 99.5, 98.5, 97.5, 97, 97.5, 97.3, 97, 97.6, 97.7];
  const recoveryMinutes = prices.map((price, index) => ({ time: `09${String(30 + index).padStart(2, "0")}`, price, volume: 100 }));
  const recoveryPeers = Array.from({ length: 6 }, (_, peerIndex) => ({
    code: `recovery-peer-${peerIndex}`,
    minutes: recoveryMinutes.map((point, index) => ({ ...point, price: 50 + peerIndex + index * 0.04 })),
  }));
  const before = computeVisibleFeatures({ minutes: recoveryMinutes, index: 8, previousClose: 100, peers: recoveryPeers });
  const changedFuture = recoveryMinutes.map((point, index) => index > 8 ? { ...point, price: point.price * 20 } : point);
  const after = computeVisibleFeatures({ minutes: changedFuture, index: 8, previousClose: 100, peers: recoveryPeers });
  assert.deepEqual(after, before);
  assert.equal(evaluateShadowCandidate("E", before).passed, true);

  const state = createShadowState("2026-07-21T01:32:00.000Z");
  const candidate = processVisibleMinute(state, { marketDate: "20260722", minutes: recoveryMinutes, index: 8, previousClose: 100, peers: recoveryPeers });
  assert.equal(candidate.find((event) => event.model === "E")?.event, "candidate");
  const entry = processVisibleMinute(state, { marketDate: "20260722", minutes: recoveryMinutes, index: 9, previousClose: 100, peers: recoveryPeers });
  assert.equal(entry.find((event) => event.model === "E")?.event, "entry");
  assert.equal(entry.find((event) => event.model === "E")?.price, 97.7);
});

test("Zijin shadow models cannot bypass the shared trend-direction hard gate", () => {
  const longFeatures = {
    time: "0937",
    buyTrendContinuationRisk: { blocked: true, reason: "下降途中尚未确认止跌" },
  };
  const blockedLong = evaluateShadowCandidate("E", longFeatures);
  assert.equal(blockedLong.passed, false);
  assert.match(blockedLong.failures[0], /方向硬门禁.*下降途中/);

  const shortFeatures = {
    time: "1010",
    sellTrendContinuationRisk: { blocked: true, reason: "上涨途中尚未确认转弱" },
  };
  const blockedShort = evaluateShadowCandidate("D", shortFeatures);
  assert.equal(blockedShort.passed, false);
  assert.match(blockedShort.failures[0], /方向硬门禁.*上涨途中/);
});

test("external factors are recorded as prospective evidence without changing frozen model E", () => {
  const externalContext = summarizeZijinExternalContext({
    fetchedAt: "2026-07-21T01:37:00.000Z",
    items: [
      { id: "hf_GC", label: "纽约黄金", changePercent: 0.8, sourceTimestamp: "2026-07-21T01:36:00.000Z", provider: "sina-public" },
      { id: "hf_CAD", label: "伦铜", changePercent: -0.2, sourceTimestamp: "2026-07-21T01:36:00.000Z", provider: "sina-public" },
      { id: "sh000300", label: "沪深300", changePercent: 0.1, sourceTimestamp: "2026-07-21T01:36:00.000Z", provider: "tencent-public" },
      { id: "hk02899", label: "港股紫金矿业", changePercent: 1.2, sourceTimestamp: "2026-07-21T01:36:00.000Z", provider: "tencent-public" },
    ],
  }, {
    fetchedAt: "2026-07-21T01:37:00.000Z",
    stocks: [{ code: "601899", counts: { positive: 1, negative: 0, neutral: 0 }, gate: { level: "positive", label: "利好", hardLock: false }, items: [] }],
  }, "2026-07-21T01:37:00.000Z");
  const base = {
    time: "0937", return3Pct: 0.20, previousReturn3Pct: -0.20,
    ma5Slope3Pct: -0.02, previousMa5Slope3Pct: -0.04,
    intradayPosition: 0.23, vwapBiasPct: -0.45, volumeRatio: 1,
    peerBreadth3: 0.67, peerCoverage: 1,
  };
  assert.equal(externalContext.coverage.ready, 5);
  assert.equal(externalContext.coverage.total, 10);
  assert.equal(externalContext.coverage.missing.length, 5);
  assert.equal(evaluateShadowCandidate("E", { ...base, externalContext }).passed, true);
  assert.equal(evaluateShadowCandidate("E", { ...base, externalContext: { coverage: { ready: 0, total: 5 } } }).passed, true);
});

test("round-15 only reads external evidence published by the signal minute", () => {
  const externalContext = {
    factors: [
      { key: "gold", available: true, value: 0.8, sourceTimestamp: "2026-07-22T01:36:00.000Z" },
      { key: "copper", available: true, value: -0.2, sourceTimestamp: "2026-07-22T01:36:00.000Z" },
      { key: "market", available: true, value: 0.1, sourceTimestamp: "2026-07-22T01:36:00.000Z" },
      { key: "hkZijin", available: true, value: 1.2, sourceTimestamp: "2026-07-22T01:38:00.000Z" },
    ],
    latestEvents: [
      { publishedAt: "2026-07-22T01:38:00.000Z", sentiment: "negative", severity: "high" },
    ],
  };
  const at0937 = causalExternalSnapshot(externalContext, "20260722", "0937");
  assert.equal(at0937.ready, 3);
  assert.equal(at0937.supportVotes, 3);
  assert.equal(at0937.hardLock, false);
  const at0938 = causalExternalSnapshot(externalContext, "20260722", "0938");
  assert.equal(at0938.ready, 4);
  assert.equal(at0938.supportVotes, 4);
  assert.equal(at0938.hardLock, true);
});

test("round-15 accepts a causal external-resonance positive-T turn and rejects missing or adverse evidence", () => {
  const externalContext = {
    factors: [
      { key: "gold", available: true, value: 0.8, sourceTimestamp: "2026-07-22T01:36:00.000Z" },
      { key: "copper", available: true, value: -0.2, sourceTimestamp: "2026-07-22T01:36:00.000Z" },
      { key: "market", available: true, value: 0.1, sourceTimestamp: "2026-07-22T01:36:00.000Z" },
      { key: "hkZijin", available: true, value: 1.2, sourceTimestamp: "2026-07-22T01:36:00.000Z" },
    ],
    latestEvents: [],
  };
  const base = {
    marketDate: "20260722", time: "0937",
    return3Pct: 0.20, previousReturn3Pct: -0.20,
    ma5Slope3Pct: -0.02, previousMa5Slope3Pct: -0.04,
    intradayPosition: 0.23, vwapBiasPct: -0.45,
    volumeRatio: 1, peerCoverage: 1, externalContext,
  };
  assert.equal(evaluateShadowCandidate("F", base).passed, true);
  const futureOnly = {
    ...externalContext,
    factors: externalContext.factors.map((factor) => ({ ...factor, sourceTimestamp: "2026-07-22T01:38:00.000Z" })),
  };
  const missing = evaluateShadowCandidate("F", { ...base, externalContext: futureOnly });
  assert.equal(missing.passed, false);
  assert.ok(missing.failures.some((reason) => reason.includes("因果覆盖")));
  const adverse = evaluateShadowCandidate("F", {
    ...base,
    externalContext: {
      ...externalContext,
      latestEvents: [{ publishedAt: "2026-07-22T01:36:00.000Z", sentiment: "利空", severity: "重大" }],
    },
  });
  assert.equal(adverse.passed, false);
  assert.ok(adverse.failures.some((reason) => reason.includes("重大利空")));
});

test("round-16 uses newly connected real factors as causal group consensus", () => {
  const factors = [
    ["gold", 0.4], ["copper", -0.2], ["domesticGold", 0.2], ["domesticCopper", -0.1],
    ["market", 0.1], ["hkZijin", 0.8], ["metalsEtf", 0.3], ["goldEtf", 0.2],
    ["usdCny", -0.1],
  ].map(([key, value]) => ({
    key, value, available: true, sourceTimestamp: "2026-07-24T01:36:00.000Z",
  }));
  const externalContext = { factors, latestEvents: [] };
  const consensus = causalExternalConsensus(externalContext, "20260724", "0937");
  assert.equal(consensus.ready, 9);
  assert.equal(consensus.supportGroups, 2);
  const base = {
    marketDate: "20260724", time: "0937",
    return3Pct: 0.12, previousReturn3Pct: -0.05,
    ma5Slope3Pct: -0.01, previousMa5Slope3Pct: -0.02,
    intradayPosition: 0.32, vwapBiasPct: -0.10,
    volumeRatio: 0.8, peerCoverage: 1, externalContext,
  };
  assert.equal(evaluateShadowCandidate("G", base).passed, true);
  const futureFactors = factors.map((factor) => ({ ...factor, sourceTimestamp: "2026-07-24T01:38:00.000Z" }));
  assert.equal(evaluateShadowCandidate("G", { ...base, externalContext: { factors: futureFactors, latestEvents: [] } }).passed, false);
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

test("round-12 reverse candidate remains observation-only and never creates a shadow order", () => {
  const prices = [100, 102, 101.5, 99, 100, 100.2, 100.1, 99.7, 99.6, 98.4];
  const reverseMinutes = prices.map((price, index) => ({ time: `09${String(30 + index).padStart(2, "0")}`, price, volume: 100 }));
  const peerPrices = [50, 52, 51.5, 49, 49.8, 49.7, 49.4, 49, 48.9, 48.8];
  const reversePeers = Array.from({ length: 6 }, (_, peerIndex) => ({
    code: `reverse-peer-${peerIndex}`,
    minutes: peerPrices.map((price, index) => ({ time: reverseMinutes[index].time, price: price + peerIndex * 0.1, volume: 100 })),
  }));
  const state = createShadowState("2026-07-21T01:32:00.000Z");
  const candidate = processVisibleMinute(state, { marketDate: "20260721", minutes: reverseMinutes, index: 7, previousClose: 100, peers: reversePeers });
  const reverseCandidate = candidate.find((event) => event.model === "C");
  assert.equal(reverseCandidate?.event, "candidate");
  assert.equal(reverseCandidate?.executionMode, "observe-only");
  assert.equal(reverseCandidate?.observationOnly, true);
  const entry = processVisibleMinute(state, { marketDate: "20260721", minutes: reverseMinutes, index: 8, previousClose: 100, peers: reversePeers });
  assert.deepEqual(entry.filter((event) => event.model === "C"), []);
  const exit = processVisibleMinute(state, { marketDate: "20260721", minutes: reverseMinutes, index: 9, previousClose: 100, peers: reversePeers });
  assert.equal(exit.find((event) => event.model === "C"), undefined);
  assert.equal(state.models.C.today.activeTrade, null);
  assert.equal(state.models.C.total.resolvedTrades, 0);
  assert.equal(state.models.C.total.candidates, 1);
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
  assert.equal(round13Protocol.prospectiveGate.minimumResolvedTrades, 50);
  assert.equal(round13Protocol.prospectiveGate.minimumResearchCandidateWinRate, 0.65);
  assert.equal(round13Protocol.prospectiveGate.minimumWinRate, 0.70);
});

test("round-14 is preregistered, causal, prospective-only and isolated from V4", () => {
  assert.equal(round14Protocol.researchDisclosure.newEconomicHypothesis, true);
  assert.equal(round14Protocol.researchDisclosure.usesTodayToTuneThresholds, false);
  assert.equal(round14Protocol.researchDisclosure.open2026History, false);
  assert.equal(round14Protocol.researchDisclosure.backfillAfterRegistration, false);
  assert.equal(round14Protocol.researchDisclosure.affectsV4, false);
  assert.equal(round14Protocol.researchDisclosure.sendsAlerts, false);
  assert.equal(round14Protocol.researchDisclosure.automaticPromotion, false);
  assert.equal(round14Protocol.frozenRule.entry, "minute-t decision, minute-t+1 public price shadow buy");
  assert.equal(round14Protocol.prospectiveGate.minimumResolvedTrades, 50);
  assert.equal(round14Protocol.prospectiveGate.minimumResearchCandidateWinRate, 0.65);
  assert.equal(round14Protocol.prospectiveGate.minimumWinRate, 0.70);
});

test("round-15 is preregistered, causal, prospective-only and isolated from V4", () => {
  assert.equal(round15Protocol.researchDisclosure.newEconomicHypothesis, true);
  assert.equal(round15Protocol.researchDisclosure.usesTodayToTuneThresholds, false);
  assert.equal(round15Protocol.researchDisclosure.usesHistoricalExternalFactors, false);
  assert.equal(round15Protocol.researchDisclosure.open2026History, false);
  assert.equal(round15Protocol.researchDisclosure.backfillAfterRegistration, false);
  assert.equal(round15Protocol.researchDisclosure.affectsV4, false);
  assert.equal(round15Protocol.researchDisclosure.sendsAlerts, false);
  assert.equal(round15Protocol.researchDisclosure.automaticPromotion, false);
  assert.equal(round15Protocol.frozenRule.entry, "minute-t decision, minute-t+1 public price shadow buy");
  assert.deepEqual(round15Protocol.frozenRule.exit.minimumNetTargetPct, 0.64);
  assert.deepEqual(round15Protocol.frozenRule.exit.maximumNetTargetPct, 1.0);
  assert.equal(round15Protocol.prospectiveGate.minimumResolvedTrades, 50);
  assert.equal(round15Protocol.prospectiveGate.minimumResearchCandidateWinRate, 0.65);
  assert.equal(round15Protocol.prospectiveGate.minimumWinRate, 0.70);
});

test("round-16 freezes old rounds and trains only on newly observed real-factor samples", () => {
  assert.equal(round16Protocol.status, "prospective-shadow-only");
  assert.equal(round16Protocol.researchDisclosure.usesTodayToTuneThresholds, false);
  assert.equal(round16Protocol.researchDisclosure.usesHistoricalExternalFactors, false);
  assert.equal(round16Protocol.researchDisclosure.backfillAfterRegistration, false);
  assert.equal(round16Protocol.researchDisclosure.affectsV4, false);
  assert.deepEqual(round16Protocol.prospectiveSamplePolicy.oldRoundsRemainFrozen, [11, 15]);
  assert.equal(round16Protocol.prospectiveSamplePolicy.appendOnlyLedger, true);
  assert.equal(round16Protocol.prospectiveGate.minimumResolvedTrades, 50);
  assert.equal(round16Protocol.prospectiveGate.minimumWinRate, 0.70);
});

test("round-17 is preregistered for forward-only L2 quality observation", () => {
  assert.equal(round17Protocol.status, "prospective-shadow-only");
  assert.equal(round17Protocol.researchDisclosure.usesHistoricalL2, false);
  assert.equal(round17Protocol.researchDisclosure.backfillAfterRegistration, false);
  assert.equal(round17Protocol.researchDisclosure.affectsV4, false);
  assert.equal(round17Protocol.researchDisclosure.sendsAlerts, false);
  assert.equal(round17Protocol.researchDisclosure.automaticPromotion, false);
  assert.equal(round17Protocol.frozenRule.entry, "observation only; no shadow execution and no user-facing signal");
  assert.equal(round17Protocol.promotionGate.minimumResolvedSignals, 50);
  assert.equal(round17Protocol.promotionGate.minimumWinRate, 0.55);
  assert.equal(round17Protocol.promotionGate.minimumSignalsPer100StockDays, 25);
});

test("single-stock research shows model G with plain 65 and 70 percent gates", () => {
  assert.match(page, /\["A","B","C","D","E","F","G","H","I","J"\]/);
  assert.match(page, /第10–18轮 · 紫金 V3 影子观察/);
  assert.match(page, /动态 ATR、盘口容量和连续 3–5 分钟 L2\/OFI 共振/);
  assert.match(page, /反T仅为研究证据/);
  assert.match(page, /65% 保留研究 · 70% 申请评审/);
  assert.match(page, /积累新样本/);
  assert.match(page, /只累计登记后的新样本，不回填历史、不影响 V4/);
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
  assert.match(observer, /\/api\/market-context/);
  assert.match(observer, /\/api\/event-radar/);
  assert.match(observer, /externalCoverage/);
  assert.match(observer, /l2ExchangeMinute\(l2\) === point\?\.time/);
  assert.match(observer, /saveMinuteArchive/);
  assert.match(observer, /minutes\/601899/);
  assert.match(compose, /ZIJIN_SHADOW_MINUTES_DIR/);
  assert.match(route, /Cache-Control.*no-store/);
});
