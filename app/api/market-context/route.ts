import { evaluateMarketContext } from "@/lib/market-context.mjs";
import { parseTencentSourceTimestamp, sinaDomesticReference } from "@/lib/external-source-parsers.mjs";

type ContextGroup = "market" | "sector" | "related" | "cross" | "currency";
type ContextItem = {
  id: string; label: string; group: ContextGroup; price: number | null;
  changePercent: number | null; sourceTimestamp: string | null;
  provider: string; inverse?: boolean;
};

type Profile = {
  name: string;
  tencent: { symbol: string; label: string; group: ContextGroup; inverse?: boolean }[];
  sina?: { symbol: string; label: string; group: ContextGroup; kind: "domestic" | "global" | "fx"; inverse?: boolean }[];
};

const broadMarket: Profile["tencent"] = [
  { symbol: "sh000001", label: "上证指数", group: "market" },
  { symbol: "sh000300", label: "沪深300", group: "market" },
];

const profiles: Record<string, Profile> = {
  "601899": {
    name: "黄金/铜矿",
    tencent: [
      ...broadMarket,
      { symbol: "sh512400", label: "有色金属ETF", group: "sector" },
      { symbol: "sh518880", label: "黄金ETF", group: "related" },
      { symbol: "hk02899", label: "港股紫金矿业", group: "cross" },
    ],
    sina: [
      { symbol: "nf_CU0", label: "沪铜连续", group: "related", kind: "domestic" },
      { symbol: "nf_AU0", label: "沪金连续", group: "related", kind: "domestic" },
      { symbol: "hf_CAD", label: "伦铜", group: "related", kind: "global" },
      { symbol: "hf_GC", label: "纽约黄金", group: "related", kind: "global" },
      { symbol: "fx_susdcny", label: "美元/人民币", group: "currency", kind: "fx", inverse: true },
    ],
  },
  "603993": {
    name: "铜钴矿业",
    tencent: [...broadMarket, { symbol: "sh512400", label: "有色金属ETF", group: "sector" }, { symbol: "hk03993", label: "港股洛阳钼业", group: "cross" }],
    sina: [{ symbol: "nf_CU0", label: "沪铜连续", group: "related", kind: "domestic" }, { symbol: "hf_CAD", label: "伦铜", group: "related", kind: "global" }],
  },
  "601012": { name: "光伏", tencent: [...broadMarket, { symbol: "sh515790", label: "光伏ETF", group: "sector" }], sina: [{ symbol: "nf_SI0", label: "工业硅连续", group: "related", kind: "domestic" }] },
  "000063": { name: "通信科技", tencent: [...broadMarket, { symbol: "sh515000", label: "科技ETF", group: "sector" }, { symbol: "hk00763", label: "港股中兴通讯", group: "cross" }] },
  "600519": { name: "白酒消费", tencent: [...broadMarket, { symbol: "sh512690", label: "酒ETF", group: "sector" }] },
  "002594": { name: "新能源汽车", tencent: [...broadMarket, { symbol: "sh515030", label: "新能源车ETF", group: "sector" }, { symbol: "hk01211", label: "港股比亚迪", group: "cross" }] },
  "601088": { name: "煤炭能源", tencent: [...broadMarket, { symbol: "sh515220", label: "煤炭ETF", group: "sector" }, { symbol: "hk01088", label: "港股中国神华", group: "cross" }] },
};

const fallbackProfile: Profile = { name: "A股通用", tencent: broadMarket };

function validCode(code: string) { if (!/^\d{6}$/.test(code)) throw new Error("股票代码必须是 6 位数字"); return code; }
function numeric(value: string | undefined) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function changePercent(price: number | null, previous: number | null) { return price !== null && previous ? (price - previous) / previous * 100 : null; }
async function responseText(response: Response) {
  const bytes = await response.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("gb18030").decode(bytes); }
}

async function loadTencent(definitions: Profile["tencent"]): Promise<ContextItem[]> {
  const response = await fetch(`https://qt.gtimg.cn/q=${definitions.map(item => item.symbol).join(",")}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SmartTContext/1.0)" } });
  if (!response.ok) throw new Error("腾讯外部行情不可用");
  const text = await responseText(response);
  const rows = new Map<string, string[]>();
  for (const match of text.matchAll(/v_([^=]+)="([^"]*)";/g)) rows.set(match[1], match[2].split("~"));
  return definitions.flatMap((definition) => {
    const fields = rows.get(definition.symbol);
    if (!fields) return [];
    const price = numeric(fields[3]);
    const percent = numeric(fields[32]) ?? changePercent(price, numeric(fields[4]));
    if (price === null || percent === null) return [];
    const sourceTimestamp = parseTencentSourceTimestamp(fields[30] ?? "");
    return [{ id: definition.symbol, label: definition.label, group: definition.group, price, changePercent: percent, sourceTimestamp, provider: "tencent-public", inverse: definition.inverse }];
  });
}

async function loadSina(definitions: NonNullable<Profile["sina"]>): Promise<ContextItem[]> {
  if (!definitions.length) return [];
  const response = await fetch(`https://hq.sinajs.cn/list=${definitions.map(item => item.symbol).join(",")}`, { headers: { Referer: "https://finance.sina.com.cn/", "User-Agent": "Mozilla/5.0 (compatible; SmartTContext/1.0)" } });
  if (!response.ok) throw new Error("新浪关联行情不可用");
  const text = await responseText(response);
  const rows = new Map<string, string[]>();
  for (const match of text.matchAll(/var hq_str_([^=]+)="([^"]*)";/g)) rows.set(match[1], match[2].split(","));
  return definitions.flatMap((definition) => {
    const fields = rows.get(definition.symbol);
    if (!fields?.length) return [];
    let price: number | null = null; let previous: number | null = null; let percent: number | null = null; let sourceTimestamp: string | null = null;
    if (definition.kind === "domestic") {
      price = numeric(fields[8]); previous = sinaDomesticReference(fields);
      sourceTimestamp = fields[17] && /^\d{6}$/.test(fields[1] ?? "") ? `${fields[17]}T${fields[1].slice(0,2)}:${fields[1].slice(2,4)}:${fields[1].slice(4,6)}+08:00` : null;
    } else if (definition.kind === "global") {
      price = numeric(fields[0]); previous = numeric(fields[7]);
      sourceTimestamp = fields[12] && fields[6] ? `${fields[12]}T${fields[6]}+08:00` : null;
    } else {
      price = numeric(fields[1]); percent = numeric(fields[10]);
      sourceTimestamp = fields[17] && fields[0] ? `${fields[17]}T${fields[0]}+08:00` : null;
    }
    percent ??= changePercent(price, previous);
    if (price === null || percent === null) return [];
    return [{ id: definition.symbol, label: definition.label, group: definition.group, price, changePercent: percent, sourceTimestamp, provider: "sina-public", inverse: definition.inverse }];
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = validCode(searchParams.get("code")?.trim() ?? "");
    const stockChange = numeric(searchParams.get("change") ?? undefined);
    const profile = profiles[code] ?? fallbackProfile;
    const [tencentResult, sinaResult] = await Promise.allSettled([loadTencent(profile.tencent), loadSina(profile.sina ?? [])]);
    const items = [
      ...(tencentResult.status === "fulfilled" ? tencentResult.value : []),
      ...(sinaResult.status === "fulfilled" ? sinaResult.value : []),
    ];
    const gate = evaluateMarketContext(items, stockChange);
    const errors = [tencentResult, sinaResult].flatMap(result => result.status === "rejected" ? [result.reason instanceof Error ? result.reason.message : "外部行情请求失败"] : []);
    return Response.json({
      code,
      profile: profile.name,
      fetchedAt: new Date().toISOString(),
      items,
      gate,
      availableSources: [...new Set(items.map(item => item.provider))],
      errors,
      events: { status: "separate-radar", label: "公告与新闻由监控名单事件雷达独立扫描", participatesInGate: true },
    }, { headers: { "Cache-Control": "public, max-age=10, s-maxage=10" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "外部环境雷达请求失败" }, { status: 400 });
  }
}
