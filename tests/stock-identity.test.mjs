import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveStockIdentities, resolveStockIdentity } from "../lib/stock-identity.mjs";

const universe = [
  { code: "603629", name: "利通电子" },
  { code: "601899", name: "紫金矿业" },
];

test("stock identity repairs an invalid code from an exact security name", () => {
  const result = resolveStockIdentity(universe, { code: "606362", name: "利通电子" });
  assert.equal(result.status, "corrected");
  assert.equal(result.code, "603629");
  assert.equal(result.name, "利通电子");
});

test("stock identity canonicalizes a name when the code is valid", () => {
  const result = resolveStockIdentity(universe, { code: "601899", name: "紫 金 矿 业" });
  assert.equal(result.status, "valid");
  assert.equal(result.name, "紫金矿业");
});

test("batch identity keeps unknown records explicit instead of treating them as zero quotes", () => {
  const [result] = resolveStockIdentities(universe, [{ code: "606362", name: "未知股票" }]);
  assert.equal(result.status, "unknown");
  assert.match(result.reason, /未在A股证券库/);
});

test("saved watchlists are reconciled before invalid identities remain on the desk", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/stock-identity/route.ts", import.meta.url), "utf8");
  assert.match(page, /fetch\('\/api\/stock-identity'/);
  assert.match(page, /correctedCodes/);
  assert.match(route, /a-share-universe\.json/);
});
