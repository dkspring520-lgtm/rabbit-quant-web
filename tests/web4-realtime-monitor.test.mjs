import assert from "node:assert/strict";
import test from "node:test";
import { evaluateWeb4RealtimeMonitor } from "../lib/web4-realtime-monitor.mjs";

test("technical evidence alone never becomes a confirmed WEB 4.0 state", () => {
  const result = evaluateWeb4RealtimeMonitor({
    symbol:"601899",
    technical:{ candidate:true, ready:true, direction:"正T", confirmed:4 },
    l2:{ available:false },
    linkage:{ available:false },
    market:{ level:"normal", label:"外部环境正常" },
    events:{ level:"normal", label:"事件正常" },
  });
  assert.equal(result.formalEligible, false);
  assert.equal(result.status, "degraded");
  assert.match(result.blockers.join("、"), /L2/);
});

test("technical, fresh L2 and independent context can form a multi-source confirmation", () => {
  const result = evaluateWeb4RealtimeMonitor({
    symbol:"601899",
    technical:{ candidate:true, ready:true, direction:"正T", confirmed:4 },
    l2:{ available:true, stale:false, state:"push", score:82, label:"有效推升" },
    linkage:{ available:true, bias:"buy", weight:8, label:"港股反弹领先" },
    market:{ level:"normal", label:"外部环境正常" },
    events:{ level:"normal", label:"事件正常" },
  });
  assert.equal(result.status, "confirmed");
  assert.equal(result.formalEligible, true);
  assert.ok(result.confidence >= 60);
});

test("fresh conflicting L2 blocks a technical candidate", () => {
  const result = evaluateWeb4RealtimeMonitor({
    symbol:"601899",
    technical:{ candidate:true, ready:true, direction:"正T", confirmed:4 },
    l2:{ available:true, stale:false, state:"outflow", score:76, label:"主动流出" },
    linkage:{ available:true, bias:"buy", weight:8, label:"港股反弹领先" },
    market:{ level:"normal", label:"外部环境正常" },
    events:{ level:"normal", label:"事件正常" },
  });
  assert.equal(result.status, "conflict");
  assert.equal(result.formalEligible, false);
  assert.match(result.summary, /L2/);
});

test("verified external hard risk locks the WEB 4.0 monitor", () => {
  const result = evaluateWeb4RealtimeMonitor({
    technical:{ candidate:true, ready:true, direction:"反T", confirmed:4 },
    l2:{ available:true, stale:false, state:"outflow", score:80, label:"主动流出" },
    linkage:{ available:true, bias:"sell", weight:8, label:"港股回落领先" },
    market:{ level:"normal", label:"外部环境正常" },
    events:{ level:"locked", hardLock:true, label:"重大事件核验" },
  });
  assert.equal(result.status, "risk");
  assert.equal(result.formalEligible, false);
});
