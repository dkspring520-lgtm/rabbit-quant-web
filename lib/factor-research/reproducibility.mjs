import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const REPRODUCIBILITY_VERSION = "1.0.0";

function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

export function stableStringify(value, spacing = 0) {
  return JSON.stringify(normalized(value), null, spacing);
}

export function sha256(value) {
  const contents = typeof value === "string" || Buffer.isBuffer(value) ? value : stableStringify(value);
  return createHash("sha256").update(contents).digest("hex");
}

export function resolveGitCommit(cwd = process.cwd()) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    const injected = String(process.env.FACTOR_RESEARCH_GIT_COMMIT ?? "").trim();
    return /^[0-9a-f]{40}$/i.test(injected) ? injected : "unknown";
  }
}

export function buildReproducibilityMetadata({
  sessions,
  datasetId,
  engineVersion,
  factorVersion,
  config,
  asOf = null,
  gitCommit = null,
  cwd = process.cwd(),
}) {
  const ordered = [...(Array.isArray(sessions) ? sessions : [])].sort((left, right) => String(left?.date).localeCompare(String(right?.date)));
  const last = ordered.at(-1);
  const inferredAsOf = last ? `${last.date}T${String(last.minutes?.at(-1)?.time ?? "1500")}` : null;
  return Object.freeze({
    datasetId: datasetId || `factor-dataset-${sha256(ordered).slice(0, 12)}`,
    datasetChecksum: sha256(ordered),
    engineVersion,
    factorVersion,
    configHash: sha256(config),
    asOf: asOf ?? inferredAsOf,
    gitCommit: gitCommit ?? resolveGitCommit(cwd),
    reproducibilityVersion: REPRODUCIBILITY_VERSION,
  });
}

export async function writeImmutableJson(filePath, value) {
  const absolute = path.resolve(filePath);
  const contents = `${stableStringify(value, 2)}\n`;
  await mkdir(path.dirname(absolute), { recursive: true });
  try {
    await writeFile(absolute, contents, { encoding: "utf8", flag: "wx" });
    return { path: absolute, created: true, checksum: sha256(contents) };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readFile(absolute, "utf8");
    if (existing !== contents) throw new Error(`Immutable research artifact differs and cannot be overwritten: ${absolute}`);
    return { path: absolute, created: false, checksum: sha256(existing) };
  }
}
