import test from "node:test";
import assert from "node:assert/strict";
import { evaluateZijinStructure } from "../lib/zijin-structure-engine.mjs";

const historicalBars = Array.from({length:40}, (_, index) => {
  const day = String(index + 1).padStart(2, "0");
  const close = 29 + index * .08;
  return {
    date:`202606${day}`,
    open:close - .05,
    high:close + .12,
    low:close - .13,
    close,
    volume:1_000_000 + index * 10_000,
  };
});

const minutes = Array.from({length:46}, (_, index) => {
  const total = 30 + index;
  const hour = 9 + Math.floor(total / 60);
  const minute = total % 60;
  const wave = Math.sin(index / 3) * .12;
  const price = 31 + index * .012 + wave;
  return {
    time:`${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`,
    price,
    high:price + .03,
    low:price - .03,
    volume:2_000 + (index % 9) * 350,
    amount:price * (2_000 + (index % 9) * 350),
  };
});

test("multi-timeframe structure remains research-only and causal", () => {
  const prefix=minutes.slice(0,31);
  const first=evaluateZijinStructure({minutes:prefix,historicalBars});
  const repeated=evaluateZijinStructure({minutes:[...prefix],historicalBars:[...historicalBars]});
  assert.deepEqual(first,repeated);
  assert.equal(first.asOfTime,prefix.at(-1).time);
  assert.equal(first.executable,false);
  assert.equal(first.affectsV4,false);
  assert.equal(first.coverage,100);
  assert.ok(["上升趋势","低位/弱势转强","趋势不明","高位/弱势转弱","下降趋势"].includes(first.direction));
});

test("Chan fractals are only exposed after their confirmation minute", () => {
  const result=evaluateZijinStructure({minutes,historicalBars});
  const asOf=Number(result.asOfTime);
  for(const fractal of result.chan.fractals){
    assert.ok(Number(fractal.confirmedAt)<=asOf);
  }
  assert.equal(result.chan.method,"因果量化缠论");
  assert.ok(result.volumeProfile.ready);
  assert.ok(result.volumeProfile.valueAreaLow<=result.volumeProfile.valueAreaHigh);
  assert.ok(result.peakVolume.volume>0);
});
