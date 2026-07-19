import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = resolve(process.argv[2] ?? "public/research/zijin-automation-status.json");
const target = resolve(process.argv[3] ?? "/opt/rabbit-quant-state/zijin-automation-status.json");

function valid(state) {
  return state?.stock?.code === "601899"
    && state?.scheduler?.mode === "change-driven"
    && state?.rabbits?.training
    && state?.rabbits?.challenger
    && state?.rabbits?.risk
    && state?.rabbits?.official;
}

function updatedAt(state) {
  const timestamp = Date.parse(String(state?.updatedAt ?? ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

const state = JSON.parse(await readFile(source, "utf8"));
if (!valid(state)) throw new Error(`Invalid Zijin automation state: ${source}`);

await mkdir(dirname(target), { recursive: true });
let current = null;
try {
  current = JSON.parse(await readFile(target, "utf8"));
} catch {
  // The runtime state is created by the first deployment.
}

if (valid(current) && updatedAt(current) > updatedAt(state)) {
  console.log(`[zijin-automation-state] keep newer runtime state ${current.scheduler.status}`);
  process.exit(0);
}

await copyFile(source, target);
console.log(`[zijin-automation-state] ${state.scheduler.status} -> ${target}`);
