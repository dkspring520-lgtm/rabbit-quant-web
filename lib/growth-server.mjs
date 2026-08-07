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
const defaultBaiduSite = "https://www.zhuandianmi.com";
const defaultBaiduEndpoint = "http://data.zz.baidu.com/urls";

function getBaiduConfig() {
  const site = String(process.env.BAIDU_SUBMIT_SITE || defaultBaiduSite).trim().replace(/\/$/, "");
  const token = String(process.env.BAIDU_SUBMIT_TOKEN || "").trim();
  const endpoint = String(process.env.BAIDU_SUBMIT_ENDPOINT || defaultBaiduEndpoint).trim();
  return { site, token, endpoint };
}

async function submitBaiduUrl(url) {
  const { site, token, endpoint } = getBaiduConfig();
  const submittedAt = new Date().toISOString();
  if (!token) {
    return { status: "skipped", url, reason: "missing_token", submittedAt };
  }

  try {
    const requestUrl = new URL(endpoint);
    requestUrl.searchParams.set("site", site);
    requestUrl.searchParams.set("token", token);
    const response = await fetch(requestUrl, {
      method: "POST",
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: `${url}\n`,
      signal: AbortSignal.timeout(15_000),
    });
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = { raw };
    }
    if (!response.ok) {
      return { status: "failed", url, submittedAt, httpStatus: response.status, error: payload?.message || raw || `HTTP ${response.status}` };
    }
    return {
      status: "submitted",
      url,
      submittedAt,
      success: payload?.success ?? 0,
      remain: payload?.remain,
      notSameSite: payload?.not_same_site,
      notValid: payload?.not_valid,
    };
  } catch (error) {
    return { status: "failed", url, submittedAt, error: error instanceof Error ? error.message : String(error) };
  }
}

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

const MOJIBAKE_PATTERN = /[\uFFFD]|鎬庝箞|鑲＄エ|鍋歍|鎴愭湰|琚|椋庨櫓|鎵嬬画璐?/;

function hasMojibake(value) {
  return MOJIBAKE_PATTERN.test(String(value || ""));
}

function isReadableText(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !hasMojibake(text);
}

function sanitizeContent(content) {
  const defaults = defaultContent();
  const keywords = Array.isArray(content?.keywords)
    ? content.keywords.filter((keyword) => isReadableText(keyword?.text))
    : [];
  const drafts = Array.isArray(content?.drafts)
    ? content.drafts.filter((draft) => (
      isReadableText(draft?.keyword)
      && isReadableText(draft?.title)
      && isReadableText(draft?.description)
      && isReadableText(draft?.body)
    ))
    : [];
  return {
    ...defaults,
    ...content,
    keywords: keywords.length ? keywords : defaults.keywords,
    drafts,
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
    return sanitizeContent(parsed);
  } catch {
    return defaultContent();
  }
}

export function writeGrowthContent(content) {
  const sanitized = sanitizeContent(content);
  fs.mkdirSync(path.dirname(contentPath), { recursive: true });
  const temporaryPath = `${contentPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, contentPath);
  return sanitized;
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

function fallbackLongBody(keywordText) {
  return [
    `很多人搜索“${keywordText}”时，真正想解决的并不是寻找一个神奇指标，而是想知道自己的仓位、成本和当天的价格波动是否适合做T。做T的前提是已有可交易仓位，并且能够接受判断错误后的结果。任何方法都不能保证盈利，文章中的内容只用于帮助你建立记录、检查和复盘流程。`,
    "一、先把做T和追涨杀跌区分开。做T通常建立在底仓和可用仓位已经明确的基础上，目标是利用日内波动改善持仓成本，而不是因为看到一根快速拉升或下跌的K线就临时改变计划。如果没有底仓、没有可用资金，或者当天无法持续观察，宁可不做，也不要为了交易而交易。",
    "二、做T前先记录四项数据：底仓数量、可用数量、持仓成本和交易费用。底仓是你愿意继续持有的部分，可用数量决定了当天是否有卖出和买回的空间，持仓成本用于判断结果，交易费用则决定了价格差是否足以覆盖手续费、滑点和可能产生的税费。只看买卖价差而忽略费用，往往会把一次看似成功的操作误判为盈利。",
    "三、VWAP可以作为观察价格位置的参考。它反映一段时间内结合成交量计算的平均成交价格，但并不是自动生成买卖信号的按钮。价格在VWAP上方，说明近期成交重心相对偏高；价格在VWAP下方，说明成交重心相对偏低。真正需要观察的是价格位置、成交量变化、分时节奏和自己的持仓计划是否同时匹配，不能只凭一次上穿或下破就下结论。",
    "四、盘前可以写一张简单清单。第一项是今天最多允许使用多少仓位，第二项是预期观察的价格区间，第三项是如果价格快速反向时准备如何退出，第四项是当天最多允许尝试几次。把条件写下来，能够减少临盘时被情绪带着走的情况。清单不需要预测每一个高点和低点，只要明确什么情况下执行、什么情况下放弃即可。",
    "五、盘中执行时，优先观察成交是否连续、价格是否有足够的流动性，以及买卖两侧的价差是否过大。价差太大时，即便方向判断正确，滑点也可能吞掉预期空间；成交突然放大时，也要区分是正常换手还是消息驱动的剧烈波动。对于无法解释的急涨急跌，保留仓位和等待确认通常比立即操作更稳妥。",
    "六、做T不是次数越多越好。每增加一次交易，就会增加手续费、滑点和判断错误的机会。如果已经完成计划中的一次操作，或者价格进入无法判断的区间，就应该停止继续尝试。特别是在开盘和收盘附近，波动、成交和消息影响往往更集中，不能因为价格变化更快就默认机会更多。",
    "七、如果操作后成本上升，先不要急着用下一次交易去弥补。可以按时间记录买入价、卖出价、数量、费用和当时的判断依据，再对照原来的计划，判断问题属于方向判断、仓位安排、执行价格还是没有遵守退出条件。把原因拆开，比简单地把结果归结为运气或指标失效更有利于改进。",
    "八、复盘时建议保留三类记录。第一类是事实，例如价格、数量、成交时间和费用；第二类是当时的假设，例如认为价格会回到哪个区间；第三类是结果，例如是否执行了退出条件、实际成本有没有下降。连续积累几周后，再统计不同市场状态下的表现，才能知道哪些条件对自己有帮助，哪些只是事后解释。",
    "最后，做T应当服务于你的整体持仓计划，而不是取代风险控制。不要使用影响生活的资金，不要为了摊薄成本无限加仓，也不要把历史结果当成未来承诺。双兔助手可以帮助你整理交易记录、理解VWAP和成本变化，但不提供个股买卖指令，也不承诺收益。发布前请根据自己的实际情况补充案例、费用规则和风险提示。",
  ].join("\n\n");
}

function fallbackDraft(keyword) {
  return {
    title: `${keyword.text}：股票做T前要先看懂的三个问题`,
    description: `围绕“${keyword.text}”梳理做T的判断顺序、成本变化与风险边界。`,
    body: fallbackLongBody(keyword.text),
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
    body: String(parsed.body || "").trim().length >= 1000 ? String(parsed.body).trim() : fallbackLongBody(keyword.text),
    faqs: Array.isArray(parsed.faqs) ? parsed.faqs.map(String).slice(0, 5) : [],
    links: ["/knowledge", "/pricing"],
    generatedBy: `openai:${model}`,
  };
}

export async function runGrowthAutomation({ force = false, limit = 10, autoPublish = false } = {}) {
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
    status: autoPublish ? "published" : "review",
    createdAt: now.toISOString(),
    ...(autoPublish ? { publishedAt: now.toISOString() } : {}),
  };
  const next = {
    ...current,
    keywords,
    drafts: [draft, ...current.drafts].slice(0, 100),
    lastRunAt: now.toISOString(),
    lastRunStatus: "success",
    lastRunError: warning || (collected.errors.length ? collected.errors.join("；") : null),
  };
  let persisted = writeGrowthContent(next);
  if (autoPublish) {
    persisted = await updateGrowthDraft(draft, { submitToBaidu: true });
  }
  return {
    ...persisted,
    generatedDraft: persisted.drafts.find((item) => item.id === draft.id) || draft,
    keywordErrors: collected.errors,
    warning,
  };
}

export async function updateGrowthDraft(draft, { submitToBaidu = false } = {}) {
  const current = readGrowthContent();
  const existing = current.drafts.find((item) => item.id === draft.id);
  let updatedDraft = existing ? { ...existing, ...draft } : draft;
  if (submitToBaidu && updatedDraft.status === "published" && updatedDraft.baiduSubmission?.status !== "submitted") {
    updatedDraft = {
      ...updatedDraft,
      baiduSubmission: await submitBaiduUrl(`${getBaiduConfig().site}/knowledge`),
    };
  }
  const drafts = existing
    ? current.drafts.map((item) => item.id === draft.id ? updatedDraft : item)
    : [updatedDraft, ...current.drafts];
  return writeGrowthContent({ ...current, drafts });
}
