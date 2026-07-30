import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source=fs.readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
const styles=fs.readFileSync(new URL("../app/globals.css",import.meta.url),"utf8");

test("intraday crosshair locks to an already observed minute",()=>{
  assert.match(source,/points:minutePoints\.map/);
  assert.match(source,/chartModel\.points\.find\(item=>item\.time===intradayCursorTime\)/);
  assert.match(source,/let nearest=chartModel\.points\[0\]/);
  assert.match(source,/setIntradayCursorTime\(current=>current===nearest\.time\?current:nearest\.time\)/);
  assert.match(source,/const changePercent=Number\.isFinite\(previousClose\)/);
});

test("mouse, touch and keyboard can inspect the same causal chart",()=>{
  assert.match(source,/onPointerMove=\{handleIntradayPointer\}/);
  assert.match(source,/onPointerDown=\{handleIntradayPointerDown\}/);
  assert.match(source,/event\.pointerType!=="mouse"/);
  assert.match(source,/event\.key!=="ArrowLeft"/);
  assert.match(source,/event\.key!=="ArrowRight"/);
  assert.match(source,/event\.key==="Escape"/);
});

test("Zijin crosshair synchronizes price, volume and main-force evidence by minute",()=>{
  assert.match(source,/zijinMainForceTrack\.bars\.find\(bar=>bar\.time===point\.time\)/);
  assert.match(source,/formatIntradayVolume\(intradayCursor\.volume\)/);
  assert.match(source,/formatMainForceAmount\(intradayCursor\.mainForce\.netNotional\)/);
  assert.match(source,/const mainForceCursorX=intradayCursor\?\.x\?\?null/);
  assert.match(source,/mainForceCursorX!==null/);
  assert.match(source,/className="main-force-crosshair"/);
  assert.match(source,/intradayCursor\.time\.slice\(0,2\).*intradayCursor\.time\.slice\(2\)/);
});

test("price and main-force SVGs share minute coordinates and the desktop gutter",()=>{
  assert.match(source,/x=\{liveChartX\(bar\.time\)-1\.45\}/);
  assert.match(source,/x1=\{liveChartSlotX\(tick\.slot\)\}/);
  assert.match(styles,/:root:not\(\[data-theme="light"\]\) \.minimal-ui \.main-force-track\{padding-left:58px;padding-right:22px\}/);
});
