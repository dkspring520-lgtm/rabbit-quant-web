import { readFile } from "node:fs/promises";

const statePath = process.env.ZIJIN_L2_AUDIT_STATE_PATH || "/training-state/zijin-l2-state-audit.json";

export async function GET() {
  try {
    const payload = JSON.parse(await readFile(statePath, "utf8"));
    return Response.json(payload, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
    });
  } catch {
    return Response.json({
      schemaVersion: 1,
      symbol: "601899",
      researchOnly: true,
      sourceStatus: "not-started",
      readiness: { ready: false, reason: "等待第一批真实L2事件" },
    }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
