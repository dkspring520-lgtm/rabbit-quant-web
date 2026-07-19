import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("../scripts/zijin-auto-trainer.py", import.meta.url), "utf8");

test("Zijin auto trainer is change-driven, locked and never promotes automatically", () => {
  assert.match(script, /dataSha256/);
  assert.match(script, /protocolSha256/);
  assert.match(script, /if unchanged and not args\.force/);
  assert.match(script, /os\.O_CREAT \| os\.O_EXCL/);
  assert.match(script, /heartbeatAt/);
  assert.match(script, /append_history/);
  assert.match(script, /previousRecordHash/);
  assert.match(script, /automaticPromotion": False/);
  assert.match(script, /sealed2026": True/);
});

test("Zijin auto trainer publishes distinct real tasks for all four rabbits", () => {
  assert.match(script, /"training": \{/);
  assert.match(script, /"challenger": \{/);
  assert.match(script, /"risk": \{/);
  assert.match(script, /"official": \{/);
  assert.match(script, /滚动样本外验证/);
  assert.match(script, /PBO、DSR/);
  assert.match(script, /影子观察/);
});
