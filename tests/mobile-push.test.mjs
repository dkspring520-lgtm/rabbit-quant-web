import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server/control-plane.mjs", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../public/notifications-sw.js", import.meta.url), "utf8");
const manifest = fs.readFileSync(new URL("../app/manifest.ts", import.meta.url), "utf8");

test("mobile push uses a service worker and authenticated server subscription", () => {
  assert.match(page, /navigator\.serviceWorker\.register\("\/notifications-sw\.js"/);
  assert.match(page, /pushManager\.subscribe/);
  assert.match(page, /\/api\/control\/push\/subscriptions/);
  assert.match(server, /path === "\/push\/public-key"/);
  assert.match(server, /path === "\/push\/test"/);
  assert.match(server, /Content-Encoding": "aes128gcm"/);
  assert.match(worker, /self\.addEventListener\("push"/);
  assert.match(worker, /showNotification/);
  assert.match(manifest, /display: "standalone"/);
});

test("foreground voice is deliberately concise", () => {
  assert.match(page, /风险提醒/);
  assert.match(page, /买点提醒/);
  assert.match(page, /卖点提醒/);
  assert.match(page, /高位提醒/);
  assert.match(page, /低位提醒/);
  assert.match(page, /new SpeechSynthesisUtterance\(spoken\)/);
});
