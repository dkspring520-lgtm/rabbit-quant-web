import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createZijinDailyAssignment,
  normalizeZijinDailyAssignment,
} from "@/lib/zijin-daily-assignment.mjs";

const bundledRegistry = resolve(process.cwd(), "public/research/zijin-factor-registry.json");
const bundledDaily = resolve(process.cwd(), "public/research/zijin-factor-daily.json");
const bundledShadow = resolve(process.cwd(), "public/research/zijin-shadow-ab.json");
const bundledAssignment = resolve(process.cwd(), "public/research/zijin-daily-assignment.json");
const runtimeRegistry = process.env.ZIJIN_FACTOR_REGISTRY_PATH || "/training-state/zijin-factor-registry.json";
const runtimeDaily = process.env.ZIJIN_FACTOR_DAILY_STATE_PATH || "/training-state/zijin-factor-daily.json";
const runtimeShadow = process.env.ZIJIN_SHADOW_STATE_PATH || "/training-state/zijin-shadow-ab.json";
const runtimeAssignment = process.env.ZIJIN_DAILY_ASSIGNMENT_PATH || "/training-state/zijin-daily-assignment.json";

async function readJson(paths: string[]) {
  for (const path of paths) {
    try {
      return { payload: JSON.parse(await readFile(path, "utf8")), source: path };
    } catch {
      // The checked-in snapshot keeps the read-only panel available without a runtime volume.
    }
  }
  return null;
}

export async function GET() {
  const assignmentResult = await readJson(runtimeAssignment === bundledAssignment ? [bundledAssignment] : [runtimeAssignment, bundledAssignment]);
  if (assignmentResult) {
    const assignment = normalizeZijinDailyAssignment(assignmentResult.payload);
    return Response.json({
      ...assignment,
      meta: { servedAt: new Date().toISOString(), source: assignmentResult.source === runtimeAssignment ? "runtime" : "bundled" },
    }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  }

  const [registryResult, dailyResult, shadowResult] = await Promise.all([
    readJson(runtimeRegistry === bundledRegistry ? [bundledRegistry] : [runtimeRegistry, bundledRegistry]),
    readJson(runtimeDaily === bundledDaily ? [bundledDaily] : [runtimeDaily, bundledDaily]),
    readJson(runtimeShadow === bundledShadow ? [bundledShadow] : [runtimeShadow, bundledShadow]),
  ]);
  if (!registryResult || !dailyResult) {
    return Response.json({ error: "daily assignment unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const assignment = createZijinDailyAssignment({
    marketDate: dailyResult.payload?.marketDate || undefined,
    generatedAt: dailyResult.payload?.completedAt || new Date().toISOString(),
    registry: registryResult.payload,
    dailyRun: dailyResult.payload,
    shadowState: shadowResult?.payload || null,
  });
  return Response.json({
    ...assignment,
    meta: { servedAt: new Date().toISOString(), source: "derived", runtimeAssignmentPath: runtimeAssignment },
  }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
}
