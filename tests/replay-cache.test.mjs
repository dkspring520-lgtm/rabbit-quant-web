import test from "node:test";
import assert from "node:assert/strict";
import { buildReplayCache, compareReplayRows } from "../lib/rl-research/trainer/replay-cache.mjs";
test("replay cache is deterministic and causal",()=>{const bars=[{close:10},{close:11},{close:12}],c=buildReplayCache({bars,states:[{timestamp:"t"}],predictions:["WAIT"]});assert.ok(Math.abs(c.futureReturnIndex[0]["1m"]-.1)<1e-12);assert.equal(c.futureReturnIndex[0]["3m"],null);assert.equal(c.featureSnapshot.length,1);});
test("replay equivalence compares required fields",()=>{assert.equal(compareReplayRows([{timestamp:"t",action:"WAIT"}],[{timestamp:"t",action:"WAIT"}]).mismatchCount,0);});
