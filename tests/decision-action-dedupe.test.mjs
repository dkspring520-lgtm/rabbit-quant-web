import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source=fs.readFileSync(new URL("../app/authenticated-app.tsx",import.meta.url),"utf8");

test("formal execution text is driven by the engine action side",()=>{
  assert.match(source,/const decisionActionSide:/);
  assert.match(source,/formalExecutionLabel\(decisionActionDirection,decisionActionSide\)/);
  assert.doesNotMatch(source,/signalMode === '反T' \? `反T信号 · 卖出/);
});

test("an opened cycle rejects another action on the same side",()=>{
  assert.match(source,/decisionActionSide===openedCycleSide/);
  assert.match(source,/同方向信号已冻结/);
  assert.match(source,/expectedClosingSide/);
});

test("formal alerts are deduplicated by event and throttled by side",()=>{
  assert.match(source,/queuedAlertEventKeys\.current\.has\(alert\.eventKey\)/);
  assert.match(source,/lastFormalAlertAtBySide\.current/);
  assert.match(source,/10\*60_000/);
});
