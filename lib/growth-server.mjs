import fs from "node:fs";
import path from "node:path";

const DEFAULT_KEYWORDS = [
  "VWAP 怎么看",
  "股票成本越来越高怎么办",
  "股票被套怎么办",
  "股票怎么做T",
  "T+0技巧",
  "做T降低成本",
  "底仓做T怎么做",
  "做T手续费怎么算",
  "做T失败怎么办",
  "日内波段怎么控制风险",
];

const contentPath = process.env.GROWTH_CONTENT_PATH
  || (process.env.NODE_ENV === "production"
    ? "/training-state/growth-content.json"
    : path.join(process.cwd(), ".growth-data", "growth-content.json"));

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toKeyword(text, index = 0, source = "seed") {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const intent = normalized.includes("成本") ? "成本管理"
    : normalized.includes("被套") ? "风险处理"
      : normalized.includes("VWAP") ? "指标理解"
        : normalized.includes("手续费") ? "费用计算"
          : normalized.includes("风险") ? "风险管理"
            : "入门教程";
  return {
    id: `kw-${Buffer.from(normalized).toString("base64url").slice(0, 18)}-${index}`,
    text: normalized,
    intent,
    score: Math.max(68, 96 - index * 3),
    source,
  };
}

function defaultContent() {
  return {
    version: 1,
    keywords: DEFAULT_KEYWORDS.map((text, index) => toKeyword(text, index)),
    drafts: [],
    lastRunAt: null,
    lastRunStatus: "idle",
    lastRunError: null,
  };
}

export function readGrowthContent() {
  try {
    const parsed = JSON.parse(fs.readFileSync(contentPath, "utf8"));
    return {
      ...defaultContent(),
      ...parsed,
      keywords: Array.isArray(parsed?.keywords) && parsed.keywords.length ? parsed.keywords : defaultContent().keywords,
      drafts: Array.isArray(parsed?.drafts) ? parsed.drafts : [],
    };
  } catch {
    return defaultContent();
  }
}

export function writeGrowthContent(content) {
  fs.mkdirSync(path.dirname(contentPath), { recursive: true });
  const temporaryPath = `${contentPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, contentPath);
  return content;
}

function parseBaiduSuggestion(body) {
  const start = body.indexOf("(");
  const end = body.lastIndexOf(")");
  if (start < 0 || end <= start) return [];
  try {
    const payload = JSON.parse(body.slice(start + 1, end));
    return Array.isArray(payload?.s) ? payload.s : [];
  } catch {
    return [];
  }
}

async function fetchSuggestions(seed) {
  const url = `https://suggestion.baidu.com/su?wd=${encodeURIComponent(seed)}&json=1`;
  const response = await fetch(url, {
    headers: { "user-agent": "RabbitGrowthAI/1.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`百度关键词接口返回 ${response.status}`);
  const body = new TextDecoder("gb18030").decode(await response.arrayBuffer());
  return parseBaiduSuggestion(body);
}

export async function collectGrowthKeywords(limit = 10) {
  const seeds = ["股票做T", "VWAP 股票", "降低股票成本", "股票被套", "T+0技巧"];
  const suggestions = [];
  const errors = [];
  for (const seed of seeds) {
    try {
      suggestions.push(...await fetchSuggestions(seed));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  const relevant = [...suggestions, ...DEFAULT_KEYWORDS]
    .map((text) => String(text).trim())
    .filter((text) => text && /(股票|做T|VWAP|T\+0|成本|被套|风险)/i.test(text))
    .filter((text, index, all) => all.indexOf(text) === index)
    .slice(0, limit)
    .map((text, index) => toKeyword(text, index, suggestions.includes(text) ? "baidu" : "seed"));
  return { keywords: relevant, errors };
}

function fallbackDraft(keyword) {
  return {
    title: `${keyword.text}：股票做T前要先看懂的三个问题`,
    description: `围绕“${keyword.text}”梳理做T的判断顺序、成本变化与风险边界。`,
    body: `很多人搜索“${keyword.text}”时，真正想解决的不是寻找一个神奇指标，而是判断自己的仓位是否适合做T。第一步，先把底仓、可用仓位、持仓成本和交易费用分开记录。\n\n第二步，观察价格相对VWAP的位置、分时量能和自己的交易计划。价格偏离不等于机会，短线波动也不能替代风险控制。\n\n最后，提前写下做错时的退出条件。双兔助手只帮助你理解自己的交易记录，不提供下单指令，也不承诺收益。`,
    faqs: [
      `${keyword.text}适合所有股票吗？`,
      "做T前需要记录哪些数据？",
      "为什么做T后成本反而上升了？",
    ],
    links: ["/knowledge", "/pricing"],
    generatedBy: "template-fallback",
  };
}

async function generateWithOpenAI(keyword) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return fallbackDraft(keyword);
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const prompt = [
    "你是双兔股票做T知识库的编辑。只输出严格 JSON，不要 Markdown 代码围栏。",
    "字段必须是 title, description, body, faqs, links。body 写 1200-1800 字中文，解释概念和检查步骤，不给出个股买卖建议，不承诺收益。",
    `主题关键词：${keyword.text}`,
    "links 固定包含 /knowledge 和 /pricing；faqs 输出 3 个中文问题。",
  ].join("\n");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "你是严谨的中文财经教育内容编辑。" },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`AI 接口返回 ${response.status}`);
  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content;
  if (!text) throw new Error("AI 没有返回文章内容");
  const parsed = JSON.parse(text);
  return {
    title: String(parsed.title || `${keyword.text}：股票做T知识`),
    description: String(parsed.description || ""),
    body: String(parsed.body || ""),
    faqs: Array.isArray(parsed.faqs) ? parsed.faqs.map(String).slice(0, 5) : [],
    links: ["/knowledge", "/pricing"],
    generatedBy: `openai:${model}`,
  };
}

export async function runGrowthAutomation({ force = false, limit = 10 } = {}) {
  const current = readGrowthContent();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (!force && current.lastRunAt?.slice?.(0, 10) === today && current.lastRunStatus === "success") {
    return { ...current, skipped: true, reason: "今日已经运行过" };
  }
  const collected = await collectGrowthKeywords(limit);
  const keywords = collected.keywords.length ? collected.keywords : current.keywords;
  const selectedKeyword = keywords[0];
  if (!selectedKeyword) throw new Error("没有抓到可用关键词");
  let generated;
  let warning = null;
  try {
    generated = await generateWithOpenAI(selectedKeyword);
    if (generated.generatedBy === "template-fallback") warning = "未配置 OPENAI_API_KEY，已使用安全模板；配置密钥后会生成 AI 长文。";
  } catch (error) {
    generated = fallbackDraft(selectedKeyword);
    warning = error instanceof Error ? `${error.message}；已回退到安全模板。` : "AI 生成失败，已回退到安全模板。";
  }
  const draft = {
    id: makeId("draft"),
    keywordId: selectedKeyword.id,
    keyword: selectedKeyword.text,
    ...generated,
    status: "review",
    createdAt: now.toISOString(),
  };
  const next = {
    ...current,
    keywords,
    drafts: [draft, ...current.drafts].slice(0, 100),
    lastRunAt: now.toISOString(),
    lastRunStatus: "success",
    lastRunError: warning || (collected.errors.length ? collected.errors.join("；") : null),
  };
  writeGrowthContent(next);
  return { ...next, generatedDraft: draft, keywordErrors: collected.errors, warning };
}

export function updateGrowthDraft(draft) {
  const current = readGrowthContent();
  const drafts = current.drafts.some((item) => item.id === draft.id)
    ? current.drafts.map((item) => item.id === draft.id ? { ...item, ...draft } : item)
    : [draft, ...current.drafts];
  return writeGrowthContent({ ...current, drafts });
}
