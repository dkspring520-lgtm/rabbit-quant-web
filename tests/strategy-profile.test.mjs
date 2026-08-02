import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStrategyProfile, STRATEGY_PROFILE_META, STRATEGY_PROFILES } from "../lib/strategy-profile.mjs";

test("strategy profile accepts every supported V4 gear", () => {
  for (const profile of STRATEGY_PROFILES) assert.equal(normalizeStrategyProfile(profile), profile);
});

test("strategy profile rejects stale or unknown values", () => {
  assert.equal(normalizeStrategyProfile("量化学习"), "平衡档");
  assert.equal(normalizeStrategyProfile(undefined), "平衡档");
});

test("the three V4 gears expose their real engine differences", () => {
  const conservative = STRATEGY_PROFILE_META["稳健档"];
  const balanced = STRATEGY_PROFILE_META["平衡档"];
  const sensitive = STRATEGY_PROFILE_META["灵敏档"];
  assert.deepEqual([conservative.score, balanced.score, sensitive.score], [6, 3, 2]);
  assert.deepEqual([conservative.minHoldMinutes, balanced.minHoldMinutes, sensitive.minHoldMinutes], [5, 4, 3]);
  assert.ok(conservative.candidateNetPct > balanced.candidateNetPct);
  assert.ok(balanced.candidateNetPct > sensitive.candidateNetPct);
  assert.deepEqual([conservative.maxCycles, balanced.maxCycles, sensitive.maxCycles], [1, 2, 1]);
});
