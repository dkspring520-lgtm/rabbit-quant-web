import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStrategyProfile, STRATEGY_PROFILES } from "../lib/strategy-profile.mjs";

test("strategy profile accepts every supported V4 gear", () => {
  for (const profile of STRATEGY_PROFILES) assert.equal(normalizeStrategyProfile(profile), profile);
});

test("strategy profile rejects stale or unknown values", () => {
  assert.equal(normalizeStrategyProfile("量化学习"), "平衡档");
  assert.equal(normalizeStrategyProfile(undefined), "平衡档");
});
