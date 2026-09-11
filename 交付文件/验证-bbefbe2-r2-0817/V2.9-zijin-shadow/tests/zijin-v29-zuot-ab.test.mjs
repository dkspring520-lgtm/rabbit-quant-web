import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateV29OpeningShadow,
  evaluateV29ZuoTConfirmation,
  selectLastCompletedFactorRow,
} from "../scripts/backtest-zijin-v29-zuot-ab.mjs";

function factorRow(time = "0934", overrides = {}) {
  return {
    date: "20260814",
    time,
    factors: {
      "vwap.bias": -0.001,
      "volume.ratio_5_20": 1,
      "volume.price_alignment_5m": 0.1,
      "technical.macd_histogram": 0.0001,
      "technical.macd_histogram_delta": 0.0001,
      "orderflow.active_buy_imbalance": 0.2,
      "orderflow.ofi_change_3m": 0.1,
      "price.return_5m": 0.001,
      ...overrides,
    },
  };
}

test("the current incomplete minute is never visible to an opening decision", () => {
  const selected = selectLastCompletedFactorRow([factorRow("0930")], 34205);
  assert.equal(selected, null);
});

test("only a fully completed prior minute can confirm a later decision", () => {
  const selected = selectLastCompletedFactorRow([
    factorRow("0930"),
    factorRow("0931"),
  ], 34265);
  assert.equal(selected.time, "0930");
  assert.ok(selected.minuteEndSecond < 34265);
});

test("missing completed history rejects both strict variants", () => {
  const result = evaluateV29ZuoTConfirmation({ direction: "positiveT", factorRow: null });
  assert.equal(result.directionContinuationPass, false);
  assert.equal(result.compactScorePass, false);
  assert.deepEqual(result.rejectionReasons, ["no-completed-minute-before-decision"]);
});

test("the compact layer requires OFI instead of filling it with zero", () => {
  const result = evaluateV29ZuoTConfirmation({
    direction: "positiveT",
    factorRow: factorRow("0935", {
      "orderflow.active_buy_imbalance": null,
      "orderflow.ofi_change_3m": null,
    }),
  });
  assert.equal(result.directionContinuationPass, true);
  assert.equal(result.compactScorePass, false);
  assert.ok(result.rejectionReasons.includes("missing-ofi"));
});

test("opposing five-minute continuation vetoes the matching direction", () => {
  const result = evaluateV29ZuoTConfirmation({
    direction: "positiveT",
    factorRow: factorRow("1000", {
      "price.return_5m": -0.003,
      "volume.ratio_5_20": 1.3,
      "technical.macd_histogram_delta": -0.0001,
      "orderflow.active_buy_imbalance": -0.2,
    }),
  });
  assert.equal(result.continuationVeto, true);
  assert.equal(result.directionContinuationPass, false);
  assert.equal(result.compactScorePass, false);
});

test("a compact positive-T confirmation needs three core votes including OFI", () => {
  const result = evaluateV29ZuoTConfirmation({
    direction: "positiveT",
    factorRow: factorRow("1000"),
  });
  assert.equal(result.directionContinuationPass, true);
  assert.equal(result.compactVotes, 4);
  assert.equal(result.compactScorePass, true);
});

function openingEvidence(overrides = {}) {
  return Array.from({ length: 6 }, (_, index) => ({
    second: 34200 + index,
    activeBuyRatio: index ? 0.35 : 0.4,
    micropriceEdgeBps: 2,
    priceResponseBps: 5,
    ...overrides[index],
  }));
}

test("opening shadow rejects a causal positive-T buy-flow collapse", () => {
  const evidence = openingEvidence({
    0: { activeBuyRatio: 0.4 },
    5: { activeBuyRatio: 0.2, micropriceEdgeBps: 2.5 },
  });
  const result = evaluateV29OpeningShadow({
    direction: "positiveT",
    evidence,
    decisionSecond: 34205,
  });
  assert.equal(result.flowCollapseVeto, true);
  assert.equal(result.retainVariantA, false);
  assert.equal(result.retainVariantB, false);
});

test("three causal opening evidence points are sufficient for an early decision", () => {
  const evidence = openingEvidence({
    0: { activeBuyRatio: 0.4 },
    2: { activeBuyRatio: 0.2, micropriceEdgeBps: 2.5 },
  }).slice(0, 3);
  const result = evaluateV29OpeningShadow({
    direction: "positiveT",
    evidence,
    decisionSecond: 34202,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.flowCollapseVeto, true);
  assert.equal(result.causalEvidenceEndSecond, 34202);
});

test("strong microprice response keeps a positive-T signal despite falling active buys", () => {
  const evidence = openingEvidence({
    0: { activeBuyRatio: 0.9 },
    5: { activeBuyRatio: 0.1, micropriceEdgeBps: 7, priceResponseBps: 30 },
  });
  const result = evaluateV29OpeningShadow({
    direction: "positiveT",
    evidence,
    decisionSecond: 34205,
  });
  assert.equal(result.flowCollapseVeto, false);
  assert.equal(result.priceFlowDivergenceVeto, false);
  assert.equal(result.retainVariantB, true);
});

test("opening shadow rejects positive price/flow divergence", () => {
  const evidence = openingEvidence({
    0: { activeBuyRatio: 0.25 },
    5: { activeBuyRatio: 0.2, micropriceEdgeBps: 0.8, priceResponseBps: 16 },
  });
  const result = evaluateV29OpeningShadow({
    direction: "positiveT",
    evidence,
    decisionSecond: 34205,
  });
  assert.equal(result.flowCollapseVeto, false);
  assert.equal(result.priceFlowDivergenceVeto, true);
  assert.equal(result.retainVariantA, true);
  assert.equal(result.retainVariantB, false);
});

test("opening shadow leaves reverse-T unchanged", () => {
  const evidence = openingEvidence({
    0: { activeBuyRatio: 0.9 },
    5: { activeBuyRatio: 0.1, micropriceEdgeBps: -5, priceResponseBps: 20 },
  });
  const result = evaluateV29OpeningShadow({
    direction: "reverseT",
    evidence,
    decisionSecond: 34205,
  });
  assert.equal(result.flowCollapseVeto, false);
  assert.equal(result.priceFlowDivergenceVeto, false);
  assert.equal(result.retainVariantB, true);
});

test("evidence after the opening decision cannot affect the shadow result", () => {
  const evidence = [
    ...openingEvidence(),
    { second: 34206, activeBuyRatio: 0, micropriceEdgeBps: -10, priceResponseBps: 30 },
  ];
  const result = evaluateV29OpeningShadow({
    direction: "positiveT",
    evidence,
    decisionSecond: 34205,
  });
  assert.equal(result.retainVariantB, true);
  assert.equal(result.causalEvidenceEndSecond, 34205);
  assert.equal(result.ignoredFutureEvidencePoints, 1);
});

test("missing opening evidence is observed but never used as an automatic veto", () => {
  const result = evaluateV29OpeningShadow({
    direction: "positiveT",
    evidence: [],
    decisionSecond: 34205,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.retainVariantA, true);
  assert.equal(result.retainVariantB, true);
});
