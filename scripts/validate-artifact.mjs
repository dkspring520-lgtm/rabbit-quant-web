import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { projectRoot } from "./sites-env.mjs";

export async function validateArtifact() {
  const workerPath = join(projectRoot, "dist", "server", "index.js");
  const hostingPath = join(projectRoot, "dist", ".openai", "hosting.json");
  await readFile(workerPath, "utf8");
  JSON.parse(await readFile(hostingPath, "utf8"));
  const workerUrl = pathToFileURL(workerPath);
  workerUrl.searchParams.set("sites-validation", `${process.pid}-${Date.now()}`);
  const worker = await import(workerUrl.href);
  if (!worker.default || typeof worker.default.fetch !== "function") {
    throw new Error("dist/server/index.js must have an ESM default export with fetch(request, env, ctx)");
  }
  console.log("Validated Sites artifact: ESM Worker default.fetch and hosting manifest are present.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await validateArtifact();
