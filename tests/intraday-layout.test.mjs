import test from "node:test";
import assert from "node:assert/strict";
import { intradayTooltipLayout, intradayViewportBounds } from "../lib/intraday-layout.mjs";

test("tooltip stays inside plot gutter in desktop and fullscreen widths", () => {
  for (const width of [920, 1280, 1600]) {
    const x = intradayTooltipLayout({ cursorX: width - 1, plotLeft: 62, plotRight: width - 62, width: 176, gutter: 18 });
    assert.ok(x >= 80 && x + 176 <= width - 44);
  }
});

test("tooltip remains bounded in narrow and mobile layouts", () => {
  for (const right of [858, 700, 520]) {
    const x = intradayTooltipLayout({ cursorX: right, plotLeft: 40, plotRight: right, width: 176, gutter: 12 });
    assert.ok(x >= 52 && x + 176 <= right - 12);
  }
});

test("viewport bounds are normalized for every layout", () => {
  assert.deepEqual(intradayViewportBounds({ width: 920, height: 320, plotLeft: 62, plotRight: 858, priceTop: 20, volumeBottom: 300 }), { left: 62, right: 858, top: 20, bottom: 300, width: 796, height: 280 });
});
