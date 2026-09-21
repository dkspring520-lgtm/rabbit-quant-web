import test from "node:test";
import assert from "node:assert/strict";
import { buildShadowResearchLayer } from "../lib/shadow-research-layer.mjs";

const now = new Date("2026-09-21T02:00:00.000Z");

test("shadow research normalizes evidence without changing formal inputs", () => {
  const result = buildShadowResearchLayer({
    code: "601899",
    phase: "intraday",
    now,
    events: { items: [{ id: "e1", title: "业绩预增", reason: "命中积极词", sentiment: "positive", publishedAt: "2026-09-21T01:55:00.000Z", source: "公开资讯" }] },
    context: { items: [{ id: "m1", label: "伦铜", changePercent: -1.2, sourceTimestamp: "2026-09-21T01:58:00.000Z", provider: "sina-public" }] },
  });
  assert.equal(result.policy.researchOnly, true);
  assert.equal(result.formalSignalInputChanged, false);
  assert.equal(result.formalRiskGateChanged, false);
  assert.equal(result.counts.total, 2);
  assert.equal(result.evidence[0].strategyImpact, "shadow-only");
});

test("stale and future evidence is excluded, and duplicate headlines collapse", () => {
  const result = buildShadowResearchLayer({
    code: "601899",
    phase: "intraday",
    now,
    events: { items: [
      { id: "old", title: "旧消息", publishedAt: "2026-09-20T00:00:00.000Z" },
      { id: "future", title: "未来消息", publishedAt: "2026-09-21T02:10:00.000Z" },
      { id: "one", title: "同一公告", publishedAt: "2026-09-21T01:55:00.000Z" },
      { id: "two", title: "同一公告", publishedAt: "2026-09-21T01:54:00.000Z" },
    ] },
  });
  assert.deepEqual(result.evidence.map((item) => item.title), ["同一公告"]);
});

test("Zijin causal shadow modules remain a sidecar when minute data is present", () => {
  const minutes = Array.from({ length: 18 }, (_, index) => ({
    time: `09${String(30 + index).padStart(2, "0")}`,
    price: 20 + index * 0.01,
    close: 20 + index * 0.01,
    high: 20 + index * 0.012,
    low: 20 + index * 0.008,
    volume: 1_000 + index * 10,
  }));
  const result = buildShadowResearchLayer({ code: "601899", phase: "intraday", now, minutes });
  assert.equal(result.policy.canExecute, false);
  assert.equal(result.formalSignalInputChanged, false);
  assert.equal(result.formalRiskGateChanged, false);
  assert.ok(Array.isArray(result.evidence));
});
