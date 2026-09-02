"use client";

import { useState } from "react";
import "./styles.css";

const watchlist = [
  { code: "SH601899", name: "紫金矿业", price: "34.93", change: "+1.25%", tone: "up", note: "观察" },
  { code: "SZ300750", name: "宁德时代", price: "187.62", change: "-0.84%", tone: "down", note: "等待" },
  { code: "SH600519", name: "贵州茅台", price: "1,468.00", change: "+0.36%", tone: "up", note: "平稳" },
  { code: "SZ000858", name: "五粮液", price: "128.40", change: "-0.22%", tone: "down", note: "观察" },
];

const chartPoints = "0,142 32,128 64,136 96,104 128,116 160,88 192,96 224,72 256,82 288,58 320,66 352,44 384,52 416,28 448,39 480,18 512,30 544,12";

export default function RabbitTraderPage() {
  const [activeStock, setActiveStock] = useState(0);
  const [activeTab, setActiveTab] = useState("分时");
  const [planOpen, setPlanOpen] = useState(false);
  const [layoutMode, setLayoutMode] = useState<"trader" | "research">("trader");
  const stock = watchlist[activeStock];

  return (
    <main className={`rabbit-shell ${layoutMode === "trader" ? "trader-mode" : "research-mode"}`}>
      <aside className="rabbit-sidebar">
        <div className="brand-lockup">
          <div className="rabbit-mark" aria-hidden="true"><span>◡</span></div>
          <div><strong>双兔</strong><small>女性操盘台</small></div>
        </div>

        <nav className="side-nav" aria-label="主导航">
          <a className="active" href="#overview"><span>⌂</span>今日概览</a>
          <a href="#market"><span>◒</span>行情观察</a>
          <a href="#position"><span>◫</span>我的持仓</a>
          <a href="#review"><span>↗</span>交易复盘</a>
          <a href="#knowledge"><span>✦</span>做T知识库</a>
        </nav>

        <div className="sidebar-note">
          <span className="note-bunny">✿</span>
          <p>今天也先看清楚，<br />再决定是否出手。</p>
        </div>

        <div className="profile-card">
          <div className="profile-avatar">兔</div>
          <div><strong>我的交易本</strong><small>已连续记录 12 天</small></div>
          <span className="more">···</span>
        </div>
      </aside>

      <section className="rabbit-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">TUESDAY · 09 / 02 / 2026</p>
            <h1>早上好，今天慢一点也没关系。</h1>
          </div>
          <div className="top-actions">
            <div className="view-switch" role="tablist" aria-label="工作模式">
              <button
                type="button"
                role="tab"
                aria-selected={layoutMode === "trader"}
                className={layoutMode === "trader" ? "active" : ""}
                onClick={() => setLayoutMode("trader")}
              >操盘模式</button>
              <button
                type="button"
                role="tab"
                aria-selected={layoutMode === "research"}
                className={layoutMode === "research" ? "active" : ""}
                onClick={() => setLayoutMode("research")}
              >研究模式</button>
            </div>
            <button className="icon-button" aria-label="通知">♧<i /></button>
            <button className="avatar-button">兔兔</button>
          </div>
        </header>

        <div className="market-strip" id="overview">
          <div className="market-mood"><span className="mood-dot" />今日市场 <strong>温和震荡</strong><small>适合观察，不宜追价</small></div>
          <div className="market-numbers"><span>上证指数 <b>3,812.16</b> <em className="up">+0.42%</em></span><span>深证成指 <b>11,942.80</b> <em className="down">-0.18%</em></span><span>两市成交 <b>8,420亿</b></span></div>
        </div>

        <div className="dashboard-grid">
          <section className="card watch-card" id="market">
            <div className="card-heading"><div><p className="section-kicker">WATCHLIST</p><h2>我的观察清单</h2></div><button className="add-button">＋ 添加</button></div>
            <div className="watch-list">
              {watchlist.map((item, index) => (
                <button className={`watch-row ${index === activeStock ? "selected" : ""}`} key={item.code} onClick={() => setActiveStock(index)}>
                  <span className={`stock-logo ${item.tone}`}>{item.name.slice(0, 1)}</span>
                  <span className="stock-name"><strong>{item.name}</strong><small>{item.code}</small></span>
                  <span className="stock-price"><strong>{item.price}</strong><em className={item.tone}>{item.change}</em></span>
                  <span className="stock-note">{item.note}</span>
                </button>
              ))}
            </div>
            <button className="text-link">查看全部自选股 <span>→</span></button>
          </section>

          <section className="card chart-card">
            <div className="card-heading chart-heading"><div><p className="section-kicker">INTRADAY VIEW</p><h2>{stock.name} <small>{stock.code}</small></h2></div><div className="chart-tabs">{["分时", "日K", "周K"].map((tab) => <button className={activeTab === tab ? "active" : ""} key={tab} onClick={() => setActiveTab(tab)}>{tab}</button>)}</div></div>
            <div className="quote-line"><strong>{stock.price}</strong><span className={stock.tone}>{stock.change}</span><small>今日参考价 34.50</small></div>
            <div className="chart-wrap">
              <svg viewBox="0 0 544 170" role="img" aria-label={`${stock.name} ${activeTab}走势示意图`} preserveAspectRatio="none">
                <defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#9b7cf6" stopOpacity=".25" /><stop offset="100%" stopColor="#9b7cf6" stopOpacity="0" /></linearGradient></defs>
                <path className="grid-line" d="M0 34H544M0 85H544M0 136H544M136 0V170M272 0V170M408 0V170" />
                <polygon fill="url(#chartFill)" points={`0,170 ${chartPoints} 544,170`} />
                <polyline className="vwap-line" points="0,108 544,48" />
                <polyline className="chart-line" points={chartPoints} />
                <circle className="chart-dot" cx="480" cy="18" r="5" />
              </svg>
              <div className="chart-axis"><span>09:30</span><span>10:30</span><span>11:30</span><span>13:30</span><span>14:30</span></div>
              <div className="chart-legend"><span><i className="purple-dot" />价格走势</span><span><i className="pink-dot" />VWAP 参考线</span></div>
            </div>
          </section>

          <section className="card rabbit-card decision-card">
            <div className="card-heading"><div><p className="section-kicker">RABBIT NOTE</p><h2>兔兔观察</h2></div><span className="live-tag">实时</span></div>
            <div className="rabbit-message"><div className="large-rabbit">🐰</div><div><strong>价格在参考线之上</strong><p>成交重心相对偏高，先观察量能是否连续。</p></div></div>
            <div className="signal-list"><div><span>波动状态</span><b className="soft-green">温和</b></div><div><span>成交量</span><b>正常</b></div><div><span>今日计划</span><b>等待确认</b></div></div>
            <div className="rabbit-tip"><span>♡</span> 没有明确机会时，等待也是一种计划。</div>
          </section>

          <section className="card position-card execution-card" id="position">
            <div className="card-heading"><div><p className="section-kicker">POSITION</p><h2>我的持仓</h2></div><button className="more-button">···</button></div>
            <div className="position-summary"><div><small>持仓市值</small><strong>¥ 86,420.50</strong></div><div className="profit-box"><small>今日盈亏</small><strong>+¥ 1,240.80</strong><em>+1.46%</em></div></div>
            <div className="holding-row"><span className="stock-logo up">紫</span><span className="stock-name"><strong>紫金矿业</strong><small>持仓 2,400 股 · 成本 33.86</small></span><span className="holding-profit">+3.16%</span></div>
            <div className="holding-row"><span className="stock-logo down">宁</span><span className="stock-name"><strong>宁德时代</strong><small>持仓 200 股 · 成本 189.20</small></span><span className="holding-profit down">-0.84%</span></div>
          </section>

          <section className="card plan-card research-plan-card">
            <div className="card-heading"><div><p className="section-kicker">TODAY&apos;S PLAN</p><h2>今日做T计划</h2></div><span className="plan-count">2 / 3</span></div>
            <div className="plan-progress"><span /></div>
            <label className="check-row"><input type="checkbox" defaultChecked /><span>确认底仓、可用仓位和交易费用</span></label>
            <label className="check-row"><input type="checkbox" defaultChecked /><span>先观察价格相对VWAP的位置</span></label>
            <label className="check-row"><input type="checkbox" /><span>提前写下做错时的退出条件</span></label>
            <button className="outline-button" onClick={() => setPlanOpen(!planOpen)}>{planOpen ? "收起计划" : "展开我的计划"}<span>{planOpen ? "↑" : "↓"}</span></button>
            {planOpen && <div className="plan-expanded">今天最多尝试 1 次，单次使用不超过可用仓位的 20%。价格快速反向或量能异常时，暂停操作并记录原因。</div>}
          </section>

          <section className="card review-card research-review-card" id="review">
            <div className="card-heading"><div><p className="section-kicker">REVIEW LOG</p><h2>最近复盘</h2></div><a href="#review">全部记录 →</a></div>
            <div className="review-row"><span className="review-date">09.01<small>昨天</small></span><span className="review-mark good">✓</span><span><strong>紫金矿业 · 做T记录</strong><small>完成计划内操作，成本下降 0.08 元</small></span><em className="up">+¥192.00</em></div>
            <div className="review-row"><span className="review-date">08.31<small>周一</small></span><span className="review-mark calm">—</span><span><strong>宁德时代 · 观察记录</strong><small>没有合适机会，选择等待</small></span><em>未操作</em></div>
          </section>
        </div>

        <footer className="rabbit-footer"><span>✦ 双兔只帮你看懂自己的交易，不提供买卖指令。</span><a href="#knowledge" id="knowledge">去知识库学习 →</a></footer>
      </section>
    </main>
  );
}
