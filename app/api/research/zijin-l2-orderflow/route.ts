import { readFile } from "node:fs/promises";

const statePath = process.env.ZIJIN_L2_STATE_PATH || "/training-state/zijin-l2-orderflow.json";

export async function GET() {
  try {
    const payload = JSON.parse(await readFile(statePath, "utf8"));
    const updatedAt = Date.parse(payload.updatedAt);
    const heartbeatAgeSeconds = Number.isFinite(updatedAt)
      ? Math.max(0, (Date.now() - updatedAt) / 1000)
      : null;
    const collectorAlive = heartbeatAgeSeconds !== null && heartbeatAgeSeconds <= 15;
    const transportConnected = payload.status?.connected === true;
    const feedAgeSeconds = Number.isFinite(payload.status?.ageSeconds)
      ? payload.status.ageSeconds
      : null;
    const feedStale = payload.status?.stale !== false;
    const stale = !collectorAlive || feedStale;

    return Response.json({
      ...payload,
      status: {
        ...payload.status,
        transportConnected,
        connected: collectorAlive && transportConnected,
        collectorAlive,
        collectorStale: !collectorAlive,
        heartbeatAgeSeconds,
        feedAgeSeconds,
        stale,
      },
      meta: {
        ...payload.meta,
        servedAt: new Date().toISOString(),
        collectorAlive,
        collectorStale: !collectorAlive,
        heartbeatAgeSeconds,
        stale,
      },
    }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch {
    return Response.json({
      schemaVersion: 1,
      source: "base32-l2-nats",
      symbol: "601899",
      status: {
        connected: false,
        transportConnected: false,
        authorized: false,
        collectorAlive: false,
        collectorStale: true,
        heartbeatAgeSeconds: null,
        feedAgeSeconds: null,
        stale: true,
      },
      meta: {
        servedAt: new Date().toISOString(),
        collectorAlive: false,
        collectorStale: true,
        heartbeatAgeSeconds: null,
        stale: true,
      },
      error: "L2 上海节点尚未产生可用数据",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
