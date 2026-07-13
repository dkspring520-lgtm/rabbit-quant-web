"use client";

import { useEffect, useMemo, useState } from "react";

type MarketBar = { date:string; open:number; close:number; high:number; low:number; volume:number; amount:number };
type MarketData = { provider:string; delayed:boolean; trial?:boolean; fetchedAt:string; sourceTimestamp?:string|null; quote:{ code:string; name:string; price:number|null; change:number|null; changePercent:number|null; open:number|null; high:number|null; low:number|null }; bars:MarketBar[]; minutes?:{time:string;price:number;volume:number}[] };
type StockState = { label:string; level:"up"|"flat"|"down"|"risk"; score:number; summary:string; action:string };

function recognizeStockState(bars: MarketBar[], quote: MarketData["quote"] | undefined, minutes: { price:number }[]): StockState {
  const closes = bars.map(bar => bar.close).filter(Number.isFinite);
  if (closes.length < 20 || !quote?.price) return { label:"数据积累中", level:"flat", score:0, summary:"日线样本不足，暂不输出交易倾向。", action:"先观察，不开新 T" };
  const last = quote.price;
  const average = (values:number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const ma5 = average(closes.slice(-5)); const ma20 = average(closes.slice(-20));
  const fiveDay = (last - closes.at(-6)!) / closes.at(-6)!;
  const recentHigh = Math.max(...closes.slice(-20)); const drawdown = (last - recentHigh) / recentHigh;
  const intradayRange = quote.high && quote.low ? (quote.high - quote.low) / last : 0;
  const intradayMove = minutes.length > 1 ? (last - minutes[0].price) / minutes[0].price : 0;
  if (quote.changePercent !== null && (quote.changePercent <= -5 || intradayRange >= .07 || drawdown <= -.1)) return { label:"极端风险", level:"risk", score:92, summary:"跌幅、振幅或回撤触发风险阈值。", action:"暂停做 T，等待波动收敛" };
  if (last > ma5 && ma5 > ma20 && fiveDay >= .035 && intradayMove >= 0) return { label:"强势上涨", level:"up", score:82, summary:"价格站上 5/20 日均线，短期趋势向上。", action:"只做正 T，回踩确认再参与" };
  if (last >= ma20 && fiveDay > -.015) return { label:"弱势上涨", level:"up", score:58, summary:"趋势仍偏多，但动能和确认度一般。", action:"轻仓正 T，避免追高" };
  if (last < ma20 && (fiveDay <= -.025 || intradayMove < -.01)) return { label:"弱势下跌", level:"down", score:73, summary:"价格位于中期均线下方，反弹可信度偏低。", action:"优先减仓或反 T，不抄底" };
  return { label:"横盘震荡", level:"flat", score:46, summary:"价格围绕均线反复，方向尚未形成。", action:"只在区间边缘低吸高抛" };
}

type ReplayAction = { time:string; side:"卖出"|"买回"; price:number; quantity:number; curveIndex:number };
type BacktestResult = { net:number; gross:number; fees:number; maxDrawdown:number; trades:number; wins:number; days:number; curve:number[]; status:string; actions:ReplayAction[] };

function runDailyBacktestLegacy(bars: MarketBar[], capital:number, baseShares:number, sellable:number, feeRate:number, slippage:number): BacktestResult {
  let cash = capital;
  let peak = capital;
  let maxDrawdown = 0;
  let gross = 0;
  let fees = 0;
  let trades = 0;
  let wins = 0;
  const curve = [capital];
  for (let index = 1; index < bars.length; index += 1) {
    const previous = bars[index - 1]; const bar = bars[index];
    const quantity = Math.floor(Math.min(baseShares, sellable) / 3 / 100) * 100;
    if (!quantity || !Number.isFinite(bar.open) || !Number.isFinite(bar.close)) continue;
    const threshold = 0.005 + feeRate / 100 + slippage / 100;
    const returnRate = (bar.close - previous.close) / previous.close;
    if (Math.abs(returnRate) < threshold) { curve.push(cash); continue; }
    const buyPrice = Math.min(bar.open, bar.close) * (1 + slippage / 100);
    const sellPrice = Math.max(bar.open, bar.close) * (1 - slippage / 100);
    const pnl = Math.max(0, sellPrice - buyPrice) * quantity;
    const cost = (buyPrice + sellPrice) * quantity * feeRate / 100 + sellPrice * quantity * 0.0005;
    gross += pnl; fees += cost; trades += 1; if (pnl > cost) wins += 1;
    cash += pnl - cost;
    peak = Math.max(peak, cash); maxDrawdown = Math.max(maxDrawdown, (peak - cash) / peak);
    curve.push(cash);
  }
  return { net: cash - capital, gross, fees, maxDrawdown, trades, wins, days: bars.length, curve, status: trades ? "已按真实日线数据计算" : "样本中没有符合阈值的交易", actions: [] };
}

function money(value:number) { return `${value >= 0 ? "+" : "-"}¥ ${Math.abs(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`; }

function runIntradayBlindReplay(minutes: {time:string;price:number;volume:number}[], capital:number, baseShares:number, sellable:number, feeRate:number, slippage:number, minCommission:boolean, slippageMode:"percent"|"tick", forceCloseTime:string): BacktestResult {
  const points=minutes.filter(point=>Number.isFinite(point.price) && point.price>0);
  const quantity=Math.floor(Math.min(baseShares,sellable)/3/100)*100;
  if(points.length<30 || !quantity) return {net:0,gross:0,fees:0,maxDrawdown:0,trades:0,wins:0,days:0,curve:[capital],status:"真实分时样本或可卖底仓不足，未生成交易",actions:[]};
  const start=Math.min(points.length-20,Math.max(15,Math.floor(points.length*.12)+Math.floor(Math.random()*Math.max(1,Math.floor(points.length*.18)))));
  let cash=capital,peak=capital,maxDrawdown=0,gross=0,fees=0,trades=0,wins=0,eligiblePoints=0,vwapSignals=0,pressureSignals=0;
  let soldPrice:number|null=null; const curve=[capital]; const actions:ReplayAction[]=[];
  for(let index=0;index<points.length;index+=1){
    const point=points[index];
    if(index<start) continue;
    const window=points.slice(Math.max(0,index-19),index+1);
    const totalVolume=window.reduce((sum,item)=>sum+Math.max(1,item.volume),0);
    const vwap=window.reduce((sum,item)=>sum+item.price*Math.max(1,item.volume),0)/totalVolume;
    const prices=window.map(item=>item.price); const range=(Math.max(...prices)-Math.min(...prices))/vwap;
    const threshold=Math.max(.0012,range*.42); const deviation=(point.price-vwap)/vwap;
    const previous=points[Math.max(0,index-1)];
    const resistance=Math.max(...points.slice(Math.max(0,index-10),index).map(item=>item.price),point.price);
    const averageVolume=window.reduce((sum,item)=>sum+Math.max(1,item.volume),0)/window.length;
    const sellWindow=point.time>="0945" && point.time<="1430";
    const pressureExhaustion=point.price>=resistance*.996 && point.price<=previous.price*1.0015 && (point.volume<=averageVolume*1.8 || deviation>=threshold*1.35);
    const slip=slippageMode==="tick" ? slippage : point.price*slippage/100;
    const commission=(turnover:number)=>Math.max(minCommission?5:0,turnover*feeRate/100);
    if(index>=20 && sellWindow) eligiblePoints++;
    if(index>=20 && sellWindow && deviation>=threshold) vwapSignals++;
    if(index>=20 && sellWindow && pressureExhaustion) pressureSignals++;
    if(soldPrice===null && index>=20 && sellWindow && deviation>=threshold && pressureExhaustion){
      soldPrice=point.price-slip; fees+=commission(soldPrice*quantity)+soldPrice*quantity*.0005; trades+=1;
      actions.push({time:point.time,side:"卖出",price:soldPrice,quantity,curveIndex:curve.length});
    }
    const buySignal=index>=20 && ((deviation<=threshold*.35 && point.price>=previous.price) || deviation<=-threshold*.35);
    if(soldPrice!==null && (buySignal || point.time>=forceCloseTime || index===points.length-1)){
      const buyPrice=point.price+slip; const buyFee=commission(buyPrice*quantity); fees+=buyFee; const pnl=(soldPrice-buyPrice)*quantity; cash+=pnl; gross+=pnl; if(pnl>buyFee+commission(soldPrice*quantity)+soldPrice*quantity*.0005)wins++; actions.push({time:point.time,side:"买回",price:buyPrice,quantity,curveIndex:curve.length}); soldPrice=null;
    }
    const mark=cash+(soldPrice===null?0:(soldPrice-point.price)*quantity); peak=Math.max(peak,mark); maxDrawdown=Math.max(maxDrawdown,(peak-mark)/peak); curve.push(mark);
  }
  const noTradeReason = !eligiblePoints ? "随机起点后没有处于可开仓时段的样本" : !vwapSignals ? "价格未达到动态 VWAP 偏离阈值" : !pressureSignals ? "未出现压力位滞涨确认" : "信号未能在尾盘前完成闭环";
  return {net:cash-capital-fees,gross,fees,maxDrawdown,trades,wins,days:1,curve,status:trades?`融合策略 V3 完成：从 ${points[start].time} 开始逐点揭示，按动态 VWAP 与压力位滞涨执行反 T。`:`融合策略 V3 本次未形成完整反 T 条件：${noTradeReason}。`,actions};
}

const initialStocks = [
  { code: "601899", name: "紫金矿业", price: "--", change: "--" },
  { code: "601012", name: "隆基绿能", price: "--", change: "--" },
  { code: "000063", name: "中兴通讯", price: "--", change: "--" },
  { code: "600519", name: "贵州茅台", price: "--", change: "--" },
];

const canonicalStockNames: Record<string, string> = {
  "601899": "紫金矿业", "603993": "洛阳钼业", "601012": "隆基绿能", "000063": "中兴通讯", "600519": "贵州茅台"
};
const normalizeWatchlist = (list: { code:string; name:string; price:string; change:string }[]) => list.map(item => ({ ...item, name: canonicalStockNames[item.code] ?? item.name }));

const agents = [
  { avatar: "/agents/training.png", name: "训练兔", role: "严格模拟", state: "训练中", value: "76%" },
  { avatar: "/agents/challenger.png", name: "挑战兔", role: "影子验证", state: "待评审", value: "58%" },
  { avatar: "/agents/official.png", name: "正式兔", role: "冠军策略", state: "运行中", value: "82%" },
  { avatar: "/agents/risk.png", name: "风控兔", role: "回撤监控", state: "低风险", value: "12%" },
];
const strategyProfiles = ["稳健档","平衡档","灵敏档","量化学习","自定义策略"];


export default function Home() {
  const [authReady, setAuthReady] = useState(false);
  const [localAuth, setLocalAuth] = useState(false);
  const [accountName, setAccountName] = useState("jay cc");
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [preferences, setPreferences] = useState({stock:'601899 紫金矿业',baseShares:6000,risk:'稳健'});
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
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [marketError, setMarketError] = useState("");
  const [marketQuotes, setMarketQuotes] = useState<Record<string, MarketData["quote"]>>({});
  const [trialQuote, setTrialQuote] = useState<MarketData | null>(null);
  const [trialError, setTrialError] = useState("");
  const [starredRevision, setStarredRevision] = useState(0);
  const [indicatorsVisible, setIndicatorsVisible] = useState(true);
  const stock = stockList[activeStock] || stockList[0];
  const activeQuote = trialQuote?.quote ?? marketData?.quote;
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
  const minutePoints = useMemo(() => trialQuote?.minutes?.length ? trialQuote.minutes : marketData?.minutes ?? [], [trialQuote, marketData]);
  const chartModel = useMemo(() => {
    if (minutePoints.length < 2) return null;
    const prices=minutePoints.map(point=>point.price); const min=Math.min(...prices); const max=Math.max(...prices); const range=max-min||Math.max(max*.002,0.01);
    const pointAt=(point:{price:number},index:number)=>`${10+(index/(minutePoints.length-1))*900},${20+(max-point.price)/range*210}`;
    const path=`M${minutePoints.map(pointAt).join(' L')}`;
    let weighted=0, totalVolume=0; const vwap=minutePoints.map((point,index)=>{weighted+=point.price*Math.max(point.volume,1);totalVolume+=Math.max(point.volume,1);return pointAt({price:weighted/totalVolume},index)});
    const maxVolume=Math.max(...minutePoints.map(point=>point.volume),1);
    return {path,vwapPath:`M${vwap.join(' L')}`,min,max,last:minutePoints.at(-1)!,volumes:minutePoints.map((point,index)=>({x:10+(index/(minutePoints.length-1))*900,height:Math.max(2,point.volume/maxVolume*42),up:index===0||point.price>=minutePoints[index-1].price})),ticks:[max,max-range*.25,max-range*.5,max-range*.75,min]};
  },[minutePoints]);
  const stockState = useMemo(() => recognizeStockState(marketData?.bars ?? [], activeQuote, minutePoints), [marketData?.bars, activeQuote, minutePoints]);
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
          if(watchlist){const list=JSON.parse(watchlist);if(Array.isArray(list)&&list.length){const normalized=normalizeWatchlist(list);setStockList(normalized);localStorage.setItem(`rabbit-watchlist:${session.toLowerCase()}`,JSON.stringify(normalized));}}
          const savedStrategy=localStorage.getItem(`rabbit-custom-strategy:${session.toLowerCase()}`)||localStorage.getItem('rabbit-custom-strategy');
          if(savedStrategy)setCustomStrategy(savedStrategy);
        }
      } catch {}
      setAuthReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!localAuth || !stock?.code) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/market-data?code=${encodeURIComponent(stock.code)}`);
        if (!response.ok) throw new Error("行情服务暂不可用");
        const data = await response.json() as MarketData;
        if (!cancelled) { setMarketData(data); setMarketError(""); }
      } catch {
        if (!cancelled) { setMarketData(null); setMarketError("行情服务暂不可用，页面不会使用示例价格代替。"); }
      }
    };
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [localAuth, stock?.code]);
  useEffect(() => {
    if (!localAuth || !stockList.length) return;
    let cancelled = false;
    void Promise.all(stockList.map(async item => {
      const response = await fetch(`/api/market-data?code=${encodeURIComponent(item.code)}`);
      if (!response.ok) throw new Error("quote unavailable");
      const data = await response.json() as MarketData;
      return data.quote;
    })).then(quotes => {
      if (!cancelled) setMarketQuotes(Object.fromEntries(quotes.map(quote => [quote.code, quote])));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [localAuth, stockList]);
  useEffect(() => {
    if (!localAuth || !stock?.code) return;
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const response = await fetch(`/api/market-data?code=${encodeURIComponent(stock.code)}&mode=trial-realtime`, { cache: "no-store" });
        if (!response.ok) throw new Error("trial quote unavailable");
        const data = await response.json() as MarketData;
        if (!cancelled) { setTrialQuote(data); setTrialError(""); }
      } catch {
        if (!cancelled) { setTrialQuote(null); setTrialError("1 秒试用行情暂不可用，已保留公开延迟行情作为参考。"); }
      } finally { inFlight = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), 1_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [localAuth, stock?.code]);
  const starKey = localAuth && stock?.code ? `rabbit-star:${accountName.toLowerCase()}:${stock.code}` : "";
  const starred = useMemo(() => {
    void starredRevision;
    try { return Boolean(starKey && localStorage.getItem(starKey) === "1"); } catch { return false; }
  }, [starKey, starredRevision]);
  const toggleStar = () => {
    if (!starKey) return;
    try { localStorage.setItem(starKey, starred ? "0" : "1"); } catch {}
    setStarredRevision(value => value + 1);
  };

  if(!authReady) return <main className="auth-loading"><img src="/rabbit-brand-v2.png" alt="做T神器"/></main>;
  if(!localAuth) return <AuthView onAuthenticated={(name,isNew,remember)=>{setAccountName(name);setLocalAuth(true);try{const persistent=isNew||remember;(persistent?localStorage:sessionStorage).setItem('rabbit-auth-session',name);(persistent?sessionStorage:localStorage).removeItem('rabbit-auth-session');const saved=localStorage.getItem(`rabbit-prefs:${name.toLowerCase()}`);if(saved)setPreferences(JSON.parse(saved));else setOnboardingOpen(true);const watchlist=localStorage.getItem(`rabbit-watchlist:${name.toLowerCase()}`);if(watchlist){const list=JSON.parse(watchlist);if(Array.isArray(list)&&list.length){const normalized=normalizeWatchlist(list);setStockList(normalized);localStorage.setItem(`rabbit-watchlist:${name.toLowerCase()}`,JSON.stringify(normalized));}}const savedStrategy=localStorage.getItem(`rabbit-custom-strategy:${name.toLowerCase()}`)||localStorage.getItem('rabbit-custom-strategy');if(savedStrategy)setCustomStrategy(savedStrategy)}catch{} if(isNew)setOnboardingOpen(true)}}/>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand brand-lockup" aria-label="做T神器 Rabbit Smart-T">
          <span className="brand-emblem"><img className="rabbit-logo" src="/rabbit-brand-v2.png" alt="双兔与上涨T品牌标志"/><i /></span>
          <span className="brand-type"><strong><em>做T</em><span>神器</span></strong><small>SMART INTRADAY SYSTEM</small></span>
        </div>
        <nav className="main-nav" aria-label="主导航">
          {['首页','操盘台','懂它','多股监控','策略市场','持仓对账','模拟回测','智能训练'].map((item) => <button onClick={() => setActiveView(item)} className={activeView === item ? 'active' : ''} key={item}>{item}</button>)}
        </nav>
        <div className="top-actions">
          <span className="market-open"><i />{trialQuote ? "1 秒试用监控" : marketData ? "公开行情已更新" : "行情连接中"}</span>
          <span className="auto-off"><i />自动交易未连接</span>
          <span className="clock">{trialQuote ? new Date(trialQuote.sourceTimestamp || trialQuote.fetchedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : marketData ? new Date(marketData.fetchedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "--:--"}</span>
          <button className="profile-cycle" onClick={()=>setProfile(strategyProfiles[(strategyProfiles.indexOf(profile)+1)%strategyProfiles.length])} aria-label={`当前策略${profile}，点击切换`}><span>{profile}</span><i>⌄</i></button>
          <button className="strategy-help" onClick={()=>setStrategyOpen(true)}>策略说明</button>
          <button className="account-button" onClick={()=>setAccountOpen(true)} aria-label="打开账户中心"><span>{accountName.slice(0,1).toUpperCase()}</span><b>{accountName}</b><i>⌄</i></button>
          <button className="icon-button" onClick={()=>setOnboardingOpen(true)} aria-label="打开偏好设置">⌘</button>
        </div>
      </header>

      {activeView === "首页" ? <HomeView onNavigate={setActiveView} stockCount={stockList.length} /> : activeView === "操盘台" ? <>
      <section className="ticker" aria-label="股票监控列表">
        {stockList.map((item, index) => (
          <div className={`ticker-item ${activeStock === index ? 'selected' : ''}`} key={item.code}>{(()=>{const quote=marketQuotes[item.code];const change=quote?.changePercent == null ? item.change : `${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%`;return <><button onClick={() => setActiveStock(index)}><span>{item.code} {quote?.name || item.name}</span><b>{quote?.price?.toFixed(2) ?? item.price}</b><em className={change.startsWith('-') ? 'down' : ''}>{change}</em></button><button className="ticker-remove" onClick={()=>removeStock(index)} disabled={stockList.length<=1} aria-label={`删除${item.name}`}>×</button></>})()}</div>
        ))}
        <button className="ticker-add" onClick={()=>setOnboardingOpen(true)}>＋ 管理监控</button>
      </section>

      <section className="stock-head">
        <div className="stock-identity">
          <span className="stock-code">{stock.code}</span><h1>{activeQuote?.name || stock.name}</h1><button className="star" onClick={toggleStar} aria-label={starred ? "取消收藏当前股票" : "收藏当前股票"} aria-pressed={starred}>{starred ? "★" : "☆"}</button>
        </div>
        <div className={`quote ${activeQuote?.changePercent != null && activeQuote.changePercent < 0 ? "down" : activeQuote?.changePercent === 0 ? "flat" : ""}`}><strong>{activeQuote?.price?.toFixed(2) ?? "--"}</strong><span>{activeQuote?.changePercent == null ? "--" : `${activeQuote.changePercent >= 0 ? "+" : ""}${activeQuote.changePercent.toFixed(2)}%`}</span></div>
        <div className="quote-metrics">
          <span>今开 <b>{activeQuote?.open?.toFixed(2) ?? "--"}</b></span><span>最高 <b>{activeQuote?.high?.toFixed(2) ?? "--"}</b></span><span>最低 <b>{activeQuote?.low?.toFixed(2) ?? "--"}</b></span><span>数据 <b className="teal">{trialQuote ? "1 秒试用" : "公开延迟"}</b></span><span>分钟线 <b className="teal">{minutePoints.length ? `${minutePoints.length} 点同步` : "等待数据"}</b></span>
        </div>
        <div className="auction"><span>集合竞价</span><b>高开转弱 · 反T优先</b><small>3/4 条件确认</small></div>
      </section>

      <section className="workspace">
        <div className="chart-zone">
          <div className="chart-tools">
            <div className="legend"><span><i className="coral-line"/>最新价 <b>{activeQuote?.price?.toFixed(2) ?? "--"}</b></span>{indicatorsVisible&&<span><i className="teal-line"/>均线参考</span>}</div>
            <span className="live-scan"><i/>{trialQuote ? `1 秒轮询试用 · ${trialQuote.provider}` : trialError || (marketData ? `公开行情 · ${marketData.delayed ? "延迟数据" : "已更新"}` : marketError || "连接行情中")}</span>
            <div className="periods">{['分时','5分','15分','30分','60分','日K'].map(p => <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>{p}</button>)}</div>
            <button className="tool-button" onClick={()=>setIndicatorsVisible(value=>!value)} aria-pressed={indicatorsVisible}>{indicatorsVisible ? "隐藏指标" : "显示指标"}</button><button className="tool-button" onClick={()=>void document.documentElement.requestFullscreen?.().catch(()=>{})}>全屏</button>
          </div>
          <div className="chart-wrap">
            <div className="y-axis">{chartModel ? chartModel.ticks.map(value=><span key={value}>{value.toFixed(2)}</span>) : [0,1,2,3,4].map(value=><span key={value}>--</span>)}</div>
            <svg viewBox="0 0 920 300" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${activeQuote?.name || stock.name}当日分时图`}>
              <defs><linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff655f" stopOpacity=".18"/><stop offset="1" stopColor="#ff655f" stopOpacity="0"/></linearGradient></defs>
              {[50,100,150,200,250].map(y => <line key={y} x1="0" y1={y} x2="920" y2={y} className="grid-line"/>)}
              {[100,200,300,400,500,600,700,800].map(x => <line key={x} x1={x} y1="0" x2={x} y2="300" className="grid-line vertical"/>)}
              {chartModel&&<><path d={`${chartModel.path} L910 252 L10 252 Z`} fill="url(#priceFill)" />
              {indicatorsVisible&&<path d={chartModel.vwapPath} className="vwap-path"/>}<path d={chartModel.path} className="price-path"/>
              <line x1="0" y1={20+(chartModel.max-chartModel.last.price)/(chartModel.max-chartModel.min||Math.max(chartModel.max*.002,.01))*210} x2="920" y2={20+(chartModel.max-chartModel.last.price)/(chartModel.max-chartModel.min||Math.max(chartModel.max*.002,.01))*210} className="last-line"/><circle cx="910" cy={20+(chartModel.max-chartModel.last.price)/(chartModel.max-chartModel.min||Math.max(chartModel.max*.002,.01))*210} r="4" className="last-dot"/></>}
              <line x1="0" y1="252" x2="920" y2="252" className="volume-divider"/>
              {chartModel?.volumes.map((bar,index)=><rect key={index} x={bar.x} y={300-bar.height} width={Math.max(2,850/chartModel.volumes.length)} height={bar.height} className={bar.up?'volume':'volume red'}/>) }
            </svg>
            <div className="price-flag">{chartModel?.last.price.toFixed(2) ?? '--'}</div>
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
          <div className={`stock-state ${stockState.level}`}>
            <div><span>股票状态识别器</span><b>{stockState.label}</b></div><strong>{stockState.score}<small>/100</small></strong>
            <p>{stockState.summary}</p><em>{stockState.action}</em>
          </div>
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
          <div className="agent-grid">{agents.map((agent,i)=><button className="agent" key={agent.name} onClick={()=>setActiveView("智能训练")} aria-label={`查看${agent.name}训练详情`}><span className={`agent-icon a${i}`}><img src={agent.avatar} alt={`${agent.name} AI头像`}/></span><span><b>{agent.name}</b><small>{agent.role}</small></span><em><i/>{agent.state}</em><strong>{agent.value}</strong></button>)}</div>
        </div>
      </section>
      </> : activeView === "懂它" ? <SingleStockResearchView key={`${accountName}:${stock.code}`} accountName={accountName} stock={stock} quote={activeQuote} marketData={marketData} onOpenConsole={()=>setActiveView('操盘台')} /> : activeView === "多股监控" ? <MultiWatchView stocks={stockList} onManage={()=>setOnboardingOpen(true)} onOpen={(index)=>{setActiveStock(index);setActiveView('操盘台')}} /> : activeView === "策略市场" ? <StrategyMarketView key={accountName} accountName={accountName} /> : activeView === "持仓对账" ? <HoldingsView key={`${accountName}:${stock.code}`} accountName={accountName} preferences={preferences} stock={stock} /> : activeView === "智能训练" ? <TrainingView running={trainingRunning} progress={trainingProgress} onRun={()=>{setTrainingProgress(trainingProgress===100?0:trainingProgress);setTrainingRunning(true)}} /> : <BacktestView key={`${stock.code}:${preferences.baseShares}`} profile={profile} setProfile={setProfile} preferences={preferences} stock={stock} stocks={stockList} activeStock={activeStock} onSelectStock={setActiveStock} />}

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
          <div className="opening-rule"><span>开盘因果规则</span><p>09:30–09:35 只观察；09:35–10:00 只使用当前分钟及之前的数据。低开重新站上VWAP、高开跌破VWAP且确认后，分两次各 1/6；早盘累计不超过 1/3。</p><button onClick={()=>{try{localStorage.setItem(`rabbit-custom-strategy:${accountName.toLowerCase()}`,customStrategy)}catch{}setProfile('自定义策略');setStrategyOpen(false)}}>保存并应用</button></div>
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
      <div className="home-terminal"><div className="terminal-head"><span>601899 紫金矿业</span><em><i/>策略示例 · 非实时</em></div><div className="terminal-price"><strong>--</strong><span>进入操盘台查看</span><small>市场雷达仅作界面示例</small></div><svg viewBox="0 0 600 180" preserveAspectRatio="none"><defs><linearGradient id="homeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#28d7c4" stopOpacity=".18"/><stop offset="1" stopColor="#28d7c4" stopOpacity="0"/></linearGradient></defs><path d="M0 145 C45 132 70 151 105 116 S170 127 205 88 S270 99 310 69 S370 91 410 58 S485 74 525 40 S570 52 600 20 L600 180 L0 180Z" fill="url(#homeFill)"/><path d="M0 145 C45 132 70 151 105 116 S170 127 205 88 S270 99 310 69 S370 91 410 58 S485 74 525 40 S570 52 600 20" className="home-line"/></svg><div className="terminal-signal"><span><i className="rabbit-dot-home">兔</i><b>研究提示</b></span><p>实时行情与回测请进入操盘台。</p><em>不构成投资建议</em></div></div>
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

function MultiWatchView({stocks,onOpen,onManage}:{stocks:typeof initialStocks;onOpen:(index:number)=>void;onManage:()=>void}) {
  const [quotes,setQuotes]=useState<Record<string,MarketData['quote']>>({});
  const [quoteStatus,setQuoteStatus]=useState<'loading'|'updated'|'partial'|'error'>('loading');
  const [updatedAt,setUpdatedAt]=useState<string>('');
  useEffect(()=>{
    let cancelled=false;
    let inFlight=false;
    const refresh=async()=>{
      if(inFlight||document.visibilityState!=='visible')return;
      inFlight=true;
      const settled=await Promise.allSettled(stocks.map(async item=>{
        const response=await fetch(`/api/market-data?code=${encodeURIComponent(item.code)}&mode=trial-realtime`,{cache:'no-store'});
        if(!response.ok)throw new Error('quote request failed');
        return await response.json() as MarketData;
      }));
      if(!cancelled){
        const loaded=settled.filter((result):result is PromiseFulfilledResult<MarketData>=>result.status==='fulfilled').map(result=>result.value);
        if(loaded.length){
          setQuotes(current=>Object.fromEntries(loaded.map(item=>[item.quote.code,item.quote]).concat(Object.entries(current).filter(([code])=>!stocks.some(stock=>stock.code===code)))));
          setQuoteStatus(loaded.length===stocks.length?'updated':'partial');
          setUpdatedAt(new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}));
        }else setQuoteStatus('error');
      }
      inFlight=false;
    };
    const onVisibility=()=>{if(document.visibilityState==='visible')void refresh();};
    void refresh();
    const timer=window.setInterval(()=>void refresh(),5000);
    document.addEventListener('visibilitychange',onVisibility);
    return ()=>{cancelled=true;window.clearInterval(timer);document.removeEventListener('visibilitychange',onVisibility);};
  },[stocks]);
  const allRows=stocks.map(item=>{
    const quote=quotes[item.code];
    const change=quote?.changePercent;
    const amplitude=quote?.high!=null&&quote?.low!=null&&quote?.price ? (quote.high-quote.low)/quote.price*100 : null;
    const position=quote?.high!=null&&quote?.low!=null&&quote?.price&&quote.high>quote.low ? (quote.price-quote.low)/(quote.high-quote.low)*100 : null;
    return {code:item.code,name:quote?.name||item.name,price:quote?.price?.toFixed(2)||'--',change:change==null?'--':`${change>=0?'+':''}${change.toFixed(2)}%`,changeValue:change,amplitude,position};
  });
  return <section className="module-view watch-view">
    <div className="module-head"><div><span className="eyebrow">MULTI-ASSET QUOTE MONITOR</span><h1>多股监控</h1><p>已接入公开行情轮询，报价每 5 秒尝试更新；仅用于观察，不会自动生成买卖指令或下单。</p></div><div className="module-status"><i/>{quoteStatus==='updated'?'公开行情正常':quoteStatus==='partial'?'部分行情可用':quoteStatus==='error'?'行情暂不可用':'正在连接行情'} · {stocks.length}只监控中</div></div>
    <div className="watch-summary"><div><span>监控股票</span><b>{stocks.length}</b><small>切换后台即暂停轮询</small></div><div><span>已取得报价</span><b className="teal">{Object.keys(quotes).filter(code=>stocks.some(stock=>stock.code===code)).length}</b><small>当前列表可用数量</small></div><div><span>刷新频率</span><b>5 秒</b><small>公开试用行情</small></div><div><span>最近更新</span><b>{updatedAt||'--:--:--'}</b><small>{quoteStatus==='partial'?'部分来源暂不可用':'页面可见时刷新'}</small></div><div><span>交易执行</span><b>关闭</b><small>不连接券商账户</small></div></div>
    <div className="watch-toolbar"><div><span>公开行情试用 · 数据时效不保证为交易级</span></div><button className="watch-add" onClick={onManage}>＋ 管理监控股票</button></div>
    <div className="watch-table"><div className="watch-row watch-title"><span>股票</span><span>最新价</span><span>涨跌幅</span><span>日内振幅</span><span>日内位置</span><span>状态</span><span/></div>{allRows.map(row=><div className="watch-row" key={row.code}><span className="watch-stock"><b>{row.name}</b><small>{row.code}</small></span><span className="watch-price"><b>{row.price}</b><small>公开行情</small></span><span><b className={row.changeValue!=null&&row.changeValue<0?'negative':row.changeValue!=null&&row.changeValue>0?'positive':'neutral'}>{row.change}</b><small>{row.change==='--'?'等待更新':'当日涨跌幅'}</small></span><span><b>{row.amplitude==null?'--':`${row.amplitude.toFixed(2)}%`}</b><small>高低波动</small></span><span className="day-position"><i><em style={{width:`${row.position??0}%`}}/></i><b>{row.position==null?'--':`${row.position.toFixed(0)}%`}</b></span><em className="watch-pill watch">仅监控</em><button onClick={()=>onOpen(stocks.findIndex(item=>item.code===row.code))}>进入操盘台 →</button></div>)}</div>
    <div className="watch-rule"><b>使用说明</b><span>多股页为 5 秒公开行情试用</span><span>操盘台为当前选股 1 秒轮询试用</span><span>页面切到后台会暂停请求</span><span>报价不构成交易建议，也不触发自动下单</span></div>
  </section>;
}

type StockResearchNote = { id:string; date:string; mode:string; outcome:string; note:string };

function SingleStockResearchView({accountName,stock,quote,marketData,onOpenConsole}:{accountName:string;stock:{code:string;name:string;price:string;change:string};quote:MarketData['quote']|undefined;marketData:MarketData|null;onOpenConsole:()=>void}) {
  const storageKey=`rabbit-stock-research:${accountName.toLowerCase()}:${stock.code}`;
  const ledgerKey=`rabbit-manual-ledger:${accountName.toLowerCase()}:${stock.code}`;
  const [notes,setNotes]=useState<StockResearchNote[]>(()=>{try{const saved=localStorage.getItem(storageKey);const parsed=saved?JSON.parse(saved):[];return Array.isArray(parsed)?parsed:[]}catch{return [];}});
  const [feedback,setFeedback]=useState('');
  const [mode,setMode]=useState('观察');
  const [outcome,setOutcome]=useState('待验证');
  const [manualCount]=useState(()=>{try{const ledger=localStorage.getItem(ledgerKey);const rows=ledger?JSON.parse(ledger):[];return Array.isArray(rows)?rows.filter((row:{status?:string})=>row.status!=='已失效').length:0;}catch{return 0;}});
  const bars=useMemo(()=>marketData?.bars??[],[marketData]);
  const stats=useMemo(()=>{
    const recent=bars.slice(-20);
    if(!recent.length)return {range:0,volumeRatio:0,trend:'等待日线数据',close:quote?.price??null,ma20:0,upDays:0};
    const range=recent.reduce((sum,bar)=>sum+(bar.close?((bar.high-bar.low)/bar.close)*100:0),0)/recent.length;
    const averageVolume=recent.reduce((sum,bar)=>sum+bar.volume,0)/recent.length;
    const latest=recent.at(-1)!;
    const ma20=recent.reduce((sum,bar)=>sum+bar.close,0)/recent.length;
    const upDays=recent.filter(bar=>bar.close>=bar.open).length;
    return {range,volumeRatio:averageVolume?latest.volume/averageVolume:0,trend:latest.close>=ma20?'日线仍在20日均价上方':'日线位于20日均价下方',close:quote?.price??latest.close,ma20,upDays};
  },[bars,quote?.price]);
  const samples=notes.length+manualCount;
  const maturity=samples<10?'样本不足':samples<30?'观察中':'候选验证';
  const candidate=stats.range===0?'等待数据形成候选':stats.range<3.5?'低波动回踩观察':'高波动分批观察';
  const saveNote=()=>{const note=feedback.trim();if(!note)return;const next=[{id:`${Date.now()}`,date:new Date().toLocaleDateString('zh-CN'),mode,outcome,note},...notes];setNotes(next);try{localStorage.setItem(storageKey,JSON.stringify(next));}catch{}setFeedback('');setOutcome('待验证');};
  return <section className="stock-research-view">
    <div className="research-head"><div><span className="eyebrow">SINGLE STOCK RESEARCH · DEVICE LOCAL</span><h1>懂它 · 单股智研档案</h1><p>把公开日线、你本机补录的成交和每日复盘合在一只股票档案中；策略只形成候选，不会自动改参数、发单或承诺收益。</p></div><button onClick={onOpenConsole}>打开操盘台 →</button></div>
    <div className="research-status"><div><span>{stock.code} · {stock.name}</span><b>{quote?.price?.toFixed(2)??'--'}</b><em>{quote?.changePercent==null?'行情等待中':`${quote.changePercent>=0?'+':''}${quote.changePercent.toFixed(2)}%`}</em></div><p><i/>档案成熟度：<strong>{maturity}</strong> · 有效学习样本 {samples} / 30 条 <b className="maturity-progress"><em style={{width:`${Math.min(100,samples/30*100)}%`}}/></b> · 仅保存在当前设备浏览器</p></div>
    <div className="research-grid">
      <article className="research-card research-summary"><span>今日研究结论</span><h2>{candidate}</h2><p>{stats.trend}；近20日平均振幅 {stats.range?`${stats.range.toFixed(2)}%`:'待计算'}，最近量能约为20日均量 {stats.volumeRatio?`${stats.volumeRatio.toFixed(2)}×`:'待计算'}。当前只生成观察条件，不输出自动交易指令。</p><div><b>研究假设失效条件</b><small>出现与候选逻辑相反的趋势、量能或复盘结果时，标记为无效并重新积累样本。</small></div></article>
      <article className="research-card"><span>股性指纹 · 日线</span><div className="fingerprint"><p><small>平均振幅</small><b>{stats.range?`${stats.range.toFixed(2)}%`:'--'}</b></p><p><small>阳线天数</small><b>{bars.length?`${stats.upDays}/20`:'--'}</b></p><p><small>20日均价</small><b>{stats.ma20?stats.ma20.toFixed(2):'--'}</b></p><p><small>量能比</small><b>{stats.volumeRatio?`${stats.volumeRatio.toFixed(2)}×`:'--'}</b></p></div><small className="data-note">数据来自当前公开日线接口；不等于分钟级或交易级行情。</small></article>
      <article className="research-card"><span>候选策略库</span><ul className="candidate-list"><li><b>{candidate}</b><small>{stats.range<3.5?'波动收窄时，优先等确认而非追价。':'日内波动偏大，先控制单次试错与频率。'}</small><em>未启用</em></li><li><b>{stats.trend.includes('上方')?'趋势内回撤观察':'均值回归观察'}</b><small>以日线结构作背景，不将日线当作盘中买卖依据。</small><em>未启用</em></li><li><b>开盘噪声规避</b><small>09:45 前只记录，不以早盘单一波动验证假设。</small><em>未启用</em></li></ul></article>
      <article className="research-card feedback-card"><span>写入一次复盘</span><p>每条记录都会进入该股的样本库。请把结果写清楚，避免只记录“感觉”。</p><div className="feedback-controls"><select value={mode} onChange={event=>setMode(event.target.value)}><option>观察</option><option>正T</option><option>反T</option></select><select value={outcome} onChange={event=>setOutcome(event.target.value)}><option>待验证</option><option>有效</option><option>无效</option></select></div><textarea value={feedback} onChange={event=>setFeedback(event.target.value)} placeholder="例如：10:15 回踩后量能未跟上，等待条件未满足；不执行。"/><button onClick={saveNote} disabled={!feedback.trim()}>保存本次复盘</button></article>
    </div>
    <div className="research-bottom"><div><span>本机成交反馈</span><b>{manualCount} 笔有效补录</b><small>来自“持仓对账”；失效记录不会计入样本。</small></div><div><span>最近复盘</span>{notes.length?notes.slice(0,3).map(note=><p key={note.id}><b>{note.date} · {note.mode}</b><em className={note.outcome==='有效'?'valid':note.outcome==='无效'?'invalid':''}>{note.outcome}</em><small>{note.note}</small></p>):<p className="empty-note">尚无复盘。先记录观察，再让档案慢慢形成对这只股票的认识。</p>}</div><aside><span>升级规则</span><b>积累 ≥30 条样本后再进入候选验证</b><small>仍需人工查看回测、样本外表现、费用和风险；自动晋升保持关闭。</small></aside></div>
  </section>;
}

const marketStrategies = [
  {rank:1,name:'胡萝卜波段兔',author:'A客户',mode:'模拟盘',win:78,returns:8.6,drawdown:2.1,cycles:41,days:36,risk:'中风险',price:0,followers:126,tags:['VWAP','反T','量能确认'],summary:'高开转弱后等待回抽失败，分批反T；14:50前强制恢复底仓。'},
  {rank:2,name:'稳稳闭环兔',author:'量化小林',mode:'模拟盘',win:72,returns:6.9,drawdown:1.2,cycles:68,days:63,risk:'低风险',price:19,followers:284,tags:['低回撤','正反T','硬风控'],summary:'以低频高确认信号为主，单次不超过底仓1/4，连续失败两次即停止。'},
  {rank:3,name:'开盘雷达兔',author:'北辰',mode:'回测',win:69,returns:11.3,drawdown:4.8,cycles:93,days:90,risk:'高风险',price:39,followers:91,tags:['集合竞价','开盘30分','趋势过滤'],summary:'聚焦09:35至10:00，只使用当时已出现数据判断低开转强与高开转弱。'},
  {rank:4,name:'午后均值兔',author:'青禾',mode:'模拟盘',win:74,returns:5.2,drawdown:1.9,cycles:37,days:45,risk:'中风险',price:9,followers:76,tags:['均值回归','VWAP','午后'],summary:'午后偏离VWAP后等待量价收敛，优先完成已有循环，不追逐新信号。'},
  {rank:5,name:'新锐挑战兔',author:'NeoQuant',mode:'回测',win:66,returns:13.7,drawdown:6.4,cycles:29,days:22,risk:'高风险',price:0,followers:48,tags:['灵敏档','超买超卖','小样本'],summary:'灵敏型候选策略，收益较高但样本量较少，目前仅允许历史回测与模拟观察。'},
];

const builtInStrategies = [
  {id:'steady-pullback',name:'稳健回踩观察',tag:'低频 · 低回撤优先',fit:'适合先建立纪律：仅在趋势背景与回踩确认同时满足时观察。',rules:['09:45 前不触发','价格结构与量能同时确认','单日最多 2 次候选'],risk:'连续两次无效后，当日暂停'},
  {id:'opening-reversal',name:'开盘反转确认',tag:'开盘 · 正反T候选',fit:'观察高开转弱或低开转强，不用第一根波动直接下结论。',rules:['仅记录 09:45 后信号','回抽失败/站回需二次确认','不追逐快速拉升或跳水'],risk:'开盘异常放量时只观察'},
  {id:'afternoon-vwap',name:'午后均值回归',tag:'午后 · VWAP参考',fit:'用于震荡日午后偏离后的收敛观察，先处理未闭环仓位。',rules:['仅在 13:30–14:30 观察','量价收敛后才形成候选','已有未闭环时不新增'],risk:'14:50 前停止新候选'},
  {id:'position-guard',name:'底仓闭环卫士',tag:'风控 · 始终生效',fit:'不是交易策略，而是每个策略都应遵守的仓位与尾盘检查。',rules:['T+1 可卖数量检查','未配对时冻结新候选','收盘前核对计划底仓'],risk:'不满足闭环条件即转人工核对'},
];

function readMarketStorage(accountName:string){
  if(typeof window==='undefined')return {subscribed:[] as string[],name:'',summary:''};
  try{
    const storageKey=`rabbit-market:${accountName.toLowerCase()}`;
    const subscriptions=JSON.parse(localStorage.getItem(`${storageKey}:subscriptions`)||'[]');
    const draft=JSON.parse(localStorage.getItem(`${storageKey}:draft`)||'{}');
    return {
      subscribed:Array.isArray(subscriptions)?subscriptions:[],
      name:typeof draft.name==='string'?draft.name:'',
      summary:typeof draft.summary==='string'?draft.summary:'',
    };
  }catch{return {subscribed:[] as string[],name:'',summary:''};}
}

function StrategyMarketView({accountName}:{accountName:string}){
  const [sort,setSort]=useState('综合榜');
  const [selected,setSelected]=useState<(typeof marketStrategies)[number]|null>(null);
  const [subscribed,setSubscribed]=useState<string[]>(()=>readMarketStorage(accountName).subscribed);
  const [publishing,setPublishing]=useState(false);
  const [draftName,setDraftName]=useState(()=>readMarketStorage(accountName).name);
  const [draftSummary,setDraftSummary]=useState(()=>readMarketStorage(accountName).summary);
  const [draftMessage,setDraftMessage]=useState('');
  const storageKey=`rabbit-market:${accountName.toLowerCase()}`;
  const [enabledBuiltIns,setEnabledBuiltIns]=useState<string[]>(()=>{try{const saved=JSON.parse(localStorage.getItem(`${storageKey}:builtins`)||'[]');return Array.isArray(saved)?saved:[]}catch{return [];}});
  const rows=[...marketStrategies].sort((a,b)=>sort==='收益榜'?b.returns-a.returns:sort==='低回撤榜'?a.drawdown-b.drawdown:sort==='胜率榜'?b.win-a.win:a.rank-b.rank);
  const follow=(name:string)=>setSubscribed(items=>{const next=items.includes(name)?items.filter(item=>item!==name):[...items,name];try{localStorage.setItem(`${storageKey}:subscriptions`,JSON.stringify(next))}catch{}return next});
  const toggleBuiltIn=(id:string)=>setEnabledBuiltIns(items=>{const next=items.includes(id)?items.filter(item=>item!==id):[...items,id];try{localStorage.setItem(`${storageKey}:builtins`,JSON.stringify(next));}catch{}return next;});
  const saveDraft=()=>{
    const name=draftName.trim();
    const summary=draftSummary.trim();
    if(!name||!summary){setDraftMessage('请填写策略名称和策略说明后再保存。');return;}
    try{localStorage.setItem(`${storageKey}:draft`,JSON.stringify({name,summary,savedAt:new Date().toISOString()}));setDraftMessage('草稿已保存到当前账户；完成回测接入后可继续提交审核。');}catch{setDraftMessage('草稿保存失败，请检查浏览器存储权限。');}
  };
  return <section className="market-view">
    <div className="market-hero"><div><span className="eyebrow">RABBIT STRATEGY MARKET</span><h1>策略智能体排行榜</h1><p>发现、比较并模拟跟随优秀的用户策略。所有指标都同时展示样本与风险，不用单一胜率制造错觉。</p></div><button onClick={()=>setPublishing(true)}>＋ 发布我的策略</button></div>
    <div className="market-guard"><b>测试版安全边界</b><span>支持策略发布、订阅与模拟跟随</span><span>真实资金自动交易保持关闭</span><span>不代管资金，不承诺收益</span></div>
    <section className="builtin-strategies"><div className="builtin-head"><div><span className="eyebrow">BUILT-IN PLAYBOOKS</span><h2>内置策略库</h2><p>这些是透明的研究规则，不是收益承诺。启用后只进入模拟观察和记录，不会自动下单。</p></div><b>已启用 {enabledBuiltIns.length} / {builtInStrategies.length}</b></div><div className="builtin-grid">{builtInStrategies.map(item=>{const enabled=enabledBuiltIns.includes(item.id);return <article className={enabled?'enabled':''} key={item.id}><div><span>{item.tag}</span><em>{enabled?'模拟观察中':'未启用'}</em></div><h3>{item.name}</h3><p>{item.fit}</p><ul>{item.rules.map(rule=><li key={rule}>{rule}</li>)}</ul><small>风控：{item.risk}</small><button onClick={()=>toggleBuiltIn(item.id)}>{enabled?'停止模拟观察':'启用模拟观察'}</button></article>})}</div></section>
    <div className="market-stats"><div><span>公开策略</span><b>128</b><small>46个通过样本检查</small></div><div><span>今日模拟跟随</span><b>1,284</b><small>全部由用户主动开启</small></div><div><span>平均闭环胜率</span><b>68.4%</b><small>至少20次闭环才统计</small></div><div><span>风险暂停</span><b className="amber-text">7</b><small>触发回撤或仓位异常</small></div></div>
    <div className="market-toolbar"><div>{['综合榜','胜率榜','收益榜','低回撤榜'].map(item=><button className={sort===item?'active':''} onClick={()=>setSort(item)} key={item}>{item}</button>)}</div><span>排行榜每个交易日收盘后更新</span></div>
    <div className="market-list"><div className="market-row market-title"><span>排名 / 策略</span><span>验证状态</span><span>胜率</span><span>扣费净收益</span><span>最大回撤</span><span>样本</span><span>订阅</span><span/></div>{rows.map(item=><div className="market-row" key={item.name}><span className="market-name"><i>{item.rank<=3?`TOP ${item.rank}`:`#${item.rank}`}</i><b>{item.name}</b><small>{item.author} · {item.tags.join(' / ')}</small></span><span><em className={item.mode==='模拟盘'?'verified':'backtested'}>{item.mode}</em><small>{item.days}个交易日</small></span><strong>{item.win}%</strong><strong className="teal">+{item.returns}%</strong><strong>-{item.drawdown}%</strong><span><b>{item.cycles}次闭环</b><small>{item.risk}</small></span><span><b>{item.price===0?'免费':`¥${item.price}/月`}</b><small>{item.followers}人关注</small></span><button onClick={()=>setSelected(item)}>查看策略 →</button></div>)}</div>
    {selected&&<div className="market-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null)}}><div className="strategy-detail"><button className="detail-close" onClick={()=>setSelected(null)}>×</button><span className="eyebrow">STRATEGY PROFILE · #{selected.rank}</span><h2>{selected.name}</h2><p>{selected.summary}</p><div className="detail-author"><span>创建者</span><b>{selected.author}</b><em>{selected.mode} · {selected.days}个交易日</em></div><div className="detail-metrics"><div><span>闭环胜率</span><b>{selected.win}%</b></div><div><span>扣费净收益</span><b className="teal">+{selected.returns}%</b></div><div><span>最大回撤</span><b>-{selected.drawdown}%</b></div><div><span>有效样本</span><b>{selected.cycles}次</b></div></div><div className="detail-rules"><h3>策略说明</h3><p>费用、滑点、T+1可卖数量和尾盘恢复为系统硬风控，订阅者不能关闭。</p><p>模拟跟随只生成提醒和虚拟成交记录，不会连接或操作真实券商账户。</p></div><button className={subscribed.includes(selected.name)?'followed':''} onClick={()=>follow(selected.name)}>{subscribed.includes(selected.name)?'✓ 已加入模拟跟随':selected.price===0?'免费模拟跟随':`订阅并模拟跟随 · ¥${selected.price}/月`}</button><small>历史表现不代表未来收益 · 可随时停止跟随</small></div></div>}
    {publishing&&<div className="market-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setPublishing(false)}}><div className="publish-card"><button className="detail-close" onClick={()=>setPublishing(false)}>×</button><span className="eyebrow">PUBLISH STRATEGY</span><h2>发布我的策略智能体</h2><p>测试版将先把策略送入回测与模拟观察，不会直接进入真实交易。</p><label>策略名称<input value={draftName} onChange={e=>{setDraftName(e.target.value);setDraftMessage('')}} placeholder="例如：我的稳健反T兔"/></label><label>策略说明<textarea value={draftSummary} onChange={e=>{setDraftSummary(e.target.value);setDraftMessage('')}} placeholder="用直白语言说明买入、卖出、仓位和停止条件"/></label><div><label>分享方式<select><option>免费分享</option><option>付费订阅（审核后开放）</option></select></label><label>风险等级<select><option>低风险</option><option>中风险</option><option>高风险</option></select></label></div><button onClick={saveDraft}>保存草稿</button><small>{draftMessage||'至少完成20次有效闭环后，才会显示在公开排行榜。'}</small></div></div>}
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

function HoldingsView({accountName,preferences,stock}:{accountName:string;preferences:{stock:string;baseShares:number;risk:string};stock:{code:string;name:string;price:string;change:string}}) {
  const [filter, setFilter] = useState("全部流水");
  const [planDone, setPlanDone] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const storageKey = `rabbit-manual-ledger:${accountName.toLowerCase()}:${stock.code}`;
  const [manualRows, setManualRows] = useState<typeof ledgerRows>(()=>{try { const saved=localStorage.getItem(storageKey); const parsed=saved?JSON.parse(saved):[]; return Array.isArray(parsed)?parsed:[]; } catch { return []; }});
  const saveManualRows=(next:typeof ledgerRows)=>{setManualRows(next);try{localStorage.setItem(storageKey,JSON.stringify(next));}catch{}};
  const invalidate=(time:string)=>saveManualRows(manualRows.map(row=>row.time===time?{...row,status:'已失效',cycle:'已撤销'}:row));
  const validManualRows=manualRows.filter(row=>row.status!=='已失效');
  const quantity=(value:string)=>Number(value.replace(/,/g,''))||0;
  const bought=validManualRows.filter(row=>row.side==='买入').reduce((sum,row)=>sum+quantity(row.qty),0);
  const sold=validManualRows.filter(row=>row.side==='卖出').reduce((sum,row)=>sum+quantity(row.qty),0);
  const netPosition=bought-sold;
  const currentShares=Math.max(0,preferences.baseShares+netPosition);
  const hasDeviation=netPosition!==0;
  const allRows = [...manualRows, ...ledgerRows];
  const visibleRows = allRows.filter(row => filter === "全部流水" || (filter === "未配对" ? row.status !== "已配对" && row.status !== "已失效" : row.side === filter));
  return <section className="holdings-view">
    <div className="holdings-head">
      <div><span className="eyebrow">POSITION RECONCILIATION</span><h1>持仓与交易对账</h1><p>底仓会同步账户偏好；手动补录的成交会即时更新本机账本，供你核对仓位与当日闭环。</p></div>
      <div className="reconcile-state"><i/><span>已同步至 {new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span><b>本机记录</b></div>
    </div>
    <div className="position-overview">
      <div className="position-identity"><span>{stock.code}</span><h2>{stock.name}</h2><small>沪深A · T+1</small></div>
      <div className="position-metric"><span>计划底仓</span><b>{preferences.baseShares.toLocaleString()}<small> 股</small></b><em>账户偏好同步</em></div>
      <div className="position-metric"><span>当前持仓</span><b>{currentShares.toLocaleString()}<small> 股</small></b><em>由手动成交计算</em></div>
      <div className="position-metric"><span>本机已补录</span><b>{validManualRows.length}<small> 笔</small></b><em>失效记录不计入</em></div>
      <div className={`position-metric ${hasDeviation?'warning':'profit'}`}><span>当日未闭合</span><b>{netPosition>0?'+':''}{netPosition.toLocaleString()}<small> 股</small></b><em>{hasDeviation?'收盘前应归零':'已恢复计划底仓'}</em></div>
      <div className="position-metric profit"><span>成交方向</span><b>{bought.toLocaleString()} / {sold.toLocaleString()}</b><em>买入 / 卖出（股）</em></div>
    </div>
    <div className="reconcile-grid">
      <div className="ledger-panel">
        <div className="panel-top"><div><h2>今日成交流水</h2><p>手动补录会计入上方仓位；预置示例仅用于展示，不计入你的本机账本。</p></div><div><button onClick={()=>setManualOpen(value=>!value)}>{manualOpen?'收起补录':'＋ 手动补录成交'}</button>{manualRows.length>0&&<button onClick={()=>saveManualRows([])}>清空本机记录</button>}</div></div>
        {manualOpen&&<form className="manual-trade-form" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);const side=String(form.get('side'));const price=Number(form.get('price'));const qty=Number(form.get('qty'));if(!Number.isFinite(price)||price<=0||!Number.isFinite(qty)||qty<=0)return;saveManualRows([{time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),side,price:price.toFixed(2),qty:qty.toLocaleString('zh-CN'),cycle:'手动待配对',fee:'待计算',result:'—',status:'未配对'},...manualRows]);event.currentTarget.reset();setManualOpen(false)}}><select name="side" defaultValue="买入"><option>买入</option><option>卖出</option></select><input name="price" type="number" min="0.01" step="0.01" required placeholder="成交价"/><input name="qty" type="number" min="100" step="100" required placeholder="数量（股）"/><button type="submit">保存成交</button></form>}
        <div className="ledger-filter">{["全部流水","买入","卖出","未配对"].map(item=>{const count=allRows.filter(row=>item==='全部流水'||(item==='未配对'?row.status!=="已配对":row.side===item)).length;return <button key={item} className={filter===item?'active':''} onClick={()=>setFilter(item)}>{item}<span>{count}</span></button>})}</div>
        <div className="ledger-table">
          <div className="ledger-row ledger-title"><span>成交时间</span><span>方向</span><span>成交价</span><span>数量</span><span>配对循环</span><span>费用</span><span>循环净收益</span><span>状态</span></div>
          {visibleRows.map((row,index)=><div className="ledger-row" key={`${row.time}-${index}`}><span>{row.time}</span><span className={row.side==='买入'?'buy-text':'sell-text'}>{row.side}</span><b>{row.price}</b><span>{row.qty}</span><span>{row.cycle}</span><span>{row.fee}</span><b className={row.result.startsWith('+')?'positive':''}>{row.result}</b><span><em className={row.status==='已配对'?'matched':'unmatched'}>{row.status}</em>{manualRows.some(item=>item.time===row.time)&&row.status!=='已失效'&&<button className="invalidate-trade" onClick={()=>invalidate(row.time)}>设为失效</button>}</span></div>)}
        </div>
      </div>
      <aside className="recovery-panel">
        <span className="recovery-kicker">INTRADAY CLOSE ALERT</span><h2>{hasDeviation?`当日尚未闭合：${netPosition>0?'多买':'多卖'} ${Math.abs(netPosition).toLocaleString()} 股`:'当前已恢复计划底仓'}</h2><p>{hasDeviation?`本机账本显示当前持仓相对计划底仓偏离 ${Math.abs(netPosition).toLocaleString()} 股。请先核对成交记录与可卖旧仓，再决定是否补录或完成闭环。`:'没有待闭合的本机成交偏离。后续补录的买卖成交会自动反映在这里。'}</p>
        <div className="close-deadline"><span>最迟处理时间</span><b>14:50</b><em>距风控检查 03:31:54</em></div>
        <div className="recovery-scale"><div><span>目标底仓 {preferences.baseShares.toLocaleString()}</span><b>当前 {currentShares.toLocaleString()}</b></div><i><em style={{width:`${Math.min(100,Math.max(8,preferences.baseShares?currentShares/preferences.baseShares*100:0))}%`}}/></i><small>目标：收盘时实际持仓恢复 {preferences.baseShares.toLocaleString()} 股；这里以本机补录成交计算，需自行核对券商实际持仓。</small></div>
        <div className="recovery-steps"><h3>当日闭环规则</h3><div><b>01</b><p><strong>立即停止继续买入</strong><span>未配对数量归零前，冻结新的正T与补仓信号。</span></p></div><div><b>02</b><p><strong>卖出等量昨日旧仓</strong><span>在价格与风险允许时分批卖出共 2,200 股，将持仓恢复到底仓。</span></p></div><div><b>03</b><p><strong>14:50 强制升级告警</strong><span>仍未闭合则标记“做T失败”，转为红色异常隔夜仓，不计策略收益。</span></p></div></div>
        <button className={planDone?'done':''} onClick={()=>setPlanDone(!planDone)}>{planDone?'✓ 当日平仓提醒已开启':'开启当日平仓提醒'}<span>→</span></button>
        <small className="recovery-note">这里只生成风控提醒，不会自动下单；自动交易接口仍保持关闭。</small>
      </aside>
    </div>
    <div className="cycle-summary"><div><span>今日买入</span><b>{bought.toLocaleString()} 股</b><small>本机有效补录</small></div><div><span>今日卖出</span><b>{sold.toLocaleString()} 股</b><small>本机有效补录</small></div><div><span>有效成交</span><b>{validManualRows.length} 笔</b><small>已失效不计入</small></div><div><span>待当日闭合</span><b className={hasDeviation?'warn':''}>{Math.abs(netPosition).toLocaleString()} 股</b><small>收盘目标必须为 0</small></div><div><span>账本状态</span><b>{hasDeviation?'待核对':'已平衡'}</b><small>不替代券商实际数据</small></div></div>
  </section>;
}

function BacktestView({ profile, setProfile, preferences, stock, stocks, activeStock, onSelectStock }: { profile: string; setProfile: (value: string) => void; preferences:{stock:string;baseShares:number;risk:string}; stock:{code:string;name:string;price:string;change:string}; stocks:{code:string;name:string;price:string;change:string}[]; activeStock:number; onSelectStock:(index:number)=>void }) {
  const [capital, setCapital] = useState(200000);
  const [baseShares, setBaseShares] = useState(preferences.baseShares);
  const [sellable, setSellable] = useState(preferences.baseShares);
  const [feeRate, setFeeRate] = useState(0.025);
  const [slippage, setSlippage] = useState(0.02);
  const [minCommission, setMinCommission] = useState(true);
  const [slippageMode, setSlippageMode] = useState<"percent"|"tick">("percent");
  const [forceCloseTime, setForceCloseTime] = useState("1450");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [source, setSource] = useState<Pick<MarketData,"provider"|"fetchedAt"|"bars"> | null>(null);
  const [error, setError] = useState("");
  const [runStatus, setRunStatus] = useState("等待运行");
  const run = async () => {
    setRunning(true); setError(""); setRunStatus("正在获取公开真实分时数据…");
    try {
      const response=await fetch(`/api/market-data?code=${encodeURIComponent(stock.code)}`, { cache:"no-store" });
      if(!response.ok) throw new Error("market unavailable");
      const data=await response.json() as MarketData;
      setSource(data);
      if((data.minutes ?? []).length < 30) {
        setResult(null);
        setError("当前未取得足够的当日 1 分钟分时，未执行回测；请在交易日收盘后重试或更换股票。");
        setRunStatus("未取得可用分时样本");
        return;
      }
      const calculated=runIntradayBlindReplay(data.minutes,capital,baseShares,sellable,feeRate,slippage,minCommission,slippageMode,forceCloseTime);
      setResult(calculated);
      setRunStatus(calculated.trades ? "盲测已完成" : "盲测完成：本次没有触发反 T 条件");
    } catch {
      setResult(null); setSource(null);
      setError("公开行情源暂不可用，未生成测试结果。请稍后重试。");
      setRunStatus("行情获取失败");
    } finally { setRunning(false); }
  };
  const curve = result?.curve ?? [];
  const curveMin = curve.length ? Math.min(...curve) : 0;
  const curveRange = curve.length ? Math.max(...curve)-curveMin || 1 : 1;
  const chartPoint = (value:number,index:number) => ({ x:(index/(curve.length-1))*800, y:200-((value-curveMin)/curveRange)*160 });
  const points = curve.length > 1 ? curve.map((value,index)=>{ const point=chartPoint(value,index); return `${point.x},${point.y}`; }).join(" ") : "";
  const cycles = (() => {
    const paired: { sell: ReplayAction; buy: ReplayAction }[] = [];
    let pending: ReplayAction | null = null;
    result?.actions.forEach(action => {
      if (action.side === "卖出") pending = action;
      else if (pending) { paired.push({ sell: pending, buy: action }); pending = null; }
    });
    return paired.map(({ sell, buy }, index) => {
      const rawSell = slippageMode === "tick" ? sell.price + slippage : sell.price / (1 - slippage / 100);
      const rawBuy = slippageMode === "tick" ? buy.price - slippage : buy.price / (1 + slippage / 100);
      const gross = (rawSell - rawBuy) * sell.quantity;
      const executionCost = ((rawSell - sell.price) + (buy.price - rawBuy)) * sell.quantity;
      const sellCommission = Math.max(minCommission ? 5 : 0, sell.price * sell.quantity * feeRate / 100);
      const buyCommission = Math.max(minCommission ? 5 : 0, buy.price * buy.quantity * feeRate / 100);
      const fees = sellCommission + sell.price * sell.quantity * 0.0005 + buyCommission;
      return { index: index + 1, sell, buy, gross, executionCost, fees, net: gross - executionCost - fees };
    });
  })();
  return <section className="backtest-view">
    <div className="backtest-head">
      <div><span className="eyebrow">INTRADAY BLIND REPLAY</span><h1>真实分时盲测</h1><p>随机隐藏后续分时，策略仅按已揭示的价格和成交量逐点决策；不读取当日收盘价、高低点或未来K线。</p></div>
      <div className="integrity-badges"><span><i/>真实分时数据</span><span><i/>无未来函数</span><span><i/>真实可卖数量</span></div>
    </div>
    <div className="backtest-grid">
      <aside className="backtest-config">
        <div className="config-title"><h2>回测参数</h2><span>{running ? "计算中" : runStatus}</span></div>
        <label>回测股票<select className="backtest-stock-select" value={activeStock} onChange={event=>onSelectStock(Number(event.target.value))} aria-label="选择回测股票">{stocks.map((item,index)=><option key={item.code} value={index}>{item.code} {item.name}</option>)}</select></label>
        <label>买卖逻辑<div className="field static-field"><b>融合策略 V3</b><span>动态 VWAP + 压力位滞涨反 T</span></div></label>
        <div className="field-pair"><label>样本来源<div className="field static-field date-display"><b>{source ? "当日完整分时" : "运行后显示"}</b><span>随机起点</span></div></label><label>决策方式<div className="field static-field date-display"><b>逐点揭示</b><span>盲测</span></div></label></div>
        <label>策略档位<div className="profile-picker">{strategyProfiles.slice(0,4).map(item=><button type="button" className={profile===item?'active':''} onClick={()=>setProfile(item)} key={item}>{item.replace('档','')}</button>)}</div></label>
        <div className="field-pair"><label>模拟资金<NumberStepper value={capital} unit="元" step={10000} min={50000} onChange={setCapital}/></label><label>真实底仓<NumberStepper value={baseShares} unit="股" step={100} min={0} onChange={setBaseShares}/></label></div>
        <div className="field-pair"><label>昨日可卖<NumberStepper value={sellable} unit="股" step={100} min={0} onChange={setSellable}/></label><label>单次上限<div className="field static-field"><b>{Math.floor(Math.min(baseShares, sellable)/3/100)*100}</b><span>股</span></div></label></div>
        <label>券商费率模板<select value={`${feeRate}-${minCommission}`} onChange={event=>{const templates:{[key:string]:[number,boolean]}={"0.025-true":[0.025,true],"0.01-false":[0.01,false],"0.0085-true":[0.0085,true]};const value=templates[event.target.value];if(value){setFeeRate(value[0]);setMinCommission(value[1])}}}><option value="0.025-true">默认行业价：万2.5（最低5元）</option><option value="0.01-false">常见大客户价：万1免五</option><option value="0.0085-true">尊享价：万0.85（最低5元）</option></select></label>
        <div className="cost-box"><div><span>佣金</span><NumberStepper value={feeRate} unit="%" step={0.005} min={0} decimals={3} onChange={setFeeRate}/></div><label className="fee-toggle"><input type="checkbox" checked={minCommission} onChange={event=>setMinCommission(event.target.checked)}/> 每笔佣金不足 5 元按 5 元收取</label><div><span>单边滑点</span><span className="slippage-controls"><select value={slippageMode} onChange={event=>{setSlippageMode(event.target.value as "percent"|"tick");setSlippage(event.target.value==="tick"?0.01:0.02)}}><option value="percent">百分比</option><option value="tick">跳数（元）</option></select><NumberStepper value={slippage} unit={slippageMode==="tick"?"元":"%"} step={slippageMode==="tick"?0.01:0.005} min={0} decimals={3} onChange={setSlippage}/></span></div><div><span>印花税</span><b>卖出 0.05%</b></div></div>
        <label>尾盘强制恢复时间<select value={forceCloseTime} onChange={event=>setForceCloseTime(event.target.value)}><option value="1445">14:45</option><option value="1450">14:50</option><option value="1455">14:55</option></select></label>
        <button className="run-backtest" onClick={()=>void run()} disabled={running}>{running ? '正在运行真实分时盲测…' : '运行随机分时盲测'}<span>→</span></button>
        <p className="config-note">连续失败 2 次当日停止；14:30 后不新开 T；{forceCloseTime.slice(0,2)}:{forceCloseTime.slice(2)} 前强制恢复计划底仓，避免尾盘流动性恶化。</p>
        <p className="config-note">状态：{runStatus}</p>
        {error&&<p className="config-note">{error}</p>}
      </aside>
      <div className="backtest-results">
        <div className="result-summary">
          <div className="result-primary"><span>净收益</span><strong>{result ? money(result.net) : "—"}</strong><em>{result ? `${(result.net/capital*100).toFixed(2)}%` : "运行后显示"}</em></div>
          <div><span>毛收益</span><b>{result ? money(result.gross) : "—"}</b><small>未扣费用</small></div><div><span>费用与滑点</span><b>{result ? money(-result.fees) : "—"}</b><small>佣金、滑点与印花税</small></div><div><span>最大回撤</span><b>{result ? `-${(result.maxDrawdown*100).toFixed(2)}%` : "—"}</b><small>{source ? "分时逐点盯市" : "运行后显示"}</small></div>
        </div>
        <div className="equity-panel"><div className="panel-heading"><div><h2>资金曲线</h2><span>{source ? "随机起点至收盘" : "运行后显示"}</span></div><div className="curve-legend"><span><i/>净资产</span><span className="sell-marker">● 卖出</span><span className="buy-marker">● 买回</span></div></div><svg viewBox="0 0 800 220" preserveAspectRatio="none" aria-label="回测资金曲线"><defs><linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#28d7c4" stopOpacity=".22"/><stop offset="1" stopColor="#28d7c4" stopOpacity="0"/></linearGradient></defs>{[40,80,120,160,200].map(y=><line key={y} x1="0" x2="800" y1={y} y2={y} className="equity-grid"/>)}{points&&<><polyline points={`${points} 800,220 0,220`} fill="url(#equityFill)"/><polyline points={points} className="equity-line" fill="none"/>{result?.actions.map((action,index)=>{ const point=chartPoint(curve[Math.min(action.curveIndex,curve.length-1)] ?? capital,Math.min(action.curveIndex,curve.length-1)); const fill=action.side==="卖出"?"#ff6464":"#28d7c4"; return <g key={`${action.side}-${action.time}-${index}`}><circle cx={point.x} cy={point.y} r="7" fill={fill} stroke="#071312" strokeWidth="3"/><text x={point.x} y={point.y-12} textAnchor="middle" fill={fill} fontSize="13" fontWeight="700">{action.side}</text></g>; })}</>}</svg></div>
        {result&&<div className="replay-actions"><div className="panel-heading"><div><h2>盲测循环复盘</h2><span>{cycles.length ? "已按卖出 → 买回自动配对" : "本次没有完整循环"}</span></div></div>{cycles.length ? <div className="cycle-list">{cycles.map(cycle=><article className={`cycle-row ${cycle.net>=0?"profit":"loss"}`} key={`${cycle.sell.time}-${cycle.buy.time}`}><div><b>反 T 循环 #{cycle.index}</b><span>卖出 {cycle.sell.time} ¥ {cycle.sell.price.toFixed(2)} → 买回 {cycle.buy.time} ¥ {cycle.buy.price.toFixed(2)}</span></div><div><small>数量</small><b>{cycle.sell.quantity.toLocaleString()} 股</b></div><div><small>毛收益</small><b>{money(cycle.gross)}</b></div><div><small>费用 + 滑点</small><b>{money(-(cycle.fees + cycle.executionCost))}</b></div><div><small>单次循环净收益</small><strong>{money(cycle.net)}</strong></div></article>)}</div> : <p className="config-note">策略在本次随机起点后没有形成可执行的完整反 T 循环，资金不变。</p>}<p className="config-note">毛收益按未滑点理论成交价计算；“费用 + 滑点”已包含佣金、卖出印花税和双向滑点。</p></div>}
        <div className="result-bottom"><div className="metric-table"><div><span>交易日</span><b>{result?.days ?? "—"}</b></div><div><span>模拟循环</span><b>{result?.trades ?? "—"}</b></div><div><span>胜出循环</span><b>{result?.wins ?? "—"}</b></div><div><span>循环胜率</span><b className="teal">{result?.trades ? `${(result.wins/result.trades*100).toFixed(2)}%` : "—"}</b></div><div><span>底仓设定</span><b>{baseShares.toLocaleString()} 股</b></div><div><span>数据源</span><b>{source?.provider ?? "—"}</b></div></div><div className="failure-panel"><h3>计算说明</h3><p><span>数据属性</span><b>{source ? "公开真实分时" : "未运行"}</b></p><p><span>执行规则</span><b>逐点揭示，不看未来</b></p><p><span>费用模型</span><b>佣金 + 滑点 + 印花税</b></p><p><span>计算状态</span><b className="failure-alert">{result?.status ?? "等待运行"}</b></p></div></div>
      </div>
    </div>
  </section>;
}

function NumberStepper({value,unit,step,min,onChange,decimals=0}:{value:number;unit:string;step:number;min:number;onChange:(value:number)=>void;decimals?:number}) {
  const format=(number:number)=>decimals ? number.toFixed(decimals) : number.toLocaleString('zh-CN');
  return <div className="number-stepper" role="group" aria-label={`${value}${unit}`}>
    <button type="button" onClick={()=>onChange(Math.max(min,Number((value-step).toFixed(decimals))))} aria-label={`减少${step}${unit}`}>−</button>
    <label><input type="text" inputMode={decimals?"decimal":"numeric"} value={format(value)} onChange={event=>{const raw=event.target.value.replace(decimals?/[^\d.]/g:/\D/g,"");const parsed=Number(raw);if(raw!==""&&Number.isFinite(parsed))onChange(Math.max(min,Number(parsed.toFixed(decimals))) )}} aria-label={`输入${unit}数值`}/><em>{unit}</em></label>
    <button type="button" onClick={()=>onChange(Number((value+step).toFixed(decimals)))} aria-label={`增加${step}${unit}`}>＋</button>
  </div>;
}
