import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = readFileSync(new URL("../app/terminal-market-rail.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } });
const componentModule = { exports: {} };
new Function("require", "module", "exports", compiled.outputText)(createRequire(import.meta.url), componentModule, componentModule.exports);
const render = l2 => renderToStaticMarkup(React.createElement(componentModule.exports.TerminalMarketRail, { code: "601899", name: "紫金矿业", price: 34.11, l2 }));

test("missing L2 keeps all twenty levels empty rather than deriving quotes from last price", () => {
  const html = render(null);
  assert.equal((html.match(/class="terminal-depth-row /g) || []).length, 20);
  assert.equal((html.match(/<b>—<\/b>/g) || []).length, 21);
  assert.ok(html.includes("等待真实十档快照"));
  assert.ok(html.includes("L2 待连接"));
});

test("partial depth preserves actual prices, volume units and missing levels", () => {
  const html = render({ status: { connected: true, stale: false }, book: { bidPrices: [34.10], askPrices: [34.12], bidVolumes: [12300], askVolumes: [4500] } });
  assert.ok(html.includes("<b>34.10</b>"));
  assert.ok(html.includes("<b>34.12</b>"));
  assert.ok(html.includes("12,300"));
  assert.ok(html.includes("1 / 10 档"));
  assert.equal((html.match(/<b>—<\/b>/g) || []).length, 19);
});

test("stale depth remains explicitly marked as delayed, not connected live quotes", () => {
  const html = render({ status: { connected: true, stale: true }, book: { bidPrices: [34.10] } });
  assert.ok(html.includes("L2 延迟"));
  assert.ok(html.includes("不作为当前可成交报价"));
  assert.ok(!html.includes("L2 已连接"));
});
