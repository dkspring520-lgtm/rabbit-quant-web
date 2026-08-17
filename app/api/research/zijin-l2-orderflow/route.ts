import { readFile } from "node:fs/promises";

const statePath = process.env.ZIJIN_L2_STATE_PATH || "/training-state/zijin-l2-orderflow.json";
const streamIntervalMs = 300;
let cachedState: Awaited<ReturnType<typeof readState>> | null = null;
let cachedAt = 0;
let stateRead: Promise<Awaited<ReturnType<typeof readState>>> | null = null;

async function readState() {
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

  return {
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
  };
}

async function readCachedState() {
  if (cachedState && Date.now() - cachedAt < streamIntervalMs - 50) return cachedState;
  if (!stateRead) {
    stateRead = readState().then((payload) => {
      cachedState = payload;
      cachedAt = Date.now();
      return payload;
    }).finally(() => { stateRead = null; });
  }
  return stateRead;
}

function unavailableState() {
  return {
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
  };
}

export async function GET(request: Request) {
  const stream = new URL(request.url).searchParams.get("stream") === "1";
  if (stream) {
    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let initialSnapshot = true;
    let lastFingerprint = "";
    let lastSnapshotAt = 0;
    let lastMinutesSnapshotAt = 0;
    const body = new ReadableStream({
      start(controller) {
        const close = () => {
          closed = true;
          if (timer) clearTimeout(timer);
          try { controller.close(); } catch {}
        };
        const send = async () => {
          if (closed || request.signal.aborted) return close();
          let payload;
          try { payload = await readCachedState(); }
          catch { payload = unavailableState(); }
          if (closed || request.signal.aborted) return close();
          const fingerprint = [
            "updatedAt" in payload ? payload.updatedAt : "",
            "lastMessageAt" in payload ? payload.lastMessageAt : "",
            payload.status?.connected,
            payload.status?.stale,
          ].join("|");
          if (initialSnapshot || fingerprint !== lastFingerprint || Date.now() - lastSnapshotAt >= 2_500) {
            const includeRecentMinutes = initialSnapshot || Date.now() - lastMinutesSnapshotAt >= 2_500;
            const outgoing = includeRecentMinutes
              ? payload
              : { ...payload, recentMinutes: [] };
            controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(outgoing)}\n\n`));
            if (includeRecentMinutes) lastMinutesSnapshotAt = Date.now();
            initialSnapshot = false;
            lastFingerprint = fingerprint;
            lastSnapshotAt = Date.now();
          }
          timer = setTimeout(() => void send(), streamIntervalMs);
        };
        request.signal.addEventListener("abort", close, { once: true });
        void send();
      },
      cancel() {
        closed = true;
        if (timer) clearTimeout(timer);
      },
    });
    return new Response(body, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0, no-transform",
        "Content-Type": "text/event-stream; charset=utf-8",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  try {
    return Response.json(await readCachedState(), { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch {
    return Response.json(unavailableState(), { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
