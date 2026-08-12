import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { FactorResearchJobRunner, validateFactorResearchRequest } from "../services/paperclip-bridge/job-runner.mjs";

const execFileAsync = promisify(execFile);

function checksum(value) {
  return createHash("sha256").update(value).digest("hex");
}

function minuteTime(index) {
  const total = 9 * 60 + 30 + index;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}${String(total % 60).padStart(2, "0")}`;
}

function sessions(count = 8) {
  return Array.from({ length: count }, (_, day) => {
    const previousClose = 34 + day * 0.03;
    const minutes = Array.from({ length: 36 }, (_, index) => {
      const price = previousClose + Math.sin((index + day) / 4) * 0.16 + index * 0.002;
      const priorPrice = previousClose + Math.sin((Math.max(index - 1, 0) + day) / 4) * 0.16 + Math.max(index - 1, 0) * 0.002;
      const volume = 10000 + index * 80;
      return {
        time: minuteTime(index),
        open: index ? priorPrice : price - 0.01,
        high: Math.max(price, priorPrice) + 0.02,
        low: Math.min(price, priorPrice) - 0.02,
        close: price,
        price,
        volume,
        amount: price * volume,
        activeBuyVolume: volume * 0.54,
        activeSellVolume: volume * 0.46,
      };
    });
    const date = new Date(Date.UTC(2025, 0, 2 + day)).toISOString().slice(0, 10).replaceAll("-", "");
    return { date, previousClose, marketRegime: day % 2 ? "trend" : "range", minutes };
  });
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-bridge-"));
  const datasetRoot = path.join(root, "datasets");
  const artifactRoot = path.join(root, "artifacts");
  const stateRoot = path.join(root, "state");
  await mkdir(datasetRoot, { recursive: true });
  const inputText = `${sessions().map(item => JSON.stringify(item)).join("\n")}\n`;
  const inputPath = path.join(datasetRoot, "zijin.jsonl");
  const manifestPath = path.join(datasetRoot, "zijin.manifest.json");
  const catalogPath = path.join(datasetRoot, "catalog.json");
  const datasetChecksum = checksum(inputText);
  await writeFile(inputPath, inputText, "utf8");
  await writeFile(manifestPath, JSON.stringify({
    datasetId: "zijin-fixture-v1",
    datasetChecksum,
    sessions: 8,
    sourceDateRange: { first: "20250102", last: "20250109" },
    researchOnly: true,
    canPromoteAutomatically: false,
  }), "utf8");
  await writeFile(catalogPath, JSON.stringify({
    datasets: [{
      datasetId: "zijin-fixture-v1",
      inputPath: "zijin.jsonl",
      manifestPath: "zijin.manifest.json",
      datasetChecksum,
    }],
  }), "utf8");
  return { root, datasetRoot, artifactRoot, stateRoot, catalogPath, manifestPath };
}

function request(overrides = {}) {
  return {
    agentId: "backtest",
    correlationId: "PC-101",
    idempotencyKey: "factor-job-20250109",
    datasetId: "zijin-fixture-v1",
    factorIds: ["price.return_5m"],
    asOf: "2025-01-09T15:00:00+08:00",
    ...overrides,
  };
}

test("factor research request accepts only registered, bounded fields", () => {
  const valid = validateFactorResearchRequest(request({ closureControl: 1.5 }));
  assert.equal(valid.agentId, "backtest");
  assert.deepEqual(valid.factorIds, ["price.return_5m"]);
  assert.throws(() => validateFactorResearchRequest(request({ command: "whoami" })), /Unsupported fields/);
  assert.throws(() => validateFactorResearchRequest(request({ cwd: "C:/" })), /Unsupported fields/);
  assert.throws(() => validateFactorResearchRequest(request({ args: ["--output", "elsewhere"] })), /Unsupported fields/);
  assert.throws(() => validateFactorResearchRequest(request({ factorIds: ["unknown.factor"] })), /Unknown factor/);
  assert.throws(() => validateFactorResearchRequest(request({ datasetId: "../secret" })), /unsupported characters/);
  assert.throws(() => validateFactorResearchRequest(request({ closureControl: 4 })), /between 1 and 3/);
});

test("only 验真兔 can launch the fixed offline factor CLI and idempotency prevents a second launch", async () => {
  const current = await fixture();
  let launches = 0;
  const runner = new FactorResearchJobRunner({
    repositoryRoot: process.cwd(),
    datasetRoot: current.datasetRoot,
    datasetCatalogPath: current.catalogPath,
    artifactRoot: current.artifactRoot,
    stateRoot: current.stateRoot,
    execute: async (args) => {
      launches += 1;
      assert.equal(args[0], path.join(process.cwd(), "scripts", "run-factor-research.mjs"));
      assert.equal(args.includes("--input"), true);
      assert.equal(args.includes("--output"), true);
      return execFileAsync(process.execPath, args, {
        cwd: process.cwd(), encoding: "utf8", maxBuffer: 4 * 1024 * 1024, windowsHide: true,
      });
    },
  });

  await assert.rejects(() => runner.submit("factor-research", request({ agentId: "quant-research" })), /cannot use backtest:run/);
  await assert.rejects(() => runner.submit("shell", request()), /Unsupported job type/);
  const first = await runner.submit("factor-research", request());
  const replay = await runner.submit("factor-research", request());
  assert.equal(first.status, "succeeded");
  assert.equal(first.researchOnly, true);
  assert.equal(first.approvalStatus, "pending_human_approval");
  assert.equal(first.canPromoteAutomatically, false);
  assert.equal(first.summary.factors, 1);
  assert.equal(first.summary.leakageAuditPassed, true);
  assert.equal(replay.jobId, first.jobId);
  assert.equal(replay.replayed, true);
  assert.equal(launches, 1);
  assert.deepEqual(await runner.getJob(first.jobId), first);
});

test("dataset catalog rejects traversal and checksum mismatch", async () => {
  const current = await fixture();
  const runner = new FactorResearchJobRunner({
    repositoryRoot: process.cwd(),
    datasetRoot: current.datasetRoot,
    datasetCatalogPath: current.catalogPath,
    artifactRoot: current.artifactRoot,
    stateRoot: current.stateRoot,
  });
  await writeFile(path.join(current.datasetRoot, "zijin.jsonl"), "changed\n", "utf8");
  await assert.rejects(() => runner.resolveDataset("zijin-fixture-v1"), /checksum verification failed/);

  await writeFile(current.catalogPath, JSON.stringify({
    datasets: [{
      datasetId: "zijin-fixture-v1",
      inputPath: "../outside.jsonl",
      manifestPath: "zijin.manifest.json",
    }],
  }), "utf8");
  await assert.rejects(() => runner.resolveDataset("zijin-fixture-v1"), /escapes its configured root/);
  await assert.rejects(() => runner.resolveDataset("unknown"), /Unknown dataset/);
  await assert.rejects(() => runner.getJob("../job"), /unsupported characters/);
});
