import assert from "node:assert/strict";
import test from "node:test";
import { evaluateZijinFundResponse } from "../lib/zijin-fund-response.mjs";

const bar = (time, price, netNotional) => ({
  time,
  price,
  netNotional,
  bigBuyNotional: netNotional > 0 ? netNotional + 100_000 : 100_000,
  bigSellNotional: netNotional < 0 ? Math.abs(netNotional) + 100_000 : 100_000,
});

test("classifies persistent net buying that moves price as effective push", () => {
  const result = evaluateZijinFundResponse([
    bar("1000", 31.00, 500_000),
    bar("1001", 31.03, 600_000),
    bar("1002", 31.07, 550_000),
    bar("1003", 31.10, 700_000),
    bar("1004", 31.14, 650_000),
  ]);
  assert.equal(result.state, "push");
  assert.ok(result.score >= 70);
});

test("warns when large net buying fails to move price", () => {
  const result = evaluateZijinFundResponse([
    bar("1000", 31.10, 900_000),
    bar("1001", 31.10, 800_000),
    bar("1002", 31.09, 950_000),
    bar("1003", 31.08, 850_000),
    bar("1004", 31.07, 900_000),
  ]);
  assert.equal(result.state, "absorbed");
  assert.match(result.message, /暂不追涨/);
});

test("classification is causal and later rows cannot alter an earlier result", () => {
  const prefix = [
    bar("1000", 31.00, 500_000),
    bar("1001", 31.04, 600_000),
    bar("1002", 31.08, 650_000),
  ];
  const before = evaluateZijinFundResponse(prefix);
  evaluateZijinFundResponse([...prefix, bar("1003", 30.80, -2_000_000)]);
  assert.deepEqual(evaluateZijinFundResponse(prefix), before);
});
