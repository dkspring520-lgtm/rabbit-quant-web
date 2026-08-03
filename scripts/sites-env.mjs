import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(scriptDir, "..");

export async function createSiteEnvironment() {
  const runtimeRoot = process.env.SITES_RUNTIME_ROOT || join(projectRoot, ".sites-runtime");
  const directories = [
    join(runtimeRoot, "home"),
    join(runtimeRoot, "npm-cache"),
    join(runtimeRoot, "xdg-config"),
    join(runtimeRoot, "tmp"),
    join(runtimeRoot, "wrangler", "logs"),
  ];
  await Promise.all(directories.map((directory) => mkdir(directory, { recursive: true })));

  const environment = { ...process.env };
  environment.SITES_ENV_READY = "1";
  environment.SITES_PROJECT_ROOT = projectRoot;
  environment.HOME = join(runtimeRoot, "home");
  environment.XDG_CONFIG_HOME = join(runtimeRoot, "xdg-config");
  environment.TMPDIR = join(runtimeRoot, "tmp");
  environment.WRANGLER_WRITE_LOGS = "false";
  environment.WRANGLER_LOG_PATH = join(runtimeRoot, "wrangler", "logs");
  environment.MINIFLARE_REGISTRY_PATH = join(runtimeRoot, "wrangler", "registry");
  delete environment.NPM_CONFIG_CACHE;
  delete environment.npm_config_cache;
  delete environment.npm_config_proxy;
  delete environment.npm_config_http_proxy;
  delete environment.npm_config_https_proxy;
  delete environment.NPM_CONFIG_PROXY;
  delete environment.NPM_CONFIG_HTTP_PROXY;
  delete environment.NPM_CONFIG_HTTPS_PROXY;
  environment.npm_config_cache = join(runtimeRoot, "npm-cache");
  environment.npm_config_audit = "false";
  environment.npm_config_fund = "false";
  environment.npm_config_update_notifier = "false";
  return environment;
}

export function resolveLocalExecutable(command) {
  if (command.includes("/") || command.includes("\\") || command.includes(":")) return command;
  const candidate = join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? `${command}.cmd` : command);
  return existsSync(candidate) ? candidate : command;
}

function resolveWindowsNodeShim(executable) {
  if (process.platform !== "win32" || !executable.toLowerCase().endsWith(".cmd")) return null;
  const packageName = basename(executable, ".cmd").toLowerCase();
  const targets = {
    drizzle: ["drizzle-kit", "bin.cjs"],
    "drizzle-kit": ["drizzle-kit", "bin.cjs"],
    eslint: ["eslint", "bin", "eslint.js"],
    vite: ["vite", "bin", "vite.js"],
    vinext: ["vinext", "dist", "cli.js"],
  }[packageName];
  if (!targets) return null;
  const target = join(dirname(executable), "..", ...targets);
  return existsSync(target) ? target : null;
}

export async function runSiteCommand(command, args = [], { timeoutMs = 0, killAfterMs = 10_000 } = {}) {
  const environment = await createSiteEnvironment();
  const executable = resolveLocalExecutable(command);
  const nodeShimTarget = resolveWindowsNodeShim(executable);
  const spawnExecutable = nodeShimTarget ? process.execPath : executable;
  const spawnArgs = nodeShimTarget ? [nodeShimTarget, ...args] : args;
  return new Promise((resolveResult, reject) => {
    const child = spawn(spawnExecutable, spawnArgs, {
      cwd: projectRoot,
      env: environment,
      stdio: "inherit",
      shell: !nodeShimTarget && process.platform === "win32" && executable.toLowerCase().endsWith(".cmd"),
    });
    let timeout;
    let forceKillTimeout;
    let timedOut = false;
    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        forceKillTimeout = setTimeout(() => child.kill(), killAfterMs);
      }, timeoutMs);
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (timeout) clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      resolveResult({ code: timedOut ? 124 : code ?? 1, signal });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  if (!args.length) {
    console.error("usage: node scripts/sites-env.mjs -- command [args...]");
    process.exitCode = 64;
    return;
  }
  const result = await runSiteCommand(args[0], args.slice(1));
  process.exitCode = result.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
