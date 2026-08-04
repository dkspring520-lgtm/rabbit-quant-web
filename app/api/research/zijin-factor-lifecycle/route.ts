import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeZijinFactorRegistry } from "@/lib/zijin-factor-lifecycle.mjs";
import { upgradeShadowState } from "@/lib/zijin-shadow-ab.mjs";

const bundledRegistry = resolve(process.cwd(), "public/research/zijin-factor-registry.json");
const runtimeRegistry = process.env.ZIJIN_FACTOR_REGISTRY_PATH || "/training-state/zijin-factor-registry.json";
const bundledDaily = resolve(process.cwd(), "public/research/zijin-factor-daily.json");
const runtimeDaily = process.env.ZIJIN_FACTOR_DAILY_STATE_PATH || "/training-state/zijin-factor-daily.json";
const bundledShadow = resolve(process.cwd(), "public/research/zijin-shadow-ab.json");
const runtimeShadow = process.env.ZIJIN_SHADOW_STATE_PATH || "/training-state/zijin-shadow-ab.json";

async function readFirst(paths: string[]) {
  for (const path of paths) {
    try {
      return { payload: JSON.parse(await readFile(path, "utf8")), source: path };
    } catch {
      // Runtime state is optional; the checked-in audit snapshot remains the fallback.
    }
  }
  return null;
}
function sourceLabel(path: string | undefined, runtimePath: string) {
  return path === runtimePath ? "runtime" : "bundled";
}

function stale(updatedAt: unknown, maxAgeMs: number) {
  if (typeof updatedAt !== "string") return true;
  const timestamp = Date.parse(updatedAt);
  return !Number.isFinite(timestamp) || Date.now() - timestamp > maxAgeMs;
}

export async function GET() {
  const registryResult = await readFirst(runtimeRegistry === bundledRegistry ? [bundledRegistry] : [runtimeRegistry, bundledRegistry]);
  const dailyResult = await readFirst(runtimeDaily === bundledDaily ? [bundledDaily] : [runtimeDaily, bundledDaily]);
  const shadowResult = await readFirst(runtimeShadow === bundledShadow ? [bundledShadow] : [runtimeShadow, bundledShadow]);
  if (!registryResult || !dailyResult) {
    return Response.json({ error: "factor lifecycle state unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const registry = normalizeZijinFactorRegistry(registryResult.payload);
  const shadow = shadowResult?.payload?.stock?.code === "601899"
    ? upgradeShadowState(shadowResult.payload)
    : null;
  return Response.json({
    schemaVersion: registry.schemaVersion,
    registryVersion: registry.registryVersion,
    stock: registry.stock,
    updatedAt: registry.updatedAt,
    formalStrategy: registry.formalStrategy,
    scheduler: registry.scheduler,
    pools: registry.pools,
    factors: registry.factors,
    daily: dailyResult.payload,
    shadow,
    meta: {
      servedAt: new Date().toISOString(),
      formalStrategyWriteEnabled: false,
      registrySource: sourceLabel(registryResult.source, runtimeRegistry),
      dailySource: sourceLabel(dailyResult.source, runtimeDaily),
      shadowSource: shadowResult ? sourceLabel(shadowResult.source, runtimeShadow) : null,
      dailyStale: stale(dailyResult.payload.completedAt, 26 * 60 * 60 * 1000),
      shadowStale: stale(shadow?.updatedAt, 5 * 60 * 1000),
    },
  }, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "CDN-Cache-Control": "no-store",
    },
  });
}
