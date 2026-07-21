type Quote = {
  code: string; name: string; price: number | null; previousClose: number | null;
  change: number | null; changePercent: number | null; open: number | null;
  high: number | null; low: number | null; volume: number | null; amount: number | null;
};
type MinutePoint = { time: string; price: number; volume: number };
type IntradaySession = { date: string; previousClose: number | null; minutes: MinutePoint[] };

type EastmoneyQuote = { f43?: number; f44?: number; f45?: number; f46?: number; f47?: number; f48?: number; f57?: string; f58?: string; f60?: number; f169?: number; f170?: number; };
const quoteFields = "f43,f44,f45,f46,f47,f48,f57,f58,f60,f169,f170";

const realtimeHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  Expires: "0",
};

const closedMarketHeaders = {
  "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
  "CDN-Cache-Control": "public, max-age=300, stale-while-revalidate=600",
  "Cloudflare-CDN-Cache-Control": "public, max-age=300, stale-while-revalidate=600",
};

function isMainlandMarketRealtimeWindow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  // Include call auction and Shenzhen after-hours fixed-price trading. A holiday
  // may still enter this branch, which only disables caching and is harmless.
  return minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
}

function number(value: unknown, scale = 1) { return typeof value === "number" && Number.isFinite(value) ? value / scale : null; }
function numeric(value: string | undefined) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function validCode(code: string) { if (!/^\d{6}$/.test(code)) throw new Error("股票代码必须是 6 位数字"); return code; }
function marketPrefix(code: string) { return code.startsWith("6") ? "sh" : code.startsWith("4") || code.startsWith("8") || code.startsWith("9") ? "bj" : "sz"; }
function sourceTime(value: string | undefined) { return value && /^\d{14}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+08:00` : null; }
function isUsable(quote: Quote) { return quote.price !== null && quote.name.length > 0 && !/[\u0080-\u009f\uFFFD]/.test(quote.name); }

async function fromTencent(code: string): Promise<{ provider: string; quote: Quote; sourceTimestamp: string | null }> {
  const response = await fetch(`https://qt.gtimg.cn/q=${marketPrefix(code)}${code}`, { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0 (compatible; SmartTMonitor/1.0)" } });
  if (!response.ok) throw new Error("腾讯行情不可用");
  const bytes = await response.arrayBuffer();
  // Tencent currently returns UTF-8 from some edges and GB18030 from others.
  // A fatal UTF-8 pass lets us distinguish the two without turning valid
  // Chinese names into mojibake such as "ç´«é‡‘çŸ¿ä¸š".
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { text = new TextDecoder("gb18030").decode(bytes); }
  const fields = text.match(/="([^"]*)"/)?.[1]?.split("~");
  if (!fields || fields.length < 35) throw new Error("腾讯行情返回无效");
  const quote = { code: fields[2] || code, name: fields[1] || "", price: numeric(fields[3]), previousClose: numeric(fields[4]), open: numeric(fields[5]), volume: numeric(fields[6]), change: numeric(fields[31]), changePercent: numeric(fields[32]), high: numeric(fields[33]), low: numeric(fields[34]), amount: null };
  if (!isUsable(quote)) throw new Error("腾讯行情无有效价格");
  return { provider: "tencent-public", quote, sourceTimestamp: sourceTime(fields[30]) };
}

async function fromTencentMinutes(code: string): Promise<MinutePoint[]> {
  const response = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${marketPrefix(code)}${code}`, { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0 (compatible; SmartTMonitor/1.0)" } });
  if (!response.ok) throw new Error("腾讯分时不可用");
  const payload = await response.json() as { data?: Record<string, { data?: { data?: string[] } }> };
  const rows = payload.data?.[`${marketPrefix(code)}${code}`]?.data?.data ?? [];
  let previousVolume = 0;
  return rows.map((row) => {
    const [time, rawPrice, rawVolume] = row.split(" ");
    const price = Number(rawPrice); const cumulativeVolume = Number(rawVolume);
    const volume = Number.isFinite(cumulativeVolume) ? Math.max(0, cumulativeVolume - previousVolume) : 0;
    previousVolume = Number.isFinite(cumulativeVolume) ? cumulativeVolume : previousVolume;
    return { time, price, volume };
  }).filter((point) => /^\d{4}$/.test(point.time) && Number.isFinite(point.price));
}

async function fromTencentIntradaySessions(code: string): Promise<IntradaySession[]> {
  const symbol = `${marketPrefix(code)}${code}`;
  const response = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/day/query?code=${symbol}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SmartTMonitor/1.0)" } });
  if (!response.ok) throw new Error("腾讯多日分时不可用");
  const payload = await response.json() as { data?: Record<string, { data?: { date?: string; data?: string[] }[] }> };
  const days = payload.data?.[symbol]?.data ?? [];
  return days.flatMap((day, index) => {
    let previousVolume = 0;
    const minutes = (day.data ?? []).map((row) => {
      const [time, rawPrice, rawVolume] = row.split(" ");
      const price = Number(rawPrice); const cumulativeVolume = Number(rawVolume);
      const volume = Number.isFinite(cumulativeVolume) ? Math.max(0, cumulativeVolume - previousVolume) : 0;
      previousVolume = Number.isFinite(cumulativeVolume) ? cumulativeVolume : previousVolume;
      return { time, price, volume };
    }).filter((point) => /^\d{4}$/.test(point.time) && Number.isFinite(point.price) && point.price > 0 && point.time <= "1500");
    const previousRows = days[index + 1]?.data ?? [];
    const previousClose = numeric(previousRows.at(-1)?.split(" ")[1]);
    // The current trading day may stop at 11:30/now. Only expose sessions that
    // reached the closing window so a replay cannot mistake a partial day for
    // an end-of-day forced close.
    if (!day.date || minutes.length < 180 || minutes.at(-1)!.time < "1450") return [];
    return [{ date: day.date, previousClose, minutes }];
  });
}

async function fromEastmoneyMinutes(code: string): Promise<MinutePoint[]> {
  const secid = `${code.startsWith("6") ? "1" : "0"}.${code}`;
  const response = await fetch(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56&klt=1&fqt=0&beg=0&end=20500101&lmt=500`, { cache: "no-store" });
  const payload = await response.json() as { data?: { klines?: string[] } };
  const rows = payload.data?.klines ?? [];
  const datedPoints = rows.map((row) => {
    const [timestamp, , close, , , volume] = row.split(",");
    return { date: timestamp.slice(0, 10), time: timestamp.slice(-5).replace(":", ""), price: Number(close), volume: Number(volume) };
  }).filter((point) => /^\d{4}$/.test(point.time) && Number.isFinite(point.price) && point.price > 0);
  const latestDate = datedPoints.at(-1)?.date;
  const points = datedPoints.filter((point) => point.date === latestDate).map(({ time, price, volume }) => ({ time, price, volume }));
  if (!response.ok || points.length < 2) throw new Error("东方财富分时不可用");
  return points;
}

async function fromEastmoneyIntradaySessions(code: string): Promise<IntradaySession[]> {
  const secid = `${code.startsWith("6") ? "1" : "0"}.${code}`;
  const response = await fetch(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56&klt=1&fqt=0&beg=0&end=20500101&lmt=1500`);
  const payload = await response.json() as { data?: { klines?: string[] } };
  if (!response.ok) throw new Error("东方财富多日分时不可用");
  const grouped = new Map<string, MinutePoint[]>();
  for (const row of payload.data?.klines ?? []) {
    const [timestamp, , close, , , volume] = row.split(",");
    const date = timestamp?.slice(0, 10); const time = timestamp?.slice(-5).replace(":", "");
    const point = { time, price: Number(close), volume: Number(volume) };
    if (!date || !/^\d{4}$/.test(time) || !Number.isFinite(point.price) || point.price <= 0) continue;
    grouped.set(date, [...(grouped.get(date) ?? []), point]);
  }
  const dates = [...grouped.keys()].sort();
  return dates.flatMap((date, index) => {
    const minutes = grouped.get(date)!;
    if (minutes.length < 180 || minutes.at(-1)!.time < "1450") return [];
    const previousDate = dates[index - 1];
    const previousClose = previousDate ? grouped.get(previousDate)?.at(-1)?.price ?? null : null;
    return [{ date: date.replaceAll("-", ""), previousClose, minutes }];
  });
}

async function fromPublicMinutes(code: string) {
  try { return await fromTencentMinutes(code); }
  catch { return fromEastmoneyMinutes(code); }
}

async function fromTencentDailyBars(code: string) {
  const response = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${marketPrefix(code)}${code},day,,,180,qfq`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SmartTMonitor/1.0)" } });
  if (!response.ok) throw new Error("腾讯日线不可用");
  const payload = await response.json() as { data?: Record<string, { qfqday?: string[][] }> };
  const rows = payload.data?.[`${marketPrefix(code)}${code}`]?.qfqday ?? [];
  const bars = rows.map(([date, open, close, high, low, volume]) => ({ date, open: Number(open), close: Number(close), high: Number(high), low: Number(low), volume: Number(volume), amount: 0 })).filter((bar) => Number.isFinite(bar.close));
  if (bars.length < 2) throw new Error("未取得足够日线数据");
  return bars;
}

async function fromSina(code: string): Promise<{ provider: string; quote: Quote; sourceTimestamp: string | null }> {
  const response = await fetch(`https://hq.sinajs.cn/list=${marketPrefix(code)}${code}`, { cache: "no-store", headers: { Referer: "https://finance.sina.com.cn/" } });
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
  const response = await fetch(`https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=${quoteFields}`, { cache: "no-store" });
  const data = (await response.json() as { data?: EastmoneyQuote }).data;
  if (!response.ok || !data) throw new Error("东方财富行情不可用");
  const quote = { code: data.f57 ?? code, name: data.f58 ?? "", price: number(data.f43, 100), previousClose: number(data.f60, 100), change: number(data.f169, 100), changePercent: number(data.f170, 100), open: number(data.f46, 100), high: number(data.f44, 100), low: number(data.f45, 100), volume: number(data.f47), amount: number(data.f48) };
  if (!isUsable(quote)) throw new Error("东方财富行情无有效价格");
  return { provider: "eastmoney-public", quote, sourceTimestamp: null };
}

async function fromPublicQuote(code: string) {
  let lastError: unknown;
  for (const provider of [fromTencent, fromSina, fromEastmoneyQuote]) {
    try { return await provider(code); }
    catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("All public quote providers are unavailable");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.trim() ?? "";
  const mode = searchParams.get("mode");
  try {
    validCode(code);
    if (mode === "trial-quote") {
      const data = await fromPublicQuote(code);
      return Response.json({
        ...data,
        minutes: [],
        intradaySessions: [],
        delayed: true,
        trial: true,
        fallbackOrder: ["tencent-public", "sina-public", "eastmoney-public"],
        fetchedAt: new Date().toISOString(),
        bars: [],
      }, { headers: realtimeHeaders });
    }
    if (mode === "trial-realtime") {
      const minutesPromise = fromPublicMinutes(code).catch(() => []);
      const [data, minutes] = await Promise.all([fromPublicQuote(code), minutesPromise]);
      return Response.json({ ...data, minutes, delayed: true, trial: true, fallbackOrder: ["tencent-public", "sina-public", "eastmoney-public"], fetchedAt: new Date().toISOString(), bars: [] }, { headers: realtimeHeaders });
    }
    const [bars, quoteResult, minutes, intradaySessions] = await Promise.all([
      fromTencentDailyBars(code).catch(() => []),
      fromTencent(code).catch(() => fromSina(code).catch(() => fromEastmoneyQuote(code).catch(() => null))),
      fromPublicMinutes(code).catch(() => []),
      fromTencentIntradaySessions(code).then(sessions => sessions.length ? sessions : fromEastmoneyIntradaySessions(code)).catch(() => fromEastmoneyIntradaySessions(code).catch(() => [])),
    ]);
    const latest = bars.at(-1);
    if (!quoteResult && !latest) throw new Error("所有公开行情源暂不可用");
    const fallbackQuote: Quote = { code, name: code, price: latest?.close ?? null, previousClose: bars.at(-2)?.close ?? null, change: latest ? latest.close - (bars.at(-2)?.close ?? latest.close) : null, changePercent: latest && bars.at(-2)?.close ? (latest.close - bars.at(-2)!.close) / bars.at(-2)!.close * 100 : null, open: latest?.open ?? null, high: latest?.high ?? null, low: latest?.low ?? null, volume: latest?.volume ?? null, amount: latest?.amount ?? null };
    const headers = mode === "realtime" || isMainlandMarketRealtimeWindow() ? realtimeHeaders : closedMarketHeaders;
    return Response.json({ provider: quoteResult?.provider ?? "tencent-public", quote: quoteResult?.quote ?? fallbackQuote, sourceTimestamp: quoteResult?.sourceTimestamp ?? null, minutes, intradaySessions, delayed: true, fetchedAt: new Date().toISOString(), bars }, { headers });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "行情请求失败" }, { status: 502, headers: realtimeHeaders }); }
}
