import { NextResponse } from "next/server";
import { runGrowthAutomation } from "@/lib/growth-server.mjs";

export const runtime = "nodejs";

export async function POST() {
  try {
    const result = await runGrowthAutomation({ force: true, limit: 10 });
    return NextResponse.json({
      ok: true,
      generatedAt: result.lastRunAt,
      keywords: result.keywords,
      draft: result.generatedDraft,
      warning: result.warning || result.lastRunError || null,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "自动生成失败",
    }, { status: 500 });
  }
}
