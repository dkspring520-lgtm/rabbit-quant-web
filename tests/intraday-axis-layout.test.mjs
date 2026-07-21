import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("intraday prices, ticks and the latest-price flag share the SVG coordinate system", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /const liveChartPriceY =/);
  assert.match(source, /pointAt=.*liveChartPriceY\(point\.price,min,max\)/);
  assert.match(source, /lastY:liveChartPriceY\(minutePoints\.at\(-1\)!\.price,min,max\)/);
  assert.match(source, /className="intraday-axis-label"/);
  assert.match(source, /className="intraday-price-flag"/);
  assert.doesNotMatch(source, /<div className="y-axis">/);
  assert.doesNotMatch(source, /<div className="price-flag">/);
});
