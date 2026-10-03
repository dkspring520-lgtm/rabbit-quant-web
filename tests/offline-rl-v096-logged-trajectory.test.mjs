import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

const cwd = process.cwd();
const dir = ".data-inspect/offline-rl-v0.9.6";
const input = `${dir}/fixture-market.jsonl`;
const signals = `${dir}/fixture-signals.jsonl`;
const scenarios = `${dir}/fixture-scenarios.json`;
const artifact = `${dir}/test-trajectory.jsonl.gz`;

function runGenerator() { execFileSync(process.execPath, ["scripts/run-offline-rl-v0.9.6-log-trajectory.mjs", `--input=${input}`, `--signals=${signals}`, `--scenarios=${scenarios}`, `--output=${artifact}`], { cwd, stdio: "pipe" }); }

test("V0.9.6 logged trajectory round-trip has schema and no counterfactual records", () => {
  runGenerator();
  const manifest = JSON.parse(readFileSync(`${artifact}.manifest.json`, "utf8"));
  const text = gunzipSync(readFileSync(artifact)).toString("utf8");
  const lines = text.trim().split("\n");
  const records = lines.map(line => JSON.parse(line));
  const hash = createHash("sha256").update(text).digest("hex");
  assert.equal(records.length, manifest.recordCount);
  assert.equal(hash, manifest.trajectoryHash);
  assert.ok(records.every(row => row.observedExpertBehavior === true));
  assert.ok(records.every(row => !Object.hasOwn(row, "counterfactuals")));
  assert.ok(records.every(row => row.state && Object.hasOwn(row, "reward") && Object.hasOwn(row, "nextState") && typeof row.done === "boolean"));
  assert.deepEqual(records.map(row => row.expertAction), ["BUY_SMALL", "WAIT", "SELL_PART", "SELL_ALL"]);
});

test("V0.9.6 logged trajectory serialization is deterministic", () => {
  runGenerator();
  const first = JSON.parse(readFileSync(`${artifact}.manifest.json`, "utf8"));
  runGenerator();
  const second = JSON.parse(readFileSync(`${artifact}.manifest.json`, "utf8"));
  assert.equal(first.trajectoryHash, second.trajectoryHash);
  assert.equal(first.recordCount, second.recordCount);
});
