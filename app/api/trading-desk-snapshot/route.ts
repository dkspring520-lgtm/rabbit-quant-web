import { GET as getEventRadar } from "@/app/api/event-radar/route";
import { GET as getMarketContext } from "@/app/api/market-context/route";
import { GET as getMarketData } from "@/app/api/market-data/route";

async function readPayload(response: Response) {
  const payload = await response.json().catch(() => null);
  return response.ok ? { payload, error: null } : {
    payload: null,
    error: typeof payload?.error === "string" ? payload.error : `HTTP ${response.status}`,
  };
}

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const code = incoming.searchParams.get("code")?.trim() ?? "";
  if (!/^\d{6}$/.test(code)) {
    return Response.json({ error: "股票代码必须是 6 位数字" }, { status: 400 });
  }

  const marketUrl = new URL("/api/market-data", incoming.origin);
  marketUrl.searchParams.set("code", code);
  marketUrl.searchParams.set("mode", "trial-realtime");
  const radarUrl = new URL("/api/event-radar", incoming.origin);
  radarUrl.searchParams.set("codes", incoming.searchParams.get("codes") ?? code);
  radarUrl.searchParams.set("names", incoming.searchParams.get("names") ?? code);

  const [marketResponse, radarResponse] = await Promise.all([
    getMarketData(new Request(marketUrl)),
    getEventRadar(new Request(radarUrl)),
  ]);
  const [marketResult, radarResult] = await Promise.all([
    readPayload(marketResponse),
    readPayload(radarResponse),
  ]);

  const contextUrl = new URL("/api/market-context", incoming.origin);
  contextUrl.searchParams.set("code", code);
  const change = Number(marketResult.payload?.quote?.changePercent);
  if (Number.isFinite(change)) contextUrl.searchParams.set("change", change.toFixed(4));
  const contextResult = await readPayload(await getMarketContext(new Request(contextUrl)));
  const errors = [
    marketResult.error && `行情：${marketResult.error}`,
    contextResult.error && `市场环境：${contextResult.error}`,
    radarResult.error && `事件雷达：${radarResult.error}`,
  ].filter(Boolean);

  return Response.json({
    fetchedAt: new Date().toISOString(),
    market: marketResult.payload,
    context: contextResult.payload,
    eventRadar: radarResult.payload,
    errors,
  }, {
    status: marketResult.payload || contextResult.payload || radarResult.payload ? 200 : 502,
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}
