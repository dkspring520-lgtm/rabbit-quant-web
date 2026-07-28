import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Zijin forward L2 collection rejects non-trading replay packets and records the morning phase", async () => {
  const source = await readFile(new URL("../scripts/zijin_l2_collector.py", import.meta.url), "utf8");
  assert.match(source, /def is_a_share_cash_session\(minute\)/);
  assert.match(source, /observed\.weekday\(\) >= 5/);
  assert.match(source, /"0915" <= clock <= "0925"/);
  assert.match(source, /isinstance\(minute, str\) and is_a_share_cash_session\(minute\)/);
  assert.match(source, /"marketPhase": phase/);
});

test("Zijin opening-emotion protocol keeps research separate from formal V4 execution", async () => {
  const protocol = JSON.parse(await readFile(new URL("../scripts/zijin-opening-emotion-protocol.json", import.meta.url), "utf8"));
  assert.equal(protocol.stock.code, "601899");
  assert.equal(protocol.safety.standaloneResearchLayer, true);
  assert.equal(protocol.safety.changesV4Automatically, false);
  assert.equal(protocol.validation.split.includes("滚动训练"), true);
});
