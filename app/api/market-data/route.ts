type EastmoneyQuote = {
  f43?: number; f44?: number; f45?: number; f46?: number; f47?: number; f48?: number;
  f57?: string; f58?: string; f60?: number; f169?: number; f170?: number;
};

const quoteFields = "f43,f44,f45,f46,f47,f48,f57,f58,f60,f169,f170";

function secid(code: string) {
  if (!/^\d{6}$/.test(code)) throw new Error("股票代码必须是 6 位数字");
  return `${code.startsWith("6") ? "1" : "0"}.${code}`;
}

function number(value: unknown, scale = 1) {
  return typeof value === "number" && Number.isFinite(value) ? value / scale : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.trim() ?? "";

  try {
    const id = secid(code);
    const quoteUrl = `https://push2.eastmoney.com/api/qt/stock/get?secid=${id}&fields=${quoteFields}`;
    const klineUrl = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${id}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&lmt=180&end=20500101`;
    const [quoteResponse, klineResponse] = await Promise.all([fetch(quoteUrl), fetch(klineUrl)]);
    if (!quoteResponse.ok || !klineResponse.ok) throw new Error("行情服务暂不可用");
    const quotePayload = await quoteResponse.json() as { data?: EastmoneyQuote };
    const klinePayload = await klineResponse.json() as { data?: { klines?: string[] } };
    const quote = quotePayload.data;
    const rows = klinePayload.data?.klines ?? [];
    if (!quote || rows.length < 2) throw new Error("未取得足够行情数据");

    const bars = rows.map((row) => {
      const [date, open, close, high, low, volume, amount] = row.split(",");
      return { date, open: Number(open), close: Number(close), high: Number(high), low: Number(low), volume: Number(volume), amount: Number(amount) };
    }).filter((bar) => Number.isFinite(bar.close));

    return Response.json({
      provider: "eastmoney-public",
      delayed: true,
      fetchedAt: new Date().toISOString(),
      quote: {
        code: quote.f57 ?? code,
        name: quote.f58 ?? code,
        price: number(quote.f43, 100), previousClose: number(quote.f60, 100),
        change: number(quote.f169, 100), changePercent: number(quote.f170, 100),
        open: number(quote.f46, 100), high: number(quote.f44, 100), low: number(quote.f45, 100),
        volume: number(quote.f47), amount: number(quote.f48),
      },
      bars,
    }, { headers: { "Cache-Control": "public, max-age=30, s-maxage=30" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "行情请求失败" }, { status: 502 });
  }
}
