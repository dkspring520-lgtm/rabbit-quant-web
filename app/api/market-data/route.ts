type Quote = {
  code: string; name: string; price: number | null; previousClose: number | null;
  change: number | null; changePercent: number | null; open: number | null;
  high: number | null; low: number | null; volume: number | null; amount: number | null;
};

type EastmoneyQuote = { f43?: number; f44?: number; f45?: number; f46?: number; f47?: number; f48?: number; f57?: string; f58?: string; f60?: number; f169?: number; f170?: number; };
const quoteFields = "f43,f44,f45,f46,f47,f48,f57,f58,f60,f169,f170";

function number(value: unknown, scale = 1) { return typeof value === "number" && Number.isFinite(value) ? value / scale : null; }
function numeric(value: string | undefined) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function validCode(code: string) { if (!/^\d{6}$/.test(code)) throw new Error("股票代码必须是 6 位数字"); return code; }
function marketPrefix(code: string) { return code.startsWith("6") ? "sh" : code.startsWith("4") || code.startsWith("8") ? "bj" : "sz"; }
function sourceTime(value: string | undefined) { return value && /^\d{14}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+08:00` : null; }
function isUsable(quote: Quote) { return quote.price !== null && quote.name.length > 0; }

async function fromTencent(code: string): Promise<{ provider: string; quote: Quote; sourceTimestamp: string | null }> {
  const response = await fetch(`https://qt.gtimg.cn/q=${marketPrefix(code)}${code}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SmartTMonitor/1.0)" } });
  if (!response.ok) throw new Error("腾讯行情不可用");
  const fields = (await response.text()).match(/="([^"]*)"/)?.[1]?.split("~");
  if (!fields || fields.length < 35) throw new Error("腾讯行情返回无效");
  const quote = { code: fields[2] || code, name: fields[1] || "", price: numeric(fields[3]), previousClose: numeric(fields[4]), open: numeric(fields[5]), volume: numeric(fields[6]), change: numeric(fields[31]), changePercent: numeric(fields[32]), high: numeric(fields[33]), low: numeric(fields[34]), amount: null };
  if (!isUsable(quote)) throw new Error("腾讯行情无有效价格");
  return { provider: "tencent-public", quote, sourceTimestamp: sourceTime(fields[30]) };
}

async function fromSina(code: string): Promise<{ provider: string; quote: Quote; sourceTimestamp: string | null }> {
  const response = await fetch(`https://hq.sinajs.cn/list=${marketPrefix(code)}${code}`, { headers: { Referer: "https://finance.sina.com.cn/" } });
  if (!response.ok) throw new Error("新浪行情不可用");
  const fields = (await response.text()).match(/="([^"]*)"/)?.[1]?.split(",");
  if (!fields || fields.length < 33) throw new Error("新浪行情返回无效");
  const previousClose = numeric(fields[2]); const price = numeric(fields[3]);
  const quote = { code, name: fields[0] || "", price, previousClose, open: numeric(fields[1]), high: numeric(fields[4]), low: numeric(fields[5]), volume: numeric(fields[8]), amount: numeric(fields[9]), change: price !== null && previousClose !== null ? price - previousClose : null, changePercent: price !== null && previousClose ? (price - previousClose) / previousClose * 100 : null };
  if (!isUsable(quote)) throw new Error("新浪行情无有效价格");
  return { provider: "sina-public", quote, sourceTimestamp: fields[30] && fields[31] ? `${fields[30]}T${fields[31]}+08:00` : null };
}

async function fromEastmoneyQuote(code: string): Promise<{ provider: string; quote: Quote; sourceTimestamp: null }> {
  const secid = `${code.startsWith("6") ? "1" : "0"}.${code}`;
  const response = await fetch(`https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=${quoteFields}`);
  const data = (await response.json() as { data?: EastmoneyQuote }).data;
  if (!response.ok || !data) throw new Error("东方财富行情不可用");
  const quote = { code: data.f57 ?? code, name: data.f58 ?? "", price: number(data.f43, 100), previousClose: number(data.f60, 100), change: number(data.f169, 100), changePercent: number(data.f170, 100), open: number(data.f46, 100), high: number(data.f44, 100), low: number(data.f45, 100), volume: number(data.f47), amount: number(data.f48) };
  if (!isUsable(quote)) throw new Error("东方财富行情无有效价格");
  return { provider: "eastmoney-public", quote, sourceTimestamp: null };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.trim() ?? "";
  const mode = searchParams.get("mode");
  try {
    validCode(code);
    if (mode === "trial-realtime") {
      const providers = [fromTencent, fromSina, fromEastmoneyQuote];
      let lastError: unknown;
      for (const provider of providers) {
        try {
          const data = await provider(code);
          return Response.json({ ...data, delayed: true, trial: true, fallbackOrder: ["tencent-public", "sina-public", "eastmoney-public"], fetchedAt: new Date().toISOString(), bars: [] }, { headers: { "Cache-Control": "no-store, max-age=0" } });
        } catch (error) { lastError = error; }
      }
      throw lastError instanceof Error ? lastError : new Error("所有试用行情源暂不可用");
    }
    const [quoteResult, klineResponse] = await Promise.all([fromEastmoneyQuote(code), fetch(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${code.startsWith("6") ? "1" : "0"}.${code}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&lmt=180&end=20500101`)]);
    if (!klineResponse.ok) throw new Error("日线服务暂不可用");
    const rows = (await klineResponse.json() as { data?: { klines?: string[] } }).data?.klines ?? [];
    const bars = rows.map((row) => { const [date, open, close, high, low, volume, amount] = row.split(","); return { date, open: Number(open), close: Number(close), high: Number(high), low: Number(low), volume: Number(volume), amount: Number(amount) }; }).filter((bar) => Number.isFinite(bar.close));
    if (bars.length < 2) throw new Error("未取得足够日线数据");
    return Response.json({ ...quoteResult, delayed: true, fetchedAt: new Date().toISOString(), bars }, { headers: { "Cache-Control": "public, max-age=30, s-maxage=30" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "行情请求失败" }, { status: 502 }); }
}
