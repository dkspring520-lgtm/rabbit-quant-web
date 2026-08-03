import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/authenticated-app.tsx", import.meta.url), "utf8");
const collector = await readFile(new URL("../scripts/zijin_l2_collector.py", import.meta.url), "utf8");

test("completed L2 minutes do not overwrite minute volume with session cumulative volume", () => {
  assert.match(page, /const flowVolume=Number\(l2\.flow\?\.tradeVolume60s\)/);
  assert.match(page, /const publicVolume=Number\(base\?\.volume\)/);
  assert.match(page, /const derivedBarVolume=Number\(l2\.l2Bar\?\.volume\)/);
  assert.ok(page.indexOf("publicVolume)&&publicVolume>0") < page.indexOf("derivedBarVolume)&&derivedBarVolume>0"));
});

test("collector restart bootstraps cumulative counters instead of emitting a giant fake bar", () => {
  assert.match(collector, /first_observed_minute = bar is None/);
  assert.match(collector, /start_volume = cumulative_volume if first_observed_minute/);
  assert.match(collector, /start_turnover = cumulative_turnover if first_observed_minute/);
});
