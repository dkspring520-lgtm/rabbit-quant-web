import test from "node:test";
import assert from "node:assert/strict";
import { detectCausalMarketRegime } from "../lib/market-regime-detector.mjs";

test("detectCausalMarketRegime classifies BULL_TREND when price is steadily above rising VWAP", () => {
  const points = [];
  const vwaps = [];
  let price = 100.0;
  for (let i = 0; i < 40; i++) {
    price += 0.05;
    points.push({ time: `09${30 + i}`, price, volume: 1000 });
    vwaps.push(price - 0.04);
  }

  const result = detectCausalMarketRegime(points, 39, vwaps, 100.0);
  assert.equal(result.regime, "BULL_TREND");
  assert.equal(result.regimeMultiplier.allowReverseT, false);
  assert.equal(result.regimeMultiplier.targetNetPctMultiplier, 1.25);
});

test("detectCausalMarketRegime classifies BEAR_TREND when price is steadily below falling VWAP", () => {
  const points = [];
  const vwaps = [];
  let price = 100.0;
  for (let i = 0; i < 40; i++) {
    price -= 0.05;
    points.push({ time: `09${30 + i}`, price, volume: 1000 });
    vwaps.push(price + 0.04);
  }

  const result = detectCausalMarketRegime(points, 39, vwaps, 100.0);
  assert.equal(result.regime, "BEAR_TREND");
  assert.equal(result.regimeMultiplier.allowPositiveT, false);
  assert.equal(result.regimeMultiplier.targetNetPctMultiplier, 1.25);
});

test("detectCausalMarketRegime classifies WIDE_RANGE with frequent VWAP crossings and wide amplitude", () => {
  const points = [];
  const vwaps = [];
  let price = 100.0;
  for (let i = 0; i < 40; i++) {
    // Oscillate with high amplitude (+/- 1.5)
    price = 100.0 + Math.sin(i / 2) * 1.5;
    points.push({ time: `09${30 + i}`, price, volume: 1000 });
    vwaps.push(100.0);
  }

  const result = detectCausalMarketRegime(points, 39, vwaps, 100.0);
  assert.equal(result.regime, "WIDE_RANGE");
  assert.ok(result.vwapCrossings >= 3);
  assert.equal(result.regimeMultiplier.hardStopPctMultiplier, 1.15);
});

test("detectCausalMarketRegime classifies NARROW_RANGE when amplitude is tight", () => {
  const points = [];
  const vwaps = [];
  for (let i = 0; i < 40; i++) {
    const price = 100.0 + (i % 2 === 0 ? 0.02 : -0.02);
    points.push({ time: `09${30 + i}`, price, volume: 500 });
    vwaps.push(100.0);
  }

  const result = detectCausalMarketRegime(points, 39, vwaps, 100.0);
  assert.equal(result.regime, "NARROW_RANGE");
  assert.equal(result.regimeMultiplier.targetNetPctMultiplier, 0.85);
});

test("detectCausalMarketRegime obeys strict causal invariant: future points do not alter current regime", () => {
  const prefix = [];
  const prefixVwaps = [];
  let price = 100.0;
  for (let i = 0; i < 35; i++) {
    price += 0.04;
    prefix.push({ time: `09${30 + i}`, price, volume: 1000 });
    prefixVwaps.push(price - 0.03);
  }

  const prefixResult = detectCausalMarketRegime(prefix, 34, prefixVwaps, 100.0);

  // Append 30 wildly different future bars (e.g. sharp crash)
  const full = [...prefix];
  const fullVwaps = [...prefixVwaps];
  for (let i = 35; i < 65; i++) {
    price -= 0.30;
    full.push({ time: `10${i - 35}`, price, volume: 5000 });
    fullVwaps.push(100.0);
  }

  const causalResult = detectCausalMarketRegime(full, 34, fullVwaps, 100.0);

  assert.deepEqual(prefixResult, causalResult, "Future bars must not change the decision at minute 34");
});
