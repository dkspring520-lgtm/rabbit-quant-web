import assert from "node:assert/strict";
import test from "node:test";
import { buildHumanTGuidance, buildHumanTGuidanceSeries, buildTGuidanceReminders } from "../lib/t-guidance/index.mjs";

const feature = ({ position = .5, decay = 0, velocity = 0, volumeTrend = "STABLE" } = {}) => ({
  valid: true, validity: "VALID",
  trend: { trendDirection: velocity > 0 ? "UP" : velocity < 0 ? "DOWN" : "FLAT" },
  position: { rangePosition: position },
  momentum: { momentumDecay: decay, shortMomentum: velocity },
  volume: { volumeTrend },
  volatility: { volatilityExpansion: false },
});
const state = (extra = {}) => ({ state: "LOW_LEVEL_EXHAUSTION", candidateState: "REBOUND", validity: "STATE_VALID", transition: "HYSTERESIS_HOLD", ...extra });

test("positive T guidance is an observation, not a trading action", () => {
  const result = buildHumanTGuidance({ symbol: "TEST", timestamp: "10:00", feature: feature({ position: .2, decay: .1, velocity: .01, volumeTrend: "CONTRACTING" }), state: state(), opportunity: { type: "POSITIVE_T_ENVIRONMENT", score: 65, valid: true } });
  assert.equal(result.primaryLabel, "POSITIVE_T_WATCH");
  assert.equal(result.actionBias, "WATCH_BUY");
  assert.equal(result.executionAllowed, false);
  assert.equal(result.voiceAllowed, false);
  assert.match(result.warnings.join("；"), /反弹迹象|保持阶段/);
  assert.equal(Object.keys(result).some(key => /BUY|SELL|AUTO|probability|expectedReturn/i.test(key)), false);
});

test("counter T guidance uses final state explanation without overwriting candidate/final state", () => {
  const result = buildHumanTGuidance({ symbol: "TEST", timestamp: "10:00", feature: feature({ position: .85, decay: .2, velocity: .01, volumeTrend: "EXPANDING" }), state: state({ state: "HIGH_LEVEL_EXHAUSTION", candidateState: "UPTREND" }), opportunity: { type: "COUNTER_T_ENVIRONMENT", score: 78, valid: true } });
  assert.equal(result.primaryLabel, "COUNTER_T_WATCH");
  assert.equal(result.actionBias, "WATCH_SELL");
  assert.equal(result.state, "HIGH_LEVEL_EXHAUSTION");
  assert.equal(result.candidateState, "UPTREND");
  assert.match(result.confirmation, /回落|失守/);
});

test("neutral, warmup and invalid guidance stay conservative", () => {
  const neutral = buildHumanTGuidance({ feature: feature(), state: state({ state: "NO_T_ENVIRONMENT", candidateState: "NO_T_ENVIRONMENT", transition: "HOLD" }), opportunity: { type: "NEUTRAL", score: 0, valid: true } });
  assert.equal(neutral.primaryLabel, "NO_CLEAR_T_OPPORTUNITY");
  const warmup = buildHumanTGuidance({ feature: { valid: false, validity: "WARMUP" }, state: { validity: "STATE_WARMUP" }, opportunity: { type: "INVALID", valid: false } });
  assert.equal(warmup.primaryLabel, "WAIT_CONFIRMATION");
  assert.equal(warmup.chartMarker, null);
  const invalid = buildHumanTGuidance({ feature: { valid: false, validity: "INVALID" }, state: { validity: "STATE_INVALID" }, opportunity: { type: "INVALID", valid: false } });
  assert.equal(invalid.primaryLabel, "INVALID");
});

test("guidance series and reminders are causal observation markers", () => {
  const features = [feature({ position: .2, velocity: .01 }), feature({ position: .2, decay: .1, velocity: .01 })];
  const states = [state({ state: "LOW_LEVEL_EXHAUSTION" }), state({ state: "LOW_LEVEL_EXHAUSTION", candidateState: "REBOUND" })];
  const opportunities = [{ type: "POSITIVE_T_ENVIRONMENT", score: 50, valid: true }, { type: "POSITIVE_T_ENVIRONMENT", score: 60, valid: true }];
  const history = buildHumanTGuidanceSeries({ timestamps: ["09:30", "09:31"], features, states, opportunities, symbol: "TEST" });
  const reminders = buildTGuidanceReminders(history, { max: 12 });
  assert.equal(history.length, 2);
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].executionAllowed, false);
  assert.equal(reminders[0].researchOnly, true);
});
