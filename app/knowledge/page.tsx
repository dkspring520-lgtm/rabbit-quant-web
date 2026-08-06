"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { trackGrowthEvent } from "@/lib/growth-store";
import "./knowledge.css";
import "./published.css";

const topics = [
  ["01", "VWAP怎么看", "先理解价格、成交量与日内均价的关系，再决定它能否进入自己的复盘流程。"],
  ["02", "股票成本越来越高怎么办", "把底仓、交易费用、滑点与每一次决策拆开，避免把一次结果误认为方法。"],
  ["03", "股票怎么做T", "从可交易仓位、预案和退出条件开始，建立适合自己的做T检查清单。"],
];

type PublishedDraft = {
  id: string;
  title: string;
  description: string;
  body: string;
  status: "draft" | "review" | "published";
};

function readPublishedDrafts(): PublishedDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem("rabbit-growth-drafts-v1");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((draft) => draft?.status === "published") : [];
  } catch {
    return [];
  }
}

async function loadPublishedDrafts() {
  const localDrafts = readPublishedDrafts();
  try {
    const response = await fetch("/api/growth/content", { cache: "no-store" });
    if (!response.ok) return localDrafts;
    const payload = await response.json();
    const serverDrafts = Array.isArray(payload?.drafts)
      ? payload.drafts.filter((draft: PublishedDraft) => draft?.status === "published")
      : [];
    const serverIds = new Set(serverDrafts.map((draft: PublishedDraft) => draft.id));
    return [...serverDrafts, ...localDrafts.filter((draft) => !serverIds.has(draft.id))];
  } catch {
    return localDrafts;
  }
}

export default function KnowledgePage() {
  const [publishedDrafts, setPublishedDrafts] = useState<PublishedDraft[]>([]);

  // Local storage and the server content endpoint are external sources; hydrate once after mount.
  useEffect(() => {
    trackGrowthEvent("page_view");
    void loadPublishedDrafts().then(setPublishedDrafts);
  }, []);

  return (
    <main className="knowledge-page">
      <header className="knowledge-header">
        <Link href="/" className="knowledge-brand"><span>兔</span><b>双兔助手 / 做T知识库</b></Link>
        <nav><Link href="/admin/growth">增长中心</Link><Link href="/pricing">会员方案</Link></nav>
      </header>
      <section className="knowledge-hero">
        <span>RABBIT KNOWLEDGE BASE</span>
        <h1>先理解自己的交易，<br/><strong>再讨论怎么做T。</strong></h1>
        <p>这里不卖神奇指标，只把成本、VWAP、仓位、风险与复盘拆成可以读懂、可以检查的内容。</p>
      </section>
      <section className="knowledge-grid">
        {topics.map(([number, title, copy]) => <article key={number}><span>{number}</span><h2>{title}</h2><p>{copy}</p><a href="#article">阅读导读 →</a></article>)}
      </section>
      <section className="knowledge-article" id="article">
        <span>EDITOR&apos;S NOTE / 001</span>
        <h2>做T不是把每一次波动都变成交易</h2>
        <p>好的知识库应该先帮助你回答三个问题：现在的仓位是什么，今天愿意承担什么风险，以及这次操作结束后准备怎样复盘。指标可以辅助观察，但不应该替代计划。</p>
        <div><b>成本</b><b>仓位</b><b>风险</b><b>复盘</b></div>
      </section>
      {publishedDrafts.length > 0 && (
        <section className="knowledge-published">
          <div className="knowledge-published-heading"><span>FROM GROWTH CENTER</span><small>服务器已发布内容</small></div>
          <div className="knowledge-published-list">
            {publishedDrafts.map((draft) => <article key={draft.id}>
              <span>NEW / PUBLISHED</span>
              <h2>{draft.title}</h2>
              <p className="published-description">{draft.description}</p>
              <div className="published-body">{draft.body.split("\n").map((paragraph, index) => <p key={`${draft.id}-${index}`}>{paragraph}</p>)}</div>
            </article>)}
          </div>
        </section>
      )}
      <footer className="knowledge-footer"><span>内容由双兔增长中心逐步整理，暂不构成投资建议。</span><Link href="/admin/growth">去生成下一篇文章 →</Link></footer>
    </main>
  );
}
