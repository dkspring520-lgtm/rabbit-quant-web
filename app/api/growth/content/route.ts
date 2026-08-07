import { NextResponse } from "next/server";
import { readGrowthContent, updateGrowthDraft } from "@/lib/growth-server.mjs";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(readGrowthContent(), {
    headers: { "cache-control": "no-store" },
  });
}

export async function PUT(request: Request) {
  const payload = await request.json().catch(() => ({}));
  if (!payload?.draft?.id) {
    return NextResponse.json({ error: "缺少文章记录" }, { status: 400 });
  }
  return NextResponse.json(await updateGrowthDraft(payload.draft, {
    submitToBaidu: payload.submitToBaidu === true,
  }), {
    headers: { "cache-control": "no-store" },
  });
}
