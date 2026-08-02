import { GET as getEventRadar } from "@/app/api/event-radar/route";
import { GET as getMarketContext } from "@/app/api/market-context/route";
import { GET as getMarketData } from "@/app/api/market-data/route";
import { GET as getZijinHkMinute } from "@/app/api/zijin-hk-minute/route";

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
  const includeMarket = incoming.searchParams.get("market") !== "0";
  const radarUrl = new URL("/api/event-radar", incoming.origin);
  radarUrl.searchParams.set("codes", incoming.searchParams.get("codes") ?? code);
  radarUrl.searchParams.set("names", incoming.searchParams.get("names") ?? code);

  const [marketResponse, radarResponse, hkResponse] = await Promise.all([
    includeMarket ? getMarketData(new Request(marketUrl)) : Promise.resolve(null),
    getEventRadar(new Request(radarUrl)),
    code === "601899" ? getZijinHkMinute() : Promise.resolve(null),
  ]);
  const [marketResult, radarResult, hkResult] = await Promise.all([
    marketResponse ? readPayload(marketResponse) : Promise.resolve({ payload:null, error:null }),
    readPayload(radarResponse),
    hkResponse ? readPayload(hkResponse) : Promise.resolve({ payload:null, error:null }),
  ]);

  const contextUrl = new URL("/api/market-context", incoming.origin);
  contextUrl.searchParams.set("code", code);
  const suppliedChangeValue = incoming.searchParams.get("change");
  const suppliedChange = suppliedChangeValue === null ? Number.NaN : Number(suppliedChangeValue);
  const change = Number.isFinite(suppliedChange)
    ? suppliedChange
    : Number(marketResult.payload?.quote?.changePercent);
  if (Number.isFinite(change)) contextUrl.searchParams.set("change", change.toFixed(4));
  const contextResult = await readPayload(await getMarketContext(new Request(contextUrl)));
  const errors = [
    marketResult.error && `行情：${marketResult.error}`,
    contextResult.error && `市场环境：${contextResult.error}`,
    radarResult.error && `事件雷达：${radarResult.error}`,
    hkResult.error && `港股紫金：${hkResult.error}`,
  ].filter(Boolean);

  return Response.json({
    fetchedAt: new Date().toISOString(),
    market: marketResult.payload,
    context: contextResult.payload,
    eventRadar: radarResult.payload,
    zijinHk: hkResult.payload,
    errors,
  }, {
    status: marketResult.payload || contextResult.payload || radarResult.payload ? 200 : 502,
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}
