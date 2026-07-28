import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildZijinMainForceTrack } from "../lib/zijin-main-force-track.mjs";

const minutes = [
  {time:"0930",bigBuyNotional:600_000,bigSellNotional:100_000,bigBuyCount:2,bigSellCount:1},
  {time:"0931",bigBuyNotional:450_000,bigSellNotional:50_000,bigBuyCount:2,bigSellCount:0},
  {time:"0932",bigBuyNotional:0,bigSellNotional:700_000,bigBuyCount:0,bigSellCount:3},
  {time:"0933",bigBuyNotional:800_000,bigSellNotional:100_000,bigBuyCount:3,bigSellCount:1},
];

test("Zijin main-force tracker separates large active buys and sells", () => {
  const result = buildZijinMainForceTrack(minutes);
  assert.equal(result.bars[0].netNotional, 500_000);
  assert.ok(result.bars[0].strength > 0);
  assert.equal(result.bars[2].netNotional, -700_000);
  assert.ok(result.bars[2].strength < 0);
  assert.equal(result.totals.netNotional, 900_000);
});

test("each historical main-force bar is causal and cannot be repainted by later rows", () => {
  for (let length = 1; length <= minutes.length; length += 1) {
    const prefix = buildZijinMainForceTrack(minutes.slice(0, length));
    const full = buildZijinMainForceTrack(minutes);
    assert.deepEqual(prefix.bars, full.bars.slice(0, length));
  }
});

test("main-force chart is tracking evidence only and collector persists minute fields", async () => {
  const [page, collector] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../scripts/zijin_l2_collector.py", import.meta.url), "utf8"),
  ]);
  assert.match(page, /主力追踪/);
  assert.match(page, /追踪证据，不单独构成买卖信号/);
  assert.match(collector, /def update_minute_flow\(/);
  assert.match(collector, /"schemaVersion": 4/);
  assert.match(collector, /load_intraday_flow_state/);
  assert.match(collector, /bigOrderNetNotional/);
});
