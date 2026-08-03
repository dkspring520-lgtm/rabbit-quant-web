import { existsSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, resolveLocalExecutable, runSiteCommand } from "./sites-env.mjs";
import { validateArtifact } from "./validate-artifact.mjs";

function parseDuration(value) {
  const match = String(value).trim().match(/^(\d+)(ms|s|m|h)?$/i);
  if (!match) return 180_000;
  const amount = Number(match[1]);
  const unit = (match[2] || "ms").toLowerCase();
  return amount * ({ ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[unit]);
}

const vinext = resolveLocalExecutable("vinext");
if (!existsSync(join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "vinext.cmd" : "vinext"))) {
  console.error("vinext is unavailable. Run npm run install:ci and wait for it to finish before building.");
  process.exitCode = 69;
} else {
  console.log("Running bounded vinext build...");
  const result = await runSiteCommand(vinext, ["build"], {
    timeoutMs: parseDuration(process.env.SITES_BUILD_TIMEOUT || "3m"),
    killAfterMs: parseDuration(process.env.SITES_BUILD_KILL_AFTER || "10s"),
  });
  if (result.code !== 0) {
    process.exitCode = result.code;
  } else {
    await validateArtifact();
  }
}
