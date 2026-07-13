"use client";

import { useEffect, useMemo, useState } from "react";

const initialStocks = [
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
const strategyProfiles = ["稳健档","平衡档","灵敏档","量化学习","自定义策略"];

const chartPath = "M10 228 L34 210 L55 222 L78 186 L102 196 L126 170 L148 178 L171 132 L194 142 L217 105 L240 123 L264 94 L286 111 L310 88 L334 102 L358 119 L382 110 L406 127 L430 118 L454 141 L478 136 L502 150 L526 145 L550 160 L574 151 L598 164 L622 158 L646 180 L670 171 L694 190 L718 185 L742 205 L766 196 L790 210 L814 190 L838 198 L862 176 L886 184 L910 168";
const vwapPath = "M10 202 C120 184 200 160 300 150 S500 146 620 155 S790 167 910 170";

export default function Home() {
  const [authReady, setAuthReady] = useState(false);
  const [localAuth, setLocalAuth] = useState(false);
  const [accountName, setAccountName] = useState("jay cc");
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [preferences, setPreferences] = useState({stock:'601899 洛阳钼业',baseShares:6000,risk:'稳健'});
  const [activeStock, setActiveStock] = useState(0);
  const [stockList, setStockList] = useState(initialStocks);
  const [profile, setProfile] = useState("平衡档");
  const [period, setPeriod] = useState("分时");
  const [panel, setPanel] = useState("今日T循环");
  const [signalMode, setSignalMode] = useState("反T");
  const [cycleStage, setCycleStage] = useState<'ready'|'opened'|'closed'>('ready');
  const [agentOpen, setAgentOpen] = useState(false);
  const [activeView, setActiveView] = useState("首页");
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [trainingRunning, setTrainingRunning] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(68);
  const [customStrategy, setCustomStrategy] = useState("09:35后等待开盘价与VWAP双确认；正T、反T每次不超过可做T数量的1/3；预期净价差低于0.5%不执行。");
  const stock = stockList[activeStock] || stockList[0];
  const removeStock=(index:number)=>{
    if(stockList.length<=1)return;
    const next=stockList.filter((_,i)=>i!==index);
    setStockList(next);
    setActiveStock(current=>current===index?Math.max(0,index-1):current>index?current-1:current);
    setPreferences(current=>{
      const stock=next.some(item=>`${item.code} ${item.name}`===current.stock)
        ? current.stock
        : `${next[0].code} ${next[0].name}`;
      const updated={...current,stock};
      try{
        localStorage.setItem(`rabbit-watchlist:${accountName.toLowerCase()}`,JSON.stringify(next));
        localStorage.setItem(`rabbit-prefs:${accountName.toLowerCase()}`,JSON.stringify(updated));
      }catch{}
      return updated;
    });
  };
  const chart = useMemo(() => chartPath, []);
  useEffect(() => {
    if (!trainingRunning) return;
    const timer = window.setInterval(() => setTrainingProgress(value => {
      if (value >= 100) { setTrainingRunning(false); return 100; }
      return Math.min(100, value + 4);
    }), 450);
    return () => window.clearInterval(timer);
  }, [trainingRunning]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const session=localStorage.getItem('rabbit-auth-session')||sessionStorage.getItem('rabbit-auth-session');
        if(session){
          setLocalAuth(true);
          setAccountName(session);
          const saved=localStorage.getItem(`rabbit-prefs:${session.toLowerCase()}`);
          if(saved)setPreferences(JSON.parse(saved));else setOnboardingOpen(true);
          const watchlist=localStorage.getItem(`rabbit-watchlist:${session.toLowerCase()}`);
          if(watchlist){const list=JSON.parse(watchlist);if(Array.isArray(list)&&list.length)setStockList(list);}
        }
      } catch {}
      setAuthReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if(!authReady) return <main className="auth-loading"><img src="/rabbit-brand-v2.png" alt="做T神器"/></main>;
  if(!localAuth) return <AuthView onAuthenticated={(name,isNew,remember)=>{setAccountName(name);setLocalAuth(true);try{const persistent=isNew||remember;(persistent?localStorage:sessionStorage).setItem('rabbit-auth-session',name);(persistent?sessionStorage:localStorage).removeItem('rabbit-auth-session');const saved=localStorage.getItem(`rabbit-prefs:${name.toLowerCase()}`);if(saved)setPreferences(JSON.parse(saved));else setOnboardingOpen(true)}catch{} if(isNew)setOnboardingOpen(true)}}/>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand brand-lockup" aria-label="做T神器 Rabbit Smart-T">
          <span className="brand-emblem"><img className="rabbit-logo" src="/rabbit-brand-v2.png" alt="双兔与上涨T品牌标志"/><i /></span>
          <span className="brand-type"><strong><em>做T</em><span>神器</span></strong><small>SMART INTRADAY SYSTEM</small></span>
        </div>
        <nav className="main-nav" aria-label="主导航">
          {['首页','操盘台','多股监控','策略市场','持仓对账','模拟回测','智能训练'].map((item) => <button onClick={() => setActiveView(item)} className={activeView === item ? 'active' : ''} key={item}>{item}</button>)}
        </nav>
        <div className="top-actions">
          <span className="market-open"><i />市场交易中</span>
          <span className="auto-off"><i />自动交易未连接</span>
          <span className="clock">09:36:21</span>
          <button className="profile-cycle" onClick={()=>setProfile(strategyProfiles[(strategyProfiles.indexOf(profile)+1)%strategyProfiles.length])} aria-label={`当前策略${profile}，点击切换`}><span>{profile}</span><i>⌄</i></button>
          <button className="strategy-help" onClick={()=>setStrategyOpen(true)}>策略说明</button>
          <button className="account-button" onClick={()=>setAccountOpen(true)} aria-label="打开账户中心"><span>{accountName.slice(0,1).toUpperCase()}</span><b>{accountName}</b><i>⌄</i></button>
          <button className="icon-button" aria-label="设置">⌘</button>
        </div>
      </header>

      {activeView === "首页" ? <HomeView onNavigate={setActiveView} stockCount={stockList.length} /> : activeView === "操盘台" ? <>
      <section className="ticker" aria-label="股票监控列表">
        {stockList.map((item, index) => (
          <div className={`ticker-item ${activeStock === index ? 'selected' : ''}`} key={item.code}><button onClick={() => setActiveStock(index)}><span>{item.code} {item.name}</span><b>{item.price}</b><em className={item.change.startsWith('-') ? 'down' : ''}>{item.change}</em></button><button className="ticker-remove" onClick={()=>removeStock(index)} disabled={stockList.length<=1} aria-label={`删除${item.name}`}>×</button></div>
        ))}
        <button className="ticker-add" onClick={()=>setOnboardingOpen(true)}>＋ 管理监控</button>
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
            <svg viewBox="0 0 920 300" preserveAspectRatio="xMidYMid meet" role="img" aria-label="洛阳钼业分时价格与VWAP">
              <defs><linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff655f" stopOpacity=".18"/><stop offset="1" stopColor="#ff655f" stopOpacity="0"/></linearGradient></defs>
              {[50,100,150,200,250].map(y => <line key={y} x1="0" y1={y} x2="920" y2={y} className="grid-line"/>)}
              {[100,200,300,400,500,600,700,800].map(x => <line key={x} x1={x} y1="0" x2={x} y2="300" className="grid-line vertical"/>)}
              <path d={`${chart} L910 300 L10 300 Z`} fill="url(#priceFill)" />
              <path d={vwapPath} className="vwap-path"/><path d={chart} className="price-path"/>
              <line x1="0" y1="168" x2="920" y2="168" className="last-line"/><circle cx="910" cy="168" r="4" className="last-dot"/>
              <g className="chart-badge oversold active-signal" transform="translate(170 132)"><circle className="badge-pulse" r="7"/><circle className="badge-trigger" r="4"/><line x1="0" y1="6" x2="0" y2="15"/><rect x="-29" y="18" width="58" height="21" rx="5"/><path d="M-5 18 L0 12 L5 18 Z"/><text x="0" y="32">◆ 超卖</text></g>
              <g className="chart-badge sell active-signal" transform="translate(310 88)"><circle className="badge-pulse" r="7"/><circle className="badge-trigger" r="4"/><line x1="0" y1="-6" x2="0" y2="-15"/><rect x="-26" y="-39" width="52" height="21" rx="5"/><path d="M-5 -18 L0 -12 L5 -18 Z"/><g className="mini-rabbit" transform="translate(-15 -28)"><ellipse cx="-1.8" cy="-3" rx="1.2" ry="2.8"/><ellipse cx="1.8" cy="-3" rx="1.2" ry="2.8"/><circle cy="1" r="3.2"/><circle className="rabbit-eye" cx="-1.2" cy=".5" r=".45"/><circle className="rabbit-eye" cx="1.2" cy=".5" r=".45"/></g><text className="badge-copy" x="7" y="-25">卖出</text></g>
              <g className="chart-badge overbought active-signal" transform="translate(454 141)"><circle className="badge-pulse" r="7"/><circle className="badge-trigger" r="4"/><line x1="0" y1="-6" x2="0" y2="-15"/><rect x="-29" y="-39" width="58" height="21" rx="5"/><path d="M-5 -18 L0 -12 L5 -18 Z"/><text x="0" y="-25">♛ 超买</text></g>
              <g className="chart-badge buy active-signal" transform="translate(742 205)"><circle className="badge-pulse" r="7"/><circle className="badge-trigger" r="4"/><line x1="0" y1="6" x2="0" y2="15"/><rect x="-26" y="18" width="52" height="21" rx="5"/><path d="M-5 18 L0 12 L5 18 Z"/><g className="mini-rabbit" transform="translate(-15 29)"><ellipse cx="-1.8" cy="-3" rx="1.2" ry="2.8"/><ellipse cx="1.8" cy="-3" rx="1.2" ry="2.8"/><circle cy="1" r="3.2"/><circle className="rabbit-eye" cx="-1.2" cy=".5" r=".45"/><circle className="rabbit-eye" cx="1.2" cy=".5" r=".45"/></g><text className="badge-copy" x="7" y="32">买入</text></g>
              <line x1="0" y1="252" x2="920" y2="252" className="volume-divider"/>
              {[18,45,65,88,110,72,96,44,38,54,62,32,28,41,35,31,50,40,36,30,58,42,34,66,48,37,29,45,53,81,56,49,62,73,48,92,55,68,44,78].map((h,i)=>{const vh=Math.round(h*.42);return <rect key={i} x={i*23} y={300-vh} width="10" height={vh} className={i%3===0?'volume red':'volume'}/>}) }
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
          <div className="radar-gate"><div><span>市场雷达门控</span><b>72<small>/100</small></b></div><p><i/>震荡区间 · 使用当前档位标准门槛</p><small>雷达低于25禁止激进正T；75以上提高反T确认分；88以上必须等待真实回落。</small></div>
          <div className="opening-causal"><span>09:35–10:00 开盘试单</span><b>仅使用已出现数据 · 单次 1/6 仓</b><small>低开站回VWAP才允许正T；高开跌破VWAP且回抽失败才允许反T。</small></div>
          <h2>{signalMode === '反T' ? '高开转弱' : '低开转强'}</h2>
          <p className="decision-copy">{signalMode === '反T' ? '冲高乏力，跌回开盘价与 VWAP 下方。' : '止跌回升，重新站上开盘价与 VWAP。'}</p>
          <button className={`primary-action ${cycleStage !== 'ready' ? 'confirmed' : ''}`} onClick={() => setCycleStage(cycleStage === 'ready' ? 'opened' : cycleStage === 'opened' ? 'closed' : 'ready')}>
            <span>{cycleStage === 'ready' ? (signalMode === '反T' ? '卖出 1/3 昨仓' : '买入 1/3 计划仓') : cycleStage === 'opened' ? (signalMode === '反T' ? '记录等量买回' : '记录等量卖出') : '本次T已闭环'}</span>
            <small>{cycleStage === 'ready' ? '记录首笔成交' : cycleStage === 'opened' ? '完成反向成交' : '开始下一次循环'} →</small>
          </button>
          <div className={`closure-guard ${cycleStage}`}>
            <div><span>当日闭环控制</span><b><i/>{cycleStage === 'ready' ? '允许开T' : cycleStage === 'opened' ? '等待闭环' : '已恢复底仓'}</b></div>
            <p><span>计划数量</span><strong>2,000 股</strong></p><p><span>当前持仓</span><strong>{cycleStage === 'opened' ? (signalMode === '正T' ? '8,000 股' : '4,000 股') : '6,000 股'}</strong></p><p><span>收盘目标</span><strong>6,000 股</strong></p>
            <div className="cycle-progress"><i className="done"/><span/><i className={cycleStage !== 'ready' ? 'done' : ''}/><span/><i className={cycleStage === 'closed' ? 'done' : ''}/></div>
            <div className="cycle-labels"><span>校验通过</span><span>首笔成交</span><span>等量闭环</span></div>
            <small>{cycleStage === 'ready' ? (signalMode === '正T' ? '可卖旧仓充足，买入后需卖出等量旧仓。' : '卖出后需在 14:50 前买回等量股份。') : cycleStage === 'opened' ? `尚有 2,000 股未配对，新的${signalMode}信号已冻结。` : '买卖数量相等，实际持仓已恢复计划底仓。'}</small>
          </div>
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
          {([...(cycleStage === 'opened' ? [['刚刚',signalMode === '反T' ? '反T卖出' : '正T买入','27.70','2,000股','—','等待闭环']] : cycleStage === 'closed' ? [['刚刚',signalMode === '反T' ? '反T循环' : '正T循环',signalMode === '反T' ? '27.70→27.55' : '27.55→27.70','2,000股','+0.54%','已闭环']] : []),['10:08:14','反T循环','27.86→27.55','2,000股','+0.62%','已闭环'],['09:02:11','正T循环','27.38→27.68','1,000股','+0.48%','已闭环']] as string[][]).map((row,i)=><div className="history-row" key={`${row[0]}-${i}`}>{row.map((cell,j)=><span className={j===1||j===4?'accent':''} key={j}>{cell}</span>)}</div>)}
        </div>
        <div className={`agents ${agentOpen ? 'open' : ''}`}>
          <button className="agents-title" onClick={()=>setAgentOpen(!agentOpen)}><span>四智能体持续训练</span><small>{trainingRunning?'影子回放进行中':'持续影子训练 · 每5分钟'}</small><b>{agentOpen?'收起':'详情'}⌃</b></button>
          {agentOpen && <div className="training-console">
            <div className="training-control"><div><span>训练批次 20260712-043102</span><b>{trainingRunning?'影子回放中':trainingProgress===100?'本轮已完成':'等待继续训练'}</b></div><button onClick={()=>{setTrainingProgress(trainingProgress===100?0:trainingProgress);setTrainingRunning(true)}} disabled={trainingRunning}>{trainingRunning?'训练中…':trainingProgress===100?'开始新批次':'继续训练'}</button></div>
            <div className="training-progress"><div style={{width:`${trainingProgress}%`}}/><span>{trainingProgress}%</span></div>
            <div className="training-metrics"><p><span>样本</span><b>10只 / 5日</b></p><p><span>触发</span><b>18 / 50</b></p><p><span>胜率</span><b>66.7%</b></p><p><span>净盈亏</span><b className="teal">+¥2,416</b></p><p><span>下轮训练</span><b>09:41 · 第13轮</b></p></div>
            <div className="training-log"><span>04:31:02</span><p>{trainingRunning?'训练兔正在获取分时样本并进行严格影子回放':'挑战兔完成样本外验证，候选参数等待人工晋升'}</p><em>自动晋升关闭</em></div>
          </div>}
          <div className="agent-grid">{agents.map((agent,i)=><button className="agent" key={agent.name}><span className={`agent-icon a${i}`}><img src={agent.avatar} alt={`${agent.name} AI头像`}/></span><span><b>{agent.name}</b><small>{agent.role}</small></span><em><i/>{agent.state}</em><strong>{agent.value}</strong></button>)}</div>
        </div>
      </section>
      </> : activeView === "多股监控" ? <MultiWatchView stocks={stockList} onManage={()=>setOnboardingOpen(true)} onOpen={(index)=>{setActiveStock(index);setActiveView('操盘台')}} /> : activeView === "策略市场" ? <StrategyMarketView /> : activeView === "持仓对账" ? <HoldingsView /> : activeView === "智能训练" ? <TrainingView running={trainingRunning} progress={trainingProgress} onRun={()=>{setTrainingProgress(trainingProgress===100?0:trainingProgress);setTrainingRunning(true)}} /> : <BacktestView profile={profile} setProfile={setProfile} />}

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
          <div className="opening-rule"><span>开盘因果规则</span><p>09:30–09:35 只观察；09:35–10:00 只使用当前分钟及之前的数据。低开重新站上VWAP、高开跌破VWAP且确认后，分两次各 1/6；早盘累计不超过 1/3。</p><button onClick={()=>{try{localStorage.setItem('rabbit-custom-strategy',customStrategy)}catch{} setStrategyOpen(false)}}>保存并应用</button></div>
        </div>
      </div>}

      {accountOpen && <div className="account-overlay" role="dialog" aria-modal="true" aria-label="账户中心" onMouseDown={e=>{if(e.target===e.currentTarget)setAccountOpen(false)}}><div className="account-dialog">
        <div className="account-head"><div className="account-avatar">{accountName.slice(0,1).toUpperCase()}</div><div><span>用户名账户已登录</span><h2>{accountName}</h2><p>本机测试账户</p></div><button onClick={()=>setAccountOpen(false)} aria-label="关闭账户中心">×</button></div>
        <div className="account-plan"><div><span>当前套餐</span><b>个人体验版</b><small>账户已自动创建，无需设置站内密码</small></div><em>已激活</em></div>
        <div className="account-stats"><div><span>监控股票</span><b>4 / 10</b></div><div><span>本月回测</span><b>29 次</b></div><div><span>策略版本</span><b>QB‑04</b></div></div>
        <div className="account-settings"><h3>账户偏好</h3><label><span>默认股票<small>进入操盘台后优先显示</small></span><b>{preferences.stock.split(' ')[0]}</b></label><label><span>计划底仓<small>用于当日闭环校验</small></span><b>{preferences.baseShares.toLocaleString()} 股</b></label><label><span>风险偏好<small>影响提醒强度，不绕过硬风控</small></span><b>{preferences.risk}</b></label><label><span>自动交易<small>券商接口尚未连接</small></span><b className="account-off">关闭</b></label></div>
        <div className="account-security"><i>✓</i><p><b>密码安全</b><span>测试版只在本机保存密码摘要，不保存密码明文；正式版将迁移至服务器账户库。</span></p></div>
        <div className="account-footer-actions"><button onClick={()=>setAccountOpen(false)}>完成</button><button onClick={()=>{setAccountOpen(false);setOnboardingOpen(true)}}>修改偏好</button><button onClick={()=>{try{localStorage.removeItem('rabbit-auth-session');sessionStorage.removeItem('rabbit-auth-session')}catch{} setAccountOpen(false);setLocalAuth(false)}}>退出登录</button></div>
      </div></div>}
      {onboardingOpen&&<OnboardingView initial={preferences} initialList={stockList} onSave={(next,list)=>{setPreferences(next);setStockList(list);setActiveStock(current=>Math.min(current,list.length-1));try{localStorage.setItem(`rabbit-prefs:${accountName.toLowerCase()}`,JSON.stringify(next));localStorage.setItem(`rabbit-watchlist:${accountName.toLowerCase()}`,JSON.stringify(list))}catch{}setOnboardingOpen(false)}}/>}

      <footer><span><i className="online"/>行情源正常 · 延迟 218ms · 盘中缓存≤4分钟</span><span>仅用于策略研究与提醒，不构成投资建议</span><span>Rabbit Quant V1.0</span></footer>
    </main>
  );
}

async function passwordDigest(value:string){
  const bytes=new TextEncoder().encode(`rabbit-t:${value}`);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

function AuthView({onAuthenticated}:{onAuthenticated:(name:string,isNew:boolean,remember:boolean)=>void}) {
  const [mode,setMode]=useState<'login'|'register'>('login');
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [showPassword,setShowPassword]=useState(false);
  const [remember,setRemember]=useState(true);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [agreed,setAgreed]=useState(false);
  const strength=password.length<6?0:Number(/[A-Z]/.test(password))+Number(/[a-z]/.test(password))+Number(/\d/.test(password))+Number(/[^A-Za-z0-9]/.test(password));
  const submit=async()=>{
    setError('');
    const name=username.trim();
    if(name.length<3){setError('用户名至少需要 3 个字符');return;}
    if(password.length<6){setError('密码至少需要 6 个字符');return;}
    if(mode==='register'&&password!==confirm){setError('两次输入的密码不一致');return;}
    if(mode==='register'&&!agreed){setError('请先阅读并同意用户协议和隐私政策');return;}
    setBusy(true);
    try{
      const key=`rabbit-account:${name.toLowerCase()}`;
      const digest=await passwordDigest(password);
      if(mode==='register'){
        if(localStorage.getItem(key)){setError('该用户名已经存在，请直接登录');return;}
        localStorage.setItem(key,JSON.stringify({name,digest,createdAt:new Date().toISOString()}));
        onAuthenticated(name,true,true);
      }else{
        const saved=localStorage.getItem(key);
        if(!saved){setError('找不到该用户，请先注册');return;}
        const account=JSON.parse(saved);
        if(account.digest!==digest){setError('用户名或密码错误');return;}
        onAuthenticated(account.name||name,false,remember);
      }
    }catch{setError('当前浏览器无法保存账户，请检查隐私设置');}finally{setBusy(false);}
  };
  return <main className="auth-page">
    <section className="auth-brand-panel"><div className="auth-brand"><img src="/rabbit-brand-v2.png" alt="双兔做T神器标志"/><span><b><em>做T</em>神器</b><small>SMART INTRADAY SYSTEM</small></span></div><div className="auth-message"><span className="eyebrow">RABBIT SMART‑T</span><h1>把复杂的盘面，<br/><em>变成简单的操作。</em></h1><p>多股监控、正反T决策、当日仓位闭环与四兔持续训练。</p></div><div className="auth-points"><span><i/>市场雷达硬门控</span><span><i/>T+1可卖数量校验</span><span><i/>收盘恢复计划底仓</span></div><small className="auth-disclaimer">策略研究工具 · 不构成投资建议</small></section>
    <section className="auth-form-panel"><div className="auth-card"><div className="auth-card-head"><span>{mode==='login'?'WELCOME BACK':'CREATE ACCOUNT'}</span><h2>{mode==='login'?'登录做T神器':'创建用户名账户'}</h2><p>{mode==='login'?'继续查看你的监控、回测和训练记录。':'首次注册后即可进入个人交易工作台。'}</p></div><div className="auth-tabs"><button className={mode==='login'?'active':''} onClick={()=>{setMode('login');setError('')}}>登录</button><button className={mode==='register'?'active':''} onClick={()=>{setMode('register');setError('')}}>注册</button></div><label className="auth-field"><span>用户名</span><input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" placeholder="请输入用户名"/></label><label className="auth-field"><span>密码</span><div><input value={password} onChange={e=>setPassword(e.target.value)} type={showPassword?'text':'password'} autoComplete={mode==='login'?'current-password':'new-password'} placeholder="至少 6 个字符"/><button onClick={()=>setShowPassword(!showPassword)} type="button">{showPassword?'隐藏':'显示'}</button></div></label>{mode==='register'&&<><div className="password-strength"><span>密码强度</span><i className={strength>0?'on':''}/><i className={strength>1?'on':''}/><i className={strength>2?'on':''}/><i className={strength>3?'on':''}/><b>{strength<2?'较弱':strength<4?'可用':'较强'}</b></div><label className="auth-field"><span>确认密码</span><input value={confirm} onChange={e=>setConfirm(e.target.value)} type={showPassword?'text':'password'} autoComplete="new-password" placeholder="再次输入密码"/></label><label className="terms-check"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/><span>我已阅读并同意《用户协议》和《隐私政策》，理解本工具不构成投资建议。</span></label></>}{mode==='login'&&<div className="auth-options"><label><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/><span>记住登录</span></label><button type="button" onClick={()=>setError('测试版暂不支持找回密码，请重新注册其他用户名')}>忘记密码？</button></div>}{error&&<div className="auth-error"><i>!</i>{error}</div>}<button className="auth-submit" onClick={submit} disabled={busy}>{busy?'正在验证…':mode==='login'?'登录':'注册并进入'}<span>→</span></button><div className="auth-local-note"><i>i</i><p><b>本机测试账户</b><span>当前账户仅保存在这个浏览器中，清除浏览器数据后会丢失。正式商用版将接入服务器数据库。</span></p></div></div><footer className="auth-footer">© 2026 Rabbit Quant · 用户协议 · 隐私政策</footer></section>
  </main>;
}

function HomeView({onNavigate,stockCount}:{onNavigate:(view:string)=>void;stockCount:number}) {
  return <section className="product-home">
    <div className="home-hero">
      <div className="home-copy"><span className="eyebrow">RABBIT SMART‑T WORKSPACE</span><h1>看清买卖点，<br/><em>当天完成每一次T。</em></h1><p>集合竞价研判、市场雷达、正反T决策、仓位闭环和四兔训练集中在一个简单的交易工作台。</p><div className="home-actions"><button onClick={()=>onNavigate('操盘台')}>进入今日操盘台 <span>→</span></button><button onClick={()=>onNavigate('模拟回测')}>先做模拟回测</button></div><div className="home-trust"><span><i/>不自动下单</span><span><i/>T+1仓位校验</span><span><i/>收盘恢复底仓</span></div></div>
      <div className="home-terminal"><div className="terminal-head"><span>601899 洛阳钼业</span><em><i/>实时监控中</em></div><div className="terminal-price"><strong>27.70</strong><span>+1.28%</span><small>市场雷达 72 / 100</small></div><svg viewBox="0 0 600 180" preserveAspectRatio="none"><defs><linearGradient id="homeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#28d7c4" stopOpacity=".18"/><stop offset="1" stopColor="#28d7c4" stopOpacity="0"/></linearGradient></defs><path d="M0 145 C45 132 70 151 105 116 S170 127 205 88 S270 99 310 69 S370 91 410 58 S485 74 525 40 S570 52 600 20 L600 180 L0 180Z" fill="url(#homeFill)"/><path d="M0 145 C45 132 70 151 105 116 S170 127 205 88 S270 99 310 69 S370 91 410 58 S485 74 525 40 S570 52 600 20" className="home-line"/></svg><div className="terminal-signal"><span><i className="rabbit-dot-home">兔</i><b>反T观察</b></span><p>高开转弱，等待回落确认</p><em>确认分 8/10</em></div></div>
    </div>
    <div className="home-strip"><div><span>今日闭环</span><b>2 次</b><small>全部恢复底仓</small></div><div><span>监控股票</span><b>{stockCount} 只</b><small>盘中持续扫描</small></div><div><span>已确认净收益</span><b className="teal">+¥887.43</b><small>未闭环不计入</small></div><div><span>四兔训练</span><b>68%</b><small>影子回放进行中</small></div></div>
    <div className="home-workflow"><div className="workflow-head"><div><span className="eyebrow">DAILY WORKFLOW</span><h2>每天只看四件事</h2></div><p>减少指标堆叠，把操作顺序固定下来。</p></div><div className="workflow-grid">{[{n:'01',title:'先看市场',copy:'集合竞价与市场雷达先决定今天能不能做、优先正T还是反T。',action:'多股监控',icon:'⌁'},{n:'02',title:'再等信号',copy:'价格、VWAP、量能和确认分同时满足，才显示可执行机会。',action:'操盘台',icon:'⌗'},{n:'03',title:'当天闭环',copy:'首笔成交后冻结同向信号，等量反向成交并恢复原底仓。',action:'持仓对账',icon:'⇄'},{n:'04',title:'收盘复盘',copy:'使用真实费用和可卖数量回放，训练参数只进入候选区。',action:'智能训练',icon:'◇'}].map(item=><button key={item.n} onClick={()=>onNavigate(item.action)}><span>{item.n}</span><i>{item.icon}</i><h3>{item.title}</h3><p>{item.copy}</p><em>{item.action} →</em></button>)}</div></div>
    <div className="home-risk"><span>重要提示</span><p>做T不保证盈利。所有信号仅用于策略研究和提醒；自动交易接口保持关闭，候选策略必须人工晋升。</p><button onClick={()=>onNavigate('模拟回测')}>查看可信回测</button></div>
  </section>;
}

function OnboardingView({initial,initialList,onSave}:{initial:{stock:string;baseShares:number;risk:string};initialList:typeof initialStocks;onSave:(value:{stock:string;baseShares:number;risk:string},list:typeof initialStocks)=>void}){
  const [stock,setStock]=useState(initial.stock);
  const [shares,setShares]=useState(initial.baseShares);
  const [risk,setRisk]=useState(initial.risk);
  const [list,setList]=useState(initialList);
  const [newCode,setNewCode]=useState('');
  const [newName,setNewName]=useState('');
  const [listError,setListError]=useState('');
  const add=()=>{const code=newCode.replace(/\D/g,'').slice(0,6);const name=newName.trim();if(code.length!==6||!name){setListError('请输入6位股票代码和股票名称');return}if(list.some(item=>item.code===code)){setListError('该股票已经在监控列表中');return}const next=[...list,{code,name,price:'--',change:'0.00%'}];setList(next);setStock(`${code} ${name}`);setNewCode('');setNewName('');setListError('')};
  const remove=(code:string)=>{if(list.length<=1){setListError('至少需要保留一只监控股票');return}const next=list.filter(item=>item.code!==code);setList(next);if(stock.startsWith(code))setStock(`${next[0].code} ${next[0].name}`);setListError('')};
  return <div className="onboarding-overlay"><div className="onboarding-card"><div className="onboarding-head"><span>ACCOUNT SETUP</span><h2>设置你的交易工作台</h2><p>管理监控股票、计划底仓和风险偏好。</p></div><div className="onboarding-step watchlist-step"><b>01</b><div><span>监控股票与默认股票</span><div className="preference-watchlist">{list.map(item=><div className={stock.startsWith(item.code)?'active':''} key={item.code}><button onClick={()=>setStock(`${item.code} ${item.name}`)}><b>{item.name}</b><small>{item.code}</small></button><button onClick={()=>remove(item.code)} aria-label={`删除${item.name}`}>×</button></div>)}</div><div className="stock-add-row"><input value={newCode} onChange={e=>setNewCode(e.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" autoComplete="off" placeholder="6位代码"/><input value={newName} onChange={e=>setNewName(e.target.value)} autoComplete="off" placeholder="股票名称"/><button onClick={add}>＋ 添加</button></div>{listError&&<small className="list-error">{listError}</small>}<small>点击股票设为默认；删除和添加会同步到操盘台与多股监控。</small></div></div><div className="onboarding-step"><b>02</b><div><span>计划底仓</span><div className="share-setup"><button onClick={()=>setShares(Math.max(0,shares-100))}>−</button><label><input type="text" inputMode="numeric" autoComplete="off" value={shares||''} onChange={e=>setShares(Math.max(0,Number(e.target.value.replace(/\D/g,''))||0))}/><em>股</em></label><button onClick={()=>setShares(shares+100)}>＋</button></div><small>可以直接输入股数，也可以按每次 100 股增减；收盘应恢复到这个数量。</small></div></div><div className="onboarding-step"><b>03</b><div><span>风险偏好</span><div className="risk-options">{['稳健','平衡','积极'].map(item=><button className={risk===item?'active':''} onClick={()=>setRisk(item)} key={item}>{item}</button>)}</div><small>仅调整信号频率，不能绕过可卖数量和当日闭环规则。</small></div></div><button className="onboarding-save" onClick={()=>onSave({stock,baseShares:shares,risk},list)}>保存并同步 <span>→</span></button></div></div>;
}

const watchRows = [
  { code:'601899',name:'洛阳钼业',price:'27.70',change:'+1.28%',radar:72,signal:'反T观察',reason:'高开转弱 · 等待回落确认',score:8,position:'底仓正常',tone:'watch' },
  { code:'601012',name:'隆基绿能',price:'18.36',change:'-0.42%',radar:23,signal:'禁止正T',reason:'市场风险区 · 雷达硬拦截',score:5,position:'无未闭环',tone:'blocked' },
  { code:'000063',name:'中兴通讯',price:'33.12',change:'+0.35%',radar:81,signal:'提高门槛',reason:'强势市场 · 反T需10分确认',score:9,position:'等待闭环',tone:'warning' },
  { code:'600519',name:'贵州茅台',price:'1,678.01',change:'-0.18%',radar:91,signal:'等待回落',reason:'市场过热 · 禁止追高卖飞',score:7,position:'底仓正常',tone:'hot' },
];

function MultiWatchView({stocks,onOpen,onManage}:{stocks:typeof initialStocks;onOpen:(index:number)=>void;onManage:()=>void}) {
  const [filter,setFilter]=useState('全部');
  const allRows=stocks.map(item=>watchRows.find(row=>row.code===item.code)||{...item,radar:72,signal:'等待数据',reason:'已加入监控，等待行情刷新',score:0,position:'底仓正常',tone:'watch'});
  const rows=allRows.filter(row=>filter==='全部'||(filter==='有机会'?row.score>=8:filter==='被拦截'?row.tone==='blocked':row.position==='等待闭环'));
  const opportunities=allRows.filter(row=>row.score>=8).length;
  const blocked=allRows.filter(row=>row.tone==='blocked').length;
  const unclosed=allRows.filter(row=>row.position==='等待闭环').length;
  return <section className="module-view watch-view">
    <div className="module-head"><div><span className="eyebrow">MULTI-ASSET RADAR</span><h1>多股实时监控</h1><p>统一使用市场雷达和 Smart‑T 决策门控，先显示风险，再显示机会。</p></div><div className="module-status"><i/>{stocks.length}只监控中 · 218ms</div></div>
    <div className="watch-summary"><div><span>监控股票</span><b>{stocks.length}</b><small>盘中自动刷新</small></div><div><span>可执行机会</span><b className="teal">{opportunities}</b><small>确认分达到门槛</small></div><div><span>门控拦截</span><b>{blocked}</b><small>弱市禁止激进正T</small></div><div><span>待闭环</span><b className="amber-text">{unclosed}</b><small>优先级高于新信号</small></div><div><span>市场雷达</span><b>72</b><small>震荡区间</small></div></div>
    <div className="watch-toolbar"><div>{['全部','有机会','被拦截','待闭环'].map(item=><button className={filter===item?'active':''} onClick={()=>setFilter(item)} key={item}>{item}</button>)}</div><button className="watch-add" onClick={onManage}>＋ 管理监控股票</button></div>
    <div className="watch-table"><div className="watch-row watch-title"><span>股票</span><span>最新价</span><span>市场雷达</span><span>Smart‑T状态</span><span>策略解释</span><span>确认分</span><span>仓位状态</span><span/></div>{rows.map(row=><div className="watch-row" key={row.code}><span className="watch-stock"><b>{row.name}</b><small>{row.code}</small></span><span><b>{row.price}</b><small className={row.change.startsWith('-')?'negative':'positive'}>{row.change}</small></span><span><b>{row.radar}</b><small>{row.radar<25?'风险区':row.radar>=88?'过热区':row.radar>=75?'强势区':'震荡区'}</small></span><em className={`watch-pill ${row.tone}`}>{row.signal}</em><span className="watch-reason">{row.reason}</span><span className="score-dots">{[1,2,3,4,5].map(n=><i className={n<=Math.ceil(row.score/2)?'on':''} key={n}/>)}<small>{row.score}/10</small></span><span className={row.position==='等待闭环'?'amber-text':''}>{row.position}</span><button onClick={()=>onOpen(stocks.findIndex(item=>item.code===row.code))}>进入操盘台 →</button></div>)}</div>
    <div className="watch-rule"><b>雷达门控规则</b><span>&lt;25 风险区：禁止激进正T</span><span>25–74：按策略档位执行</span><span>75–87：反T门槛提高</span><span>≥88：必须等待真实回落</span></div>
  </section>;
}

const marketStrategies = [
  {rank:1,name:'胡萝卜波段兔',author:'A客户',mode:'模拟盘',win:78,returns:8.6,drawdown:2.1,cycles:41,days:36,risk:'中风险',price:0,followers:126,tags:['VWAP','反T','量能确认'],summary:'高开转弱后等待回抽失败，分批反T；14:50前强制恢复底仓。'},
  {rank:2,name:'稳稳闭环兔',author:'量化小林',mode:'模拟盘',win:72,returns:6.9,drawdown:1.2,cycles:68,days:63,risk:'低风险',price:19,followers:284,tags:['低回撤','正反T','硬风控'],summary:'以低频高确认信号为主，单次不超过底仓1/4，连续失败两次即停止。'},
  {rank:3,name:'开盘雷达兔',author:'北辰',mode:'回测',win:69,returns:11.3,drawdown:4.8,cycles:93,days:90,risk:'高风险',price:39,followers:91,tags:['集合竞价','开盘30分','趋势过滤'],summary:'聚焦09:35至10:00，只使用当时已出现数据判断低开转强与高开转弱。'},
  {rank:4,name:'午后均值兔',author:'青禾',mode:'模拟盘',win:74,returns:5.2,drawdown:1.9,cycles:37,days:45,risk:'中风险',price:9,followers:76,tags:['均值回归','VWAP','午后'],summary:'午后偏离VWAP后等待量价收敛，优先完成已有循环，不追逐新信号。'},
  {rank:5,name:'新锐挑战兔',author:'NeoQuant',mode:'回测',win:66,returns:13.7,drawdown:6.4,cycles:29,days:22,risk:'高风险',price:0,followers:48,tags:['灵敏档','超买超卖','小样本'],summary:'灵敏型候选策略，收益较高但样本量较少，目前仅允许历史回测与模拟观察。'},
];

function StrategyMarketView(){
  const [sort,setSort]=useState('综合榜');
  const [selected,setSelected]=useState<(typeof marketStrategies)[number]|null>(null);
  const [subscribed,setSubscribed]=useState<string[]>([]);
  const [publishing,setPublishing]=useState(false);
  const rows=[...marketStrategies].sort((a,b)=>sort==='收益榜'?b.returns-a.returns:sort==='低回撤榜'?a.drawdown-b.drawdown:sort==='胜率榜'?b.win-a.win:a.rank-b.rank);
  const follow=(name:string)=>setSubscribed(items=>items.includes(name)?items.filter(item=>item!==name):[...items,name]);
  return <section className="market-view">
    <div className="market-hero"><div><span className="eyebrow">RABBIT STRATEGY MARKET</span><h1>策略智能体排行榜</h1><p>发现、比较并模拟跟随优秀的用户策略。所有指标都同时展示样本与风险，不用单一胜率制造错觉。</p></div><button onClick={()=>setPublishing(true)}>＋ 发布我的策略</button></div>
    <div className="market-guard"><b>测试版安全边界</b><span>支持策略发布、订阅与模拟跟随</span><span>真实资金自动交易保持关闭</span><span>不代管资金，不承诺收益</span></div>
    <div className="market-stats"><div><span>公开策略</span><b>128</b><small>46个通过样本检查</small></div><div><span>今日模拟跟随</span><b>1,284</b><small>全部由用户主动开启</small></div><div><span>平均闭环胜率</span><b>68.4%</b><small>至少20次闭环才统计</small></div><div><span>风险暂停</span><b className="amber-text">7</b><small>触发回撤或仓位异常</small></div></div>
    <div className="market-toolbar"><div>{['综合榜','胜率榜','收益榜','低回撤榜'].map(item=><button className={sort===item?'active':''} onClick={()=>setSort(item)} key={item}>{item}</button>)}</div><span>排行榜每个交易日收盘后更新</span></div>
    <div className="market-list"><div className="market-row market-title"><span>排名 / 策略</span><span>验证状态</span><span>胜率</span><span>扣费净收益</span><span>最大回撤</span><span>样本</span><span>订阅</span><span/></div>{rows.map(item=><div className="market-row" key={item.name}><span className="market-name"><i>{item.rank<=3?`TOP ${item.rank}`:`#${item.rank}`}</i><b>{item.name}</b><small>{item.author} · {item.tags.join(' / ')}</small></span><span><em className={item.mode==='模拟盘'?'verified':'backtested'}>{item.mode}</em><small>{item.days}个交易日</small></span><strong>{item.win}%</strong><strong className="teal">+{item.returns}%</strong><strong>-{item.drawdown}%</strong><span><b>{item.cycles}次闭环</b><small>{item.risk}</small></span><span><b>{item.price===0?'免费':`¥${item.price}/月`}</b><small>{item.followers}人关注</small></span><button onClick={()=>setSelected(item)}>查看策略 →</button></div>)}</div>
    {selected&&<div className="market-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null)}}><div className="strategy-detail"><button className="detail-close" onClick={()=>setSelected(null)}>×</button><span className="eyebrow">STRATEGY PROFILE · #{selected.rank}</span><h2>{selected.name}</h2><p>{selected.summary}</p><div className="detail-author"><span>创建者</span><b>{selected.author}</b><em>{selected.mode} · {selected.days}个交易日</em></div><div className="detail-metrics"><div><span>闭环胜率</span><b>{selected.win}%</b></div><div><span>扣费净收益</span><b className="teal">+{selected.returns}%</b></div><div><span>最大回撤</span><b>-{selected.drawdown}%</b></div><div><span>有效样本</span><b>{selected.cycles}次</b></div></div><div className="detail-rules"><h3>策略说明</h3><p>费用、滑点、T+1可卖数量和尾盘恢复为系统硬风控，订阅者不能关闭。</p><p>模拟跟随只生成提醒和虚拟成交记录，不会连接或操作真实券商账户。</p></div><button className={subscribed.includes(selected.name)?'followed':''} onClick={()=>follow(selected.name)}>{subscribed.includes(selected.name)?'✓ 已加入模拟跟随':selected.price===0?'免费模拟跟随':`订阅并模拟跟随 · ¥${selected.price}/月`}</button><small>历史表现不代表未来收益 · 可随时停止跟随</small></div></div>}
    {publishing&&<div className="market-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setPublishing(false)}}><div className="publish-card"><button className="detail-close" onClick={()=>setPublishing(false)}>×</button><span className="eyebrow">PUBLISH STRATEGY</span><h2>发布我的策略智能体</h2><p>测试版将先把策略送入回测与模拟观察，不会直接进入真实交易。</p><label>策略名称<input placeholder="例如：我的稳健反T兔"/></label><label>策略说明<textarea placeholder="用直白语言说明买入、卖出、仓位和停止条件"/></label><div><label>分享方式<select><option>免费分享</option><option>付费订阅（审核后开放）</option></select></label><label>风险等级<select><option>低风险</option><option>中风险</option><option>高风险</option></select></label></div><button onClick={()=>setPublishing(false)}>保存草稿并进入回测 →</button><small>至少完成20次有效闭环后，才会显示在公开排行榜。</small></div></div>}
  </section>;
}

function TrainingView({running,progress,onRun}:{running:boolean;progress:number;onRun:()=>void}) {
  return <section className="module-view training-view">
    <div className="module-head"><div><span className="eyebrow">QUANTBRAIN LAB</span><h1>四兔持续训练中心</h1><p>每5分钟运行一轮影子训练；盘中只学习、不自动晋升，正式策略仍由人工确认。</p></div><button className="lab-run" onClick={onRun} disabled={running}>{running?'本轮训练中…':progress===100?'立即运行下一轮':'继续本轮训练'}<span>→</span></button></div>
    <div className="lab-progress"><div className="lab-progress-head"><span>批次 20260712-043102 · 第12轮 · 近5日严格影子回放</span><b>{running?'正在训练':progress===100?'下轮 09:41':'已暂停'} · {progress}%</b></div><i><em style={{width:`${progress}%`}}/></i><div className="lab-stages"><span className="done">读取新鲜数据</span><span className={progress>=40?'done':''}>训练兔回放</span><span className={progress>=70?'done':''}>挑战兔验证</span><span className={progress>=90?'done':''}>风控兔检查</span><span className={progress===100?'done':''}>等待人工晋升</span></div></div>
    <div className="lab-grid">{agents.map((agent,index)=><article className="lab-agent" key={agent.name}><div><span className={`agent-icon a${index}`}><img src={agent.avatar} alt={`${agent.name} AI头像`}/></span><p><b>{agent.name}</b><small>{agent.role}</small></p><em>{index===0&&running?'运行中':index===1?'样本外验证':index===2?'正式策略锁定':'风险低'}</em></div><strong>{index===0?`${progress}%`:agent.value}</strong><i><span style={{width:index===0?`${progress}%`:agent.value}}/></i><p>{index===0?'只在历史分时数据上学习，不接触正式账户。':index===1?'用训练兔未见过的样本检验候选参数。':index===2?'只有人工确认后才接收新版本。':'回撤、费用和仓位异常拥有一票否决权。'}</p></article>)}</div>
    <div className="lab-results"><div className="lab-metrics"><h2>本轮训练结果</h2><div><p><span>测试范围</span><b>10只 / 5日</b></p><p><span>触发信号</span><b>18 / 50</b></p><p><span>模拟成交</span><b>12</b></p><p><span>胜率</span><b>66.7%</b></p><p><span>净盈亏</span><b className="teal">+¥2,416</b></p><p><span>费用</span><b>-¥386</b></p></div><small>没有触发交易的批次不会被错误计为亏损；候选参数必须通过样本外验证和风险检查。</small></div><div className="promotion-card"><span>候选版本 QB‑20260712‑04</span><h2>等待人工晋升</h2><p>胜率与净收益达标，但样本量仍偏少。建议继续积累至少 20 个交易日后再评审。</p><button disabled>晋升为正式策略</button><small>自动晋升已关闭</small></div></div>
    <div className="lab-log"><h2>训练记录</h2>{[['04:31:02','训练兔','开始获取10只股票近5日分时数据'],['04:31:18','训练兔','完成50个样本窗口，记录18个有效信号'],['04:31:24','挑战兔','样本外胜率66.7%，候选进入风控检查'],['04:31:31','风控兔','最大回撤1.36%，费用占毛利13.8%'],['04:31:34','系统','本轮完成，候选参数等待人工晋升']].map(row=><div key={row[0]}><time>{row[0]}</time><b>{row[1]}</b><span>{row[2]}</span></div>)}</div>
  </section>;
}

const ledgerRows = [
  { time: "09:41:26", side: "卖出", price: "27.86", qty: "2,000", cycle: "反T-01", fee: "¥41.79", result: "+¥578.21", status: "已配对" },
  { time: "10:08:14", side: "买入", price: "27.55", qty: "2,000", cycle: "反T-01", fee: "¥13.78", result: "—", status: "已配对" },
  { time: "10:36:09", side: "买入", price: "27.38", qty: "2,200", cycle: "待配对", fee: "¥15.06", result: "—", status: "仓位偏离" },
  { time: "11:12:32", side: "卖出", price: "27.71", qty: "1,000", cycle: "正T-02", fee: "¥20.78", result: "+¥309.22", status: "已配对" },
  { time: "13:48:51", side: "买入", price: "27.39", qty: "1,000", cycle: "正T-02", fee: "¥6.85", result: "—", status: "已配对" },
];

function HoldingsView() {
  const [filter, setFilter] = useState("全部流水");
  const [planDone, setPlanDone] = useState(false);
  const visibleRows = ledgerRows.filter(row => filter === "全部流水" || (filter === "未配对" ? row.status !== "已配对" : row.side === filter));
  return <section className="holdings-view">
    <div className="holdings-head">
      <div><span className="eyebrow">POSITION RECONCILIATION</span><h1>持仓与交易对账</h1><p>把底仓、当日成交和已完成 T 循环放在同一张账上，先核对仓位，再判断下一步。</p></div>
      <div className="reconcile-state"><i/><span>已同步至 11:18:06</span><b>模拟数据</b></div>
    </div>
    <div className="position-overview">
      <div className="position-identity"><span>601899</span><h2>洛阳钼业</h2><small>沪A · T+1</small></div>
      <div className="position-metric"><span>计划底仓</span><b>6,000<small> 股</small></b><em>策略基准</em></div>
      <div className="position-metric"><span>当前持仓</span><b>8,200<small> 股</small></b><em>成本 ¥27.44</em></div>
      <div className="position-metric"><span>剩余可卖旧仓</span><b>3,000<small> 股</small></b><em>足够闭合 2,200 股</em></div>
      <div className="position-metric warning"><span>当日未闭合</span><b>+2,200<small> 股</small></b><em>异常 · 收盘前归零</em></div>
      <div className="position-metric profit"><span>今日净收益</span><b>+¥887.43</b><em>已扣 ¥98.26 费用</em></div>
    </div>
    <div className="reconcile-grid">
      <div className="ledger-panel">
        <div className="panel-top"><div><h2>今日成交流水</h2><p>成交按时间排序，系统自动寻找可闭合的正T / 反T循环。</p></div><button>＋ 手动补录成交</button></div>
        <div className="ledger-filter">{["全部流水","买入","卖出","未配对"].map(item=><button key={item} className={filter===item?'active':''} onClick={()=>setFilter(item)}>{item}<span>{item==='全部流水'?5:item==='买入'?3:item==='卖出'?2:1}</span></button>)}</div>
        <div className="ledger-table">
          <div className="ledger-row ledger-title"><span>成交时间</span><span>方向</span><span>成交价</span><span>数量</span><span>配对循环</span><span>费用</span><span>循环净收益</span><span>状态</span></div>
          {visibleRows.map(row=><div className="ledger-row" key={row.time}><span>{row.time}</span><span className={row.side==='买入'?'buy-text':'sell-text'}>{row.side}</span><b>{row.price}</b><span>{row.qty}</span><span>{row.cycle}</span><span>{row.fee}</span><b className={row.result.startsWith('+')?'positive':''}>{row.result}</b><em className={row.status==='已配对'?'matched':'unmatched'}>{row.status}</em></div>)}
        </div>
      </div>
      <aside className="recovery-panel">
        <span className="recovery-kicker">INTRADAY CLOSE ALERT</span><h2>正T尚未闭合：多买 2,200 股</h2><p>当前持仓高于底仓 36.7%。新买股票本身当天不可卖，但仍有 3,000 股昨日旧仓可卖，可用其中 2,200 股在收盘前完成等量闭环。</p>
        <div className="close-deadline"><span>最迟处理时间</span><b>14:50</b><em>距风控检查 03:31:54</em></div>
        <div className="recovery-scale"><div><span>目标底仓 6,000</span><b>当前 8,200</b></div><i><em/></i><small>目标：收盘时实际持仓恢复 6,000 股，未归零不得计为完成一次T。</small></div>
        <div className="recovery-steps"><h3>当日闭环规则</h3><div><b>01</b><p><strong>立即停止继续买入</strong><span>未配对数量归零前，冻结新的正T与补仓信号。</span></p></div><div><b>02</b><p><strong>卖出等量昨日旧仓</strong><span>在价格与风险允许时分批卖出共 2,200 股，将持仓恢复到底仓。</span></p></div><div><b>03</b><p><strong>14:50 强制升级告警</strong><span>仍未闭合则标记“做T失败”，转为红色异常隔夜仓，不计策略收益。</span></p></div></div>
        <button className={planDone?'done':''} onClick={()=>setPlanDone(!planDone)}>{planDone?'✓ 当日平仓提醒已开启':'开启当日平仓提醒'}<span>→</span></button>
        <small className="recovery-note">这里只生成风控提醒，不会自动下单；自动交易接口仍保持关闭。</small>
      </aside>
    </div>
    <div className="cycle-summary"><div><span>今日买入</span><b>5,200 股</b><small>均价 ¥27.44</small></div><div><span>今日卖出</span><b>3,000 股</b><small>均价 ¥27.81</small></div><div><span>已闭合循环</span><b>2 次</b><small>1 次正T · 1 次反T</small></div><div><span>待当日闭合</span><b className="warn">2,200 股</b><small>收盘目标必须为 0</small></div><div><span>已确认净收益</span><b>¥887.43</b><small>未闭合交易暂不计入</small></div></div>
  </section>;
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
        <label>股票代码<div className="field static-field"><b>601899</b><span>洛阳钼业</span></div></label>
        <div className="field-pair"><label>开始日期<div className="field static-field date-display"><b>2026-06-01</b><span>起</span></div></label><label>结束日期<div className="field static-field date-display"><b>2026-07-11</b><span>止</span></div></label></div>
        <label>策略档位<div className="profile-picker">{strategyProfiles.slice(0,4).map(item=><button type="button" className={profile===item?'active':''} onClick={()=>setProfile(item)} key={item}>{item.replace('档','')}</button>)}</div></label>
        <div className="field-pair"><label>模拟资金<NumberStepper value={capital} unit="元" step={10000} min={50000} onChange={setCapital}/></label><label>真实底仓<NumberStepper value={baseShares} unit="股" step={100} min={0} onChange={setBaseShares}/></label></div>
        <div className="field-pair"><label>昨日可卖<NumberStepper value={sellable} unit="股" step={100} min={0} onChange={setSellable}/></label><label>单次上限<div className="field static-field"><b>{Math.floor(Math.min(baseShares, sellable)/3/100)*100}</b><span>股</span></div></label></div>
        <div className="cost-box"><div><span>佣金</span><NumberStepper value={feeRate} unit="%" step={0.005} min={0} decimals={3} onChange={setFeeRate}/></div><div><span>单边滑点</span><NumberStepper value={slippage} unit="%" step={0.005} min={0} decimals={3} onChange={setSlippage}/></div><div><span>印花税</span><b>卖出 0.05%</b></div></div>
        <button className="run-backtest" onClick={run} disabled={running}>{running ? '正在逐分钟重放…' : '运行可信回测'}<span>→</span></button>
        <p className="config-note">连续失败 2 次当日停止；14:30 后不新开 T；14:50 前必须恢复计划底仓，否则整笔记为失败。</p>
      </aside>
      <div className="backtest-results">
        <div className="result-summary">
          <div className="result-primary"><span>净收益</span><strong>{done ? '+¥ 8,426.30' : '—'}</strong><em>+4.21%</em></div>
          <div><span>毛收益</span><b>¥ 11,208.00</b><small>未扣费用</small></div><div><span>费用与滑点</span><b>-¥ 2,781.70</b><small>占毛利 24.82%</small></div><div><span>最大回撤</span><b>-1.36%</b><small>¥ 2,718.00</small></div>
        </div>
        <div className="equity-panel"><div className="panel-heading"><div><h2>资金曲线</h2><span>2026-06-01 — 2026-07-11</span></div><div className="curve-legend"><span><i/>净资产</span><span><i/>基准持仓</span></div></div><svg viewBox="0 0 800 220" preserveAspectRatio="none" aria-label="回测资金曲线"><defs><linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#28d7c4" stopOpacity=".22"/><stop offset="1" stopColor="#28d7c4" stopOpacity="0"/></linearGradient></defs>{[40,80,120,160,200].map(y=><line key={y} x1="0" x2="800" y1={y} y2={y} className="equity-grid"/>)}<path d="M0 190 C55 176 82 182 120 160 S190 170 230 142 S302 151 350 120 S430 132 470 98 S550 112 600 80 S680 96 730 54 S772 60 800 32 L800 220 L0 220 Z" fill="url(#equityFill)"/><path d="M0 190 C55 176 82 182 120 160 S190 170 230 142 S302 151 350 120 S430 132 470 98 S550 112 600 80 S680 96 730 54 S772 60 800 32" className="equity-line"/><path d="M0 185 C130 174 220 178 320 150 S520 140 800 110" className="benchmark-line"/></svg></div>
        <div className="result-bottom"><div className="metric-table"><div><span>交易日</span><b>29</b></div><div><span>当日闭环</span><b>41 / 43</b></div><div><span>正T / 反T</span><b>18 / 23</b></div><div><span>闭环胜率</span><b className="teal">68.29%</b></div><div><span>收盘仓位一致率</span><b>95.35%</b></div><div><span>平均闭环时间</span><b>21分</b></div></div><div className="failure-panel"><h3>未执行与失败原因</h3><p><span>价差不足 0.5%</span><b>17次</b></p><p><span>趋势方向拦截</span><b>9次</b></p><p><span>可卖旧仓不足</span><b>2次</b></p><p><span>14:50 未恢复底仓</span><b className="failure-alert">2次</b></p></div></div>
      </div>
    </div>
  </section>;
}

function NumberStepper({value,unit,step,min,onChange,decimals=0}:{value:number;unit:string;step:number;min:number;onChange:(value:number)=>void;decimals?:number}) {
  const format=(number:number)=>decimals ? number.toFixed(decimals) : number.toLocaleString('zh-CN');
  return <div className="number-stepper" role="group" aria-label={`${value}${unit}`}>
    <button type="button" onClick={()=>onChange(Math.max(min,Number((value-step).toFixed(decimals))))} aria-label={`减少${step}${unit}`}>−</button>
    <span><b>{format(value)}</b><em>{unit}</em></span>
    <button type="button" onClick={()=>onChange(Number((value+step).toFixed(decimals)))} aria-label={`增加${step}${unit}`}>＋</button>
  </div>;
}
