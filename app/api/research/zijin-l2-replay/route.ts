import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeZijinL2ReplayPayload } from "@/lib/zijin-l2-causal-replay.mjs";

const statePath = process.env.ZIJIN_L2_STATE_PATH || "/training-state/zijin-l2-orderflow.json";
const archiveDir = process.env.ZIJIN_L2_REPLAY_ARCHIVE_DIR || "/training-state/zijin-l2-replay";

async function readJson(path:string) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function GET(request:Request) {
  const date = new URL(request.url).searchParams.get("date")?.replace(/\D/g, "").slice(0, 8) ?? "";
  if (!/^\d{8}$/.test(date)) {
    return Response.json({ available:false, date:null, minutes:[], reason:"需要8位交易日" }, { status:400 });
  }
  let payload = null;
  let source = "archive";
  try {
    payload = await readJson(join(archiveDir, `${date}.json`));
  } catch {
    source = "current-session";
    try { payload = await readJson(statePath); } catch { payload = null; }
  }
  const normalized = normalizeZijinL2ReplayPayload(payload, date);
  return Response.json({
    ...normalized,
    source: normalized.available ? source : "unavailable",
    causal: true,
    researchOnly: true,
  }, {
    headers: { "Cache-Control":"no-store, no-cache, must-revalidate, max-age=0" },
  });
}
