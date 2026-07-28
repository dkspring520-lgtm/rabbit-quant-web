import assert from "node:assert/strict";
import test from "node:test";
import {
  isAshareContinuousSessionAt,
  isFreshLiveExchangeMinute,
} from "../scripts/zijin-l2-state-observer.mjs";
import { readFileSync } from "node:fs";

test("L2 audit accepts only a fresh Shanghai continuous-auction minute", () => {
  assert.equal(isFreshLiveExchangeMinute("20260728-1030", "2026-07-28T02:32:00.000Z"), true);
  assert.equal(isFreshLiveExchangeMinute("20260728-1025", "2026-07-28T02:32:00.000Z"), false);
  assert.equal(isFreshLiveExchangeMinute("20260727-1030", "2026-07-28T02:32:00.000Z"), false);
  assert.equal(isFreshLiveExchangeMinute("20260728-1200", "2026-07-28T04:00:00.000Z"), false);
});

test("L2 audit does not create a new event from the cached close after market", () => {
  assert.equal(isAshareContinuousSessionAt("2026-07-28T10:30:00.000Z"), false);
  assert.equal(isFreshLiveExchangeMinute("20260728-1459", "2026-07-28T10:30:00.000Z"), false);
});

test("L2 observer and web service share a persistent replay archive", () => {
  const compose=readFileSync(new URL("../compose.web.yml",import.meta.url),"utf8");
  const observer=readFileSync(new URL("../scripts/zijin-l2-state-observer.mjs",import.meta.url),"utf8");
  assert.match(compose,/ZIJIN_L2_REPLAY_ARCHIVE_DIR: \/training-state\/zijin-l2-replay/);
  assert.match(observer,/archiveReplayMinutes\(exchangeMinute, minutes\)/);
});
