import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/authenticated-app.tsx", import.meta.url), "utf8");
const server = await readFile(new URL("../server/control-plane.mjs", import.meta.url), "utf8");
const desktopCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const mobileCss = await readFile(new URL("../app/mobile.css", import.meta.url), "utf8");

test("trading desk merges actual server and local reminder history", () => {
  assert.match(page, /提醒历史记录/);
  assert.match(page, /\/api\/control\/alert-log\?/);
  assert.match(page, /\/api\/control\/alerts\?afterId=0&limit=100/);
  assert.match(page, /rabbit-alert-history:/);
  assert.match(page, /操盘台实时引擎/);
  assert.match(page, /正式信号/);
  assert.match(page, /候选提醒/);
  assert.match(page, /风险提醒/);
  assert.match(page, /尚无提醒记录/);
  assert.match(page, /\/api\/control\/health/);
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

test("client formal actions are persisted and restored across devices", () => {
  assert.match(page, /fetch\('\/api\/control\/alerts',\{/);
  assert.match(page, /uploadClientFormalAction/);
  assert.match(page, /item\.marketDate\?\?item\.payload\?\.marketDate/);
  assert.match(server, /req\.method === "POST" && path === "\/alerts"/);
  assert.match(server, /normalizeClientFormalAlert/);
});

test("Zijin agent waiting state does not suppress a fresh engine candidate", () => {
  assert.match(page, /const selectedAgent=agentCandidateFresh\?agentEvaluation:null/);
  assert.match(page, /const selectedEngineCandidate=engineCandidateFresh\?latestObservation:null/);
  assert.match(page, /\|\| selectedAgent\s*\|\| selectedEngineCandidate/);
  assert.doesNotMatch(page, /agentEvaluation \? agentCandidateFresh : candidateFresh/);
});

test("monitor audit remains readable on desktop and phone", () => {
  assert.match(desktopCss, /\.alert-log-dialog/);
  assert.match(desktopCss, /\.alert-log-row/);
  assert.match(desktopCss, /\.alert-log-health/);
  assert.match(mobileCss, /@media \(max-width:760px\)/);
  assert.match(mobileCss, /\.alert-log-summary\{grid-template-columns:repeat\(3,1fr\)\}/);
});
