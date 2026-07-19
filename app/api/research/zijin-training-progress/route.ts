import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateZijinSchedulerHealth } from "@/lib/zijin-scheduler-health.mjs";

const bundledState = resolve(process.cwd(), "public/research/zijin-training-progress.json");
const runtimeState = process.env.ZIJIN_TRAINING_STATE_PATH || "/training-state/zijin-training-progress.json";
const bundledAutomationState = resolve(process.cwd(), "public/research/zijin-automation-status.json");
const runtimeAutomationState = process.env.ZIJIN_AUTOMATION_STATE_PATH || "/training-state/zijin-automation-status.json";

function parseProgressTime(value: unknown) {
  if (typeof value !== "string") return Number.NaN;
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return Date.parse(normalized);
}

async function readProgress(path: string) {
  const payload = JSON.parse(await readFile(path, "utf8"));
  if (payload?.stock?.code !== "601899" || !payload.runId || typeof payload.progress !== "number") {
    throw new Error("invalid Zijin training state");
  }
  return payload;
}

async function readAutomation(path: string) {
  const payload = JSON.parse(await readFile(path, "utf8"));
  if (payload?.stock?.code !== "601899" || !payload.scheduler || !payload.rabbits) {
    throw new Error("invalid Zijin automation state");
  }
  return payload;
}

async function latestAutomation() {
  const candidates = runtimeAutomationState === bundledAutomationState
    ? [bundledAutomationState]
    : [runtimeAutomationState, bundledAutomationState];
  for (const path of candidates) {
    try {
      const payload = await readAutomation(path);
      const health = evaluateZijinSchedulerHealth(payload.scheduler);
      return {
        payload,
        source: path === runtimeAutomationState ? "runtime" : "bundled",
        health,
      };
    } catch {
      // Try the bundled state when a server-side scheduler has not written a state yet.
    }
  }
  return null;
}

export async function GET() {
  const candidates = runtimeState === bundledState ? [bundledState] : [runtimeState, bundledState];
  for (const path of candidates) {
    try {
      const payload = await readProgress(path);
      const updatedAt = parseProgressTime(payload.updatedAt);
      const stale = payload.status === "running"
        && (!Number.isFinite(updatedAt) || Date.now() - updatedAt > 10 * 60 * 1000);
      const automation = await latestAutomation();
      return Response.json({
        ...payload,
        automation: automation?.payload ?? null,
        meta: {
          source: path === runtimeState ? "runtime" : "bundled",
          servedAt: new Date().toISOString(),
          stale,
          automationSource: automation?.source ?? null,
          automationStale: automation?.health.status === "offline",
          automationHealth: automation?.health ?? null,
        },
      }, {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          "CDN-Cache-Control": "no-store",
          "Cloudflare-CDN-Cache-Control": "no-store",
        },
      });
    } catch {
      // Try the bundled, audited state when the runtime state has not been created yet.
    }
  }

  return Response.json({ error: "训练状态暂不可用" }, {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
}
