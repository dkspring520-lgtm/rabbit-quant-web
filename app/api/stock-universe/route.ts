type EastmoneyStock = {
  f12?: string;
  f13?: number;
  f14?: string;
  f100?: string;
};

type StockUniverseItem = {
  code: string;
  name: string;
  industry: string;
  market: "沪市" | "深市" | "北交所";
};

const representativeFallback: StockUniverseItem[] = [
  ["601899", "紫金矿业", "有色金属"], ["603993", "洛阳钼业", "有色金属"], ["601012", "隆基绿能", "电力设备"],
  ["000063", "中兴通讯", "通信"], ["600519", "贵州茅台", "食品饮料"], ["600036", "招商银行", "银行"],
  ["000333", "美的集团", "家用电器"], ["300750", "宁德时代", "电力设备"], ["601318", "中国平安", "非银金融"],
  ["600276", "恒瑞医药", "医药生物"], ["002415", "海康威视", "计算机"], ["600900", "长江电力", "公用事业"],
  ["601088", "中国神华", "煤炭"], ["600030", "中信证券", "非银金融"], ["601166", "兴业银行", "银行"],
  ["600887", "伊利股份", "食品饮料"], ["600309", "万华化学", "基础化工"], ["600031", "三一重工", "机械设备"],
  ["601668", "中国建筑", "建筑装饰"], ["600050", "中国联通", "通信"], ["600028", "中国石化", "石油石化"],
  ["601857", "中国石油", "石油石化"], ["600438", "通威股份", "电力设备"], ["600690", "海尔智家", "家用电器"],
  ["000651", "格力电器", "家用电器"], ["000858", "五粮液", "食品饮料"], ["000001", "平安银行", "银行"],
  ["000725", "京东方A", "电子"], ["002594", "比亚迪", "汽车"], ["002230", "科大讯飞", "计算机"],
  ["002714", "牧原股份", "农林牧渔"], ["300059", "东方财富", "非银金融"], ["300015", "爱尔眼科", "医药生物"],
  ["300124", "汇川技术", "机械设备"], ["688981", "中芯国际", "电子"], ["688008", "澜起科技", "电子"],
].map(([code, name, industry]) => ({ code, name, industry, market: code.startsWith("6") ? "沪市" : "深市" } as StockUniverseItem));

const universeHeaders = {
  "Cache-Control": "public, max-age=1800, s-maxage=21600, stale-while-revalidate=86400",
  "CDN-Cache-Control": "public, max-age=21600, stale-while-revalidate=86400",
  "Cloudflare-CDN-Cache-Control": "public, max-age=21600, stale-while-revalidate=86400",
};

function isTradableAShareCode(code: string) {
  return /^(?:60[0135]\d{3}|68\d{4}|00[0123]\d{3}|30[01]\d{3}|[48]\d{5}|920\d{3})$/.test(code);
}

function marketOf(code: string, marketId?: number): StockUniverseItem["market"] {
  if (code.startsWith("4") || code.startsWith("8") || code.startsWith("920")) return "北交所";
  return marketId === 1 || code.startsWith("6") ? "沪市" : "深市";
}

async function loadEastmoneyUniverse() {
  const query = new URLSearchParams({
    pn: "1", pz: "6000", po: "1", np: "1", fltt: "2", invt: "2", fid: "f3",
    fs: "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048",
    fields: "f12,f13,f14,f100",
  });
  const upstreams = [
    "https://push2.eastmoney.com",
    "https://push2delay.eastmoney.com",
    "https://82.push2.eastmoney.com",
  ];
  let payload: { data?: { diff?: EastmoneyStock[] } } | null = null;
  let lastError: unknown;
  for (const upstream of upstreams) {
    try {
      const response = await fetch(`${upstream}/api/qt/clist/get?${query}`, {
        signal: AbortSignal.timeout(12_000),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SmartTUniverse/1.0)",
          Referer: "https://quote.eastmoney.com/center/gridlist.html",
          Accept: "application/json,text/plain,*/*",
        },
      });
      if (!response.ok) throw new Error(`全A股列表返回 ${response.status}`);
      const candidate = await response.json() as { data?: { diff?: EastmoneyStock[] } };
      if ((candidate.data?.diff?.length ?? 0) < 3_000) throw new Error("全A股列表返回不完整");
      payload = candidate;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!payload) throw lastError instanceof Error ? lastError : new Error("全A股列表暂不可用");
  const stocks = (payload.data?.diff ?? []).flatMap(item => {
    const code = String(item.f12 ?? "").trim();
    const name = String(item.f14 ?? "").trim();
    if (!isTradableAShareCode(code) || !name || /退市|退$/.test(name)) return [];
    return [{ code, name, industry: String(item.f100 || "未分类"), market: marketOf(code, item.f13) } satisfies StockUniverseItem];
  });
  const unique = [...new Map(stocks.map(item => [item.code, item])).values()];
  if (unique.length < 3_000) throw new Error(`全A股列表数量异常：${unique.length}`);
  return unique;
}

export async function GET() {
  try {
    const stocks = await loadEastmoneyUniverse();
    return Response.json({ provider: "eastmoney-public", total: stocks.length, fallback: false, fetchedAt: new Date().toISOString(), stocks }, { headers: universeHeaders });
  } catch (error) {
    return Response.json({
      provider: "representative-fallback", total: representativeFallback.length, fallback: true,
      fetchedAt: new Date().toISOString(), warning: error instanceof Error ? error.message : "全A股列表暂不可用", stocks: representativeFallback,
    }, { headers: { "Cache-Control": "no-store", "CDN-Cache-Control": "no-store", "Cloudflare-CDN-Cache-Control": "no-store", "X-Stock-Universe-Fallback": "1" } });
  }
}
