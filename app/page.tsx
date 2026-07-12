"use client";

import { useMemo, useState } from "react";

const stocks = [
  { code: "601899", name: "洛阳钼业", price: "27.70", change: "+1.28%" },
  { code: "601012", name: "隆基绿能", price: "18.36", change: "-0.42%" },
  { code: "000063", name: "中兴通讯", price: "33.12", change: "+0.35%" },
  { code: "600519", name: "贵州茅台", price: "1,678.01", change: "-0.18%" },
];

const agents = [
  { icon: "◌", name: "训练兔", role: "严格模拟", state: "训练中", value: "76%" },
  { icon: "◇", name: "挑战兔", role: "影子验证", state: "待评审", value: "58%" },
  { icon: "●", name: "正式兔", role: "冠军策略", state: "运行中", value: "82%" },
  { icon: "◆", name: "风控兔", role: "回撤监控", state: "低风险", value: "12%" },
];

const chartPath = "M10 228 L34 210 L55 222 L78 186 L102 196 L126 170 L148 178 L171 132 L194 142 L217 105 L240 123 L264 94 L286 111 L310 88 L334 102 L358 119 L382 110 L406 127 L430 118 L454 141 L478 136 L502 150 L526 145 L550 160 L574 151 L598 164 L622 158 L646 180 L670 171 L694 190 L718 185 L742 205 L766 196 L790 210 L814 190 L838 198 L862 176 L886 184 L910 168";
const vwapPath = "M10 202 C120 184 200 160 300 150 S500 146 620 155 S790 167 910 170";

export default function Home() {
  const [activeStock, setActiveStock] = useState(0);
  const [profile, setProfile] = useState("平衡档");
  const [period, setPeriod] = useState("分时");
  const [panel, setPanel] = useState("今日T循环");
  const [signalMode, setSignalMode] = useState("反T");
  const [confirmed, setConfirmed] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const stock = stocks[activeStock];
  const chart = useMemo(() => chartPath, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand brand-lockup" aria-label="做T神器 Rabbit Smart-T">
          <span className="brand-emblem"><img className="rabbit-logo" src="/double-rabbit-logo.png" alt="双兔品牌标志"/><i /></span>
          <span className="brand-type"><strong><em>做T</em>神器</strong><small>RABBIT · SMART-T</small></span>
        </div>
        <nav className="main-nav" aria-label="主导航">
          {['操盘台','多股监控','模拟回测','智能训练','自动交易'].map((item, index) => <button className={index === 0 ? 'active' : ''} key={item}>{item}</button>)}
        </nav>
        <div className="top-actions">
          <span className="market-open"><i />市场交易中</span>
          <span className="auto-off"><i />自动交易未连接</span>
          <span className="clock">09:36:21</span>
          <select value={profile} onChange={(e) => setProfile(e.target.value)} aria-label="策略档位">
            <option>稳健档</option><option>平衡档</option><option>灵敏档</option><option>量化学习</option>
          </select>
          <button className="icon-button" aria-label="设置">⌘</button>
        </div>
      </header>

      <section className="ticker" aria-label="股票监控列表">
        {stocks.map((item, index) => (
          <button key={item.code} onClick={() => setActiveStock(index)} className={activeStock === index ? 'selected' : ''}>
            <span>{item.code} {item.name}</span><b>{item.price}</b><em className={item.change.startsWith('-') ? 'down' : ''}>{item.change}</em>
          </button>
        ))}
        <button className="ticker-add">＋ 添加监控</button>
      </section>

      <section className="stock-head">
        <div className="stock-identity">
          <span className="stock-code">{stock.code}</span><h1>{stock.name}</h1><button className="star">☆</button>
        </div>
        <div className="quote"><strong>{stock.price}</strong><span>{stock.change}</span></div>
        <div className="quote-metrics">
          <span>今开 <b>27.62</b></span><span>最高 <b>27.98</b></span><span>最低 <b>27.31</b></span><span>VWAP <b className="teal">27.46</b></span><span>成交额 <b>6.84亿</b></span>
        </div>
        <div className="auction"><span>集合竞价</span><b>高开转弱 · 反T优先</b><small>3/4 条件确认</small></div>
      </section>

      <section className="workspace">
        <div className="chart-zone">
          <div className="chart-tools">
            <div className="legend"><span><i className="coral-line"/>分时价 <b>27.70</b></span><span><i className="teal-line"/>VWAP <b>27.46</b></span></div>
            <div className="periods">{['分时','5分','15分','30分','60分','日K'].map(p => <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>{p}</button>)}</div>
            <button className="tool-button">指标⌄</button><button className="tool-button">全屏</button>
          </div>
          <div className="chart-wrap">
            <div className="y-axis"><span>28.20</span><span>27.90</span><span>27.60</span><span>27.30</span><span>27.00</span></div>
            <svg viewBox="0 0 920 300" preserveAspectRatio="none" role="img" aria-label="洛阳钼业分时价格与VWAP">
              <defs><linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff655f" stopOpacity=".18"/><stop offset="1" stopColor="#ff655f" stopOpacity="0"/></linearGradient></defs>
              {[50,100,150,200,250].map(y => <line key={y} x1="0" y1={y} x2="920" y2={y} className="grid-line"/>)}
              {[100,200,300,400,500,600,700,800].map(x => <line key={x} x1={x} y1="0" x2={x} y2="300" className="grid-line vertical"/>)}
              <path d={`${chart} L910 300 L10 300 Z`} fill="url(#priceFill)" />
              <path d={vwapPath} className="vwap-path"/><path d={chart} className="price-path"/>
              <line x1="0" y1="168" x2="920" y2="168" className="last-line"/><circle cx="910" cy="168" r="4" className="last-dot"/>
              {[18,45,65,88,110,72,96,44,38,54,62,32,28,41,35,31,50,40,36,30,58,42,34,66,48,37,29,45,53,81,56,49,62,73,48,92,55,68,44,78].map((h,i)=><rect key={i} x={i*23} y={300-h} width="10" height={h} className={i%3===0?'volume red':'volume'}/>) }
            </svg>
            <div className="price-flag">27.70</div>
            <div className="x-axis"><span>09:30</span><span>10:00</span><span>10:30</span><span>11:30/13:00</span><span>14:00</span><span>14:30</span><span>15:00</span></div>
          </div>
          <div className="signal-tape">
            <span className="tape-title">信号证据</span>
            <span><i className="ok">✓</i>价格跌回 VWAP 下方</span><span><i className="ok">✓</i>量能放大 1.42×</span><span><i className="ok">✓</i>短线动能转弱</span><span><i className="wait">·</i>等待二次确认</span>
          </div>
        </div>

        <aside className="decision-zone">
          <div className="decision-tabs"><button onClick={() => setSignalMode('正T')} className={signalMode==='正T'?'active':''}>正T</button><button onClick={() => setSignalMode('反T')} className={signalMode==='反T'?'active':''}>反T</button></div>
          <div className="decision-label"><span>SMART-T 决策</span><em>可信度高</em></div>
          <h2>{signalMode === '反T' ? '高开转弱' : '低开转强'}</h2>
          <p className="decision-copy">{signalMode === '反T' ? '冲高乏力，跌回开盘价与 VWAP 下方。' : '止跌回升，重新站上开盘价与 VWAP。'}</p>
          <button className={`primary-action ${confirmed ? 'confirmed' : ''}`} onClick={() => setConfirmed(!confirmed)}>
            <span>{confirmed ? '已加入执行计划' : signalMode === '反T' ? '卖出 1/3 昨仓' : '买入 1/3 计划仓'}</span><small>{confirmed ? '等待券商确认' : '点击确认策略计划'} →</small>
          </button>
          <div className="decision-stats"><div><span>策略评分</span><b>8<small>/10</small></b></div><div><span>预期价差</span><b>0.62<small>%</small></b></div><div><span>市场雷达</span><b>72<small>/100</small></b></div></div>
          <div className="risk-box"><div><span>止盈参考</span><b>+0.60% ~ +1.20%</b></div><div><span>风险边界</span><b>-0.60%</b></div><p>若价格重新站回 VWAP 并放量上攻，反T预案立即失效，避免卖飞。</p></div>
          <button className="automation-reserved" disabled><span><i />自动交易接口</span><b>已预留 · 当前关闭</b></button>
          <div className="position-row"><span>计划仓位</span><div className="position-dots"><i className="on"/><i/><i/></div><b>1 / 3</b></div>
        </aside>
      </section>

      <section className="lower-panel">
        <div className="history">
          <div className="lower-tabs">{['今日T循环','历史信号','模拟记录'].map(item=><button key={item} onClick={()=>setPanel(item)} className={panel===item?'active':''}>{item}</button>)}</div>
          <div className="history-head"><span>时间</span><span>方向</span><span>价格</span><span>数量</span><span>价差</span><span>状态</span></div>
          {[['09:25:18','反T卖出','27.86','1/3仓','+0.62%','待回补'],['09:08:42','正T买入','27.55','1/3仓','—','已成交'],['09:02:11','反T卖出','27.68','1/3仓','+0.48%','已完成']].map((row,i)=><div className="history-row" key={i}>{row.map((cell,j)=><span className={j===1||j===4?'accent':''} key={j}>{cell}</span>)}</div>)}
        </div>
        <div className={`agents ${agentOpen ? 'open' : ''}`}>
          <button className="agents-title" onClick={()=>setAgentOpen(!agentOpen)}><span>四智能体持续训练</span><small>量化学习档 · 每120分钟</small><b>{agentOpen?'收起':'详情'}⌃</b></button>
          <div className="agent-grid">{agents.map((agent,i)=><button className="agent" key={agent.name}><span className={`agent-icon a${i}`}>{agent.icon}</span><span><b>{agent.name}</b><small>{agent.role}</small></span><em><i/>{agent.state}</em><strong>{agent.value}</strong></button>)}</div>
        </div>
      </section>

      <footer><span><i className="online"/>行情源正常 · 延迟 218ms</span><span>仅用于策略研究与提醒，不构成投资建议</span><span>Rabbit Quant V1.0</span></footer>
    </main>
  );
}
