import test from "node:test";
import assert from "node:assert/strict";
import {
  formatObservationTime,
  guidanceTimeline,
  normalizeObservationAction,
  observationContext,
  observationMainMessage,
  observationNextStep,
  observationReasons,
  researchContextForState,
} from "../lib/t-observation-panel.mjs";

test("observation panel keeps guidance actions and derives cautious display text", () => {
  const guidance = { actionBias: "WAIT", primaryLabel: "WAIT_CONFIRMATION", state: "TRANSITION", candidateState: "REBOUND", reasons: ["候选变化", "动能减弱", "量能收缩", "多余原因"] };
  assert.equal(normalizeObservationAction(guidance).label, "WAIT_CONFIRMATION");
  assert.equal(observationMainMessage(guidance), "当前结构还不完整，先等确认。");
  assert.equal(observationNextStep(guidance, { state: "TRANSITION" }), "等待结构确认");
  assert.deepEqual(observationReasons(guidance), ["候选变化", "动能减弱", "量能收缩"]);
});

test("context labels are deterministic and unavailable data stays neutral", () => {
  assert.equal(observationContext("2026-10-07T09:30:00").label, "开盘发现");
  assert.equal(observationContext("2026-10-07T13:01:00").label, "午后重开");
  assert.equal(observationContext(null).available, false);
  assert.equal(formatObservationTime("2026-10-07T14:05:00"), "14:05");
});

test("historical research stays separate from live guidance", () => {
  assert.equal(researchContextForState("REBOUND").cautions[0], "样本外稳定性偏弱");
  assert.equal(researchContextForState("LOW_LEVEL_EXHAUSTION").key, "DOWNWARD_EXHAUSTION");
  assert.equal(researchContextForState("UPTREND").key, "NONE");
});

test("guidance timeline is compact and preserves newest events", () => {
  const rows = guidanceTimeline([
    { timestamp: "2026-10-07T09:30:00", actionBias: "WAIT", primaryLabel: "WAIT_CONFIRMATION", reasons: ["预热"] },
    { timestamp: "2026-10-07T09:31:00", actionBias: "WATCH_BUY", reasons: ["低位稳定"] },
  ], 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].timestamp, "2026-10-07T09:31:00");
  assert.equal(rows[0].eventType, "WATCH_BUY");
});
