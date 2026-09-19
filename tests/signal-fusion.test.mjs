import test from "node:test";
import assert from "node:assert/strict";
import { fuseSignals } from "../lib/signal-fusion.mjs";

test("missing and unscaled evidence cannot create candidates", () => {
  for (const signals of [[], [{direction:"buy",weight:25}], [{direction:"buy",score:null}], [{direction:"buy",score:101}]]) {
    assert.equal(fuseSignals(signals).direction,"wait");
    assert.equal(fuseSignals(signals).score,null);
  }
});
test("sell quality has the same scale as buy quality", () => {
  for (const direction of ["buy","sell"]) {
    const result=fuseSignals([{direction,score:80}]);
    assert.equal(result.score,80);
    assert.equal(result.grade,"确认较强");
    assert.equal(result.support,1);
    assert.equal(result.oppose,0);
  }
});
test("conflicts wait, and repeated evidence does not inflate scores", () => {
  assert.equal(fuseSignals([{direction:"buy",score:90},{direction:"sell",score:70}]).direction,"wait");
  assert.equal(fuseSignals(Array.from({length:20},()=>({direction:"buy",score:75}))).score,75);
  assert.equal(fuseSignals(Array.from({length:20},()=>({direction:"buy",score:75}))).support,1);
  assert.equal(fuseSignals([{direction:"buy",score:90},{direction:"buy",score:60}]).score,60);
});
