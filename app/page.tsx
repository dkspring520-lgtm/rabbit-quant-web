"use client";

import { useMemo, useState } from "react";

const stocks = [
  { code: "601899", name: "洛阳钼业", price: "27.70", change: "+1.28%" },
  { code: "601012", name: "隆基绿能", price: "18.36", change: "-0.42%" },
  { code: "000063", name: "中兴通讯", price: "33.12", change: "+0.35%" },
  { code: "600519", name: "贵州茅台", price: "1,678.01", change: "-0.18%" },
];

const agents = [
  { avatar: "/agents/training.png", name: "训练兔", role: "严格模拟", state: "训练中", value: "76%" },
  { avatar: "/agents/challenger.png", name: "挑战兔", role: "影子验证", state: "待评审", value: "58%" },
  { avatar: "/agents/official.png", name: "正式兔", role: "冠军策略", state: "运行中", value: "82%" },
  { avatar: "/agents/risk.png", name: "风控兔", role: "回撤监控", state: "低风险", value: "12%" },
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
  const [activeView, setActiveView] = useState("操盘台");
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [customStrategy, setCustomStrategy] = useState("09:35后等待开盘价与VWAP双确认；正T、反T每次不超过可做T数量的1/3；预期净价差低于0.5%不执行。");
  const stock = stocks[activeStock];
  const chart = useMemo(() => chartPath, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand brand-lockup" aria-label="做T神器 Rabbit Smart-T">
          <span className="brand-emblem"><img className="rabbit-logo" src="/rabbit-brand-v2.png" alt="双兔与上涨T品牌标志"/><i /></span>
          <span className="brand-type"><strong><em>做T</em><span>神器</span></strong><small>SMART INTRADAY SYSTEM</small></span>
        </div>
        <nav className="main-nav" aria-label="主导航">
          {['操盘台','多股监控','模拟回测','智能训练','自动交易'].map((item) => <button onClick={() => item === '操盘台' || item === '模拟回测' ? setActiveView(item) : undefined} className={activeView === item ? 'active' : ''} key={item}>{item}</button>)}
        </nav>
        <div className="top-actions">
          <span className="market-open"><i />市场交易中</span>
          <span className="auto-off"><i />自动交易未连接</span>
          <span className="clock">09:36:21</span>
          <select value={profile} onChange={(e) => setProfile(e.target.value)} aria-label="策略档位">
            <option>稳健档</option><option>平衡档</option><option>灵敏档</option><option>量化学习</option><option>自定义策略</option>
          </select>
          <button className="strategy-help" onClick={()=>setStrategyOpen(true)}>策略说明</button>
          <button className="icon-button" aria-label="设置">⌘</button>
        </div>
      </header>

      {activeView === "操盘台" ? <>
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
            <span className="live-scan"><i/>开盘自动监控 · 实时扫描中</span>
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
              <g className="signal-marker observation oversold active-signal" transform="translate(170 132)"><circle className="signal-halo" r="10"/><circle className="signal-core" r="5"/><text x="10" y="-7">超卖重点观察</text></g>
              <g className="signal-marker confirm sell-confirm active-signal" transform="translate(310 88)"><circle className="pulse-ring" r="8"/><circle className="signal-core" r="8"/><text x="0" y="3">卖</text></g>
              <g className="signal-marker observation overbought active-signal" transform="translate(454 141)"><circle className="signal-halo" r="10"/><circle className="signal-core" r="5"/><text x="9" y="-7">超买重点观察</text></g>
              <g className="signal-marker confirm buy-confirm active-signal" transform="translate(742 205)"><circle className="pulse-ring" r="8"/><circle className="signal-core" r="8"/><text x="0" y="3">买</text></g>
              {[18,45,65,88,110,72,96,44,38,54,62,32,28,41,35,31,50,40,36,30,58,42,34,66,48,37,29,45,53,81,56,49,62,73,48,92,55,68,44,78].map((h,i)=><rect key={i} x={i*23} y={300-h} width="10" height={h} className={i%3===0?'volume red':'volume'}/>) }
            </svg>
            <div className="price-flag">27.70</div>
            <div className="x-axis"><span>09:30</span><span>10:00</span><span>10:30</span><span>11:30/13:00</span><span>14:00</span><span>14:30</span><span>15:00</span></div>
          </div>
          <div className="signal-tape">
            <span className="tape-title">信号证据</span>
            <span><i className="ok">✓</i>价格跌回 VWAP 下方</span><span><i className="ok">✓</i>量能放大 1.42×</span><span><i className="ok">✓</i>超买/超卖识别已启用</span><span><i className="wait">·</i>等待二次确认</span>
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
          <div className="agent-grid">{agents.map((agent,i)=><button className="agent" key={agent.name}><span className={`agent-icon a${i}`}><img src={agent.avatar} alt={`${agent.name} AI头像`}/></span><span><b>{agent.name}</b><small>{agent.role}</small></span><em><i/>{agent.state}</em><strong>{agent.value}</strong></button>)}</div>
        </div>
      </section>
      </> : <BacktestView profile={profile} setProfile={setProfile} />}

      {strategyOpen && <div className="strategy-overlay" role="dialog" aria-modal="true" aria-label="策略选择与说明">
        <div className="strategy-dialog">
          <div className="strategy-dialog-head"><div><span>SMART‑T STRATEGY</span><h2>选择真正看得懂的策略</h2><p>策略决定信号门槛与频率；仓位、费用、可卖数量、止损和尾盘恢复始终由硬风控约束。</p></div><button onClick={()=>setStrategyOpen(false)} aria-label="关闭策略说明">×</button></div>
          <div className="strategy-cards">
            {[
              {name:'稳健档',tag:'少做，只做最确定',fit:'震荡市、新手、重视回撤',score:'9/10',cycles:'每日最多 2 次',spread:'最低净价差 0.50%',risk:'可能错过快速机会'},
              {name:'平衡档',tag:'确认与机会兼顾',fit:'大多数正常交易日',score:'8/10',cycles:'每日最多 3 次',spread:'最低净价差 0.35%',risk:'默认推荐'},
              {name:'灵敏档',tag:'更早发现拐点',fit:'活跃行情、熟练用户',score:'7/10',cycles:'每日最多 5 次',spread:'最低净价差 0.25%',risk:'假信号会增加'},
              {name:'量化学习',tag:'用历史结果持续优化',fit:'积累足够模拟样本后',score:'动态门槛',cycles:'每日最多 4 次',spread:'经验参数决定',risk:'新参数需人工晋级'},
            ].map(item=><button key={item.name} onClick={()=>setProfile(item.name)} className={`strategy-card ${profile===item.name?'selected':''}`}><div><h3>{item.name}</h3><span>{profile===item.name?'当前使用':'选择'}</span></div><strong>{item.tag}</strong><p>{item.fit}</p><ul><li>确认分：{item.score}</li><li>{item.cycles}</li><li>{item.spread}</li></ul><em>{item.risk}</em></button>)}
          </div>
          <div className={`custom-strategy ${profile==='自定义策略'?'selected':''}`}><div className="custom-head"><div><h3>用户自定义策略</h3><p>用自然语言写下你的买卖条件，系统会同步到监控与模拟回测。</p></div><button onClick={()=>setProfile('自定义策略')}>{profile==='自定义策略'?'当前使用':'设为当前策略'}</button></div><textarea value={customStrategy} onChange={e=>setCustomStrategy(e.target.value)} aria-label="自定义做T策略规则"/><div className="hard-guards"><span>不可绕过：</span><b>可卖数量</b><b>费用与滑点</b><b>14:30开仓限制</b><b>尾盘仓位恢复</b><b>连续失败熔断</b></div></div>
          <div className="opening-rule"><span>开盘统一规则</span><p>09:30–09:35 只观察；09:35–10:00 收盘确认＋回踩确认后分两次各 1/6；早盘累计不超过 1/3；10:00 后按盘中策略执行。</p><button onClick={()=>{try{localStorage.setItem('rabbit-custom-strategy',customStrategy)}catch{} setStrategyOpen(false)}}>保存并应用</button></div>
        </div>
      </div>}

      <footer><span><i className="online"/>行情源正常 · 延迟 218ms</span><span>仅用于策略研究与提醒，不构成投资建议</span><span>Rabbit Quant V1.0</span></footer>
    </main>
  );
}

function BacktestView({ profile, setProfile }: { profile: string; setProfile: (value: string) => void }) {
  const [capital, setCapital] = useState(200000);
  const [baseShares, setBaseShares] = useState(6000);
  const [sellable, setSellable] = useState(6000);
  const [feeRate, setFeeRate] = useState(0.025);
  const [slippage, setSlippage] = useState(0.02);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(true);
  const run = () => { setRunning(true); setDone(false); window.setTimeout(() => { setRunning(false); setDone(true); }, 900); };
  return <section className="backtest-view">
    <div className="backtest-head">
      <div><span className="eyebrow">TRUSTED REPLAY ENGINE</span><h1>可信模拟回测</h1><p>逐分钟重放，只使用当时已完成的数据；与实时监控共用 Smart‑T 决策引擎。</p></div>
      <div className="integrity-badges"><span><i/>无未来数据</span><span><i/>统一费用模型</span><span><i/>真实可卖数量</span></div>
    </div>
    <div className="backtest-grid">
      <aside className="backtest-config">
        <div className="config-title"><h2>回测参数</h2><span>已保存</span></div>
        <label>股票代码<div className="field fixed"><b>601899</b><span>洛阳钼业</span></div></label>
        <div className="field-pair"><label>开始日期<input className="plain-input" type="text" inputMode="numeric" autoComplete="off" defaultValue="2026-06-01" aria-label="开始日期，格式为年月日"/></label><label>结束日期<input className="plain-input" type="text" inputMode="numeric" autoComplete="off" defaultValue="2026-07-11" aria-label="结束日期，格式为年月日"/></label></div>
        <label>策略档位<select value={profile} onChange={e=>setProfile(e.target.value)}><option>稳健档</option><option>平衡档</option><option>灵敏档</option><option>量化学习</option></select></label>
        <div className="field-pair"><label>模拟资金<input className="plain-input" type="text" inputMode="numeric" autoComplete="off" value={capital} onChange={e=>setCapital(Number(e.target.value.replace(/\D/g,'')) || 0)}/><em>元</em></label><label>真实底仓<input className="plain-input" type="text" inputMode="numeric" autoComplete="off" value={baseShares} onChange={e=>setBaseShares(Number(e.target.value.replace(/\D/g,'')) || 0)}/><em>股</em></label></div>
        <div className="field-pair"><label>昨日可卖<input className="plain-input" type="text" inputMode="numeric" autoComplete="off" value={sellable} onChange={e=>setSellable(Number(e.target.value.replace(/\D/g,'')) || 0)}/><em>股</em></label><label>单次上限<div className="field fixed"><b>{Math.floor(Math.min(baseShares, sellable)/3/100)*100}</b><span>股</span></div></label></div>
        <div className="cost-box"><div><span>佣金</span><label><input className="plain-input" type="text" inputMode="decimal" autoComplete="off" value={feeRate} onChange={e=>setFeeRate(Number(e.target.value.replace(/[^\d.]/g,'')) || 0)}/><em>%</em></label></div><div><span>单边滑点</span><label><input className="plain-input" type="text" inputMode="decimal" autoComplete="off" value={slippage} onChange={e=>setSlippage(Number(e.target.value.replace(/[^\d.]/g,'')) || 0)}/><em>%</em></label></div><div><span>印花税</span><b>卖出 0.05%</b></div></div>
        <button className="run-backtest" onClick={run} disabled={running}>{running ? '正在逐分钟重放…' : '运行可信回测'}<span>→</span></button>
        <p className="config-note">连续失败 2 次当日停止；14:30 后不新开 T；尾盘恢复计划仓位。</p>
      </aside>
      <div className="backtest-results">
        <div className="result-summary">
          <div className="result-primary"><span>净收益</span><strong>{done ? '+¥ 8,426.30' : '—'}</strong><em>+4.21%</em></div>
          <div><span>毛收益</span><b>¥ 11,208.00</b><small>未扣费用</small></div><div><span>费用与滑点</span><b>-¥ 2,781.70</b><small>占毛利 24.82%</small></div><div><span>最大回撤</span><b>-1.36%</b><small>¥ 2,718.00</small></div>
        </div>
        <div className="equity-panel"><div className="panel-heading"><div><h2>资金曲线</h2><span>2026-06-01 — 2026-07-11</span></div><div className="curve-legend"><span><i/>净资产</span><span><i/>基准持仓</span></div></div><svg viewBox="0 0 800 220" preserveAspectRatio="none" aria-label="回测资金曲线"><defs><linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#28d7c4" stopOpacity=".22"/><stop offset="1" stopColor="#28d7c4" stopOpacity="0"/></linearGradient></defs>{[40,80,120,160,200].map(y=><line key={y} x1="0" x2="800" y1={y} y2={y} className="equity-grid"/>)}<path d="M0 190 C55 176 82 182 120 160 S190 170 230 142 S302 151 350 120 S430 132 470 98 S550 112 600 80 S680 96 730 54 S772 60 800 32 L800 220 L0 220 Z" fill="url(#equityFill)"/><path d="M0 190 C55 176 82 182 120 160 S190 170 230 142 S302 151 350 120 S430 132 470 98 S550 112 600 80 S680 96 730 54 S772 60 800 32" className="equity-line"/><path d="M0 185 C130 174 220 178 320 150 S520 140 800 110" className="benchmark-line"/></svg></div>
        <div className="result-bottom"><div className="metric-table"><div><span>交易日</span><b>29</b></div><div><span>完成T循环</span><b>41</b></div><div><span>正T / 反T</span><b>18 / 23</b></div><div><span>胜率</span><b className="teal">68.29%</b></div><div><span>平均净价差</span><b>0.53%</b></div><div><span>平均持仓</span><b>21分</b></div></div><div className="failure-panel"><h3>未执行与失败原因</h3><p><span>价差不足 0.5%</span><b>17次</b></p><p><span>趋势方向拦截</span><b>9次</b></p><p><span>确认分不足</span><b>7次</b></p><p><span>可卖数量不足</span><b>2次</b></p></div></div>
      </div>
    </div>
  </section>;
}
