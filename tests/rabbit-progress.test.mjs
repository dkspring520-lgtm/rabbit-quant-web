import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("reusable rabbit progress meter is wired to training and replay", () => {
  assert.match(page, /function RabbitProgressMeter/);
  assert.match(page, /role="progressbar"/);
  assert.match(page, /rabbit-logo-compact\.png/);
  assert.match(page, /紫金矿业 · 四兔真实训练/);
  assert.match(page, /当前股票证据覆盖/);
  assert.match(page, /全 A 股随机批次测试/);
  assert.match(page, /单股完整交易日回测/);
});

test("generic rabbit evidence meter does not pretend to run a browser-side trainer", () => {
  assert.doesNotMatch(page, /setTrainingProgress/);
  assert.doesNotMatch(page, /setTrainingRunning/);
  assert.doesNotMatch(page, /盘后自动/);
  assert.match(page, /这不是服务器训练进度/);
});

test("rabbit meter has responsive and reduced-motion styles", () => {
  assert.match(css, /\.rabbit-progress\{/);
  assert.match(css, /\.rabbit-progress-orbit/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});
