import test from "node:test";
import assert from "node:assert/strict";
import { aShareSession } from "../lib/a-share-session.mjs";

const cn = (time) => new Date(`2026-07-16T${time}:00+08:00`);

test("09:25 changes from live auction observation to a non-executable auction result", () => {
  assert.equal(aShareSession(cn("09:24")).phase, "auction");
  const result = aShareSession(cn("09:25"));
  assert.equal(result.phase, "auction-result");
  assert.equal(result.live, false);
  assert.match(result.detail, /09:25.*初判.*09:30/);
});

test("continuous-auction monitoring starts at 09:30", () => {
  assert.equal(aShareSession(cn("09:29")).phase, "auction-result");
  const open = aShareSession(cn("09:30"));
  assert.equal(open.phase, "morning");
  assert.equal(open.live, true);
});
