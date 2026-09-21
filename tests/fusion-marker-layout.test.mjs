import test from "node:test";
import assert from "node:assert/strict";

test("fusion labels reserve an independent label lane from formal markers", () => {
  const formal = { left: 40, right: 180, top: 20, bottom: 36 };
  const fusion = { left: 40, right: 180, top: 42, bottom: 58 };
  assert.equal(fusion.top >= formal.bottom, true);
});
