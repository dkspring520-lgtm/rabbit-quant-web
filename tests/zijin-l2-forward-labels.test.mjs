import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/zijin_l2_forward_labels.py", import.meta.url));

function record(clock, price, phase = "open-discovery") {
  return { schemaVersion: 2, symbol: "601899", observedAt: `2026-07-27T${clock.slice(0, 2)}:${clock.slice(2)}:00Z`, exchangeMinute: `20260727-${clock}`, marketPhase: phase, lastPrice: price, target: null };
}

test("L2 forward labels are delayed, same-day and preserve feature records", () => {
  const directory = mkdtempSync(join(tmpdir(), "zijin-l2-labels-"));
  const input = join(directory, "forward.jsonl");
  const labels = join(directory, "labels.jsonl");
  const state = join(directory, "state.json");
  const rows = [record("0925", 31.0, "auction-locked")];
  for (let index = 0; index <= 5; index += 1) rows.push(record(`093${index}`, 31 + index * 0.1));
  writeFileSync(input, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  execFileSync("python", [script, "--input", input, "--labels", labels, "--state", state, "--minimum-labels", "1", "--minimum-days", "1", "--minimum-opening-labels", "1"], { encoding: "utf8" });
  const written = readFileSync(labels, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const auction = written.find((item) => item.marketPhase === "auction-locked");
  assert.equal(auction.anchor.mode, "opening-price");
  assert.equal(auction.anchor.exchangeMinute, "20260727-0930");
  assert.equal(auction.outcomes["5"].observedMinutes, 5);
  assert.equal(auction.causality.formalV4Changed, false);
  assert.equal(JSON.parse(readFileSync(input, "utf8").split("\n")[0]).target, null);
});

test("L2 forward labels reject an incomplete future-minute chain", () => {
  const directory = mkdtempSync(join(tmpdir(), "zijin-l2-gap-"));
  const input = join(directory, "forward.jsonl");
  const labels = join(directory, "labels.jsonl");
  const state = join(directory, "state.json");
  writeFileSync(input, `${[record("0930", 31), record("0931", 31.1), record("0933", 31.2), record("0934", 31.3), record("0935", 31.4)].map((row) => JSON.stringify(row)).join("\n")}\n`);
  execFileSync("python", [script, "--input", input, "--labels", labels, "--state", state], { encoding: "utf8" });
  const summary = JSON.parse(readFileSync(state, "utf8"));
  assert.equal(summary.coverage.labeledObservations, 0);
  assert.equal(summary.safety.formalV4Changed, false);
});
