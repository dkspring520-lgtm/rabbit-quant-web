import { readFile } from "node:fs/promises";

const statePath = process.env.ZIJIN_L2_STATE_PATH || "/training-state/zijin-l2-orderflow.json";

export async function GET() {
  try {
    const payload = JSON.parse(await readFile(statePath, "utf8"));
    const updatedAt = Date.parse(payload.updatedAt);
    return Response.json({
      ...payload,
      meta: { servedAt: new Date().toISOString(), stale: !Number.isFinite(updatedAt) || Date.now() - updatedAt > 15_000 },
    }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch {
    return Response.json({
      schemaVersion: 1, source: "base32-l2-nats", symbol: "601899",
      status: { connected: false, authorized: false, stale: true },
      error: "L2 上海节点尚未产生可用数据",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
