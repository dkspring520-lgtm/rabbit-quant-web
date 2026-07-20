import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateZijinSchedulerHealth } from "@/lib/zijin-scheduler-health.mjs";

const bundledState = resolve(process.cwd(), "public/research/zijin-training-progress.json");
const runtimeState = process.env.ZIJIN_TRAINING_STATE_PATH || "/training-state/zijin-training-progress.json";
const bundledAutomationState = resolve(process.cwd(), "public/research/zijin-automation-status.json");
const runtimeAutomationState = process.env.ZIJIN_AUTOMATION_STATE_PATH || "/training-state/zijin-automation-status.json";
const bundledReport = resolve(process.cwd(), "public/research/zijin-round6-report.json");
const runtimeReport = process.env.ZIJIN_TRAINING_REPORT_PATH || "/training-state/zijin-round9-report.json";
const runtimeTrainerAlerts = process.env.ZIJIN_TRAINER_ALERTS_PATH || "/training-state/zijin-trainer-alerts.jsonl";

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

async function readReport(path: string) {
  const payload = JSON.parse(await readFile(path, "utf8"));
  if (!payload?.experimentId || !payload?.runId || !Array.isArray(payload?.hypotheses)) {
    throw new Error("invalid Zijin experiment report");
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

async function latestTrainerAlert() {
  try {
    const lines = (await readFile(runtimeTrainerAlerts, "utf8")).split(/\r?\n/).filter(Boolean);
    if (!lines.length) return null;
    const payload = JSON.parse(lines.at(-1) || "null");
    if (!payload?.at || !payload?.event || !payload?.reason) return null;
    return payload;
  } catch {
    return null;
  }
}

async function latestReport() {
  const candidates = runtimeReport === bundledReport ? [bundledReport] : [runtimeReport, bundledReport];
  for (const path of candidates) {
    try {
      return {
        payload: await readReport(path),
        source: path === runtimeReport ? "runtime" : "bundled",
      };
    } catch {
      // Fall back to the audited report bundled with the current release.
    }
  }
  return null;
}

function mergeCurrentRun(payload: any, automation: any) {
  if (!automation?.scheduler || !automation?.run) return payload;
  const schedulerStatus = automation.scheduler.status;
  const status = schedulerStatus === "running"
    ? "running"
    : schedulerStatus === "failed"
      ? "failed"
      : automation.lastRun?.status === "completed"
        ? "completed"
        : payload.status;
  return {
    ...payload,
    runId: automation.run.id || automation.lastRun?.id || payload.runId,
    status,
    stage: automation.run.stage || payload.stage,
    progress: Number.isFinite(automation.run.progress) ? automation.run.progress : payload.progress,
    message: automation.run.currentTask || automation.scheduler.reason || payload.message,
    updatedAt: automation.updatedAt || payload.updatedAt,
  };
}

export async function GET() {
  const candidates = runtimeState === bundledState ? [bundledState] : [runtimeState, bundledState];
  for (const path of candidates) {
    try {
      const payload = await readProgress(path);
      const automation = await latestAutomation();
      const report = await latestReport();
      const trainerAlert = await latestTrainerAlert();
      const current = mergeCurrentRun(payload, automation?.payload);
      const currentUpdatedAt = parseProgressTime(current.updatedAt);
      const currentStale = current.status === "running"
        && (!Number.isFinite(currentUpdatedAt) || Date.now() - currentUpdatedAt > 10 * 60 * 1000);
      return Response.json({
        ...current,
        automation: automation?.payload ?? null,
        currentExperiment: report?.payload ?? null,
        meta: {
          source: path === runtimeState ? "runtime" : "bundled",
          servedAt: new Date().toISOString(),
          stale: currentStale,
          automationSource: automation?.source ?? null,
          reportSource: report?.source ?? null,
          automationStale: automation?.health.status === "offline",
          automationHealth: automation?.health ?? null,
          trainerAlert,
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
