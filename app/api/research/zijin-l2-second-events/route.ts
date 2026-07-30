import { readFile } from "node:fs/promises";

const eventPath = process.env.ZIJIN_L2_SECOND_EVENT_PATH || "/training-state/zijin-l2-second-events.jsonl";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requested = Number(url.searchParams.get("limit") || 100);
    const limit = Math.max(1, Math.min(500, Number.isFinite(requested) ? Math.floor(requested) : 100));
    const rows = (await readFile(eventPath, "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map(line => JSON.parse(line));
    return Response.json({
      schemaVersion: 1,
      symbol: "601899",
      appendOnly: true,
      count: rows.length,
      events: rows,
      meta: { servedAt: new Date().toISOString() },
    }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch {
    return Response.json({
      schemaVersion: 1,
      symbol: "601899",
      appendOnly: true,
      count: 0,
      events: [],
      error: "秒级状态事件尚未产生",
    }, { headers: { "Cache-Control": "no-store" } });
  }
}
