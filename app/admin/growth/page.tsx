"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { readGrowthEvents, trackGrowthEvent, type GrowthEvent } from "@/lib/growth-store";
import "./growth.css";

type Keyword = {
  id: string;
  text: string;
  intent: string;
  score: number;
};

type Draft = {
  id: string;
  keywordId: string;
  keyword: string;
  title: string;
  description: string;
  body: string;
  faqs: string[];
  links: string[];
  status: "draft" | "review" | "published";
  createdAt: string;
  publishedAt?: string;
  generatedBy?: string;
};

const KEYWORDS_KEY = "rabbit-growth-keywords-v1";
const DRAFTS_KEY = "rabbit-growth-drafts-v1";

const seedKeywords: Keyword[] = [
  { id: "kw-1", text: "VWAP怎么看", intent: "指标理解", score: 96 },
  { id: "kw-2", text: "股票成本越来越高怎么办", intent: "成本管理", score: 94 },
  { id: "kw-3", text: "股票被套怎么办", intent: "风险处理", score: 92 },
  { id: "kw-4", text: "股票怎么做T", intent: "入门教程", score: 91 },
  { id: "kw-5", text: "T+0技巧", intent: "方法研究", score: 88 },
  { id: "kw-6", text: "做T降低成本", intent: "成本管理", score: 87 },
  { id: "kw-7", text: "底仓做T怎么做", intent: "流程教程", score: 84 },
  { id: "kw-8", text: "做T手续费怎么算", intent: "费用计算", score: 81 },
  { id: "kw-9", text: "做T失败怎么办", intent: "复盘改进", score: 78 },
  { id: "kw-10", text: "日内波段怎么控制风险", intent: "风险管理", score: 76 },
];

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The UI remains usable when browser storage is unavailable.
  }
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeDraft(keyword: Keyword): Draft {
  return {
    id: makeId("draft"),
    keywordId: keyword.id,
    keyword: keyword.text,
    title: `${keyword.text}：股票做T前要先看懂的三个问题`,
    description: `围绕“${keyword.text}”梳理做T的判断顺序、成本变化与风险边界。`,
    body: `很多人第一次搜索“${keyword.text}”时，真正想解决的不是寻找一个神奇指标，而是想知道自己手里的仓位该如何判断。做T的第一步，是把底仓、可用仓位、持仓成本和交易费用分开记录。\n\n接下来再观察价格相对VWAP的位置、分时量能和自己的交易计划。价格偏离不等于机会，短线波动也不能替代风险控制。只有当预案、仓位和退出条件都清楚时，做T才有复盘价值。\n\n这篇文章先提供一个可执行的检查清单：一是确认今天是否有足够的可交易仓位；二是估算手续费、滑点和可能的税费；三是提前写下做错时的退出条件。双兔助手只用于帮助你理解自己的交易记录，不提供下单，也不承诺收益。`,
    faqs: [
      `${keyword.text}适合所有股票吗？`,
      "做T前需要记录哪些数据？",
      "为什么做T后成本反而升高了？",
    ],
    links: ["/knowledge", "/pricing"],
    status: "draft",
    createdAt: new Date().toISOString(),
  };
}

function formatDate(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function countLastSevenDays(events: GrowthEvent[]) {
  const now = Date.now();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now - (6 - index) * 86_400_000);
    const day = date.toISOString().slice(0, 10);
    return {
      day: `${date.getMonth() + 1}/${date.getDate()}`,
      count: events.filter((event) => event.type === "page_view" && event.createdAt.slice(0, 10) === day).length,
    };
  });
}

export default function GrowthPage() {
  const [tab, setTab] = useState<"workspace" | "analytics">("workspace");
  const [keywords, setKeywords] = useState<Keyword[]>(seedKeywords);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [events, setEvents] = useState<GrowthEvent[]>([]);
  const [selectedKeywordId, setSelectedKeywordId] = useState("kw-1");
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [automating, setAutomating] = useState(false);
  const [automationMessage, setAutomationMessage] = useState("");

  // Local storage is an external client-side source; hydrate the dashboard once after mount.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const storedKeywords = readLocal<Keyword[] | null>(KEYWORDS_KEY, null);
    const loadedKeywords = Array.isArray(storedKeywords) && storedKeywords.length > 0 ? storedKeywords : seedKeywords;
    const storedDrafts = readLocal<Draft[] | null>(DRAFTS_KEY, null);
    const loadedDrafts = Array.isArray(storedDrafts) ? storedDrafts : [];
    setKeywords(loadedKeywords);
    setDrafts(loadedDrafts);
    setSelectedKeywordId(loadedKeywords[0]?.id ?? "");
    setSelectedDraftId(loadedDrafts[0]?.id ?? "");
    trackGrowthEvent("page_view");
    setEvents(readGrowthEvents());
    void fetch("/api/growth/content", { cache: "no-store" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!payload) return;
        if (Array.isArray(payload.keywords) && payload.keywords.length > 0) {
          const serverKeywords = payload.keywords as Keyword[];
          setKeywords((current) => {
            const merged = [...serverKeywords, ...current.filter((item) => !serverKeywords.some((serverItem) => serverItem.id === item.id))];
            writeLocal(KEYWORDS_KEY, merged);
            return merged;
          });
          setSelectedKeywordId(serverKeywords[0].id);
        }
        if (Array.isArray(payload.drafts) && payload.drafts.length > 0) {
          const serverDrafts = payload.drafts as Draft[];
          setDrafts((current) => {
            const merged = [...serverDrafts, ...current.filter((item) => !serverDrafts.some((serverItem) => serverItem.id === item.id))];
            writeLocal(DRAFTS_KEY, merged);
            return merged;
          });
          setSelectedDraftId(serverDrafts[0].id);
        }
      })
      .catch(() => undefined);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const selectedKeyword = keywords.find((keyword) => keyword.id === selectedKeywordId) ?? keywords[0];
  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId) ?? drafts[0];
  const recentViews = useMemo(() => countLastSevenDays(events), [events]);
  const maxViews = Math.max(...recentViews.map((item) => item.count), 1);
  const reviewCount = drafts.filter((draft) => draft.status === "review").length;
  const publishedCount = drafts.filter((draft) => draft.status === "published").length;

  function refreshEvents() {
    setEvents(readGrowthEvents());
  }

  function addKeyword() {
    const text = keywordInput.trim();
    if (!text) return;
    const keyword: Keyword = { id: makeId("kw"), text, intent: "待分类", score: 70 };
    const next = [keyword, ...keywords];
    setKeywords(next);
    writeLocal(KEYWORDS_KEY, next);
    setSelectedKeywordId(keyword.id);
    setKeywordInput("");
    trackGrowthEvent("keyword_added");
    refreshEvents();
  }

  async function runAutomation() {
    if (automating) return;
    setAutomating(true);
    setAutomationMessage("正在抓取百度关键词并生成草稿…");
    try {
      const response = await fetch("/api/growth/auto-generate", { method: "POST", cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "自动生成失败");
      const contentResponse = await fetch("/api/growth/content", { cache: "no-store" });
      const content = contentResponse.ok ? await contentResponse.json() : null;
      if (Array.isArray(content?.keywords)) {
        const serverKeywords = content.keywords as Keyword[];
        setKeywords(serverKeywords);
        writeLocal(KEYWORDS_KEY, serverKeywords);
        setSelectedKeywordId(serverKeywords[0]?.id ?? "");
      }
      if (Array.isArray(content?.drafts)) {
        const serverDrafts = content.drafts as Draft[];
        setDrafts(serverDrafts);
        writeLocal(DRAFTS_KEY, serverDrafts);
        setSelectedDraftId(payload.draft?.id ?? serverDrafts[0]?.id ?? "");
      }
      trackGrowthEvent("draft_created");
      refreshEvents();
      setAutomationMessage(payload.warning ? `已生成，待审核：${payload.warning}` : "已抓取并生成 1 篇待审核草稿");
    } catch (error) {
      setAutomationMessage(error instanceof Error ? error.message : "自动生成失败");
    } finally {
      setAutomating(false);
    }
  }

  function generateDraft() {
    if (!selectedKeyword) return;
    const draft = makeDraft(selectedKeyword);
    const next = [draft, ...drafts];
    setDrafts(next);
    writeLocal(DRAFTS_KEY, next);
    setSelectedDraftId(draft.id);
    trackGrowthEvent("draft_created");
    refreshEvents();
  }

  function updateDraft(patch: Partial<Draft>) {
    if (!selectedDraft) return;
    const updatedDraft = { ...selectedDraft, ...patch };
    const next = drafts.map((draft) => (draft.id === selectedDraft.id ? updatedDraft : draft));
    setDrafts(next);
    writeLocal(DRAFTS_KEY, next);
    void fetch("/api/growth/content", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft: updatedDraft }),
    }).catch(() => undefined);
  }

  function publishDraft() {
    if (!selectedDraft) return;
    updateDraft({ status: "published", publishedAt: new Date().toISOString() });
    trackGrowthEvent("draft_published");
    refreshEvents();
  }

  return (
    <main className="growth-page">
      <header className="growth-header">
        <div className="growth-brand"><span className="growth-mark">兔</span><div><b>双兔增长中心</b><small>RABBIT GROWTH AI · PHASE 01</small></div></div>
        <div className="growth-header-actions"><Link href="/knowledge">查看知识库</Link><Link href="/">返回首页</Link></div>
      </header>

      <section className="growth-hero">
        <div><span className="growth-kicker">CONTENT ENGINE / REVIEW FIRST</span><h1>把做T知识，变成持续增长的入口。</h1><p>百度关键词 → AI文章草稿 → 人工审核 → 发布记录 → 访问统计。自动生成内容会保存到服务器，发布前始终保留人工确认。</p></div>
        <div className="growth-status"><span className="status-dot" />MVP 已启动<small>不触碰交易策略与账户数据</small></div>
      </section>

      <section className="growth-metrics">
        <article><span>关键词库</span><b>{keywords.length}</b><small>已准备主题</small></article>
        <article><span>待审核</span><b>{reviewCount}</b><small>需要人工确认</small></article>
        <article><span>发布记录</span><b>{publishedCount}</b><small>本地流程记录</small></article>
        <article><span>7日访问事件</span><b>{events.filter((event) => event.type === "page_view").length}</b><small>当前浏览器累计</small></article>
      </section>

      <div className="growth-tabs" role="tablist" aria-label="增长中心模块">
        <button className={tab === "workspace" ? "active" : ""} onClick={() => setTab("workspace")}>内容工作台</button>
        <button className={tab === "analytics" ? "active" : ""} onClick={() => { setTab("analytics"); refreshEvents(); }}>流量统计</button>
      </div>

      {tab === "workspace" ? (
        <section className="growth-workspace">
          <aside className="growth-panel keyword-panel">
            <div className="panel-heading"><div><span>01 / TOPICS</span><h2>关键词库</h2></div><em>{keywords.length} 条</em></div>
            <div className="keyword-add"><input value={keywordInput} onChange={(event) => setKeywordInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addKeyword()} placeholder="添加一个搜索问题"/><button onClick={addKeyword}>+</button></div>
            <div className="keyword-list">{keywords.map((keyword) => <button key={keyword.id} className={keyword.id === selectedKeyword?.id ? "selected" : ""} onClick={() => setSelectedKeywordId(keyword.id)}><span><b>{keyword.text}</b><small>{keyword.intent}</small></span><em>{keyword.score}</em></button>)}</div>
          </aside>

          <section className="growth-panel draft-panel">
            <div className="panel-heading"><div><span>02 / DRAFTS</span><h2>文章生成与审核</h2></div><div className="growth-panel-actions"><button className="primary-button" onClick={runAutomation} disabled={automating}>{automating ? "抓取中…" : "自动抓取生成"}</button><button className="primary-button" onClick={generateDraft}>生成草稿</button></div></div>
            {automationMessage && <div className="automation-message">{automationMessage}</div>}
            <div className="selected-topic"><small>当前主题</small><b>{selectedKeyword?.text ?? "请选择关键词"}</b><span>{selectedKeyword?.intent ?? "—"} · 机会分 {selectedKeyword?.score ?? "—"}</span></div>
            {selectedDraft ? <>
              <div className="draft-list">{drafts.slice(0, 5).map((draft) => <button key={draft.id} className={draft.id === selectedDraft.id ? "selected" : ""} onClick={() => setSelectedDraftId(draft.id)}><span>{draft.title}</span><em className={`draft-status ${draft.status}`}>{draft.status === "published" ? "已发布" : draft.status === "review" ? "待审核" : "草稿"}</em></button>)}</div>
              <div className="draft-editor"><label>SEO标题<input value={selectedDraft.title} onChange={(event) => updateDraft({ title: event.target.value })}/></label><label>摘要<textarea value={selectedDraft.description} onChange={(event) => updateDraft({ description: event.target.value })}/></label><label>正文<textarea className="body-input" value={selectedDraft.body} onChange={(event) => updateDraft({ body: event.target.value })}/></label><div className="draft-actions"><span>创建于 {formatDate(selectedDraft.createdAt)} · FAQ {selectedDraft.faqs.length} 条</span><button onClick={() => updateDraft({ status: "review" })}>送审</button><button className="publish-button" onClick={publishDraft}>发布记录</button></div></div>
            </> : <div className="empty-state"><span>✦</span><h3>还没有文章草稿</h3><p>从左侧选择一个关键词，点击“生成草稿”开始。</p></div>}
          </section>
        </section>
      ) : (
        <section className="analytics-grid">
          <section className="growth-panel chart-panel"><div className="panel-heading"><div><span>03 / ANALYTICS</span><h2>访问事件趋势</h2></div><em>近 7 天</em></div><div className="bar-chart">{recentViews.map((item) => <div className="bar-item" key={item.day}><div className="bar-track"><i style={{ height: `${Math.max((item.count / maxViews) * 100, item.count ? 8 : 2)}%` }} /></div><b>{item.count}</b><small>{item.day}</small></div>)}</div><p className="panel-note">目前统计的是知识库与增长后台在当前浏览器产生的访问事件；接入云端统计后，再汇总真实用户流量。</p></section>
          <section className="growth-panel event-panel"><div className="panel-heading"><div><span>EVENT LOG</span><h2>最近动作</h2></div><em>{events.length} 条</em></div><div className="event-list">{events.slice(-8).reverse().map((event) => <div key={event.id}><span className={`event-icon ${event.type}`} /> <b>{event.type === "page_view" ? "页面访问" : event.type === "keyword_added" ? "新增关键词" : event.type === "draft_created" ? "生成草稿" : "文章发布"}</b><small>{formatDate(event.createdAt)}</small></div>)}{events.length === 0 && <div className="empty-event">还没有统计事件</div>}</div></section>
        </section>
      )}

      <footer className="growth-footer"><span>每日 02:00 自动抓取并生成 1 篇待审核草稿；发布后可继续接入 sitemap 与百度提交。</span><Link href="/knowledge">先看公开知识库 →</Link></footer>
    </main>
  );
}
