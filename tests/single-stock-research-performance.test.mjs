import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("collapsed single-stock research does not run historical replay", () => {
  assert.match(page, /const researchSessions=useMemo/);
  assert.match(page, /const autoSamples=useMemo<AutoResearchSample\[\]>\(\(\)=>researchExpanded\?researchSessions/);
  assert.match(page, /const samples=autoSampleDayCount\+notes\.length\+manualCount/);
});

test("collapsed single-stock research defers secondary Zijin analysis", () => {
  assert.match(page, /if\(!researchExpanded\|\|stock\.code!=="601899"\)return null/);
  assert.match(page, /researchExpanded&&stock\.code==="601899"\?analyzeZijinFactorResearch/);
});

test("Zijin shadow polling only starts after research details are expanded", () => {
  const effectStart = page.indexOf('fetch(`/api/research/zijin-shadow-ab');
  assert.notEqual(effectStart, -1);
  const effectPrefix = page.slice(Math.max(0, effectStart - 1_200), effectStart);
  assert.match(effectPrefix, /if\(!researchExpanded\)return/);
  assert.match(page.slice(effectStart, effectStart + 1_000), /\[stock\.code,researchExpanded\]/);
});
