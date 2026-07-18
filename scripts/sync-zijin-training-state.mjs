import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = resolve(process.argv[2] ?? "public/research/zijin-training-progress.json");
const target = resolve(process.argv[3] ?? "/opt/rabbit-quant-state/zijin-training-progress.json");

function valid(progress) {
  return progress?.stock?.code === "601899" && progress.runId && typeof progress.progress === "number";
}

function updatedAt(progress) {
  const value = String(progress?.updatedAt ?? "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

const progress = JSON.parse(await readFile(source, "utf8"));
if (!valid(progress)) throw new Error(`Invalid Zijin training state: ${source}`);

await mkdir(dirname(target), { recursive: true });
let current = null;
try {
  current = JSON.parse(await readFile(target, "utf8"));
} catch {
  // The runtime state is created by the first deployment.
}

if (valid(current) && updatedAt(current) > updatedAt(progress)) {
  console.log(
    `[zijin-training-state] keep newer runtime state ${current.runId} ${current.status} ${current.progress}%`,
  );
  process.exit(0);
}

await copyFile(source, target);

console.log(
  `[zijin-training-state] ${progress.runId} ${progress.status} ${progress.progress}% -> ${target}`,
);
