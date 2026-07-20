import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const runtimeState = process.env.ZIJIN_SHADOW_STATE_PATH || "/training-state/zijin-shadow-ab.json";
const bundledState = resolve(process.cwd(), "public/research/zijin-shadow-ab.json");

function valid(payload: any) {
  return payload?.experimentId === "zijin-round10-vs-round11-forward-shadow"
    && payload?.stock?.code === "601899"
    && payload?.models?.A
    && payload?.models?.B;
}
export async function GET() {
  for (const path of [runtimeState, bundledState]) {
    try {
      const payload = JSON.parse(await readFile(path, "utf8"));
      if (!valid(payload)) continue;
      const updatedAt = Date.parse(payload.updatedAt);
      return Response.json({
        ...payload,
        meta: {
          source: path === runtimeState ? "runtime" : "bundled",
          servedAt: new Date().toISOString(),
          stale: !Number.isFinite(updatedAt) || Date.now() - updatedAt > 5 * 60 * 1000,
        },
      }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
    } catch {
      // Try the bundled empty state when the observer has not written runtime data.
    }
  }
  return Response.json({ error: "紫金A/B影子观察状态暂不可用" }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
