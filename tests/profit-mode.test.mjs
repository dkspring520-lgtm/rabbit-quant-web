import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProfitMode, profitModeSummary, smartTProfitModeOptions } from "../lib/profit-mode.mjs";
import { runSmartTReplay } from "../lib/smart-t-engine.mjs";

test("Zijin small-spread mode exposes an explicit after-cost floor", () => {
  const options = smartTProfitModeOptions("601899", "zijin-small-spread");
  assert.equal(options.minimumGrossSpreadAmount, 0.10);
  assert.equal(options.minimumNetProfitAmount, 30);
  assert.equal(options.profileOverrides.targetNetPct, 0.12);
  assert.equal(options.profileOverrides.maxTargetNetPct, 0.30);
  assert.match(profitModeSummary("601899", "zijin-small-spread").description, /扣费后至少 ¥30/);
});

test("small-spread mode never leaks into another stock", () => {
  assert.deepEqual(smartTProfitModeOptions("601012", "zijin-small-spread"), {});
  assert.equal(profitModeSummary("601012", "zijin-small-spread").id, "standard");
  assert.equal(normalizeProfitMode("unknown"), "standard");
});

test("the absolute profit floor can block an otherwise viable replay entry", () => {
  const rows = [
    ["0930", 10.00, 2000], ["0931", 9.94, 1800], ["0932", 9.88, 2200],
    ["0933", 9.82, 2600], ["0934", 9.78, 3000], ["0935", 9.80, 2500],
    ["0936", 9.84, 2800], ["0937", 9.89, 3200], ["0938", 9.94, 3400],
    ["0939", 9.98, 3000], ["0940", 10.02, 2800],
  ].map(([time, price, volume]) => ({ time, price, volume }));
  const result = runSmartTReplay(rows, {
    capital: 200_000,
    baseShares: 10_000,
    sellable: 10_000,
    feeRate: 0.025,
    slippage: 0.02,
    minCommission: true,
    slippageMode: "percent",
    forceCloseTime: "1450",
    profile: "灵敏档",
    previousClose: 10.00,
    randomValue: 0,
    minimumNetProfitAmount: 50_000,
  });
  assert.equal(result.actions.length, 0);
  assert.ok(result.diagnostics.costBlocked > 0);
});
