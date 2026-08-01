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
  assert.equal(auction.costModel.mode, "account-dynamic");
  assert.ok(auction.costModel.roundTripCostPct < auction.costThresholdPct);
  assert.ok(auction.costThresholdPct > 0.30 && auction.costThresholdPct < 0.34);
  assert.equal(JSON.parse(readFileSync(input, "utf8").split("\n")[0]).target, null);
});

test("L2 forward labels retain an explicit legacy fixed-threshold replay mode", () => {
  const directory = mkdtempSync(join(tmpdir(), "zijin-l2-fixed-cost-"));
  const input = join(directory, "forward.jsonl");
  const labels = join(directory, "labels.jsonl");
  const state = join(directory, "state.json");
  const rows = [];
  for (let index = 0; index <= 5; index += 1) rows.push(record(`093${index}`, 32 + index * 0.1));
  writeFileSync(input, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  execFileSync("python", [script, "--input", input, "--labels", labels, "--state", state, "--cost-pct", "0.46"], { encoding: "utf8" });
  const first = JSON.parse(readFileSync(labels, "utf8").trim().split("\n")[0]);
  assert.equal(first.costThresholdPct, 0.46);
  assert.equal(first.costModel.mode, "fixed");
});

test("L2 forward labels append 15m and 30m outcomes after an earlier 5m label matures", () => {
  const directory = mkdtempSync(join(tmpdir(), "zijin-l2-incremental-horizons-"));
  const input = join(directory, "forward.jsonl");
  const labels = join(directory, "labels.jsonl");
  const state = join(directory, "state.json");
  const rows = Array.from({ length: 31 }, (_, index) => {
    const total = 9 * 60 + 30 + index;
    const clock = `${String(Math.floor(total / 60)).padStart(2, "0")}${String(total % 60).padStart(2, "0")}`;
    return record(clock, 32 + index * 0.01);
  });
  writeFileSync(input, `${rows.slice(0, 6).map((row) => JSON.stringify(row)).join("\n")}\n`);
  execFileSync("python", [script, "--input", input, "--labels", labels, "--state", state], { encoding: "utf8" });
  assert.deepEqual(readFileSync(labels, "utf8").trim().split("\n").map(JSON.parse).map(item => item.horizonMinutes), [5]);

  writeFileSync(input, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  execFileSync("python", [script, "--input", input, "--labels", labels, "--state", state], { encoding: "utf8" });
  const anchorLabels = readFileSync(labels, "utf8").trim().split("\n").map(JSON.parse)
    .filter(item => item.featureExchangeMinute === "20260727-0930");
  assert.deepEqual(anchorLabels.map(item => item.horizonMinutes), [5, 15, 30]);
  const summary = JSON.parse(readFileSync(state, "utf8"));
  assert.equal(summary.coverage.labeledObservations, 26);
  assert.ok(summary.coverage.horizonLabels > summary.coverage.labeledObservations);
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

test("L2 v3 feature rows receive distinct immutable observation ids", () => {
  const directory = mkdtempSync(join(tmpdir(), "zijin-l2-v3-labels-"));
  const input = join(directory, "forward.jsonl");
  const labels = join(directory, "labels.jsonl");
  const state = join(directory, "state.json");
  const rows = Array.from({ length: 6 }, (_, index) => ({
    ...record(`093${index}`, 32 + index * .1),
    schemaVersion: 3,
    microstructure: { featureSchemaId: "zijin-l2-microstructure-v1", flow3sTfi: .2 },
  }));
  writeFileSync(input, `${rows.map(JSON.stringify).join("\n")}\n`);
  execFileSync("python", [script, "--input", input, "--labels", labels, "--state", state], { encoding: "utf8" });
  const first = JSON.parse(readFileSync(labels, "utf8").trim().split("\n")[0]);
  assert.match(first.observationId, /:l2-v3$/);
  assert.equal(first.causality.featureFrozenBeforeOutcome, true);
});
