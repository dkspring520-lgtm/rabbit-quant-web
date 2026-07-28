import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("../scripts/zijin-auto-trainer.py", import.meta.url), "utf8");

test("Zijin auto trainer is change-driven, locked and never promotes automatically", () => {
  assert.match(script, /dataSha256/);
  assert.match(script, /protocolSha256/);
  assert.match(script, /researchInputSha256/);
  assert.match(script, /externalFactorSha256/);
  assert.match(script, /if completed_prior and not eligible_change/);
  assert.match(script, /强制重跑请求同样被研究硬门禁拒绝/);
  assert.match(script, /os\.O_CREAT \| os\.O_EXCL/);
  assert.match(script, /recorded_owner != lock_owner_id\(\)/);
  assert.match(script, /not process_exists\(recorded_pid\)/);
  assert.match(script, /recorded_owner is None/);
  assert.match(script, /heartbeatAt/);
  assert.match(script, /refresh_idle_heartbeat\(args\.state\)/);
  assert.match(script, /append_history/);
  assert.match(script, /previousRecordHash/);
  assert.match(script, /automaticPromotion": False/);
  assert.match(script, /sealed2026": True/);
});

test("Zijin hard gate separates hypotheses from threshold tuning", () => {
  assert.match(script, /def research_input_manifest/);
  assert.match(script, /def external_input_manifest/);
  assert.match(script, /"features": sorted/);
  assert.match(script, /"externalFactors"/);
  assert.match(script, /"threshold", "minimum", "maximum", "target", "grid", "weight"/);
  assert.match(script, /仅参数或阈值发生变化，不属于新假设/);
  assert.match(script, /--external-input/);
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

test("an idle Zijin scheduler does not pretend that the training rabbit is running", () => {
  assert.match(script, /finished = stage in \{"completed", "waiting"\}/);
  assert.match(script, /"completed" if finished or stage == "rolling-oos" else "running"/);
  assert.match(script, /if finished:\s+completed_hypotheses = total_hypotheses/);
});
