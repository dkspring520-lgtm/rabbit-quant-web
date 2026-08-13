import { readFile } from "node:fs/promises";

type ServiceState = "healthy" | "unavailable";
type RuntimeState = "running" | "degraded" | "stopped";

const STATUS_PATH = process.env.PAPERCLIP_STATUS_PATH || "/training-state/paperclip-status.json";
// The deployment watchdog writes this snapshot on deploy and recovery checks;
// it is not a per-request heartbeat. Keep genuine degraded states immediate
// without turning a healthy, unchanged runtime stale after two minutes.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function serviceState(value: unknown): ServiceState {
  return value === "healthy" ? "healthy" : "unavailable";
}

export async function GET() {
  const servedAt = new Date().toISOString();
  try {
    const raw = JSON.parse(await readFile(STATUS_PATH, "utf8")) as Record<string, unknown>;
    const services = (raw.services && typeof raw.services === "object" ? raw.services : {}) as Record<string, unknown>;
    const checkedAt = typeof raw.checkedAt === "string" ? raw.checkedAt : null;
    const stale = !checkedAt || !Number.isFinite(Date.parse(checkedAt)) || Date.now() - Date.parse(checkedAt) > STALE_AFTER_MS;
    const paperclip = serviceState(services.paperclip);
    const bridge = serviceState(services.bridge);
    const healthy = !stale && paperclip === "healthy" && bridge === "healthy";
    const status: RuntimeState = healthy ? "running" : "degraded";
    return Response.json({
      status,
      services: { paperclip, bridge },
      checkedAt,
      message: healthy ? "研究控制面运行正常" : "研究控制面状态异常或已过期",
      meta: { servedAt, stale },
    }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch {
    return Response.json({
      status: "stopped" satisfies RuntimeState,
      services: { paperclip: "unavailable" satisfies ServiceState, bridge: "unavailable" satisfies ServiceState },
      checkedAt: null,
      message: "实时控制面未启动",
      meta: { servedAt, stale: true },
    }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  }
}

export const dynamic = "force-dynamic";
