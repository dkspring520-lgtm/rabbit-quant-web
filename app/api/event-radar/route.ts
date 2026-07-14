import { classifyEvent, dedupeRelatedEvents, evaluateEventGate, stripEventMarkup } from "@/lib/event-radar.mjs";

type RawEvent = {
  id: string; code: string; title: string; summary: string; url: string; source: string;
  provider: string; official: boolean; publishedAt: string;
};

const withTimeout = (milliseconds = 7_000) => AbortSignal.timeout(milliseconds);

function parseStocks(searchParams: URLSearchParams) {
  const codes = (searchParams.get("codes") ?? "").split(",").map(value => value.trim()).filter(value => /^\d{6}$/.test(value));
  const names = (searchParams.get("names") ?? "").split(",").map(value => stripEventMarkup(value.trim()));
  return [...new Set(codes)].slice(0, 10).map((code, index) => ({ code, name: names[index] || code }));
}

function dateInShanghai(offsetDays: number) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

async function loadCninfo(code: string): Promise<RawEvent[]> {
  const body = new URLSearchParams({
    pageNum: "1", pageSize: "8", column: code.startsWith("6") ? "sse" : "szse", tabName: "fulltext",
    plate: "", stock: "", searchkey: code, secid: "", category: "", trade: "",
    seDate: `${dateInShanghai(-3)}~${dateInShanghai(0)}`, sortName: "", sortType: "", isHLtitle: "true",
  });
  const response = await fetch("https://www.cninfo.com.cn/new/hisAnnouncement/query", {
    method: "POST", body, signal: withTimeout(),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SmartTRadar/1.0)", Referer: "https://www.cninfo.com.cn/", "X-Requested-With": "XMLHttpRequest" },
  });
  if (!response.ok) throw new Error("巨潮资讯公告暂不可用");
  const data = await response.json() as { announcements?: Array<{ announcementId:string; secCode:string; announcementTitle:string; announcementTime:number; adjunctUrl:string }> };
  return (data.announcements ?? []).filter(item => item.secCode === code).map(item => ({
    id: `cninfo-${item.announcementId}`, code, title: stripEventMarkup(item.announcementTitle), summary: "上市公司法定披露公告",
    url: `https://static.cninfo.com.cn/${item.adjunctUrl}`, source: "巨潮资讯", provider: "cninfo-official", official: true,
    publishedAt: new Date(item.announcementTime).toISOString(),
  }));
}

async function loadSinaNews(code: string, name: string): Promise<RawEvent[]> {
  const response = await fetch(`https://search.sina.com.cn/api/news?q=${encodeURIComponent(name)}`, {
    signal: withTimeout(), headers: { "User-Agent": "Mozilla/5.0 (compatible; SmartTRadar/1.0)", Referer: "https://search.sina.com.cn/" },
  });
  if (!response.ok) throw new Error("公开财经资讯暂不可用");
  const data = await response.json() as { data?: { list?: Array<{ dataid:string; title:string; intro?:string; searchSummary?:string; media_show?:string; ctime:number; url:string }> } };
  return (data.data?.list ?? []).slice(0, 8).map(item => ({
    id: `sina-${item.dataid}`, code, title: stripEventMarkup(item.title), summary: stripEventMarkup(item.searchSummary || item.intro || ""),
    url: item.url, source: stripEventMarkup(item.media_show || "新浪财经聚合"), provider: "sina-search-public", official: false,
    publishedAt: new Date(item.ctime * 1_000).toISOString(),
  }));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const stocks = parseStocks(searchParams);
  if (!stocks.length) return Response.json({ error: "至少需要一个 6 位股票代码" }, { status: 400 });
  const now = Date.now();
  const errors: string[] = [];
  const results = await Promise.all(stocks.map(async stock => {
    const [announcements, news] = await Promise.allSettled([loadCninfo(stock.code), loadSinaNews(stock.code, stock.name)]);
    if (announcements.status === "rejected") errors.push(`${stock.code} ${announcements.reason instanceof Error ? announcements.reason.message : "公告请求失败"}`);
    if (news.status === "rejected") errors.push(`${stock.code} ${news.reason instanceof Error ? news.reason.message : "资讯请求失败"}`);
    const raw = [
      ...(announcements.status === "fulfilled" ? announcements.value : []),
      ...(news.status === "fulfilled" ? news.value : []),
    ];
    const classified = raw.map(item => ({ ...item, ...classifyEvent({ ...item, now }) }))
      .filter(item => item.ageHours <= 72)
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
    const items = dedupeRelatedEvents(classified).slice(0, 12);
    const gate = evaluateEventGate(items);
    return {
      ...stock, items, gate,
      counts: {
        positive: items.filter(item => item.sentiment === "positive").length,
        negative: items.filter(item => item.sentiment === "negative").length,
        neutral: items.filter(item => item.sentiment === "neutral").length,
      },
    };
  }));
  return Response.json({
    fetchedAt: new Date(now).toISOString(), scanned: results.length, requested: stocks.length, pollSeconds: 60,
    sources: ["巨潮资讯（法定公告）", "新浪财经公开搜索（聚合资讯）"], stocks: results, errors,
  }, { headers: { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=120" } });
}
