const n = value => Number.isFinite(Number(value)) ? Number(value) : null;
const avg = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
const pct = (a,b) => n(a) !== null && n(b) ? a / b - 1 : null;

export function buildOHLCVFeatures(bars = [], index = 0) {
  const p = bars[index] ?? {}; const close = n(p.close ?? p.price); const window = bars.slice(Math.max(0, index - 40), index + 1); const closes = window.map(x => n(x.close ?? x.price)).filter(v => v !== null); const volumes = window.map(x => n(x.volume ?? x.vol)).filter(v => v !== null);
  const amount = n(p.amount); const volume = n(p.volume ?? p.vol); const vwap = volume > 0 && amount !== null ? amount / volume : null; const cumVol = window.reduce((s,x)=>s+(n(x.volume??x.vol)??0),0); const cumAmount = window.reduce((s,x)=>s+(n(x.amount)??0),0);
  const ret = h => index >= h ? pct(close, n(bars[index-h]?.close ?? bars[index-h]?.price)) : null; const ma = h => avg(closes.slice(-h)); const high = Math.max(...window.slice(-20).map(x=>n(x.high??x.close)).filter(v=>v!==null)); const low = Math.min(...window.slice(-20).map(x=>n(x.low??x.close)).filter(v=>v!==null)); const range = Math.max(close-(n(p.low)??close),(n(p.high)??close)-close,1e-9);
  return { return1m:ret(1), return3m:ret(3), return5m:ret(5), return10m:ret(10), priceAcceleration: ret(1) !== null && ret(3) !== null ? ret(1) - ret(3)/3 : null, volumeRatio: volumes.length > 1 ? volume / (avg(volumes.slice(-21,-1)) || volume) : null, distanceToVWAP: vwap ? close/vwap-1 : null, distanceFromHigh: high ? close/high-1 : null, distanceFromLow: low ? close/low-1 : null, upperWickRatio: ((n(p.high)??close)-Math.max(n(p.open)??close,close))/range, lowerWickRatio: (Math.min(n(p.open)??close,close)-(n(p.low)??close))/range, bodyRatio: Math.abs(close-(n(p.open)??close))/range, rollingVolatility: closes.length > 2 ? Math.sqrt(avg(closes.slice(-20).map((x,i,a)=>i?Math.pow(x/a[i-1]-1,2):0).slice(1))) : null, MA5:ma(5), MA20:ma(20), MA5Slope: ma(5) && closes.length>5 ? ma(5)/avg(closes.slice(-10,-5))-1 : null, MA20Slope: ma(20) && closes.length>20 ? ma(20)/avg(closes.slice(-40,-20))-1 : null, barVWAP:vwap, intradayVWAP:n(p.intradayVWAP) ?? (cumVol>0?cumAmount/cumVol:null) };
}

export function classifyOHLCVSentiment(features = {}) {
  const r = features.return5m ?? 0; const v = features.volumeRatio ?? 1; const d = features.distanceToVWAP ?? 0; const slowing = (features.priceAcceleration ?? 0) < 0;
  if (r > .015 && slowing && v >= 1) return { state:"OVERHEATED", score:Math.min(100,60+r*2000), reason:["快速上涨后速度下降","成交仍活跃"], features };
  if (r < -.015 && v >= 1.2) return { state:"PANIC", score:Math.min(100,60+Math.abs(r)*2000), reason:["短线快速下跌","成交放大"], features };
  if (r > .005 && d >= 0) return { state:"HEALTHY_UP", score:60+r*2000, reason:["价格上涨","位于VWAP上方"], features };
  if (r > 0 && (features.lowerWickRatio ?? 0) > .3) return { state:"RECOVERY", score:55, reason:["下影线显示跌后恢复"], features };
  return { state:"NEUTRAL", score:50, reason:["没有明确价格量情绪"], features };
}

export function generateOHLCVResearchSignal({ bar = {}, features = {}, sentiment = {}, trend = "SIDEWAYS", symbol = "", timestamp = "", index = 0 } = {}) {
  let action = "WAIT"; const reason = [...(sentiment.reason ?? [])]; let score = sentiment.score ?? 50;
  const pullback = (features.distanceToVWAP ?? 0) <= .003 && (features.return3m ?? 0) < 0 && (features.priceAcceleration ?? 0) > -.003;
  const positiveT = trend === "UP" && pullback && ["RECOVERY","NEUTRAL"].includes(sentiment.state);
  const reverseT = ["OVERHEATED"].includes(sentiment.state) && (features.distanceFromHigh ?? 0) > -.01;
  if (positiveT) { action = (score >= 70 ? "BUY" : "BUY_SMALL"); reason.push("上涨趋势回踩VWAP","下跌速度减弱"); }
  else if (reverseT) { action = (score >= 75 ? "SELL_ALL" : "SELL_PART"); reason.push("快速拉升后高位滞涨"); }
  return { strategyId:"OHLCV_T_RESEARCH_V1", symbol, timestamp, action, score:Math.max(0,Math.min(100,score)), confidence:Math.max(0,Math.min(1,Math.abs(score-50)/50)), marketRegime:trend, sentimentState:sentiment.state, reason, features, index, price:n(bar.close??bar.price) };
}

export function runOHLCVTResearch(bars = [], { symbol = "" } = {}) {
  const signals = []; const diagnostics = { totalBars:bars.length, conditionPassRate:{}, conditionBlockRate:{} };
  for (let i=0;i<bars.length;i++) { const features=buildOHLCVFeatures(bars,i); const sentiment=classifyOHLCVSentiment(features); const ma5=features.MA5, ma20=features.MA20; const trend=ma5&&ma20?(ma5>ma20?"UP":ma5<ma20?"DOWN":"SIDEWAYS"):"SIDEWAYS"; const signal=generateOHLCVResearchSignal({bar:bars[i],features,sentiment,trend,symbol,timestamp:bars[i].timestamp,index:i}); signals.push(signal); }
  return { signals, diagnostics };
}
