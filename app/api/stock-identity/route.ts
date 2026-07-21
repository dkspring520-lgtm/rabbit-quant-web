import snapshotUniverse from "@/public/research/a-share-universe.json";
import { resolveStockIdentities, resolveStockIdentity } from "@/lib/stock-identity.mjs";

const universe = (snapshotUniverse.stocks ?? []).map(item => ({
  code: String(item.code ?? "").trim(),
  name: String(item.name ?? "").trim(),
})).filter(item => /^\d{6}$/.test(item.code) && item.name);

const headers = { "Cache-Control": "private, max-age=300" };

export async function GET(request: Request) {
  const url = new URL(request.url);
  return Response.json(resolveStockIdentity(universe, {
    code: url.searchParams.get("code") ?? "",
    name: url.searchParams.get("name") ?? "",
  }), { headers });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({})) as { stocks?: { code?: string; name?: string }[] };
  const stocks = Array.isArray(payload.stocks) ? payload.stocks : [];
  return Response.json({ stocks: resolveStockIdentities(universe, stocks) }, { headers: { "Cache-Control": "no-store" } });
}
