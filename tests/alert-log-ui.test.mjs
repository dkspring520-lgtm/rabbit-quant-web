import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const desktopCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const mobileCss = await readFile(new URL("../app/mobile.css", import.meta.url), "utf8");

test("trading desk exposes the real server monitor audit instead of a fabricated history", () => {
  assert.match(page, /提醒追踪日志/);
  assert.match(page, /\/api\/control\/alert-log\?/);
  assert.match(page, /正式信号/);
  assert.match(page, /候选提醒/);
  assert.match(page, /未触发/);
  assert.match(page, /行情异常/);
  assert.match(page, /这不是“0 条记录”/);
  assert.match(page, /\/api\/control\/health/);
  assert.match(page, /\/api\/control\/alerts\?afterId=0&limit=100/);
  assert.match(page, /后台监控状态/);
  assert.match(page, /心跳超时/);
  assert.match(page, /等待浏览器领取/);
  assert.match(page, /通知已送达/);
  assert.match(page, /发送失败/);
});

test("browser delivery result is written back to the server alert record", () => {
  assert.match(page, /\/api\/control\/alerts\/\$\{item\.id\}\/delivery/);
  assert.match(page, /status:deliveryChannels\.length\?'notified':'displayed'/);
  assert.match(page, /channel:deliveryChannels\.length\?deliveryChannels\.join\('\+'\):'in-app'/);
});

test("monitor audit remains readable on desktop and phone", () => {
  assert.match(desktopCss, /\.alert-log-dialog/);
  assert.match(desktopCss, /\.alert-log-row/);
  assert.match(desktopCss, /\.alert-log-health/);
  assert.match(mobileCss, /@media \(max-width:760px\)/);
  assert.match(mobileCss, /\.alert-log-summary\{grid-template-columns:repeat\(3,1fr\)\}/);
});
