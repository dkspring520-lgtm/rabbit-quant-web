import assert from "node:assert/strict";
import test from "node:test";
import { summarizeZijinMainForceIntent } from "../lib/zijin-main-force-intent.mjs";

const bar = (time, price, buy, sell) => ({time, price, bigBuyNotional: buy, bigSellNotional: sell});

test("summarises persistent large net buying with a rising price as strong absorption", () => {
  const result = summarizeZijinMainForceIntent([
    bar("0930", 31.00, 900_000, 150_000),
    bar("0931", 31.04, 800_000, 120_000),
    bar("0932", 31.08, 950_000, 180_000),
    bar("0933", 31.12, 880_000, 140_000),
  ]);
  assert.equal(result.state, "accumulation");
  assert.equal(result.label, "承接偏强");
  assert.ok(result.confidence >= 60);
});

test("keeps a weak price response separate from an automatic buy conclusion", () => {
  const result = summarizeZijinMainForceIntent([
    bar("0930", 31.10, 900_000, 130_000),
    bar("0931", 31.07, 850_000, 120_000),
    bar("0932", 31.03, 920_000, 140_000),
  ]);
  assert.equal(result.state, "absorbed");
  assert.equal(result.label, "下跌承接");
  assert.match(result.message, /止跌确认/);
});

test("returns a neutral conclusion when large orders are balanced", () => {
  const result = summarizeZijinMainForceIntent([
    bar("0930", 31.00, 500_000, 490_000),
    bar("0931", 31.01, 510_000, 520_000),
    bar("0932", 31.00, 480_000, 475_000),
  ]);
  assert.equal(result.state, "waiting");
  assert.equal(result.label, "多空分歧");
});
