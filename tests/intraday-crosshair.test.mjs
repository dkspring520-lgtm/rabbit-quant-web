import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source=fs.readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");

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
  assert.match(source,/className="main-force-crosshair"/);
});
