"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Stock = { code:string; name:string; price:string; change:string; prices?:number[]; times?:string[]; volumes?:number[]; open?:number; high?:number; low?:number; vwap?:number; amount?:string; signal?:string; reason?:string; signalScore?:number; strictSignal?:boolean; buyPrice?:number; sellPrice?:number; marketStatus?:string; quoteStale?:boolean };
function normalizePrices(raw:unknown):number[]{
  if(!Array.isArray(raw))return [];
  return raw.map(item=>{
    if(typeof item==='number')return item;
    if(typeof item==='string')return Number(item);
    if(item&&typeof item==='object')return Number((item as Record<string,unknown>).price);
    return NaN;
  }).filter(Number.isFinite);
}
function normalizeVolumes(raw:unknown):number[]{
  if(!Array.isArray(raw))return [];
  return raw.map(item=>{
    if(!item||typeof item!=='object')return 0;
    const row=item as Record<string,unknown>;
    return Math.max(0,Number(row.volumeDelta??row.volume??0)||0);
  });
}
function normalizeTimes(raw:unknown):string[]{
  if(!Array.isArray(raw))return [];
  return raw.map(item=>{
    const value=item&&typeof item==='object'?(item as Record<string,unknown>).time||(item as Record<string,unknown>).datetime||(item as Record<string,unknown>).timestamp:item;
    if(typeof value==='number'&&Number.isFinite(value)){const date=new Date(value<1e12?value*1000:value);return Number.isNaN(date.getTime())?'':date.toISOString()}
    return typeof value==='string'?value:'';
  });
}
function formatMarketAmount(raw:unknown):string|undefined{
  const value=Number(raw||0);if(!Number.isFinite(value)||value<=0)return undefined;
  if(value>=100000000)return `${(value/100000000).toFixed(2)}亿`;
  if(value>=10000)return `${(value/10000).toFixed(1)}万`;
  return value.toFixed(0);
}
function quoteFromSeries(raw:unknown,prices:number[],fallback?:number){
  const value=Number(raw);
  if(!prices.length)return Number.isFinite(value)&&value>0?value:fallback;
  const min=Math.min(...prices),max=Math.max(...prices),last=prices[prices.length-1];
  if(Number.isFinite(value)&&value>=min*.98&&value<=max*1.02)return value;
  return fallback??last;
}
function radarLabel(score:number){return score<0?'数据不可用':score<25?'风险区':score<75?'震荡区':score<88?'强势区':'过热区'}
function normalizeProgress(raw:unknown){const value=Number(raw);return Number.isFinite(value)?Math.min(100,Math.max(0,value)):0}
const initialStocks:Stock[] = [
  { code: "601899", name: "紫金矿业", price: "--", change: "--", prices: [], volumes: [] },
  { code: "601012", name: "隆基绿能", price: "--", change: "--", prices: [], volumes: [] },
  { code: "000063", name: "中兴通讯", price: "--", change: "--", prices: [], volumes: [] },
  { code: "600519", name: "贵州茅台", price: "--", change: "--", prices: [], volumes: [] },
];

const knownStockNames: Record<string,string> = {
  "601899":"紫金矿业","603993":"洛阳钼业","601012":"隆基绿能","000063":"中兴通讯","600519":"贵州茅台",
  "000001":"平安银行","000333":"美的集团","000651":"格力电器","000858":"五粮液",
  "002594":"比亚迪","300750":"宁德时代","600036":"招商银行","600276":"恒瑞医药",
  "600900":"长江电力","601318":"中国平安","601398":"工商银行","601857":"中国石油"
};
const canonicalStockName=(code:string,fallback:string)=>{const normalized=code.replace(/^(sh|sz)/i,'').padStart(6,'0');return knownStockNames[normalized]||fallback};

const BACKEND_BASE='/rq-api';
const backendIdentity=(name:string)=>`${encodeURIComponent(name.trim().toLowerCase())}@users.zhuandianmi.com`;
async function backendJson(path:string,init?:RequestInit){
  const response=await fetch(`${BACKEND_BASE}${path}`,{credentials:'include',cache:'no-store',...init,headers:{'Content-Type':'application/json',...(init?.headers||{})}});
  const type=response.headers.get('content-type')||'';if(!type.includes('application/json'))throw new Error('BACKEND_UNAVAILABLE');
  const data=await response.json();return{response,data};
}

const agents = [
  { avatar: "/agents/training.png", name: "训练兔", role: "严格模拟", state: "等待状态", value: "--" },
  { avatar: "/agents/challenger.png", name: "挑战兔", role: "影子验证", state: "等待状态", value: "--" },
  { avatar: "/agents/official.png", name: "正式兔", role: "冠军策略", state: "等待状态", value: "--" },
  { avatar: "/agents/risk.png", name: "风控兔", role: "回撤监控", state: "等待状态", value: "--" },
];
const strategyProfiles = ["稳健档","平衡档","灵敏档","量化学习","自定义策略"];
const mainViews = ['首页','操盘台','多股监控','策略市场','持仓对账','模拟回测','智能训练'];

function marketMinute(raw:string):number|null{
  const match=raw.match(/(?:^|\s|T)(\d{2}):(\d{2})(?::\d{2})?/);if(!match)return null;
  const hour=Number(match[1]),minute=Number(match[2]),clock=hour*60+minute;
  if(clock<570||clock>900)return null;if(clock<=690)return clock-570;if(clock<780)return 120;return 120+(clock-780);
}
function buildPriceChart(prices:number[],reference?:number,times:string[]=[]){
  if(prices.length<2)return{path:'',lastX:10,lastY:168,values:[],xValues:[],min:0,max:0,vwapPath:''};
  const values=prices.slice(-300),visibleTimes=times.length===prices.length?times.slice(-300):[],min=Math.min(...values),max=Math.max(...values),span=Math.max(max-min,0.0001);
  const xValues=values.map((_,index)=>{const minute=visibleTimes.length?marketMinute(visibleTimes[index]):null;return minute===null?10+900*index/Math.max(values.length-1,1):10+900*minute/240});
  const path=values.map((value,index)=>`${index?'L':'M'}${xValues[index].toFixed(1)} ${(228-((value-min)/span)*150).toFixed(1)}`).join(' ');
  const referenceValue=Number(reference);
  const referenceY=Number.isFinite(referenceValue)&&referenceValue>=min&&referenceValue<=max?228-((referenceValue-min)/span)*150:NaN;
  return{path,lastX:xValues[xValues.length-1],lastY:228-((values[values.length-1]-min)/span)*150,values,xValues,min,max,vwapPath:Number.isFinite(referenceY)?`M10 ${referenceY.toFixed(1)} L910 ${referenceY.toFixed(1)}`:''};
}
function aggregatePeriod<T>(prices:T[],period:string){
  if(period==='日K')return [];
  const size=period==='5分'?5:period==='15分'?15:period==='30分'?30:period==='60分'?60:1;
  if(size===1)return prices;
  const result:T[]=[];for(let index=0;index<prices.length;index+=size){const chunk=prices.slice(index,index+size);if(chunk.length)result.push(chunk[chunk.length-1]);}
  return result;
}

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
  const [strategySaveState,setStrategySaveState]=useState({busy:false,message:'',error:false});
  const [accountOpen, setAccountOpen] = useState(false);
  const [trainingRunning, setTrainingRunning] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [trainingMessage,setTrainingMessage]=useState('正在读取训练状态');
  const [trainingResult,setTrainingResult]=useState<Record<string,unknown>>({});
  const [customStrategy, setCustomStrategy] = useState("09:35后等待开盘价与VWAP双确认；正T、反T每次不超过可做T数量的1/3；预期净价差低于0.5%不执行。");
  const [favoriteCodes, setFavoriteCodes] = useState<string[]>([]);
  const [showIndicators, setShowIndicators] = useState(true);
  const [marketClock, setMarketClock] = useState({time:'--:--:--',open:false,label:'休市中'});
  const [marketRadar,setMarketRadar]=useState({score:-1,state:'UNAVAILABLE',coverage:'unknown'});
  const [realtimeStatus,setRealtimeStatus]=useState<'checking'|'online'|'offline'>('checking');
  const [watchlistSync,setWatchlistSync]=useState({message:'',error:false});
  const [preferenceSaveState,setPreferenceSaveState]=useState({busy:false,message:'',error:false});
  const watchlistQueue=useRef<Promise<boolean>>(Promise.resolve(true));
  const stock = stockList[activeStock] || stockList[0];
  const selectProfile=(next:string)=>{setProfile(next);try{localStorage.setItem(`rabbit-profile:${accountName.toLowerCase()}`,next)}catch{}};
  const chooseStrategyProfile=(next:string)=>{selectProfile(next);setStrategySaveState({busy:false,message:'档位已选择，请点击“保存并应用”同步到服务器',error:false})};
  const persistWatchlist=(list:typeof initialStocks)=>{
    const text=list.map(item=>`${/^[569]/.test(item.code)?'sh':'sz'}${item.code}`).join(',');
    const operation=watchlistQueue.current.then(async()=>{setWatchlistSync({message:'正在同步服务器监控列表…',error:false});try{
        const {data}=await backendJson('/api/watchlist',{method:'POST',body:JSON.stringify({text})});
        if(!data.ok)throw new Error(String(data.message||data.error||'服务器未保存监控列表'));
        setWatchlistSync({message:'服务器监控列表已同步',error:false});return true;
      }catch(error){setWatchlistSync({message:error instanceof Error?error.message:'监控列表同步失败',error:true});return false}});
    watchlistQueue.current=operation;return operation;
  };
  const savePreferences=async(next:{stock:string;baseShares:number;risk:string},list:typeof initialStocks)=>{
    setPreferenceSaveState({busy:true,message:'正在保存账户偏好…',error:false});
    try{
      const watchlistSaved=await persistWatchlist(list);
      if(!watchlistSaved)throw new Error('监控列表未能同步，请检查服务器连接');
      const {data}=await backendJson('/api/settings',{method:'POST',body:JSON.stringify({cash:100000,trade:20000,sample:10,days:5,defaultStock:next.stock,baseShares:next.baseShares,riskPreference:next.risk,customStrategy,strategyMode:profile})});
      if(data.ok===false)throw new Error(String(data.message||data.error||'服务器未保存账户偏好'));
      setPreferences(next);setStockList(list);
      const preferredIndex=list.findIndex(item=>next.stock.startsWith(item.code));setActiveStock(preferredIndex>=0?preferredIndex:0);
      try{localStorage.setItem(`rabbit-prefs:${accountName.toLowerCase()}`,JSON.stringify(next));localStorage.setItem(`rabbit-watchlist:${accountName.toLowerCase()}`,JSON.stringify(list))}catch{}
      try{localStorage.removeItem(`rabbit-needs-onboarding:${accountName.toLowerCase()}`)}catch{}
      setPreferenceSaveState({busy:false,message:'底仓与偏好已保存到服务器',error:false});
      setOnboardingOpen(false);return true;
    }catch(error){setPreferenceSaveState({busy:false,message:error instanceof Error?error.message:'账户偏好保存失败',error:true});return false}
  };
  const removeStock=(index:number)=>{if(stockList.length<=1)return;const next=stockList.filter((_,i)=>i!==index);setStockList(next);setActiveStock(current=>current===index?Math.max(0,index-1):current>index?current-1:current);setCycleStage('ready');persistWatchlist(next);try{localStorage.setItem(`rabbit-watchlist:${accountName.toLowerCase()}`,JSON.stringify(next))}catch{}};
  const chartState = useMemo(() => buildPriceChart(aggregatePeriod(stock.prices||[],period),stock.vwap,aggregatePeriod(stock.times||[],period)), [stock.prices,stock.times,stock.vwap,period]);
  const volumeBars = useMemo(() => {
    if(period==='日K')return [] as {height:number;down:boolean}[];
    const size=period==='5分'?5:period==='15分'?15:period==='30分'?30:period==='60分'?60:1;
    const source=stock.volumes||[];const values:number[]=[];
    for(let index=0;index<source.length;index+=size)values.push(source.slice(index,index+size).reduce((sum,value)=>sum+value,0));
    const visible=values.slice(-300),max=Math.max(...visible,0);
    return visible.map((value,index)=>({height:max>0?Math.max(2,44*value/max):0,down:(chartState.values[index]??0)<(chartState.values[Math.max(0,index-1)]??0)}));
  },[chartState.values,period,stock.volumes]);
  const signalPoints = useMemo(() => {
    const values=chartState.values;
    if(values.length<2||!stock.strictSignal||stock.quoteStale)return [] as {x:number;y:number;kind:'buy'|'sell';label:string}[];
    const kind: 'buy'|'sell'=Number(stock.buyPrice||0)>0?'buy':'sell';
    const signalPrice=kind==='buy'?Number(stock.buyPrice||0):Number(stock.sellPrice||0);
    if(signalPrice<=0)return [];
    // The realtime endpoint exposes a current strict signal but no signal timestamp.
    // Anchor it to the latest real quote instead of guessing an earlier same-price point.
    const index=values.length-1;
    const span=Math.max(chartState.max-chartState.min,0.0001);
    return [{x:chartState.xValues[index]??(10+900*index/Math.max(values.length-1,1)),y:228-((values[index]-chartState.min)/span)*150,kind,label:kind==='buy'?'买入确认':'卖出确认'}];
  },[chartState,stock.buyPrice,stock.quoteStale,stock.sellPrice,stock.strictSignal]);
  const chart = chartState.path;
  const isDown = stock.change.trim().startsWith('-');
  const quoteTone=stock.change.trim().startsWith('-')?'down':stock.change.trim().startsWith('+')?'up':'neutral';
  const quoteNumber=Number(stock.price.replace(/,/g,''))||0;
  const open=Number(stock.open)||0;
  const high=Number(stock.high)||0;
  const low=Number(stock.low)||0;
  const vwap=Number(stock.vwap)||0;
  const quoteMetric=(value:number)=>value>0?value.toFixed(2):'--';
  const currentSignal=stock.quoteStale?'行情延迟':stock.signal||'观察';
  const currentReason=stock.reason||(marketClock.open?'暂无高质量买卖点，等待后端确认。':'当前休市，仅显示最近行情。');
  const confirmedSignal=Boolean(stock.strictSignal&&!stock.quoteStale);
  const confirmedMode=Number(stock.buyPrice||0)>0?'正T':Number(stock.sellPrice||0)>0?'反T':'';
  const signalDirectionMatches=!confirmedSignal||!confirmedMode||signalMode===confirmedMode;
  const closureQuantity=Math.max(0,Math.floor(preferences.baseShares/3/100)*100);
  const runTraining=async()=>{try{setTrainingRunning(true);setTrainingMessage('训练任务提交中');const {data}=await backendJson('/api/four-rabbits/control',{method:'POST',body:JSON.stringify({action:'run'})});setTrainingMessage(String(data.message||'训练任务已提交'));setTrainingProgress(normalizeProgress(data.progress));}catch{setTrainingRunning(false);setTrainingMessage('训练服务暂不可用，请稍后重试')}};
  const saveCustomStrategy=async()=>{
    setStrategySaveState({busy:true,message:'正在同步策略设置…',error:false});
    try{
      const {data}=await backendJson('/api/settings',{method:'POST',body:JSON.stringify({cash:100000,trade:20000,sample:10,days:5,defaultStock:preferences.stock,baseShares:preferences.baseShares,riskPreference:preferences.risk,customStrategy,strategyMode:profile})});
      if(!data.ok)throw new Error(String(data.message||data.error||'服务器未保存策略'));
      try{localStorage.setItem(`rabbit-custom-strategy:${accountName.toLowerCase()}`,customStrategy);localStorage.setItem(`rabbit-profile:${accountName.toLowerCase()}`,profile)}catch{}
      setStrategySaveState({busy:false,message:'策略已同步到服务器',error:false});window.setTimeout(()=>setStrategyOpen(false),500);
    }catch(error){setStrategySaveState({busy:false,message:error instanceof Error?error.message:'策略同步失败',error:true})}
  };
  useEffect(() => {
    const updateClock=()=>{
      const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(new Date());
      const read=(type:string)=>parts.find(part=>part.type===type)?.value||'';
      const total=Number(read('hour'))*60+Number(read('minute'));const workday=!['Sat','Sun'].includes(read('weekday'));
      const open=workday&&((total>=570&&total<690)||(total>=780&&total<900));
      setMarketClock({time:`${read('hour')}:${read('minute')}:${read('second')}`,open,label:open?'交易时段内':workday&&total<570?'等待开盘':'非交易时段'});
    };
    updateClock();const timer=window.setInterval(updateClock,1000);return()=>window.clearInterval(timer);
  }, []);
  useEffect(()=>{
    if(!localAuth)return;
    const refresh=async()=>{try{const {data}=await backendJson('/api/realtime');if(!data.ok||!Array.isArray(data.stocks)){setRealtimeStatus('offline');return}setRealtimeStatus('online');setStockList(current=>current.map(item=>{const live=data.stocks.find((row:Record<string,unknown>)=>String(row.code||'').replace(/^(sh|sz)/i,'').padStart(6,'0')===item.code);if(!live)return item;const rawChange=live.change;const change=rawChange===undefined||rawChange===null||rawChange===''?NaN:Number(rawChange);const livePrices=normalizePrices(live.prices);const liveTimes=normalizeTimes(live.prices);const liveVolumes=normalizeVolumes(live.prices);const prices=livePrices.length>1?livePrices:item.prices;const times=livePrices.length>1&&liveTimes.length===livePrices.length?liveTimes:item.times;const series=prices||[];const derivedOpen=series[0];const derivedHigh=series.length?Math.max(...series):undefined;const derivedLow=series.length?Math.min(...series):undefined;const derivedVwap=series.length?series.reduce((sum,value)=>sum+value,0)/series.length:undefined;return{...item,name:knownStockNames[item.code]||String(live.name||item.name),price:Number(live.price||0)>0?Number(live.price).toFixed(2):'--',change:Number.isFinite(change)?(change>=0?'+':'')+change.toFixed(2)+'%':'--',prices,times,volumes:liveVolumes.length?liveVolumes:item.volumes,open:quoteFromSeries(live.open,series,derivedOpen??item.open),high:quoteFromSeries(live.high,series,derivedHigh??item.high),low:quoteFromSeries(live.low,series,derivedLow??item.low),vwap:quoteFromSeries(live.avg||live.vwap,series,derivedVwap??item.vwap),amount:formatMarketAmount(live.amount)||item.amount,signal:String(live.signal||''),reason:String(live.reason||''),signalScore:live.signalScore==null?item.signalScore:Number(live.signalScore),strictSignal:Boolean(live.strictSignal),buyPrice:Number(live.buyPrice||0),sellPrice:Number(live.sellPrice||0),marketStatus:String(live.marketStatus||''),quoteStale:Boolean(live.quoteStale)}}))}catch{setRealtimeStatus('offline')}};
    void refresh();const timer=window.setInterval(refresh,15000);return()=>window.clearInterval(timer);
  },[localAuth]);
  useEffect(()=>{
    if(!localAuth)return;
    const refresh=async()=>{try{const {data}=await backendJson('/api/four-rabbits/status');if(!data.ok){setTrainingMessage('训练状态服务暂不可用');return}setTrainingRunning(data.running===true||data.running==='true');setTrainingProgress(normalizeProgress(data.progress));setTrainingMessage(String(data.message||'等待训练任务'));setTrainingResult(data.lastResult&&typeof data.lastResult==='object'?data.lastResult:{})}catch{setTrainingRunning(false);setTrainingMessage('训练状态服务暂不可用')}};
    void refresh();const timer=window.setInterval(refresh,5000);return()=>window.clearInterval(timer);
  },[localAuth]);
  useEffect(()=>{
    if(!localAuth)return;
    const refresh=async()=>{try{const {data}=await backendJson('/api/market_radar');const score=Number(data.score);setMarketRadar({score:Number.isFinite(score)?score:-1,state:String(data.state||'UNAVAILABLE'),coverage:String(data.coverage||'unknown')})}catch{setMarketRadar({score:-1,state:'UNAVAILABLE',coverage:'unknown'})}};
    void refresh();const timer=window.setInterval(refresh,90000);return()=>window.clearInterval(timer);
  },[localAuth]);
  useEffect(()=>{
    if(!watchlistSync.message||watchlistSync.error)return;
    const timer=window.setTimeout(()=>setWatchlistSync({message:'',error:false}),3200);return()=>window.clearTimeout(timer);
  },[watchlistSync]);
  useEffect(() => {
    const timer = window.setTimeout(async() => {
      try {
        const session=localStorage.getItem('rabbit-auth-session')||sessionStorage.getItem('rabbit-auth-session');
        if(session){
          try{const {data}=await backendJson('/api/account');if(!data.loggedIn&&!data.account){localStorage.removeItem('rabbit-auth-session');sessionStorage.removeItem('rabbit-auth-session');setAuthReady(true);return}}catch{setAuthReady(true);return}
          setLocalAuth(true);
          setAccountName(session);
          const saved=localStorage.getItem(`rabbit-prefs:${session.toLowerCase()}`);
          const needsOnboarding=localStorage.getItem(`rabbit-needs-onboarding:${session.toLowerCase()}`)==='1';
          if(saved){const prefs=JSON.parse(saved);if(typeof prefs.stock==='string'&&prefs.stock.startsWith('601899'))prefs.stock='601899 紫金矿业';setPreferences(prefs);localStorage.setItem(`rabbit-prefs:${session.toLowerCase()}`,JSON.stringify(prefs));}
          const watchlist=localStorage.getItem(`rabbit-watchlist:${session.toLowerCase()}`);
          if(watchlist){const list=JSON.parse(watchlist);if(Array.isArray(list)&&list.length){const normalized=list.map(item=>({...item,name:canonicalStockName(String(item?.code||''),String(item?.name||'待行情识别'))}));setStockList(normalized);if(saved){const preferredCode=String(JSON.parse(saved).stock||'').slice(0,6);const preferredIndex=normalized.findIndex((item:Stock)=>item.code===preferredCode);if(preferredIndex>=0)setActiveStock(preferredIndex)}localStorage.setItem(`rabbit-watchlist:${session.toLowerCase()}`,JSON.stringify(normalized));}}
          const savedProfile=localStorage.getItem(`rabbit-profile:${session.toLowerCase()}`);if(savedProfile)setProfile(savedProfile);
          const savedStrategy=localStorage.getItem(`rabbit-custom-strategy:${session.toLowerCase()}`);if(savedStrategy)setCustomStrategy(savedStrategy);
          const savedFavorites=localStorage.getItem(`rabbit-favorites:${session.toLowerCase()}`);if(savedFavorites)setFavoriteCodes(JSON.parse(savedFavorites));
          void (async()=>{try{
            const [{data:remoteWatch},{data:remoteSettings}]=await Promise.all([backendJson('/api/watchlist'),backendJson('/api/settings')]);
            let remoteRows:Stock[]|null=null;
            if(remoteWatch.ok&&Array.isArray(remoteWatch.stocks)&&remoteWatch.stocks.length){remoteRows=remoteWatch.stocks.map((item:Record<string,unknown>)=>{const code=String(item.code||'').replace(/^(sh|sz)/i,'').padStart(6,'0');return{code,name:knownStockNames[code]||String(item.name||'待行情识别'),price:item.price?String(item.price):'--',change:item.change?String(item.change):'--',prices:normalizePrices(item.prices),times:normalizeTimes(item.prices),open:Number(item.open||0)||undefined,high:Number(item.high||0)||undefined,low:Number(item.low||0)||undefined,vwap:Number(item.vwap||0)||undefined,amount:item.amount?String(item.amount):undefined}});setStockList(remoteRows);setActiveStock(current=>Math.min(current,remoteRows!.length-1));localStorage.setItem(`rabbit-watchlist:${session.toLowerCase()}`,JSON.stringify(remoteRows));}
            let restoredRemotePreferences=false;
            if(remoteSettings.ok){
              if(remoteSettings.customStrategy)setCustomStrategy(String(remoteSettings.customStrategy));if(strategyProfiles.includes(String(remoteSettings.strategyMode)))setProfile(String(remoteSettings.strategyMode));
              const remoteStock=String(remoteSettings.defaultStock||remoteSettings.default_stock||'');const remoteShares=Number(remoteSettings.baseShares??remoteSettings.base_shares);const remoteRisk=String(remoteSettings.riskPreference||remoteSettings.risk_preference||'');
              if(/^\d{6}(?:\s|$)/.test(remoteStock)&&Number.isFinite(remoteShares)&&remoteShares>=0){const restored={stock:remoteStock,baseShares:remoteShares,risk:['稳健','平衡','积极'].includes(remoteRisk)?remoteRisk:'稳健'};setPreferences(restored);if(remoteRows){const preferredIndex=remoteRows.findIndex(item=>item.code===remoteStock.slice(0,6));if(preferredIndex>=0)setActiveStock(preferredIndex)}localStorage.setItem(`rabbit-prefs:${session.toLowerCase()}`,JSON.stringify(restored));restoredRemotePreferences=true;}
            }
            if(needsOnboarding||(!saved&&!restoredRemotePreferences))setOnboardingOpen(true);
          }catch{if(needsOnboarding||!saved)setOnboardingOpen(true)}})();
        }
      } catch {}
      setAuthReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if(!authReady) return <main className="auth-loading"><img src="/rabbit-brand-mark.webp" alt="做T神器"/></main>;
  if(!localAuth) return <AuthView onAuthenticated={(name,isNew,remember)=>{
    setAccountName(name);setLocalAuth(true);
    try{
      const userKey=name.toLowerCase();const persistent=isNew||remember;
      (persistent?localStorage:sessionStorage).setItem('rabbit-auth-session',name);(persistent?sessionStorage:localStorage).removeItem('rabbit-auth-session');
      if(isNew)localStorage.setItem(`rabbit-needs-onboarding:${userKey}`,'1');
      const saved=localStorage.getItem(`rabbit-prefs:${userKey}`);
      if(saved){const prefs=JSON.parse(saved);if(typeof prefs.stock==='string'&&prefs.stock.startsWith('601899'))prefs.stock='601899 紫金矿业';setPreferences(prefs);}else setOnboardingOpen(true);
      const watchlist=localStorage.getItem(`rabbit-watchlist:${userKey}`);
      if(watchlist){const list=JSON.parse(watchlist);if(Array.isArray(list)&&list.length)setStockList(list.map(item=>({...item,name:canonicalStockName(String(item?.code||''),String(item?.name||'待行情识别'))})));}
      const savedProfile=localStorage.getItem(`rabbit-profile:${userKey}`);if(savedProfile)setProfile(savedProfile);
      const savedStrategy=localStorage.getItem(`rabbit-custom-strategy:${userKey}`);if(savedStrategy)setCustomStrategy(savedStrategy);
      const savedFavorites=localStorage.getItem(`rabbit-favorites:${userKey}`);if(savedFavorites)setFavoriteCodes(JSON.parse(savedFavorites));
    }catch{}
    if(isNew)setOnboardingOpen(true);
  }}/>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand brand-lockup" aria-label="做T神器 Rabbit Smart-T">
          <span className="brand-emblem"><img className="rabbit-logo" src="/rabbit-brand-mark.webp" alt="双兔与上涨T品牌标志"/><i /></span>
          <span className="brand-type"><strong><em>做T</em><span>神器</span></strong><small>SMART INTRADAY SYSTEM</small></span>
        </div>
        <nav className="main-nav" aria-label="主导航">
          {mainViews.map((item) => <button onClick={() => setActiveView(item)} className={activeView === item ? 'active' : ''} key={item}>{item}</button>)}
        </nav>
        <div className="top-actions">
          <span className={marketClock.open?'market-open':'market-open market-closed'}><i />{marketClock.label}</span>
          <span className="auto-off"><i />自动交易未连接</span>
          <span className="clock">{marketClock.time}</span>
          <button className="profile-cycle" onClick={()=>{setStrategySaveState({busy:false,message:'',error:false});setStrategyOpen(true)}} aria-label={`当前策略${profile}，点击查看与修改`}><span>{profile}</span><i>⌄</i></button>
          <button className="strategy-help" onClick={()=>{setStrategySaveState({busy:false,message:'',error:false});setStrategyOpen(true)}}>策略说明</button>
          <button className="account-button" onClick={()=>setAccountOpen(true)} aria-label="打开账户中心"><span>{accountName.slice(0,1).toUpperCase()}</span><b>{accountName}</b><i>⌄</i></button>
          <button className="icon-button" onClick={()=>setOnboardingOpen(true)} aria-label="设置交易偏好">⌘</button>
        </div>
      </header>
      <nav className="mobile-nav" aria-label="移动端主导航">
        {mainViews.map((item)=><button onClick={()=>setActiveView(item)} className={activeView===item?'active':''} key={item}>{item}</button>)}
      </nav>
      {watchlistSync.message&&<div className={`sync-toast ${watchlistSync.error?'error':''}`} role="status"><i/>{watchlistSync.message}<button onClick={()=>setWatchlistSync({message:'',error:false})} aria-label="关闭同步提示">×</button></div>}

      {activeView === "首页" ? <HomeView onNavigate={setActiveView} stockCount={stockList.length} stock={stock} radar={marketRadar} trainingProgress={trainingProgress} trainingRunning={trainingRunning} /> : activeView === "操盘台" ? <>
      <section className="ticker" aria-label="股票监控列表">
        {stockList.map((item, index) => (
          <div className={`ticker-item ${activeStock === index ? 'selected' : ''}`} key={item.code}><button onClick={() => {setActiveStock(index);setCycleStage('ready')}}><span>{item.code} {item.name}</span><b>{item.price}</b><em className={item.change.startsWith('-')?'down':item.change.startsWith('+')?'up':'neutral'}>{item.change}</em></button><button className="ticker-remove" onClick={()=>removeStock(index)} disabled={stockList.length<=1} aria-label={`删除${item.name}`}>×</button></div>
        ))}
        <button className="ticker-add" onClick={()=>setOnboardingOpen(true)}>＋ 管理监控</button>
      </section>

      <section className="stock-head">
        <div className="stock-identity">
          <span className="stock-code">{stock.code}</span><h1>{stock.name}</h1><button className={`star ${favoriteCodes.includes(stock.code)?'active':''}`} onClick={()=>{const next=favoriteCodes.includes(stock.code)?favoriteCodes.filter(code=>code!==stock.code):[...favoriteCodes,stock.code];setFavoriteCodes(next);try{localStorage.setItem(`rabbit-favorites:${accountName.toLowerCase()}`,JSON.stringify(next))}catch{}}} aria-label={favoriteCodes.includes(stock.code)?'取消收藏':'收藏股票'}>{favoriteCodes.includes(stock.code)?'★':'☆'}</button>
        </div>
        <div className={`quote ${quoteTone}`}><strong>{stock.price}</strong><span>{stock.change}</span></div>
        <div className="quote-metrics">
          <span>今开 <b>{quoteMetric(open)}</b></span><span>最高 <b>{quoteMetric(high)}</b></span><span>最低 <b>{quoteMetric(low)}</b></span><span>VWAP <b className="teal">{quoteMetric(vwap)}</b></span><span>成交额 <b>{stock.amount||'--'}</b></span>
        </div>
        <div className="auction"><span>{stock.marketStatus||'行情状态'}</span><b>{currentSignal}</b><small>{confirmedSignal?`严格信号已确认 · ${stock.signalScore||0}/10`:'观察信号 · 不执行'}</small></div>
      </section>

      <section className="workspace">
        <div className="chart-zone">
          <div className="chart-tools">
            <div className="legend"><span><i className={isDown?'green-line':'coral-line'}/>分时价 <b>{stock.price}</b></span><span><i className="teal-line"/>VWAP <b>{quoteMetric(vwap)}</b></span></div>
            <span className={`live-scan ${realtimeStatus==='offline'?'offline':''}`}><i/>{realtimeStatus==='checking'?'正在连接行情源…':realtimeStatus==='offline'?'行情接口连接失败':!marketClock.open?'休市 · 展示最近行情':stock.quoteStale?'行情延迟 · 等待刷新':'开盘自动监控 · 实时扫描中'}</span>
            <div className="periods">{['分时','5分','15分','30分','60分','日K'].map(p => <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>{p}</button>)}</div>
            <button className={`tool-button ${showIndicators?'active':''}`} onClick={()=>setShowIndicators(!showIndicators)}>{showIndicators?'隐藏指标':'显示指标'}</button><button className="tool-button" onClick={e=>{const target=e.currentTarget.closest('.chart-zone') as HTMLElement|null;if(target?.requestFullscreen)target.requestFullscreen()}}>全屏</button>
          </div>
          <div className="chart-wrap">
            <div className="y-axis"><span>{chartState.max ? chartState.max.toFixed(2) : '--'}</span><span>{chartState.max ? (chartState.max-(chartState.max-chartState.min)*.25).toFixed(2) : '--'}</span><span>{chartState.max ? (chartState.max-(chartState.max-chartState.min)*.5).toFixed(2) : '--'}</span><span>{chartState.max ? (chartState.max-(chartState.max-chartState.min)*.75).toFixed(2) : '--'}</span><span>{chartState.min ? chartState.min.toFixed(2) : '--'}</span></div>
            <svg viewBox="0 0 920 300" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${stock.name}分时价格与VWAP`}>
              <defs><linearGradient id="priceFillUp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff655f" stopOpacity=".18"/><stop offset="1" stopColor="#ff655f" stopOpacity="0"/></linearGradient><linearGradient id="priceFillDown" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#42c98a" stopOpacity=".18"/><stop offset="1" stopColor="#42c98a" stopOpacity="0"/></linearGradient></defs>
              {[50,100,150,200,250].map(y => <line key={y} x1="0" y1={y} x2="920" y2={y} className="grid-line"/>)}
              {[10,122.5,235,460,685,797.5,910].map(x => <line key={x} x1={x} y1="0" x2={x} y2="300" className="grid-line vertical"/>)}
              {chart&&<path d={`${chart} L${chartState.lastX.toFixed(1)} 300 L10 300 Z`} fill={`url(#${isDown?'priceFillDown':'priceFillUp'})`} />}
              {showIndicators&&chartState.vwapPath&&<path d={chartState.vwapPath} className="vwap-path"/>}{chart&&<path d={chart} className={`price-path ${isDown?'down':''}`}/>}
              {chart&&<><line x1="0" y1={chartState.lastY} x2="920" y2={chartState.lastY} className={`last-line ${isDown?'down':''}`}/><circle cx={chartState.lastX} cy={chartState.lastY} r="4" className={`last-dot ${isDown?'down':''}`}/></>}
              {signalPoints.map(point=><g key={`${point.kind}-${point.x}`} className={`chart-badge ${point.kind} active-signal`} transform={`translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`}><circle className="badge-pulse" r="7"/><circle className="badge-trigger" r="4"/><line x1="0" y1={point.kind==='buy'?6:-6} x2="0" y2={point.kind==='buy'?15:-15}/><rect x="-27" y={point.kind==='buy'?18:-39} width="54" height="21" rx="5"/><path d={point.kind==='buy'?'M-5 18 L0 12 L5 18 Z':'M-5 -18 L0 -12 L5 -18 Z'}/><text className="badge-copy" x="0" y={point.kind==='buy'?32:-25}>{point.label}</text></g>)}
              <line x1="0" y1="252" x2="920" y2="252" className="volume-divider"/>
              {volumeBars.map((bar,index)=>{const gap=900/Math.max(volumeBars.length,1);return <rect key={index} x={chartState.xValues[index]??(10+index*gap)} y={300-bar.height} width={Math.max(2,Math.min(10,gap*.55))} height={bar.height} className={bar.down?'volume':'volume red'}/>})}
            </svg>
            {!chart&&<div className="chart-empty"><b>{period==='日K'?'暂无真实日K数据':'暂无当前股票真实分时数据'}</b><span>{period==='日K'?'当前后端仅提供当日逐分钟行情，历史日K接口接入后再开放。':'等待行情接口返回当前股票的分钟量价数据，不使用模拟曲线。'}</span></div>}
            {chart&&quoteNumber>0&&<div className={`price-flag ${isDown?'down':''}`} style={{top:`${Math.max(12,Math.min(82,chartState.lastY/3))}%`}}>{stock.price}</div>}
            <div className="x-axis">{[['09:30',0],['10:00',12.5],['10:30',25],['11:30/13:00',50],['14:00',75],['14:30',87.5],['15:00',100]].map(([label,left],index)=><span key={String(label)} style={{left:`${left}%`,transform:index===0?'none':index===6?'translateX(-100%)':'translateX(-50%)'}}>{label}</span>)}</div>
          </div>
          <div className="signal-tape">
            <span className="tape-title">信号证据</span>
            <span><i className={confirmedSignal?'ok':'wait'}>{confirmedSignal?'✓':'·'}</i>{confirmedSignal?'后端严格信号确认':'尚无严格买卖信号'}</span><span><i className={stock.quoteStale?'wait':'ok'}>{stock.quoteStale?'·':'✓'}</i>{stock.quoteStale?'行情已延迟':'行情时效正常'}</span><span><i className={vwap?'ok':'wait'}>{vwap?'✓':'·'}</i>VWAP {quoteMetric(vwap)}</span><span><i className="wait">·</i>{currentReason}</span>
          </div>
        </div>

        <aside className="decision-zone">
          <div className="decision-tabs"><button onClick={() => setSignalMode('正T')} className={signalMode==='正T'?'active':''}>正T</button><button onClick={() => setSignalMode('反T')} className={signalMode==='反T'?'active':''}>反T</button></div>
          <div className="decision-label"><span>SMART-T 决策</span><em>{confirmedSignal?'严格信号已确认':'等待严格信号'}</em></div>
          <div className="radar-gate"><div><span>市场雷达门控</span><b>{marketRadar.score>=0?marketRadar.score.toFixed(0):'--'}<small>/100</small></b></div><p><i/>{radarLabel(marketRadar.score)} · {marketRadar.score<0?'等待雷达数据':marketRadar.coverage==='full'?'全市场覆盖':'降级样本'}</p><small>雷达低于25禁止激进正T；75以上提高反T确认分；88以上必须等待真实回落。</small></div>
          <div className="opening-causal"><span>09:35–10:00 开盘试单</span><b>仅使用已出现数据 · 单次 1/6 仓</b><small>低开站回VWAP才允许正T；高开跌破VWAP且回抽失败才允许反T。</small></div>
          <h2>{currentSignal}</h2>
          <p className="decision-copy">{currentReason}</p>
          <button disabled={cycleStage==='ready'&&(!confirmedSignal||!signalDirectionMatches)} className={`primary-action ${cycleStage !== 'ready' ? 'confirmed' : ''}`} onClick={() => setCycleStage(cycleStage === 'ready' ? 'opened' : cycleStage === 'opened' ? 'closed' : 'ready')}>
            <span>{cycleStage==='ready'&&!confirmedSignal?'等待严格信号确认':cycleStage==='ready'&&!signalDirectionMatches?`当前严格信号为${confirmedMode}`:cycleStage === 'ready' ? (signalMode === '反T' ? '卖出 1/3 昨仓' : '买入 1/3 计划仓') : cycleStage === 'opened' ? (signalMode === '反T' ? '记录等量买回' : '记录等量卖出') : '本次T已闭环'}</span>
            <small>{cycleStage === 'ready' ? '记录首笔成交' : cycleStage === 'opened' ? '完成反向成交' : '开始下一次循环'} →</small>
          </button>
          <div className={`closure-guard ${cycleStage}`}>
            <div><span>当日闭环控制</span><b><i/>{cycleStage === 'ready' ? '允许开T' : cycleStage === 'opened' ? '等待闭环' : '已恢复底仓'}</b></div>
            <p><span>计划数量</span><strong>{closureQuantity.toLocaleString()} 股</strong></p><p><span>当前持仓</span><strong>{(cycleStage === 'opened' ? (signalMode === '正T' ? preferences.baseShares+closureQuantity : Math.max(0,preferences.baseShares-closureQuantity)) : preferences.baseShares).toLocaleString()} 股</strong></p><p><span>收盘目标</span><strong>{preferences.baseShares.toLocaleString()} 股</strong></p>
            <div className="cycle-progress"><i className="done"/><span/><i className={cycleStage !== 'ready' ? 'done' : ''}/><span/><i className={cycleStage === 'closed' ? 'done' : ''}/></div>
            <div className="cycle-labels"><span>校验通过</span><span>首笔成交</span><span>等量闭环</span></div>
            <small>{cycleStage === 'ready' ? (signalMode === '正T' ? '可卖旧仓充足，买入后需卖出等量旧仓。' : '卖出后需在 14:50 前买回等量股份。') : cycleStage === 'opened' ? `尚有 ${closureQuantity.toLocaleString()} 股未配对，新的${signalMode}信号已冻结。` : '买卖数量相等，实际持仓已恢复计划底仓。'}</small>
          </div>
          <div className="decision-stats"><div><span>策略评分</span><b>{stock.signalScore??'--'}<small>/10</small></b></div><div><span>当前偏离</span><b>{vwap&&quoteNumber?((quoteNumber-vwap)/vwap*100).toFixed(2):'--'}<small>%</small></b></div><div><span>市场雷达</span><b>{marketRadar.score>=0?marketRadar.score.toFixed(0):'--'}<small>/100</small></b></div></div>
          <div className="risk-box"><div><span>止盈参考</span><b>+0.60% ~ +1.20%</b></div><div><span>风险边界</span><b>-0.60%</b></div><p>若价格重新站回 VWAP 并放量上攻，反T预案立即失效，避免卖飞。</p></div>
          <button className="automation-reserved" disabled><span><i />自动交易接口</span><b>已预留 · 当前关闭</b></button>
          <div className="position-row"><span>计划仓位</span><div className="position-dots"><i className="on"/><i/><i/></div><b>1 / 3</b></div>
        </aside>
      </section>

      <section className="lower-panel">
        <div className="history">
          <div className="lower-tabs">{['今日T循环','历史信号','模拟记录'].map(item=><button key={item} onClick={()=>setPanel(item)} className={panel===item?'active':''}>{item}</button>)}</div>
          <div className="history-head"><span>时间</span><span>方向</span><span>价格</span><span>数量</span><span>价差</span><span>状态</span></div>
          {(cycleStage === 'opened' ? [['刚刚',signalMode === '反T' ? '反T卖出' : '正T买入',stock.price,`${closureQuantity.toLocaleString()}股`,'—','本机模拟 · 等待闭环']] : cycleStage === 'closed' ? [['刚刚',signalMode === '反T' ? '反T循环' : '正T循环',stock.price,`${closureQuantity.toLocaleString()}股`,'待后端计算','本机模拟 · 已闭环']] : []).map((row,i)=><div className="history-row" key={`${row[0]}-${i}`}>{row.map((cell,j)=><span className={j===1||j===4?'accent':''} key={j}>{cell}</span>)}</div>)}
          {cycleStage==='ready'&&<div className="history-empty">暂无真实成交记录；本区不会再显示预置成交。</div>}
        </div>
        <div className={`agents ${agentOpen ? 'open' : ''}`}>
          <button className="agents-title" onClick={()=>setAgentOpen(!agentOpen)}><span>四智能体持续训练</span><small>{trainingRunning?'影子回放进行中':'持续影子训练 · 每5分钟'}</small><b>{agentOpen?'收起':'详情'}⌃</b></button>
          {agentOpen && <div className="training-console">
            <div className="training-control"><div><span>{trainingMessage}</span><b>{trainingRunning?'影子回放中':trainingProgress===100?'本轮已完成':'等待继续训练'}</b></div><button onClick={()=>void runTraining()} disabled={trainingRunning}>{trainingRunning?'训练中…':trainingProgress===100?'开始新批次':'继续训练'}</button></div>
            <div className="training-progress"><div style={{width:`${trainingProgress}%`}}/><span>{trainingProgress}%</span></div>
            <div className="training-metrics"><p><span>样本</span><b>{String(trainingResult.tested??'--')}</b></p><p><span>触发</span><b>{String(trainingResult.trigger??'--')}</b></p><p><span>胜率</span><b>{trainingResult.winRate==null?'--':`${Number(trainingResult.winRate).toFixed(1)}%`}</b></p><p><span>净盈亏</span><b className="teal">{trainingResult.pnl==null?'--':`${Number(trainingResult.pnl)>=0?'+':''}¥${Number(trainingResult.pnl).toLocaleString('zh-CN')}`}</b></p><p><span>状态</span><b>{trainingRunning?'运行中':trainingProgress===100?'已完成':'待运行'}</b></p></div>
            <div className="training-log"><span>实时</span><p>{trainingMessage}</p><em>自动晋升关闭</em></div>
          </div>}
          <div className="agent-grid">{agents.map((agent,i)=><button className="agent" onClick={()=>setActiveView('智能训练')} key={agent.name}><span className={`agent-icon a${i}`}><img src={agent.avatar} alt={`${agent.name} AI头像`}/></span><span><b>{agent.name}</b><small>{agent.role}</small></span><em><i/>{agent.state}</em><strong>{agent.value}</strong></button>)}</div>
        </div>
      </section>
      </> : activeView === "多股监控" ? <MultiWatchView stocks={stockList} radar={marketRadar} realtimeStatus={realtimeStatus} onManage={()=>setOnboardingOpen(true)} onOpen={(index)=>{setActiveStock(index);setCycleStage('ready');setActiveView('操盘台')}} /> : activeView === "策略市场" ? <StrategyMarketView accountName={accountName} /> : activeView === "持仓对账" ? <HoldingsView stock={stock} baseShares={preferences.baseShares} /> : activeView === "智能训练" ? <TrainingView running={trainingRunning} progress={trainingProgress} message={trainingMessage} result={trainingResult} onRun={()=>void runTraining()} /> : <BacktestView key={`${stock.code}-${preferences.baseShares}`} profile={profile} setProfile={selectProfile} stock={stock} initialBaseShares={preferences.baseShares} />}

      {strategyOpen && <div className="strategy-overlay" role="dialog" aria-modal="true" aria-label="策略选择与说明">
        <div className="strategy-dialog">
          <div className="strategy-dialog-head"><div><span>SMART‑T STRATEGY</span><h2>选择真正看得懂的策略</h2><p>策略决定信号门槛与频率；仓位、费用、可卖数量、止损和尾盘恢复始终由硬风控约束。</p></div><button onClick={()=>setStrategyOpen(false)} aria-label="关闭策略说明">×</button></div>
          <div className="strategy-cards">
            {[
              {name:'稳健档',tag:'少做，只做最确定',fit:'震荡市、新手、重视回撤',score:'9/10',cycles:'每日最多 2 次',spread:'最低净价差 0.50%',risk:'可能错过快速机会'},
              {name:'平衡档',tag:'确认与机会兼顾',fit:'大多数正常交易日',score:'8/10',cycles:'每日最多 3 次',spread:'最低净价差 0.35%',risk:'默认推荐'},
              {name:'灵敏档',tag:'更早发现拐点',fit:'活跃行情、熟练用户',score:'7/10',cycles:'每日最多 5 次',spread:'最低净价差 0.25%',risk:'假信号会增加'},
              {name:'量化学习',tag:'用历史结果持续优化',fit:'积累足够模拟样本后',score:'动态门槛',cycles:'每日最多 4 次',spread:'经验参数决定',risk:'新参数需人工晋级'},
            ].map(item=><button key={item.name} onClick={()=>chooseStrategyProfile(item.name)} className={`strategy-card ${profile===item.name?'selected':''}`}><div><h3>{item.name}</h3><span>{profile===item.name?'已选择':'选择'}</span></div><strong>{item.tag}</strong><p>{item.fit}</p><ul><li>确认分：{item.score}</li><li>{item.cycles}</li><li>{item.spread}</li></ul><em>{item.risk}</em></button>)}
          </div>
          <div className={`custom-strategy ${profile==='自定义策略'?'selected':''}`}><div className="custom-head"><div><h3>用户自定义策略</h3><p>自然语言规则会保存到服务器账户；规则解析和自动生成交易条件仍待后端策略编译器接入。</p></div><button onClick={()=>chooseStrategyProfile('自定义策略')}>{profile==='自定义策略'?'已选择':'选择此策略'}</button></div><textarea value={customStrategy} onChange={e=>{setCustomStrategy(e.target.value);setStrategySaveState({busy:false,message:'规则已修改，请点击“保存并应用”同步到服务器',error:false})}} aria-label="自定义做T策略规则"/><div className="hard-guards"><span>不可绕过：</span><b>可卖数量</b><b>费用与滑点</b><b>14:30开仓限制</b><b>尾盘仓位恢复</b><b>连续失败熔断</b></div></div>
          <div className="opening-rule"><span>开盘因果规则</span><p>09:30–09:35 只观察；09:35–10:00 只使用当前分钟及之前的数据。低开重新站上VWAP、高开跌破VWAP且确认后，分两次各 1/6；早盘累计不超过 1/3。</p><button onClick={()=>void saveCustomStrategy()} disabled={strategySaveState.busy}>{strategySaveState.busy?'同步中…':'保存并应用'}</button>{strategySaveState.message&&<small className={strategySaveState.error?'save-error':'save-success'}>{strategySaveState.message}</small>}</div>
        </div>
      </div>}

      {accountOpen && <div className="account-overlay" role="dialog" aria-modal="true" aria-label="账户中心" onMouseDown={e=>{if(e.target===e.currentTarget)setAccountOpen(false)}}><div className="account-dialog">
        <div className="account-head"><div className="account-avatar">{accountName.slice(0,1).toUpperCase()}</div><div><span>用户名账户已登录</span><h2>{accountName}</h2><p>服务器账户</p></div><button onClick={()=>setAccountOpen(false)} aria-label="关闭账户中心">×</button></div>
        <div className="account-plan"><div><span>当前套餐</span><b>个人体验版</b><small>用户名与密码由服务器账户系统验证</small></div><em>已激活</em></div>
        <div className="account-stats"><div><span>监控股票</span><b>{stockList.length} / 10</b></div><div><span>本月回测</span><b>--</b></div><div><span>当前策略</span><b>{profile}</b></div></div>
        <div className="account-settings"><h3>账户偏好</h3><label><span>默认股票<small>进入操盘台后优先显示</small></span><b>{preferences.stock.split(' ')[0]}</b></label><label><span>计划底仓<small>用于当日闭环校验</small></span><b>{preferences.baseShares.toLocaleString()} 股</b></label><label><span>风险偏好<small>影响提醒强度，不绕过硬风控</small></span><b>{preferences.risk}</b></label><label><span>自动交易<small>券商接口尚未连接</small></span><b className="account-off">关闭</b></label></div>
        <div className="account-security"><i>✓</i><p><b>服务器账户已启用</b><span>登录由服务器校验并通过安全 Cookie 保持会话；浏览器不保存密码明文。</span></p></div>
        <div className="account-footer-actions"><button onClick={()=>setAccountOpen(false)}>完成</button><button onClick={()=>{setAccountOpen(false);setOnboardingOpen(true)}}>修改偏好</button><button onClick={()=>{void backendJson('/api/logout',{method:'POST',body:'{}'}).catch(()=>{});try{localStorage.removeItem('rabbit-auth-session');sessionStorage.removeItem('rabbit-auth-session')}catch{} setAccountOpen(false);setLocalAuth(false)}}>退出登录</button></div>
      </div></div>}
      {onboardingOpen&&<OnboardingView
        initial={preferences}
        initialList={stockList}
        syncState={watchlistSync}
        saveState={preferenceSaveState}
        onListChange={(list)=>{setStockList(list);setActiveStock(current=>Math.min(current,list.length-1));setCycleStage('ready');void persistWatchlist(list);try{localStorage.setItem(`rabbit-watchlist:${accountName.toLowerCase()}`,JSON.stringify(list))}catch{}}}
        onSave={savePreferences}
      />}

      <footer><span><i className={realtimeStatus==='online'?'online':realtimeStatus==='offline'?'offline':''}/>{realtimeStatus==='checking'?'正在检查行情源连接':realtimeStatus==='online'?'行情源已连接 · 每15秒刷新 · 雷达每90秒刷新':'行情源连接失败 · 正在自动重试'}</span><span>仅用于策略研究与提醒，不构成投资建议</span><span>Rabbit Quant V1.0</span></footer>
    </main>
  );
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
      const endpoint=mode==='register'?'/api/register':'/api/login';
      const {data}=await backendJson(endpoint,{method:'POST',body:JSON.stringify({email:backendIdentity(name),password,nickname:name,avatar:1})});
      if(!data.ok){setError(String(data.message||data.error||(mode==='register'?'注册失败，请检查用户名':'用户名或密码错误')));return;}
      onAuthenticated(data.account?.nickname||name,mode==='register',remember);window.setTimeout(()=>window.location.reload(),0);
    }catch{setError('登录服务器暂时无法连接，请稍后重试');}finally{setBusy(false);}
  };
  return <main className="auth-page">
    <section className="auth-brand-panel"><div className="auth-brand"><img src="/rabbit-brand-mark.webp" alt="双兔做T神器标志"/><span><b><em>做T</em>神器</b><small>SMART INTRADAY SYSTEM</small></span></div><div className="auth-message"><span className="eyebrow">RABBIT SMART‑T</span><h1>把复杂的盘面，<br/><em>变成简单的操作。</em></h1><p>多股监控、正反T决策、当日仓位闭环与四兔持续训练。</p></div><div className="auth-points"><span><i/>市场雷达硬门控</span><span><i/>T+1可卖数量校验</span><span><i/>收盘恢复计划底仓</span></div><small className="auth-disclaimer">策略研究工具 · 不构成投资建议</small></section>
    <section className="auth-form-panel"><div className="auth-card"><div className="auth-card-head"><span>{mode==='login'?'WELCOME BACK':'CREATE ACCOUNT'}</span><h2>{mode==='login'?'登录做T神器':'创建用户名账户'}</h2><p>{mode==='login'?'继续查看你的监控、回测和训练记录。':'首次注册后即可进入个人交易工作台。'}</p></div><div className="auth-tabs"><button className={mode==='login'?'active':''} onClick={()=>{setMode('login');setError('')}}>登录</button><button className={mode==='register'?'active':''} onClick={()=>{setMode('register');setError('')}}>注册</button></div><label className="auth-field"><span>用户名</span><input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" placeholder="请输入用户名"/></label><label className="auth-field"><span>密码</span><div><input value={password} onChange={e=>setPassword(e.target.value)} type={showPassword?'text':'password'} autoComplete={mode==='login'?'current-password':'new-password'} placeholder="至少 6 个字符"/><button onClick={()=>setShowPassword(!showPassword)} type="button">{showPassword?'隐藏':'显示'}</button></div></label>{mode==='register'&&<><div className="password-strength"><span>密码强度</span><i className={strength>0?'on':''}/><i className={strength>1?'on':''}/><i className={strength>2?'on':''}/><i className={strength>3?'on':''}/><b>{strength<2?'较弱':strength<4?'可用':'较强'}</b></div><label className="auth-field"><span>确认密码</span><input value={confirm} onChange={e=>setConfirm(e.target.value)} type={showPassword?'text':'password'} autoComplete="new-password" placeholder="再次输入密码"/></label><label className="terms-check"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/><span>我已阅读并同意《用户协议》和《隐私政策》，理解本工具不构成投资建议。</span></label></>}{mode==='login'&&<div className="auth-options"><label><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/><span>记住登录</span></label><button type="button" onClick={()=>setError('测试版暂不支持找回密码，请联系管理员重置')}>忘记密码？</button></div>}{error&&<div className="auth-error"><i>!</i>{error}</div>}<button className="auth-submit" onClick={submit} disabled={busy}>{busy?'正在验证…':mode==='login'?'登录':'注册并进入'}<span>→</span></button><div className="auth-local-note"><i>i</i><p><b>服务器账户验证</b><span>账户和监控列表由服务器同步；接口不可用时会明确报错，不会伪装登录成功。</span></p></div></div><footer className="auth-footer">© 2026 Rabbit Quant · 用户协议 · 隐私政策</footer></section>
  </main>;
}

function HomeView({onNavigate,stockCount,stock,radar,trainingProgress,trainingRunning}:{onNavigate:(view:string)=>void;stockCount:number;stock:(typeof initialStocks)[number];radar:{score:number;state:string;coverage:string};trainingProgress:number;trainingRunning:boolean}) {
  const homeChartState=buildPriceChart(stock.prices||[],undefined,stock.times||[]);
  const homeChart=homeChartState.path;
  const homeDown=stock.change.startsWith('-');
  const homeTone=stock.change.startsWith('-')?'negative':stock.change.startsWith('+')?'positive':'neutral';
  return <section className="product-home">
    <div className="home-hero">
      <div className="home-copy"><span className="eyebrow">RABBIT SMART‑T WORKSPACE</span><h1>看清买卖点，<br/><em>当天完成每一次T。</em></h1><p>集合竞价研判、市场雷达、正反T决策、仓位闭环和四兔训练集中在一个简单的交易工作台。</p><div className="home-actions"><button onClick={()=>onNavigate('操盘台')}>进入今日操盘台 <span>→</span></button><button onClick={()=>onNavigate('模拟回测')}>先做模拟回测</button></div><div className="home-trust"><span><i/>不自动下单</span><span><i/>T+1仓位校验</span><span><i/>收盘恢复底仓</span></div></div>
      <div className="home-terminal"><div className="terminal-head"><span>{stock.code} {stock.name}</span><em><i/>{stock.marketStatus||'行情同步中'}</em></div><div className="terminal-price"><strong>{stock.price}</strong><span className={homeTone}>{stock.change}</span><small>{radar.score>=0?`市场雷达 ${radar.score.toFixed(0)} · ${radarLabel(radar.score)}`:stock.quoteStale?'行情延迟，暂停信号':'等待实时行情'}</small></div><svg viewBox="0 0 920 300" preserveAspectRatio="none"><defs><linearGradient id="homeFillUp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff655f" stopOpacity=".18"/><stop offset="1" stopColor="#ff655f" stopOpacity="0"/></linearGradient><linearGradient id="homeFillDown" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#42c98a" stopOpacity=".18"/><stop offset="1" stopColor="#42c98a" stopOpacity="0"/></linearGradient></defs>{homeChart&&<><path d={`${homeChart} L${homeChartState.lastX.toFixed(1)} 300 L10 300Z`} fill={`url(#${homeDown?'homeFillDown':'homeFillUp'})`}/><path d={homeChart} className={`home-line ${homeDown?'down':''}`}/></>}</svg>{!homeChart&&<div className="terminal-chart-empty">等待当前股票真实分时数据</div>}<div className="terminal-signal"><span><i className="rabbit-dot-home">兔</i><b>{stock.signal||'观察'}</b></span><p>{stock.reason||'等待后端返回有效信号'}</p><em>{stock.strictSignal?`严格确认 · ${stock.signalScore||0}/10`:'观察中 · 不执行'}</em></div></div>
    </div>
    <div className="home-strip"><div><span>今日闭环</span><b>--</b><small>成交存储接入后显示</small></div><div><span>监控股票</span><b>{stockCount} 只</b><small>盘中持续扫描</small></div><div><span>已确认净收益</span><b className="teal">--</b><small>未闭环不计入</small></div><div><span>四兔训练</span><b>{trainingProgress}%</b><small>{trainingRunning?'影子回放进行中':'等待训练任务'}</small></div></div>
    <div className="home-workflow"><div className="workflow-head"><div><span className="eyebrow">DAILY WORKFLOW</span><h2>每天只看四件事</h2></div><p>减少指标堆叠，把操作顺序固定下来。</p></div><div className="workflow-grid">{[{n:'01',title:'先看市场',copy:'集合竞价与市场雷达先决定今天能不能做、优先正T还是反T。',action:'多股监控',icon:'⌁'},{n:'02',title:'再等信号',copy:'价格、VWAP、量能和确认分同时满足，才显示可执行机会。',action:'操盘台',icon:'⌗'},{n:'03',title:'当天闭环',copy:'首笔成交后冻结同向信号，等量反向成交并恢复原底仓。',action:'持仓对账',icon:'⇄'},{n:'04',title:'收盘复盘',copy:'使用真实费用和可卖数量回放，训练参数只进入候选区。',action:'智能训练',icon:'◇'}].map(item=><button key={item.n} onClick={()=>onNavigate(item.action)}><span>{item.n}</span><i>{item.icon}</i><h3>{item.title}</h3><p>{item.copy}</p><em>{item.action} →</em></button>)}</div></div>
    <div className="home-risk"><span>重要提示</span><p>做T不保证盈利。所有信号仅用于策略研究和提醒；自动交易接口保持关闭，候选策略必须人工晋升。</p><button onClick={()=>onNavigate('模拟回测')}>查看可信回测</button></div>
  </section>;
}

function OnboardingView({initial,initialList,syncState,saveState,onListChange,onSave}:{initial:{stock:string;baseShares:number;risk:string};initialList:typeof initialStocks;syncState:{message:string;error:boolean};saveState:{busy:boolean;message:string;error:boolean};onListChange:(list:typeof initialStocks)=>void;onSave:(value:{stock:string;baseShares:number;risk:string},list:typeof initialStocks)=>Promise<boolean>}){
  const [stock,setStock]=useState(initial.stock);
  const [shares,setShares]=useState(initial.baseShares);
  const [risk,setRisk]=useState(initial.risk);
  const [list,setList]=useState(initialList);
  const [newCode,setNewCode]=useState('');
  const [newName,setNewName]=useState('');
  const [nameTouched,setNameTouched]=useState(false);
  const [listError,setListError]=useState('');
  const add=()=>{const code=newCode.replace(/\D/g,'').slice(0,6);if(code.length!==6){setListError('请输入完整的6位股票代码');return}if(list.length>=10){setListError('测试版最多监控10只股票，请先删除一只');return}if(list.some(item=>item.code===code)){setListError('该股票已经在监控列表中');return}const name=newName.trim()||knownStockNames[code]||'待行情识别';const next=[...list,{code,name,price:'--',change:'--',prices:[],volumes:[]}];setList(next);onListChange(next);setStock(`${code} ${name}`);setNewCode('');setNewName('');setNameTouched(false);setListError(`已添加 ${code} ${name}，正在同步服务器`)};
  const remove=(code:string)=>{if(list.length<=1){setListError('至少需要保留一只监控股票');return}const next=list.filter(item=>item.code!==code);setList(next);onListChange(next);if(stock.startsWith(code))setStock(`${next[0].code} ${next[0].name}`);setListError('已从监控台移除')};
  return <div className="onboarding-overlay"><div className="onboarding-card"><div className="onboarding-head"><span>ACCOUNT SETUP</span><h2>设置你的交易工作台</h2><p>管理监控股票、计划底仓和风险偏好。</p></div><div className="onboarding-step watchlist-step"><b>01</b><div><span>监控股票与默认股票</span><div className="preference-watchlist">{list.map(item=><div className={stock.startsWith(item.code)?'active':''} key={item.code}><button onClick={()=>setStock(`${item.code} ${item.name}`)}><b>{item.name}</b><small>{item.code}</small></button><button onClick={()=>remove(item.code)} aria-label={`删除${item.name}`}>×</button></div>)}</div><div className="stock-add-row"><input value={newCode} onChange={e=>{const code=e.target.value.replace(/\D/g,'').slice(0,6);setNewCode(code);if(!nameTouched)setNewName(knownStockNames[code]||'');setListError('')}} onKeyDown={e=>{if(e.key==='Enter')add()}} inputMode="numeric" autoComplete="off" placeholder="输入6位代码"/><input value={newName} onChange={e=>{setNewName(e.target.value);setNameTouched(true)}} onKeyDown={e=>{if(e.key==='Enter')add()}} autoComplete="off" placeholder="名称（可不填）"/><button onClick={add}>＋ 加入监控</button></div>{listError&&<small className={listError.startsWith('已')?'list-success':'list-error'}>{listError}</small>}{syncState.message&&<small className={syncState.error?'list-error':'list-success'}>{syncState.message}</small>}<small>只填代码即可添加；未知名称会在真实行情返回后自动识别。添加和删除会同步到服务器。</small></div></div><div className="onboarding-step"><b>02</b><div><span>计划底仓</span><div className="share-setup"><button onClick={()=>setShares(Math.max(0,shares-100))}>−</button><label><input type="text" inputMode="numeric" autoComplete="off" value={shares||''} onChange={e=>setShares(Math.max(0,Number(e.target.value.replace(/\D/g,''))||0))}/><em>股</em></label><button onClick={()=>setShares(shares+100)}>＋</button></div><small>可以直接输入股数，也可以按每次 100 股增减；收盘应恢复到这个数量。</small></div></div><div className="onboarding-step"><b>03</b><div><span>风险偏好</span><div className="risk-options">{['稳健','平衡','积极'].map(item=><button className={risk===item?'active':''} onClick={()=>setRisk(item)} key={item}>{item}</button>)}</div><small>仅调整信号频率，不能绕过可卖数量和当日闭环规则。</small></div></div>{saveState.message&&<small className={saveState.error?'list-error':'list-success'}>{saveState.message}</small>}<button className="onboarding-save" onClick={()=>void onSave({stock,baseShares:shares,risk},list)} disabled={saveState.busy}>{saveState.busy?'正在保存到服务器…':'保存底仓与偏好'} <span>→</span></button></div></div>;
}

function MultiWatchView({stocks,radar,realtimeStatus,onOpen,onManage}:{stocks:typeof initialStocks;radar:{score:number;state:string;coverage:string};realtimeStatus:'checking'|'online'|'offline';onOpen:(index:number)=>void;onManage:()=>void}) {
  const [filter,setFilter]=useState('全部');
  const allRows=stocks.map(item=>({radar:radar.score>=0?radar.score:-1,signal:item.signal||'等待数据',reason:item.reason||'已加入监控，等待行情刷新',score:item.signalScore??0,position:'尚无成交记录',tone:item.quoteStale?'blocked':item.strictSignal?(item.signal?.includes('买')?'watch':'warning'):'watch',...item}));
  const rows=allRows.filter(row=>filter==='全部'||(filter==='有机会'?row.strictSignal===true:filter==='被拦截'?row.tone==='blocked':row.position==='等待闭环'));
  const opportunities=allRows.filter(row=>row.strictSignal===true&&!row.quoteStale).length;
  const blocked=allRows.filter(row=>row.tone==='blocked').length;
  const unclosed=allRows.filter(row=>row.position==='等待闭环').length;
  return <section className="module-view watch-view">
    <div className="module-head"><div><span className="eyebrow">MULTI-ASSET RADAR</span><h1>多股实时监控</h1><p>统一使用市场雷达和 Smart‑T 决策门控，先显示风险，再显示机会。</p></div><div className={`module-status ${realtimeStatus==='offline'?'offline':''}`}><i/>{realtimeStatus==='checking'?'正在连接行情源':realtimeStatus==='offline'?'行情源连接失败':`${stocks.length}只监控中 · 15秒刷新`}</div></div>
    <div className="watch-summary"><div><span>监控股票</span><b>{stocks.length}</b><small>盘中自动刷新</small></div><div><span>可执行机会</span><b className="teal">{opportunities}</b><small>确认分达到门槛</small></div><div><span>门控拦截</span><b>{blocked}</b><small>弱市禁止激进正T</small></div><div><span>待闭环</span><b className="amber-text">{unclosed}</b><small>优先级高于新信号</small></div><div><span>市场雷达</span><b>{radar.score>=0?radar.score.toFixed(0):'--'}</b><small>{radarLabel(radar.score)}</small></div></div>
    <div className="watch-toolbar"><div>{['全部','有机会','被拦截','待闭环'].map(item=><button className={filter===item?'active':''} onClick={()=>setFilter(item)} key={item}>{item}</button>)}</div><button className="watch-add" onClick={onManage}>＋ 管理监控股票</button></div>
    <div className="watch-table"><div className="watch-row watch-title"><span>股票</span><span>最新价</span><span>市场雷达</span><span>Smart‑T状态</span><span>策略解释</span><span>确认分</span><span>仓位状态</span><span/></div>{rows.map(row=><div className="watch-row" key={row.code}><span className="watch-stock"><b>{row.name}</b><small>{row.code}</small></span><span><b>{row.price}</b><small className={row.change.startsWith('-')?'negative':row.change.startsWith('+')?'positive':'neutral'}>{row.change}</small></span><span><b>{row.radar>=0?row.radar:'--'}</b><small>{radarLabel(row.radar)}</small></span><em className={`watch-pill ${row.tone}`}>{row.signal}</em><span className="watch-reason">{row.reason}</span><span className="score-dots">{[1,2,3,4,5].map(n=><i className={n<=Math.ceil(row.score/2)?'on':''} key={n}/>)}<small>{row.score}/10</small></span><span className={row.position==='等待闭环'?'amber-text':''}>{row.position}</span><button onClick={()=>onOpen(stocks.findIndex(item=>item.code===row.code))}>进入操盘台 →</button></div>)}{!rows.length&&<div className="watch-empty">当前分类暂无股票，切换“全部”或等待新信号。</div>}</div>
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

function StrategyMarketView({accountName}:{accountName:string}){
  const [sort,setSort]=useState('综合榜');
  const [selected,setSelected]=useState<(typeof marketStrategies)[number]|null>(null);
  const [subscribed,setSubscribed]=useState<string[]>(()=>{if(typeof window==='undefined')return[];try{const saved=localStorage.getItem(`rabbit-subscriptions:${accountName.toLowerCase()}`);return saved?JSON.parse(saved):[]}catch{return[]}});
  const [publishing,setPublishing]=useState(false);
  const rows=[...marketStrategies].sort((a,b)=>sort==='收益榜'?b.returns-a.returns:sort==='低回撤榜'?a.drawdown-b.drawdown:sort==='胜率榜'?b.win-a.win:a.rank-b.rank);
  const averageWin=(marketStrategies.reduce((sum,item)=>sum+item.win,0)/marketStrategies.length).toFixed(1);
  const follow=(name:string)=>setSubscribed(items=>{const next=items.includes(name)?items.filter(item=>item!==name):[...items,name];try{localStorage.setItem(`rabbit-subscriptions:${accountName.toLowerCase()}`,JSON.stringify(next))}catch{}return next});
  return <section className="market-view">
    <div className="market-hero"><div><span className="eyebrow">RABBIT STRATEGY MARKET</span><h1>策略智能体排行榜</h1><p>发现、比较并模拟跟随优秀的用户策略。所有指标都同时展示样本与风险，不用单一胜率制造错觉。</p></div><button onClick={()=>setPublishing(true)}>＋ 发布我的策略</button></div>
    <div className="market-guard"><b>测试版演示榜单</b><span>当前排名数据为产品演示，不代表真实用户业绩</span><span>真实资金自动交易保持关闭</span><span>不代管资金，不承诺收益</span></div>
    <div className="market-stats"><div><span>演示策略</span><b>{marketStrategies.length}</b><small>等待接入真实发布审核数据</small></div><div><span>我的模拟跟随</span><b>{subscribed.length}</b><small>仅保存在当前账户偏好</small></div><div><span>演示平均胜率</span><b>{averageWin}%</b><small>由下方演示样本计算</small></div><div><span>风险暂停</span><b className="amber-text">--</b><small>风控统计服务尚未接入</small></div></div>
    <div className="market-toolbar"><div>{['综合榜','胜率榜','收益榜','低回撤榜'].map(item=><button className={sort===item?'active':''} onClick={()=>setSort(item)} key={item}>{item}</button>)}</div><span>排行榜每个交易日收盘后更新</span></div>
    <div className="market-list"><div className="market-row market-title"><span>排名 / 策略</span><span>验证状态</span><span>胜率</span><span>扣费净收益</span><span>最大回撤</span><span>样本</span><span>订阅</span><span/></div>{rows.map(item=><div className="market-row" key={item.name}><span className="market-name"><i>{item.rank<=3?`TOP ${item.rank}`:`#${item.rank}`}</i><b>{item.name}</b><small>{item.author} · {item.tags.join(' / ')}</small></span><span><em className={item.mode==='模拟盘'?'verified':'backtested'}>{item.mode}</em><small>{item.days}个交易日</small></span><strong>{item.win}%</strong><strong className="teal">+{item.returns}%</strong><strong>-{item.drawdown}%</strong><span><b>{item.cycles}次闭环</b><small>{item.risk}</small></span><span><b>{item.price===0?'免费':`¥${item.price}/月`}</b><small>{item.followers}人关注</small></span><button onClick={()=>setSelected(item)}>查看策略 →</button></div>)}</div>
    {selected&&<div className="market-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null)}}><div className="strategy-detail"><button className="detail-close" onClick={()=>setSelected(null)}>×</button><span className="eyebrow">STRATEGY PROFILE · #{selected.rank}</span><h2>{selected.name}</h2><p>{selected.summary}</p><div className="detail-author"><span>创建者</span><b>{selected.author}</b><em>{selected.mode} · {selected.days}个交易日</em></div><div className="detail-metrics"><div><span>闭环胜率</span><b>{selected.win}%</b></div><div><span>扣费净收益</span><b className="teal">+{selected.returns}%</b></div><div><span>最大回撤</span><b>-{selected.drawdown}%</b></div><div><span>有效样本</span><b>{selected.cycles}次</b></div></div><div className="detail-rules"><h3>策略说明</h3><p>费用、滑点、T+1可卖数量和尾盘恢复为系统硬风控，订阅者不能关闭。</p><p>模拟跟随只生成提醒和虚拟成交记录，不会连接或操作真实券商账户。</p></div><button className={subscribed.includes(selected.name)?'followed':''} onClick={()=>follow(selected.name)}>{subscribed.includes(selected.name)?'✓ 已加入模拟跟随':selected.price===0?'免费模拟跟随':`订阅并模拟跟随 · ¥${selected.price}/月`}</button><small>历史表现不代表未来收益 · 可随时停止跟随</small></div></div>}
    {publishing&&<div className="market-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setPublishing(false)}}><div className="publish-card"><button className="detail-close" onClick={()=>setPublishing(false)}>×</button><span className="eyebrow">PUBLISH STRATEGY</span><h2>发布我的策略智能体</h2><p>发布服务尚未接入。当前表单仅用于确认下一版所需字段，不会伪装保存成功。</p><label>策略名称<input placeholder="例如：我的稳健反T兔" disabled/></label><label>策略说明<textarea placeholder="用直白语言说明买入、卖出、仓位和停止条件" disabled/></label><div><label>分享方式<select disabled><option>免费分享</option><option>付费订阅（审核后开放）</option></select></label><label>风险等级<select disabled><option>低风险</option><option>中风险</option><option>高风险</option></select></label></div><button disabled>发布接口待接入</button><small>后端发布、审核和排行榜存储完成后再开放；至少需要20次有效闭环。</small></div></div>}
  </section>;
}

function TrainingView({running,progress,message,result,onRun}:{running:boolean;progress:number;message:string;result:Record<string,unknown>;onRun:()=>void}) {
  const resultText=(key:string,fallback='--')=>result[key]===undefined||result[key]===null?fallback:String(result[key]);
  const percentText=(key:string)=>{const value=Number(result[key]);return Number.isFinite(value)?`${value.toFixed(1)}%`:'--'};
  const moneyText=(key:string)=>{const value=Number(result[key]);return Number.isFinite(value)?`${value>=0?'+':''}¥${value.toLocaleString('zh-CN',{maximumFractionDigits:2})}`:'--'};
  const agentState=(index:number)=>index===0?(running?'运行中':progress>0?'已暂停':'等待任务'):index===1?(progress>=70?'验证完成':progress>=40?'验证中':'等待训练兔'):index===2?(progress===100?'等待人工评审':'正式策略锁定'):(progress>=90?'检查完成':progress>=70?'检查中':'等待候选结果');
  return <section className="module-view training-view">
    <div className="module-head"><div><span className="eyebrow">QUANTBRAIN LAB</span><h1>四兔持续训练中心</h1><p>每5分钟运行一轮影子训练；盘中只学习、不自动晋升，正式策略仍由人工确认。</p></div><button className="lab-run" onClick={onRun} disabled={running}>{running?'本轮训练中…':progress===100?'立即运行下一轮':'继续本轮训练'}<span>→</span></button></div>
    <div className="lab-progress"><div className="lab-progress-head"><span>{message||'等待训练服务返回状态'}</span><b>{running?'正在训练':progress===100?'本轮完成':progress>0?'已暂停':'等待任务'} · {progress}%</b></div><i><em style={{width:`${Math.max(0,Math.min(100,progress))}%`}}/></i><div className="lab-stages"><span className={progress>0||running?'done':''}>读取新鲜数据</span><span className={progress>=40?'done':''}>训练兔回放</span><span className={progress>=70?'done':''}>挑战兔验证</span><span className={progress>=90?'done':''}>风控兔检查</span><span className={progress===100?'done':''}>等待人工晋升</span></div></div>
    <div className="lab-grid">{agents.map((agent,index)=><article className="lab-agent" key={agent.name}><div><span className={`agent-icon a${index}`}><img src={agent.avatar} alt={`${agent.name} AI头像`}/></span><p><b>{agent.name}</b><small>{agent.role}</small></p><em>{agentState(index)}</em></div><strong>{index===0?`${progress}%`:agent.value}</strong><i><span style={{width:index===0?`${progress}%`:'0%'}}/></i><p>{index===0?'只在历史分时数据上学习，不接触正式账户。':index===1?'用训练兔未见过的样本检验候选参数。':index===2?'只有人工确认后才接收新版本。':'回撤、费用和仓位异常拥有一票否决权。'}</p></article>)}</div>
    <div className="lab-results"><div className="lab-metrics"><h2>本轮训练结果</h2><div><p><span>测试样本</span><b>{resultText('tested')}</b></p><p><span>触发信号</span><b>{resultText('trigger')}</b></p><p><span>模拟成交</span><b>{resultText('trades')}</b></p><p><span>胜率</span><b>{percentText('winRate')}</b></p><p><span>净盈亏</span><b className="teal">{moneyText('pnl')}</b></p><p><span>费用</span><b>{moneyText('fees')}</b></p></div><small>“--”表示后端尚未返回该项结果；没有真实训练结果时不再展示演示数字。</small></div><div className="promotion-card"><span>候选策略评审</span><h2>{progress===100?'等待人工晋升':'训练尚未完成'}</h2><p>{progress===100?'候选参数仍需通过样本外验证和风险检查，不能自动替换正式策略。':'完成本轮训练后再生成候选版本和评审建议。'}</p><button disabled>晋升为正式策略</button><small>自动晋升已关闭</small></div></div>
    <div className="lab-log"><h2>训练记录</h2><div><time>实时</time><b>系统</b><span>{message||'等待后端训练状态'}</span></div><div><time>结果</time><b>风控兔</b><span>{Object.keys(result).length?'已收到本轮结果，候选策略仍需人工评审。':'尚无可展示的真实训练结果。'}</span></div></div>
  </section>;
}

// 成交流水必须来自真实账户接口；接口未接入时保持空状态，避免把示例数字误认为真实成交。
const ledgerRows: Array<{time:string;side:string;price:string;qty:string;cycle:string;fee:string;result:string;status:string}> = [];

function HoldingsView({stock,baseShares}:{stock:(typeof initialStocks)[number];baseShares:number}) {
  const [filter, setFilter] = useState("全部流水");
  const [planDone, setPlanDone] = useState(false);
  const visibleRows = ledgerRows.filter(row => filter === "全部流水" || (filter === "未配对" ? row.status !== "已配对" : row.side === filter));
  return <section className="holdings-view">
    <div className="holdings-head">
      <div><span className="eyebrow">POSITION RECONCILIATION</span><h1>持仓与交易对账</h1><p>当前页面为交互演示，尚未接入真实券商持仓与成交；下方数字不能作为账户依据。</p></div>
      <div className="reconcile-state"><i/><span>尚未接入账户成交数据</span><b>演示模拟账本</b></div>
    </div>
    <div className="position-overview">
      <div className="position-identity"><span>{stock.code}</span><h2>{stock.name}</h2><small>沪深A · T+1</small></div>
      <div className="position-metric"><span>计划底仓</span><b>{baseShares.toLocaleString()}<small> 股</small></b><em>策略基准</em></div>
      <div className="position-metric"><span>当前持仓</span><b>--<small> 股</small></b><em>等待账户同步</em></div>
      <div className="position-metric"><span>剩余可卖旧仓</span><b>--<small> 股</small></b><em>等待账户同步</em></div>
      <div className="position-metric warning"><span>当日未闭合</span><b>--<small> 股</small></b><em>成交接口未接入</em></div>
      <div className="position-metric profit"><span>今日净收益</span><b>--</b><em>等待真实成交数据</em></div>
    </div>
    <div className="reconcile-grid">
      <div className="ledger-panel">
        <div className="panel-top"><div><h2>今日成交流水</h2><p>成交按时间排序，系统自动寻找可闭合的正T / 反T循环。</p></div><button disabled title="下一版本接入成交存储后开放">手动补录 · 待接入</button></div>
        <div className="ledger-filter">{["全部流水","买入","卖出","未配对"].map(item=>{const count=item==='全部流水'?ledgerRows.length:item==='未配对'?ledgerRows.filter(row=>row.status!=='已配对').length:ledgerRows.filter(row=>row.side===item).length;return <button key={item} className={filter===item?'active':''} onClick={()=>setFilter(item)}>{item}<span>{count}</span></button>})}</div>
        <div className="ledger-table">
          <div className="ledger-row ledger-title"><span>成交时间</span><span>方向</span><span>成交价</span><span>数量</span><span>配对循环</span><span>费用</span><span>循环净收益</span><span>状态</span></div>
          {visibleRows.length?visibleRows.map(row=><div className="ledger-row" key={row.time}><span>{row.time}</span><span className={row.side==='买入'?'buy-text':'sell-text'}>{row.side}</span><b>{row.price}</b><span>{row.qty}</span><span>{row.cycle}</span><span>{row.fee}</span><b className={row.result.startsWith('+')?'positive':''}>{row.result}</b><em className={row.status==='已配对'?'matched':'unmatched'}>{row.status}</em></div>):<div className="ledger-empty">尚未接入真实账户成交，暂无可对账流水。</div>}
        </div>
      </div>
      <aside className="recovery-panel">
        <span className="recovery-kicker">INTRADAY CLOSE ALERT</span><h2>等待真实成交数据</h2><p>账户成交接口接入后，这里会根据当前持仓、可卖旧仓和计划底仓计算当日闭环提醒。</p>
        <div className="close-deadline"><span>最迟处理时间</span><b>--</b><em>等待交易日历与账户数据</em></div>
        <div className="recovery-scale"><div><span>目标底仓 {baseShares.toLocaleString()}</span><b>当前 --</b></div><i><em style={{width:'0%'}}/></i><small>暂无真实持仓数据，不生成买卖或强制平仓建议。</small></div>
        <div className="recovery-steps"><h3>当日闭环规则</h3><div><b>01</b><p><strong>先同步账户成交</strong><span>没有真实成交与可卖数量时，系统不会生成闭环判断。</span></p></div><div><b>02</b><p><strong>再计算可执行数量</strong><span>仅对昨日可卖旧仓计算正T / 反T，严格遵守100股和三分之一上限。</span></p></div><div><b>03</b><p><strong>收盘前检查</strong><span>接入交易日历后才会显示真实截止时间与异常提醒。</span></p></div></div>
        <button className={planDone?'done':''} onClick={()=>setPlanDone(!planDone)}>{planDone?'✓ 已开启数据同步提醒':'开启数据同步提醒'}<span>→</span></button>
        <small className="recovery-note">这里只生成风控提醒，不会自动下单；自动交易接口仍保持关闭。</small>
      </aside>
    </div>
    <div className="cycle-summary"><div><span>今日买入</span><b>--</b><small>等待真实成交数据</small></div><div><span>今日卖出</span><b>--</b><small>等待真实成交数据</small></div><div><span>已闭合循环</span><b>--</b><small>成交接口未接入</small></div><div><span>待当日闭合</span><b className="warn">--</b><small>同步后自动计算</small></div><div><span>已确认净收益</span><b>--</b><small>不展示模拟收益</small></div></div>
  </section>;
}

function BacktestView({ profile, setProfile, stock, initialBaseShares }: { profile: string; setProfile: (value: string) => void;stock:(typeof initialStocks)[number];initialBaseShares:number }) {
  const [capital, setCapital] = useState(200000);
  const [baseShares, setBaseShares] = useState(initialBaseShares);
  const [sellable, setSellable] = useState(initialBaseShares);
  const [feeRate, setFeeRate] = useState(0.025);
  const [slippage, setSlippage] = useState(0.02);
  const [running, setRunning] = useState(false);
  const [result,setResult]=useState<{stats:Record<string,unknown>;stocks:Record<string,unknown>[];summary:string}|null>(null);
  const [runError,setRunError]=useState('');
  const profileMap:Record<string,string>={'稳健档':'steady','平衡档':'balanced','灵敏档':'sensitive','量化学习':'quantbrain'};
  const maxTradeShares=Math.max(0,Math.floor(Math.min(baseShares,sellable)/3/100)*100);
  const run = async() => {
    setRunning(true);setRunError('');setResult(null);
    try{
      if(baseShares<=0)throw new Error('请先设置真实底仓');
      if(sellable<=0)throw new Error('昨日可卖数量为 0，无法进行做T回测');
      if(maxTradeShares<=0)throw new Error('单次可做T数量不足 100 股');
      const {data}=await backendJson('/api/run/simulate5',{method:'POST',body:JSON.stringify({sample:1,stocks:stock.code,days:5,cash:capital,trade:Math.max(1000,Math.min(capital,Math.floor(capital/3))),baseShares,sellableShares:sellable,maxTradeShares,smartTProfile:profileMap[profile]||'balanced',simMode:'strict',commissionRate:feeRate/100,stampDutyRate:.0005,slippageBps:slippage*100})});
      if(!data.ok)throw new Error(String(data.summary||'回测未完成'));
      setResult({stats:data.stats&&typeof data.stats==='object'?data.stats:{},stocks:Array.isArray(data.stocks)?data.stocks:[],summary:String(data.summary||'回测完成')});
    }catch(error){setRunError(error instanceof Error?error.message:'回测服务暂不可用');}finally{setRunning(false)}
  };
  const stats=result?.stats||{};const firstRow=result?.stocks?.[0];
  const replayPrices=normalizePrices(firstRow?.prices);const replayChart=buildPriceChart(replayPrices);
  const review=stats.review&&typeof stats.review==='object'?stats.review as Record<string,unknown>:{};
  const failures=review.failures&&typeof review.failures==='object'?Object.entries(review.failures as Record<string,unknown>):[];
  const pattern=useMemo(()=>{
    const raw=Array.isArray(firstRow?.prices)?firstRow.prices:[];const days=new Map<string,Record<string,unknown>[]>();
    raw.forEach(item=>{if(!item||typeof item!=='object')return;const row=item as Record<string,unknown>;const date=String(row.date||'当日');const bucket=days.get(date)||[];bucket.push(row);days.set(date,bucket)});
    const highTimes:string[]=[];const lowTimes:string[]=[];
    days.forEach(rows=>{const valid=rows.filter(row=>Number(row.price)>0);if(!valid.length)return;highTimes.push(String(valid.reduce((a,b)=>Number(a.price)>=Number(b.price)?a:b).time||''));lowTimes.push(String(valid.reduce((a,b)=>Number(a.price)<=Number(b.price)?a:b).time||''))});
    const common=(values:string[])=>{const counts=new Map<string,number>();values.forEach(value=>{const [h,m]=value.split(':').map(Number);if(!Number.isFinite(h)||!Number.isFinite(m))return;const start=Math.floor(m/30)*30;const key=`${String(h).padStart(2,'0')}:${String(start).padStart(2,'0')}—${String(h).padStart(2,'0')}:${String(start+29).padStart(2,'0')}`;counts.set(key,(counts.get(key)||0)+1)});return [...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]||'--'};
    return{days:days.size,high:common(highTimes),low:common(lowTimes)};
  },[firstRow]);
  return <section className="backtest-view">
    <div className="backtest-head">
      <div><span className="eyebrow">TRUSTED REPLAY ENGINE</span><h1>可信模拟回测</h1><p>逐分钟重放，只使用当时已完成的数据；与实时监控共用 Smart‑T 决策引擎。</p></div>
      <div className="integrity-badges"><span><i/>无未来数据</span><span><i/>统一费用模型</span><span><i/>可卖数量前置校验</span></div>
    </div>
    <div className="backtest-grid">
      <aside className="backtest-config">
        <div className="config-title"><h2>回测参数</h2><span>本次运行</span></div>
        <label>股票代码<div className="field static-field"><b>{stock.code}</b><span>{stock.name}</span></div></label>
        <div className="field-pair"><label>回放范围<div className="field static-field date-display"><b>近 5 个交易日</b><span>后端实盘分钟数据</span></div></label><label>数据要求<div className="field static-field date-display"><b>完整分钟量价</b><span>不足则拒绝回测</span></div></label></div>
        <label>策略档位<div className="profile-picker">{strategyProfiles.slice(0,4).map(item=><button type="button" className={profile===item?'active':''} onClick={()=>setProfile(item)} key={item}>{item.replace('档','')}</button>)}</div></label>
        <div className="field-pair"><label>模拟资金<NumberStepper value={capital} unit="元" step={10000} min={50000} onChange={setCapital}/></label><label>真实底仓<NumberStepper value={baseShares} unit="股" step={100} min={0} onChange={setBaseShares}/></label></div>
        <div className="field-pair"><label>昨日可卖<NumberStepper value={sellable} unit="股" step={100} min={0} onChange={setSellable}/></label><label>单次上限<div className="field static-field"><b>{maxTradeShares}</b><span>股</span></div></label></div>
        <div className="cost-box"><div><span>佣金</span><NumberStepper value={feeRate} unit="%" step={0.005} min={0} decimals={3} onChange={setFeeRate}/></div><div><span>单边滑点</span><NumberStepper value={slippage} unit="%" step={0.005} min={0} decimals={3} onChange={setSlippage}/></div><div><span>印花税</span><b>卖出 0.05%</b></div></div>
        <button className="run-backtest" onClick={run} disabled={running}>{running ? '正在逐分钟重放…' : '运行可信回测'}<span>→</span></button>
        {runError&&<p className="backtest-error">{runError}</p>}
        <p className="config-note">昨日可卖和单次上限会随回测请求提交；连续失败 2 次当日停止，14:30 后不新开 T，14:50 前必须恢复计划底仓。</p>
      </aside>
      <div className="backtest-results">
        <div className="result-summary">
          <div className="result-primary"><span>净收益</span><strong>{String(stats.pnl??'--')}</strong><em>{String(stats.return??'--')}</em></div>
          <div><span>毛收益</span><b>{String(stats.grossPnl??'--')}</b><small>未扣费用</small></div><div><span>费用与滑点</span><b>{String(stats.fees??'--')}</b><small>佣金、税费与滑点</small></div><div><span>期末资金</span><b>{String(stats.endingCash??'--')}</b><small>{result?'后端真实结果':'等待运行回测'}</small></div>
        </div>
        <div className="equity-panel"><div className="panel-heading"><div><h2>回放价格轨迹</h2><span>{result?.summary||'运行后显示后端返回的真实分钟数据'}</span></div><div className="curve-legend"><span><i/>真实回放价格</span></div></div><svg viewBox="0 0 920 300" preserveAspectRatio="none" aria-label="回测价格轨迹"><defs><linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#28d7c4" stopOpacity=".22"/><stop offset="1" stopColor="#28d7c4" stopOpacity="0"/></linearGradient></defs>{[60,120,180,240].map(y=><line key={y} x1="0" x2="920" y1={y} y2={y} className="equity-grid"/>)}{replayChart.path&&<><path d={`${replayChart.path} L910 300 L10 300 Z`} fill="url(#equityFill)"/><path d={replayChart.path} className="equity-line"/></>}</svg>{!replayChart.path&&<div className="backtest-empty">暂无真实回放结果</div>}</div>
        <div className="result-bottom"><div className="metric-table"><div><span>回放股票</span><b>{result?.stocks.length??'--'}</b></div><div><span>触发信号</span><b>{String(stats.trigger??'--')}</b></div><div><span>闭环胜率</span><b className="teal">{String(stats.win??'--')}</b></div><div><span>初始资金</span><b>{String(stats.cash??'--')}</b></div><div><span>单笔预算</span><b>{String(stats.trade??'--')}</b></div><div><span>数据交易日</span><b>{pattern.days||'--'}</b></div></div><div className="failure-panel"><h3>未执行与失败原因</h3>{failures.length?failures.map(([name,count])=><p key={name}><span>{name}</span><b>{String(count)}次</b></p>):<p><span>等待真实回测结果</span><b>--</b></p>}</div></div>
        <section className="pattern-analysis"><div className="pattern-head"><div><span className="eyebrow">INTRADAY PATTERN LAB</span><h2>{stock.code} {stock.name} · 单股规律分析</h2><p>只根据本次后端回放返回的真实分钟点统计，不使用预置结论。</p></div><span className="pattern-confidence">样本 · {pattern.days||0}日</span></div><div className="pattern-grid"><div><span>高点常见半小时</span><b>{pattern.high}</b><small>按各交易日最高价出现时间聚合</small></div><div><span>低点常见半小时</span><b>{pattern.low}</b><small>按各交易日最低价出现时间聚合</small></div><div><span>策略触发</span><b className="teal">{String(stats.trigger??'--')}</b><small>未触发不会计为亏损</small></div><div><span>闭环胜率</span><b className="coral-text">{String(stats.win??'--')}</b><small>以回测引擎返回结果为准</small></div></div><div className="pattern-timeline"><span>统计结论 <b>{pattern.days>=20?'可进入复核':'样本不足'}</b></span><i><em/></i><span>最低建议 <b>20个交易日</b></span></div><small className="pattern-note">少于20个交易日仅展示观察结果，不能据此形成自动交易规则。</small></section>
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
