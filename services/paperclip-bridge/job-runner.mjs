import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { DEFAULT_FACTOR_REGISTRY, stableStringify } from "../../lib/factor-research/index.mjs";
import { assertScope } from "./scopes.mjs";

const execFileAsync = promisify(execFile);
const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(MODULE_DIRECTORY, "../..");
const REQUEST_FIELDS = new Set([
  "agentId", "correlationId", "idempotencyKey", "datasetId", "factorIds",
  "combinations", "closures", "closureControl", "asOf",
]);

export class BridgeError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "BridgeError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function nonEmptyString(value, field, maximum = 160) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new BridgeError(400, "INVALID_REQUEST", `${field} must be a non-empty string of at most ${maximum} characters`);
  }
  return value.trim();
}

function validateId(value, field) {
  const result = nonEmptyString(value, field, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(result) || result.includes("..")) {
    throw new BridgeError(400, "INVALID_ID", `${field} contains unsupported characters`);
  }
  return result;
}

export function validateFactorResearchRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BridgeError(400, "INVALID_REQUEST", "Request body must be a JSON object");
  }
  const unknown = Object.keys(input).filter(key => !REQUEST_FIELDS.has(key));
  if (unknown.length) throw new BridgeError(400, "UNKNOWN_FIELDS", `Unsupported fields: ${unknown.join(", ")}`);
  const factorIds = input.factorIds === undefined ? null : input.factorIds;
  if (factorIds !== null && (!Array.isArray(factorIds) || factorIds.length < 1 || factorIds.length > 48)) {
    throw new BridgeError(400, "INVALID_FACTORS", "factorIds must contain 1 to 48 registered factors");
  }
  const normalizedFactors = factorIds?.map(value => validateId(value, "factorIds")) ?? null;
  for (const factorId of normalizedFactors ?? []) {
    if (!DEFAULT_FACTOR_REGISTRY.get(factorId)) throw new BridgeError(400, "UNKNOWN_FACTOR", `Unknown factor: ${factorId}`);
  }
  const closureControl = input.closureControl === undefined ? 1.5 : Number(input.closureControl);
  if (!Number.isFinite(closureControl) || closureControl < 1 || closureControl > 3) {
    throw new BridgeError(400, "INVALID_CLOSURE_CONTROL", "closureControl must be between 1 and 3");
  }
  if (input.asOf !== undefined && Number.isNaN(Date.parse(input.asOf))) {
    throw new BridgeError(400, "INVALID_AS_OF", "asOf must be an ISO-8601 timestamp");
  }
  return Object.freeze({
    agentId: validateId(input.agentId, "agentId"),
    correlationId: nonEmptyString(input.correlationId, "correlationId"),
    idempotencyKey: nonEmptyString(input.idempotencyKey, "idempotencyKey"),
    datasetId: validateId(input.datasetId, "datasetId"),
    factorIds: normalizedFactors ? Object.freeze([...new Set(normalizedFactors)]) : null,
    combinations: input.combinations === true,
    closures: input.closures === true,
    closureControl,
    asOf: input.asOf ? new Date(input.asOf).toISOString() : null,
  });
}

export function resolveInside(root, relativePath, field = "path") {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) {
    throw new BridgeError(400, "UNSAFE_PATH", `${field} must be relative to its configured root`);
  }
  const absoluteRoot = path.resolve(root);
  const resolved = path.resolve(absoluteRoot, relativePath);
  const relative = path.relative(absoluteRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new BridgeError(400, "UNSAFE_PATH", `${field} escapes its configured root`);
  }
  return resolved;
}

async function atomicJson(filePath, value, exclusive = false) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const contents = `${stableStringify(value, 2)}\n`;
  if (exclusive) {
    await writeFile(filePath, contents, { encoding: "utf8", flag: "wx" });
    return;
  }
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, filePath);
}

export class FactorResearchJobRunner {
  #running = new Map();

  constructor({
    repositoryRoot = DEFAULT_REPOSITORY_ROOT,
    datasetRoot,
    datasetCatalogPath,
    artifactRoot,
    stateRoot,
    execute = null,
  }) {
    this.repositoryRoot = path.resolve(repositoryRoot);
    this.datasetRoot = path.resolve(datasetRoot);
    this.datasetCatalogPath = path.resolve(datasetCatalogPath);
    this.artifactRoot = path.resolve(artifactRoot);
    this.stateRoot = path.resolve(stateRoot);
    this.execute = execute ?? (async (args) => execFileAsync(process.execPath, args, {
      cwd: this.repositoryRoot,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    }));
  }

  async listDatasets() {
    const catalog = JSON.parse(await readFile(this.datasetCatalogPath, "utf8"));
    if (!Array.isArray(catalog.datasets)) throw new BridgeError(500, "INVALID_CATALOG", "Dataset catalog requires a datasets array");
    return catalog.datasets.map(item => ({ datasetId: item.datasetId, description: item.description ?? null }));
  }

  async resolveDataset(datasetId) {
    const catalog = JSON.parse(await readFile(this.datasetCatalogPath, "utf8"));
    const entries = Array.isArray(catalog.datasets) ? catalog.datasets : [];
    const entry = entries.find(item => item.datasetId === datasetId);
    if (!entry) throw new BridgeError(404, "UNKNOWN_DATASET", `Unknown dataset: ${datasetId}`);
    const inputPath = resolveInside(this.datasetRoot, entry.inputPath, "inputPath");
    const manifestPath = resolveInside(this.datasetRoot, entry.manifestPath, "manifestPath");
    const [input, manifestText] = await Promise.all([readFile(inputPath), readFile(manifestPath, "utf8")]);
    const manifest = JSON.parse(manifestText);
    const checksum = sha256(input);
    if (manifest.datasetId !== datasetId || entry.datasetChecksum && entry.datasetChecksum !== checksum || manifest.datasetChecksum !== checksum) {
      throw new BridgeError(409, "DATASET_CHECKSUM_MISMATCH", `Dataset checksum verification failed for ${datasetId}`);
    }
    if (manifest.researchOnly !== true || manifest.canPromoteAutomatically !== false) {
      throw new BridgeError(409, "UNSAFE_DATASET_MANIFEST", "Dataset manifest must be research-only and forbid automatic promotion");
    }
    return Object.freeze({
      datasetId,
      inputPath,
      manifestPath,
      checksum,
      sourceDateRange: manifest.sourceDateRange ?? null,
      sessions: manifest.sessions ?? null,
      researchOnly: true,
      canPromoteAutomatically: false,
    });
  }

  async submit(jobType, rawRequest) {
    if (jobType !== "factor-research") throw new BridgeError(400, "UNKNOWN_JOB_TYPE", `Unsupported job type: ${jobType}`);
    const request = validateFactorResearchRequest(rawRequest);
    assertScope(request.agentId, "backtest:run");
    const dataset = await this.resolveDataset(request.datasetId);
    const fingerprint = sha256(stableStringify({ jobType, request, datasetChecksum: dataset.checksum }));
    const idempotencyDigest = sha256(`${request.agentId}\0${request.idempotencyKey}`);
    const jobId = `fr-${idempotencyDigest.slice(0, 24)}`;
    const statePath = path.join(this.stateRoot, "jobs", `${jobId}.json`);

    if (this.#running.has(jobId)) return this.#running.get(jobId);
    try {
      await atomicJson(statePath, {
        jobId, jobType, fingerprint, status: "running", correlationId: request.correlationId,
        researchOnly: true, approvalStatus: "pending_human_approval", canPromoteAutomatically: false,
      }, true);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = JSON.parse(await readFile(statePath, "utf8"));
      if (existing.fingerprint !== fingerprint) {
        throw new BridgeError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used with another request");
      }
      return { ...existing, replayed: true };
    }

    const execution = this.#execute({ jobId, jobType, request, dataset, fingerprint, statePath });
    this.#running.set(jobId, execution);
    try {
      return await execution;
    } finally {
      this.#running.delete(jobId);
    }
  }

  async #execute({ jobId, jobType, request, dataset, fingerprint, statePath }) {
    const outputPath = resolveInside(this.artifactRoot, jobId, "job output");
    const args = [
      path.join(this.repositoryRoot, "scripts", "run-factor-research.mjs"),
      "--input", dataset.inputPath,
      "--output", outputPath,
      "--dataset-id", dataset.datasetId,
      "--dataset-manifest", dataset.manifestPath,
    ];
    if (request.factorIds) args.push("--factor", request.factorIds.join(","));
    if (request.combinations) args.push("--combinations");
    if (request.closures) args.push("--closures", "--closure-control", String(request.closureControl));
    if (request.asOf) args.push("--as-of", request.asOf);

    try {
      const { stdout, stderr = "" } = await this.execute(args);
      const summary = JSON.parse(String(stdout).trim());
      const reportPath = path.resolve(summary.reportPath);
      const relativeReport = path.relative(outputPath, reportPath);
      if (relativeReport.startsWith("..") || path.isAbsolute(relativeReport)) {
        throw new BridgeError(500, "UNSAFE_ARTIFACT", "Research CLI returned an artifact outside the job directory");
      }
      const result = {
        jobId,
        jobType,
        fingerprint,
        status: "succeeded",
        correlationId: request.correlationId,
        datasetId: dataset.datasetId,
        datasetChecksum: dataset.checksum,
        summary,
        stderr: String(stderr).trim() || null,
        researchOnly: true,
        approvalStatus: "pending_human_approval",
        canPromoteAutomatically: false,
      };
      await atomicJson(statePath, result);
      return result;
    } catch (error) {
      const failed = {
        jobId, jobType, fingerprint, status: "failed", correlationId: request.correlationId,
        error: error instanceof Error ? error.message : String(error), researchOnly: true,
        approvalStatus: "pending_human_approval", canPromoteAutomatically: false,
      };
      await atomicJson(statePath, failed);
      throw error;
    }
  }

  async getJob(jobId) {
    const safeJobId = validateId(jobId, "jobId");
    try {
      return JSON.parse(await readFile(path.join(this.stateRoot, "jobs", `${safeJobId}.json`), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") throw new BridgeError(404, "UNKNOWN_JOB", `Unknown job: ${safeJobId}`);
      throw error;
    }
  }
}
