import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = resolve(process.argv[2] ?? "public/research/zijin-training-progress.json");
const target = resolve(process.argv[3] ?? "/opt/rabbit-quant-state/zijin-training-progress.json");

const progress = JSON.parse(await readFile(source, "utf8"));
if (progress?.stock?.code !== "601899" || !progress.runId || typeof progress.progress !== "number") {
  throw new Error(`Invalid Zijin training state: ${source}`);
}

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);

console.log(
  `[zijin-training-state] ${progress.runId} ${progress.status} ${progress.progress}% -> ${target}`,
);
