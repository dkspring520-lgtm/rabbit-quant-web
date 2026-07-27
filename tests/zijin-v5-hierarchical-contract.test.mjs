import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);

test("V5 hierarchical research is sealed, forward-safe, and cannot alter V4", async () => {
  const protocol = JSON.parse(await readFile(new URL("scripts/zijin-v5-hierarchical-protocol.json", root), "utf8"));
  const runner = await readFile(new URL("scripts/evaluate_zijin_v5_hierarchical.py", root), "utf8");

  assert.equal(protocol.researchDisclosure.affectsSmartTV4, false);
  assert.equal(protocol.researchDisclosure.automaticPromotion, false);
  assert.equal(protocol.researchDisclosure.opens2026, false);
  assert.equal(protocol.researchDisclosure.usesHistoricalL2, false);
  assert.equal(protocol.dataPolicy.maximumLoadedDate, "20251231");
  assert.deepEqual(protocol.dataPolicy.peerTrainingCodes, ["603993", "600362", "000630", "600547", "600489", "601600"]);
  assert.equal(protocol.outputs.promotionGate.requiresForwardL2Evidence, true);
  assert.match(runner, /minute t\+1 open/);
  assert.match(runner, /sealed-date violation/);
  assert.match(runner, /usesHistoricalL2": False/);
});
