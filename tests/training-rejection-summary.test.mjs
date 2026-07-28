import assert from "node:assert/strict";
import test from "node:test";
import { explainTrainingRejection } from "../lib/training-rejection-summary.mjs";

test("未通过摘要用普通话解释净收益、季度稳定性和过拟合", () => {
  const summary = explainTrainingRejection({
    qualifiedHypothesisIds: [],
    hypotheses: [{
      outOfSampleWinRate: 0.46,
      outerQuarters: [{ trades: 30 }],
      evaluation: { metrics: { meanNetPct: -0.05, meanStressNetPct: -0.1, positiveQuarterRatio: 0.5, pbo: 0.68, deflatedSharpeProbability: 0.001 } },
    }],
  });
  assert.match(summary.headline, /扣掉费用/);
  assert.ok(summary.reasons.some(reason => reason.includes("低于 65%")));
  assert.ok(summary.reasons.some(reason => reason.includes("长期期望没有转正")));
  assert.ok(summary.reasons.some(reason => reason.includes("换一段行情")));
});

test("没有实验时不会编造失败指标", () => {
  const summary = explainTrainingRejection(null);
  assert.match(summary.headline, /还没有形成/);
  assert.equal(summary.reasons.length, 1);
});
