"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import "./position-setup.css";
import { runSmartTReplay } from "@/lib/smart-t-engine.mjs";
import { A_SHARE_INTRADAY_AXIS, intradayChartX, intradaySlotX, isAShareAfterHoursFixedPriceMinute, isAShareRegularTradingMinute } from "@/lib/intraday-axis.mjs";
import { confirmStockPosition, loadStockPosition, migrateLegacyPosition, normalizeStockPosition, saveStockPosition } from "@/lib/stock-position.mjs";
import type { StockPosition } from "@/lib/stock-position.mjs";
import { normalizeTradeLedgerRows, summarizeTradeLedger, tradeLedgerDate, tradeLedgerKey } from "@/lib/trade-ledger.mjs";
import type { TradeLedgerRow } from "@/lib/trade-ledger.mjs";
import { analyzeZijinFactorResearch } from "@/lib/zijin-factor-research.mjs";
import { evaluateZijinOpeningPlaybook } from "@/lib/zijin-opening-playbook.mjs";
import { evaluateStockAgent, resolveStockAgent } from "@/lib/stock-agent-router.mjs";
import zijinHistoricalEvidence from "@/public/research/zijin-factor-evidence.json";
import zijinPatternDiscovery from "@/public/research/zijin-pattern-discovery.json";
import zijinPeerPatternDiscovery from "@/public/research/zijin-peer-pattern-discovery.json";
import zijinExternalFactorReadiness from "@/public/research/zijin-external-factor-readiness.json";
import { sampleWithSeed } from "@/lib/batch-sampler.mjs";
import { buildCausalReferencePoints } from "@/lib/causal-reference-points.mjs";
import { aShareSession } from "@/lib/a-share-session.mjs";
import { fulfilledWatchlistSnapshots, isRecentCausalEvent, isVwapDisplacementObservation, selectLatestAlertableObservation } from "@/lib/live-monitor-alerts.mjs";
import PublicLanding from "./public-landing";

type MarketBar = { date:string; open:number; close:number; high:number; low:number; volume:number; amount:number };
type IntradaySession = { date:string; previousClose:number|null; minutes:{time:string;price:number;volume:number}[] };
type MarketData = { provider:string; delayed:boolean; trial?:boolean; fetchedAt:string; sourceTimestamp?:string|null; sampleDate?:string; quote:{ code:string; name:string; price:number|null; previousClose?:number|null; change:number|null; changePercent:number|null; open:number|null; high:number|null; low:number|null; volume?:number|null; amount?:number|null }; bars:MarketBar[]; minutes?:{time:string;price:number;volume:number}[]; intradaySessions?:IntradaySession[] };
type StockState = { label:string; level:"up"|"flat"|"down"|"risk"; score:number; summary:string; action:string; details:string[] };
type MarketContextItem = { id:string; label:string; group:"market"|"sector"|"related"|"cross"|"currency"; price:number|null; changePercent:number|null; sourceTimestamp:string|null; provider:string; inverse?:boolean };
type MarketContext = { code:string; profile:string; fetchedAt:string; items:MarketContextItem[]; gate:{ score:number; level:"normal"|"caution"|"restricted"|"locked"|"degraded"; label:string; action:string; positionFraction:number; hardLock:boolean; reasons:string[] }; availableSources:string[]; errors:string[]; events:{ status:string; label:string; participatesInGate:boolean } };
type EventRadarItem = { id:string; code:string; title:string; summary:string; url:string; source:string; sources?:string[]; relatedCount?:number; provider:string; official:boolean; publishedAt:string; sentiment:"positive"|"negative"|"neutral"; severity:"critical"|"warning"|"info"; reason:string; ageHours:number };
type EventRadarStock = { code:string; name:string; items:EventRadarItem[]; counts:{ positive:number; negative:number; neutral:number }; gate:{ level:"normal"|"caution"|"restricted"|"locked"; hardLock:boolean; score:number; label:string; action:string; reason:string } };
type EventRadarResponse = { fetchedAt:string; scanned:number; requested:number; pollSeconds:number; sources:string[]; stocks:EventRadarStock[]; errors:string[] };
type AlertSettings = { sound:boolean; system:boolean };
type TradeAlertToast = { level:"candidate"|"signal"|"risk"; rabbit:"buy"|"sell"|"both"; title:string; message:string };
type MemberRecord = { id:string; username:string; displayName:string; role:"admin"|"member"; status:"active"|"paused"; createdAt:string; lastLoginAt:string|null; monitorCount:number; alertCount:number };
type ZijinTrainingProgress = {
  schemaVersion:number;
  stock:{code:string;name:string};
  runId:string;
  status:"idle"|"running"|"completed"|"failed";
  stage:"loading"|"features"|"training"|"validation"|"blind-test"|"completed"|"failed";
  progress:number;
  processedCandidates:number;
  totalCandidates:number;
  message:string;
  updatedAt:string;
  latest:{
    tradingDays?:number;
    trainingTrades?:number; trainingWinRate?:number|null; trainingAverageNetPct?:number;
    validationTrades?:number; validationWinRate?:number|null; validationAverageNetPct?:number;
    blindTrades?:number; blindWinRate?:number|null; blindAverageNetPct?:number;
    passedTrainingGate?:boolean; passedValidationGate?:boolean; elapsedSeconds?:number;
    qualifiedCandidates?:number; validationRan?:boolean; blindRan?:boolean; nextAction?:string;
  };
};
type AccountPreferences = { stock:string; baseShares:number; risk:string };
type StockPositionMap = Record<string, StockPosition>;
const DEFAULT_PREFERENCES:AccountPreferences={stock:"601899 紫金矿业",baseShares:0,risk:"稳健"};

function resolveStockPosition(positions:StockPositionMap, preferences:AccountPreferences, code:string) {
  return positions[code] ?? migrateLegacyPosition(preferences, code);
}

function recognizeStockState(bars: MarketBar[], quote: MarketData["quote"] | undefined, minutes: { price:number }[]): StockState {
  const closes = bars.map(bar => bar.close).filter(Number.isFinite);
  if (closes.length < 20 || !quote?.price) return { label:"数据积累中", level:"flat", score:0, summary:"日线或分时样本不足，暂不输出交易倾向。", action:"等待当前股票数据加载完成", details:["未使用上一只股票的缓存行情"] };
  const last = quote.price;
  const average = (values:number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const ma5 = average(closes.slice(-5)); const ma20 = average(closes.slice(-20));
  const fiveDay = (last - closes.at(-6)!) / closes.at(-6)!;
  const recentHigh = Math.max(...closes.slice(-20)); const drawdown = (last - recentHigh) / recentHigh;
  const rangeBase = quote.previousClose || last;
  const intradayRange = quote.high && quote.low ? (quote.high - quote.low) / rangeBase : 0;
  const pullbackFromHigh = quote.high ? (last - quote.high) / quote.high : 0;
  const intradayMove = minutes.length > 1 ? (last - minutes[0].price) / minutes[0].price : 0;
  const dayChange = quote.changePercent ?? intradayMove * 100;
  const riskReasons:string[]=[];
  if(dayChange<=-5)riskReasons.push(`当日跌幅 ${dayChange.toFixed(2)}% 已低于 -5% 风控线`);
  if(intradayRange>=.05&&pullbackFromHigh<=-.03)riskReasons.push(`日内振幅 ${(intradayRange*100).toFixed(2)}%，且较日内高点回撤 ${(pullbackFromHigh*100).toFixed(2)}%`);
  if(drawdown<=-.15&&last<ma20&&fiveDay<=-.05)riskReasons.push(`较 20 日高点回撤 ${(drawdown*100).toFixed(2)}%，并跌破 20 日均线`);
  if(riskReasons.length)return { label:"极端风险", level:"risk", score:Math.min(98,82+riskReasons.length*6), summary:"存在明确下跌或冲高回落证据，已触发刚性风控。", action:"暂停开新 T，等待风险条件解除", details:riskReasons };
  const rangeNote=intradayRange>=.07?`日内振幅 ${(intradayRange*100).toFixed(2)}%，但未伴随急跌，不单独判定极端风险`:`较日内高点 ${(pullbackFromHigh*100).toFixed(2)}%`;
  if (last > ma5 && ma5 > ma20 && fiveDay >= .035 && intradayMove >= 0) return { label:"强势上涨", level:"up", score:82, summary:`当日 ${dayChange>=0?"上涨":"下跌"} ${Math.abs(dayChange).toFixed(2)}%，价格站上 5/20 日均线。`, action:"顺势为主，回踩确认后再参与", details:[rangeNote,`5 日动量 ${(fiveDay*100).toFixed(2)}%`] };
  if (last >= ma20 && fiveDay > -.015) return { label:"弱势上涨", level:"up", score:58, summary:"价格仍在 20 日均线上方，但短期动能尚未充分确认。", action:"轻仓观察，避免追高", details:[rangeNote,`5 日动量 ${(fiveDay*100).toFixed(2)}%`] };
  if (last < ma20 && (fiveDay <= -.025 || intradayMove < -.01)) return { label:"弱势下跌", level:"down", score:73, summary:"价格位于 20 日均线下方，短期走势偏弱。", action:"控制仓位，反弹不确认时不抄底", details:[`5 日动量 ${(fiveDay*100).toFixed(2)}%`,rangeNote] };
  return { label:"横盘震荡", level:"flat", score:46, summary:"价格围绕均线反复，方向尚未形成。", action:"只在区间边缘等待高胜率信号", details:[rangeNote,`5 日动量 ${(fiveDay*100).toFixed(2)}%`] };
}

type ReplayAction = { time:string; side:"买入"|"卖出"|"买回"; price:number; quantity:number; curveIndex:number; direction?:"正T"|"反T"; cycleId?:number; reason?:string; meta?:{hold?:number;[key:string]:unknown} };
type ReplayObservation = { time:string; price?:number; direction:"正T"|"反T"; score:number; threshold:number; edge:number; executable:boolean; stage?:"watch"|"candidate"; pairGap?:number|null; pivotTime?:string; pivotPrice?:number; pivotLabel?:string; pivotAssessment?:"strong"|"confirmed"|"unconfirmed"; confirmationLabel?:string; blockers:string[]; reason:string };
type DeskHistoryRow = { time:string; direction:string; price:string; quantity:string; spread:string; status:string; tone?:"buy"|"sell"|"candidate" };
type BacktestResult = { net:number; gross:number; fees:number; executionCost:number; maxDrawdown:number; trades:number; wins:number; days:number; curve:number[]; curveTimes:string[]; cycleNets:number[]; startTime:string; status:string; actions:ReplayAction[]; observations?:ReplayObservation[]; diagnostics?:Record<string,number> };
type BatchMetrics = { samples:number; completed:number; wins:number; gross:number; fees:number; executionCost:number; net:number; tradingRounds:number; profitableRounds:number; losingRounds:number; profitFactor:number|null; maxDrawdown:number };
type ReplayMinute = { time:string; price:number; volume:number };
type StockUniverseItem = { code:string; name:string; industry:string; market:string };
type StockUniverseResponse = { provider:string; total:number; fallback:boolean; warning?:string; stocks:StockUniverseItem[] };
type StockBatchCycle = { id:number; direction:"正T"|"反T"; entry:ReplayAction; exit:ReplayAction; holdingMinutes:number; gross:number; fees:number; executionCost:number; net:number; outcome:"盈利"|"亏损"|"持平"; explanation:string };
type StockBatchFeedback = { code:string; name:string; date:string; sessions:number; samples:number; completed:number; wins:number; winRate:number|null; positiveT:number; reverseT:number; net:number; noTrade:number; candidates:number; keyObservations:number; strongSellTrendBlocked:number; strongBuyTrendBlocked:number; feedback:string; minutes:ReplayMinute[]; actions:ReplayAction[]; observations:ReplayObservation[]; cycles:StockBatchCycle[] };
type BatchBacktestResult = BatchMetrics & { seed:string; rounds:number; stocks:number; attemptedStocks:number; replacementStocks:number; uniqueSessions:number; noTrade:number; referenceStocks:number; candidateStocks:number; candidateDecisions:number; keyObservations:number; averageNet:number; medianNet:number; providers:string[]; universeSize:number; universeProvider:string; fallbackUniverse:boolean; industries:number; legacy:BatchMetrics; stockFeedback:StockBatchFeedback[] };

function selectVisibleChartObservations(observations: ReplayObservation[]) {
  // Every live marker stays on the minute when the engine could first know it.
  // Never reselect an old pivot later or paint a confirmed turn back in time.
  return observations.filter(observation=>!observation.executable);
}

function observationConfirmationLabel(observation: ReplayObservation) {
  return observation.confirmationLabel ?? (observation.direction==="正T"?"反弹观察":"回落观察");
}

function observationDirectionNote(observation: ReplayObservation) {
  return `候补${observation.direction}方向 · 不可执行`;
}

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
  return { net: cash - capital, gross, fees, executionCost:0, maxDrawdown, trades, wins, days: bars.length, curve, curveTimes:[], cycleNets:[], startTime:"", status: trades ? "已按真实日线数据计算" : "样本中没有符合阈值的交易", actions: [] };
}

function money(value:number) { return `${value >= 0 ? "+" : "-"}¥ ${Math.abs(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`; }

function pnlClass(value:number) { return value > 0 ? "pnl-profit" : value < 0 ? "pnl-loss" : "pnl-flat"; }

function standardBacktestShares(data:MarketData, capital:number) {
  const referencePrice=data.minutes?.[0]?.price ?? data.quote.open ?? data.quote.price ?? 0;
  if(!referencePrice || capital<=0)return 0;
  // Keep the simulated inventory comparable across cheap and expensive
  // stocks: roughly 45% of a ¥200k account, rounded to three board lots so a
  // one-third T order is always a valid 100-share lot.
  const targetNotional=Math.min(100_000,capital*.45);
  return Math.max(300,Math.min(30_000,Math.floor(targetNotional/referencePrice/300)*300));
}

function replayTime(value:string) {
  return value.length >= 4 ? `${value.slice(0,2)}:${value.slice(2,4)}` : value;
}

function tradingMinuteOffset(value:string) {
  const hour=Number(value.slice(0,2)),minute=Number(value.slice(2,4));
  const wall=hour*60+minute;
  return wall<=690?wall-570:120+wall-780;
}

function buildBatchCycles(result:BacktestResult, costs:{feeRate:number;slippage:number;minCommission:boolean;slippageMode:"percent"|"tick"}):StockBatchCycle[] {
  const groups=new Map<number,ReplayAction[]>();
  result.actions.forEach(action=>{
    if(!action.cycleId)return;
    const group=groups.get(action.cycleId)??[];
    group.push(action);
    groups.set(action.cycleId,group);
  });
  const rawPrice=(action:ReplayAction)=>{
    const buying=action.side==="买入"||action.side==="买回";
    if(costs.slippageMode==="tick")return action.price+(buying?-costs.slippage:costs.slippage);
    return action.price/(buying?1+costs.slippage/100:1-costs.slippage/100);
  };
  const orderFee=(action:ReplayAction)=>{
    const turnover=action.price*action.quantity;
    const commission=Math.max(costs.minCommission?5:0,turnover*costs.feeRate/100);
    return commission+(action.side==="卖出"?turnover*.0005:0);
  };
  return [...groups.entries()].sort(([left],[right])=>left-right).flatMap(([id,actions])=>{
    const entry=actions[0],exit=actions[1];
    if(!entry||!exit)return [];
    const direction=entry.direction??(entry.side==="买入"?"正T":"反T");
    const rawEntry=rawPrice(entry),rawExit=rawPrice(exit);
    const gross=(direction==="正T"?rawExit-rawEntry:rawEntry-rawExit)*entry.quantity;
    const fees=orderFee(entry)+orderFee(exit);
    const executionCost=(Math.abs(entry.price-rawEntry)+Math.abs(exit.price-rawExit))*entry.quantity;
    const net=result.cycleNets[id-1]??gross-fees-executionCost;
    const holdingMinutes=Number(exit.meta?.hold??Math.max(0,tradingMinuteOffset(exit.time)-tradingMinuteOffset(entry.time)));
    const outcome=net>0?"盈利":net<0?"亏损":"持平";
    let explanation="价格走势未按入场预期发展，退出后本循环扣费为负。";
    if(net>=0)explanation="价格按入场方向运行，退出后仍覆盖了佣金、印花税与滑点。";
    else if(direction==="反T"&&/止损/.test(exit.reason??""))explanation="卖出后价格没有按预期回落，反而重新转强，因此触发止损买回。";
    else if(direction==="正T"&&/止损/.test(exit.reason??""))explanation="买入后价格继续走弱，没有形成预期反弹，因此触发止损卖出。";
    else if(/时间退出/.test(exit.reason??""))explanation="持有到时间上限仍未形成足够价差，系统按时间纪律退出。";
    else if(/强制恢复/.test(exit.reason??""))explanation="尾盘前仍未形成计划价差，系统强制恢复计划底仓。";
    return [{id,direction,entry,exit,holdingMinutes,gross,fees,executionCost,net,outcome,explanation}];
  });
}

function BatchMiniChart({minutes,actions,observations}:{minutes:ReplayMinute[];actions:ReplayAction[];observations:ReplayObservation[]}) {
  if(minutes.length<2)return <div className="batch-mini-empty">没有可绘制的完整分时</div>;
  const width=720,height=190,left=18,right=12,top=16,bottom=28;
  const prices=minutes.map(point=>point.price);
  const low=Math.min(...prices),high=Math.max(...prices);
  const padding=Math.max(.01,(high-low)*.08);
  const min=low-padding,max=high+padding;
  const x=(index:number)=>left+index/Math.max(1,minutes.length-1)*(width-left-right);
  const y=(price:number)=>top+(max-price)/Math.max(.01,max-min)*(height-top-bottom);
  const points=minutes.map((point,index)=>`${x(index).toFixed(1)},${y(point.price).toFixed(1)}`).join(" ");
  const pointAt=(time:string)=>{
    const index=Math.max(0,minutes.findIndex(point=>point.time===time));
    return {x:x(index),y:y(minutes[index]?.price??minutes[0].price)};
  };
  return <div className="batch-mini-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="完整日内分时及买卖点">
      {[.25,.5,.75].map(ratio=><line key={ratio} x1={left} x2={width-right} y1={top+(height-top-bottom)*ratio} y2={top+(height-top-bottom)*ratio} className="mini-grid"/>)}
      <polyline points={points} className="mini-price-line"/>
      {observations.slice(0,4).map((observation,index)=>{const point=pointAt(observation.time);const label=observationConfirmationLabel(observation);return <g key={`ob-${observation.time}-${index}`} className="mini-observation"><title>{`${label}；${observationDirectionNote(observation)}；${observation.reason}`}</title><circle cx={point.x} cy={point.y} r="4"/><text x={point.x} y={Math.max(10,point.y-8)}>{label}</text></g>})}
      {actions.map((action,index)=>{const point=pointAt(action.time);const selling=action.side==="卖出";return <g key={`action-${action.time}-${index}`} className={selling?"mini-action sell":"mini-action buy"}><circle cx={point.x} cy={point.y} r="5"/><text x={point.x} y={Math.max(10,point.y-9)}>{action.side==="买回"?"回":selling?"卖":"买"}</text></g>})}
      <text x={left} y={height-8} className="mini-axis">09:30</text><text x={width/2} y={height-8} textAnchor="middle" className="mini-axis">13:00</text><text x={width-right} y={height-8} textAnchor="end" className="mini-axis">15:00</text>
    </svg>
    <div className="batch-mini-caption"><span>低 {low.toFixed(2)}</span><span>高 {high.toFixed(2)}</span><span>收 {prices.at(-1)?.toFixed(2)}</span></div>
  </div>;
}

function BatchReport({batch,representativeCode}:{batch:BatchBacktestResult;representativeCode?:string}) {
  const [expanded,setExpanded]=useState<string|null>(batch.stockFeedback.find(item=>item.net<0)?.code??null);
  return <section className="batch-report" aria-label="随机10股真实分时批次汇总">
    <div className="batch-report-head"><div><span>RANDOM 10-STOCK FULL-DAY CAUSAL REPLAY</span><h2>全A股随机10股真实分时批次</h2></div><div className="batch-run-meta"><em>{batch.fallbackUniverse?"代表池回退":"全A股池"} {batch.universeSize.toLocaleString()} 只 · 本批 {batch.industries} 个行业</em>{batch.replacementStocks>0&&<small>行情缺失自动补抽 {batch.replacementStocks} 只（共尝试 {batch.attemptedStocks} 只）</small>}</div></div>
    <div className="batch-coverage"><b>候补覆盖 {batch.referenceStocks}/{batch.stocks} 股</b><span>正式候选 {batch.candidateStocks}/{batch.stocks} 股</span><span>正式触发 {batch.tradingRounds}/{batch.stocks} 股</span><span>正式闭环 {batch.completed} 个 · {batch.wins} 盈 / {Math.max(0,batch.completed-batch.wins)} 亏</span><small>每股最多展示 2 个候补买点和 2 个候补卖点，全部标记在当时能够确认的分钟，不回填全天高低点；候补点不可执行。只有继续通过趋势、量价、成本和风控的点才升级为正式候选或正式交易。</small></div>
    <div className="batch-metrics"><div><span>扣费后循环胜率</span><strong>{batch.completed?`${(batch.wins/batch.completed*100).toFixed(2)}%`:'—'}</strong><small>{batch.wins}/{batch.completed} 个闭环盈利</small></div><div><span>毛收益</span><b className={pnlClass(batch.gross)}>{money(batch.gross)}</b><small>{batch.samples.toLocaleString()} 个随机股票日</small></div><div><span>交易费用 + 滑点</span><b className="pnl-loss">{money(-(batch.fees+batch.executionCost))}</b><small>费用 {money(-batch.fees)} · 滑点 {money(-batch.executionCost)}</small></div><div><span>总净收益</span><b className={pnlClass(batch.net)}>{money(batch.net)}</b><small>平均每股日 {money(batch.averageNet)}</small></div><div><span>有交易 / 盈利 / 亏损日</span><b>{batch.tradingRounds} / {batch.profitableRounds} / {batch.losingRounds}</b><small>共 {batch.rounds} 个随机股票日</small></div><div><span>盈利因子 / 最差回撤</span><b>{batch.profitFactor===null?'—':batch.profitFactor.toFixed(2)} / -{(batch.maxDrawdown*100).toFixed(2)}%</b><small>{batch.providers.join(' / ')}</small></div></div>
    <div className="ab-compare"><b>同样本旧版</b><span>闭环 {batch.legacy.completed}</span><span>胜率 {batch.legacy.completed?(batch.legacy.wins/batch.legacy.completed*100).toFixed(2):'—'}%</span><span className={pnlClass(batch.legacy.net)}>净收益 {money(batch.legacy.net)}</span><strong className={pnlClass(batch.net-batch.legacy.net)}>新版差额 {money(batch.net-batch.legacy.net)}</strong></div>
    <div className="stock-feedback"><div className="stock-feedback-head"><div><b>随机股票逐股反馈</b><span>股票和近5个可用完整交易日都会重新抽取；点“复盘”查看观察参考、正式点位、费用及失败原因</span></div><em>正T / 反T 为完整日内的闭环数</em></div><div className="stock-feedback-scroll"><table><thead><tr><th>股票</th><th>交易日</th><th>观察参考 / 正式候选</th><th>闭环</th><th>扣费胜率</th><th>正T / 反T</th><th>净收益</th><th>无正式闭环日</th><th>反馈</th><th>详情</th></tr></thead><tbody>{batch.stockFeedback.map(item=><Fragment key={item.code}><tr className={item.code===representativeCode?'representative':''}><td><b>{item.code}</b><span>{item.name}</span></td><td>{item.date.slice(4,6)}-{item.date.slice(6,8)}</td><td>{item.keyObservations} / {item.candidates}</td><td>{item.completed}</td><td>{item.winRate===null?'—':`${(item.winRate*100).toFixed(2)}%`}</td><td>{item.positiveT} / {item.reverseT}</td><td className={pnlClass(item.net)}>{money(item.net)}</td><td>{item.noTrade} / {item.samples}</td><td>{item.feedback}</td><td><button type="button" className="batch-detail-toggle" aria-expanded={expanded===item.code} onClick={()=>setExpanded(current=>current===item.code?null:item.code)}>{expanded===item.code?'收起':'复盘'}</button></td></tr>{expanded===item.code&&<tr className="batch-detail-row"><td colSpan={10}><div className="batch-stock-detail"><div><div className="batch-detail-title"><b>{item.code} {item.name} · {item.date.slice(0,4)}-{item.date.slice(4,6)}-{item.date.slice(6,8)}</b><span>{item.completed?`${item.completed} 个正式闭环`:`${item.keyObservations} 个因果观察参考，0 个正式闭环`}</span></div><BatchMiniChart minutes={item.minutes} actions={item.actions} observations={item.observations}/></div><div className="batch-cycle-details">{item.cycles.length?item.cycles.map(cycle=><article key={cycle.id} className={cycle.net<0?'cycle-loss':'cycle-profit'}><header><b>第 {cycle.id} 轮 · {cycle.direction} · {cycle.outcome}</b><strong>{money(cycle.net)}</strong></header><div className="cycle-route"><span>{replayTime(cycle.entry.time)} {cycle.entry.side} ¥{cycle.entry.price.toFixed(3)}</span><i>→</i><span>{replayTime(cycle.exit.time)} {cycle.exit.side} ¥{cycle.exit.price.toFixed(3)}</span><em>{cycle.entry.quantity.toLocaleString()} 股</em></div><dl><div><dt>理论毛收益</dt><dd>{money(cycle.gross)}</dd></div><div><dt>手续费</dt><dd>{money(-cycle.fees)}</dd></div><div><dt>双向滑点</dt><dd>{money(-cycle.executionCost)}</dd></div></dl><p className="cycle-explanation"><b>{cycle.net<0?'亏损原因':'结果说明'}：</b>{cycle.explanation}</p><p><b>入场依据：</b>{cycle.entry.reason??'由当分钟量价与趋势条件共同触发。'}</p><p><b>退出依据：</b>{cycle.exit.reason??'由止盈、止损或时间纪律触发。'}</p></article>):<article className="cycle-no-trade"><header><b>为什么没有交易？</b></header><p>{item.feedback}。观察参考不可执行，未通过正式门槛不会生成买卖点。</p>{item.strongSellTrendBlocked>0&&<div className="hard-risk-block"><b>风控硬拦截</b><span>强势交易日仍在 VWAP 上方，拦截 {item.strongSellTrendBlocked} 次逆势反T判定，避免低位卖出后追高买回。</span></div>}{item.strongBuyTrendBlocked>0&&<div className="hard-risk-block"><b>风控硬拦截</b><span>弱势交易日仍在 VWAP 下方，拦截 {item.strongBuyTrendBlocked} 次逆势正T判定，避免下跌中补仓后继续承压。</span></div>}{item.observations.map((observation,index)=><div key={`${observation.time}-${index}`}><b>{replayTime(observation.time)} {observationConfirmationLabel(observation)}</b><span>{observationDirectionNote(observation)}；{observation.blockers.length?observation.blockers.join('；'):'量价确认不足'}</span></div>)}</article>}</div></div></td></tr>}</Fragment>)}</tbody></table></div></div>
    <p>每次点击优先从当前全 A 股普通股票列表无放回抽取 10 只，并尽量分散行业；行情缺失会继续从全市场补抽。只有全市场列表暂时不可用时才明确回退代表池。每股图上最多保留 2 个候补买点和 2 个候补卖点，正式闭环另行标注。</p>
  </section>;
}

function runIntradayBlindReplayLegacy(minutes: {time:string;price:number;volume:number}[], capital:number, baseShares:number, sellable:number, feeRate:number, slippage:number, minCommission:boolean, slippageMode:"percent"|"tick", forceCloseTime:string, randomValue=0): BacktestResult {
  const points=minutes.filter(point=>Number.isFinite(point.price) && point.price>0);
  const quantity=Math.floor(Math.min(baseShares,sellable)/3/100)*100;
  if(points.length<30 || !quantity) return {net:0,gross:0,fees:0,executionCost:0,maxDrawdown:0,trades:0,wins:0,days:0,curve:[capital],curveTimes:[],cycleNets:[],startTime:"",status:"真实分时样本或可卖底仓不足，未生成交易",actions:[]};
  const boundedRandom=Math.min(.999999,Math.max(0,randomValue));
  const start=Math.min(points.length-20,Math.max(15,Math.floor(points.length*.12)+Math.floor(boundedRandom*Math.max(1,Math.floor(points.length*.58)))));
  let cash=capital,peak=capital,maxDrawdown=0,gross=0,fees=0,executionCost=0,trades=0,wins=0,eligiblePoints=0,vwapSignals=0,pressureSignals=0;
  let soldPrice:number|null=null,rawSoldPrice:number|null=null,openCost=0,consecutiveLosses=0; const curve=[capital]; const curveTimes=[points[start].time]; const actions:ReplayAction[]=[]; const cycleNets:number[]=[];
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
    const sellWindow=point.time>="0945" && point.time<="1430" && consecutiveLosses<2;
    const pressureExhaustion=point.price>=resistance*.996 && point.price<=previous.price*1.0015 && (point.volume<=averageVolume*1.8 || deviation>=threshold*1.35);
    const slip=slippageMode==="tick" ? slippage : point.price*slippage/100;
    const commission=(turnover:number)=>Math.max(minCommission?5:0,turnover*feeRate/100);
    if(index>=20 && sellWindow) eligiblePoints++;
    if(index>=20 && sellWindow && deviation>=threshold) vwapSignals++;
    if(index>=20 && sellWindow && pressureExhaustion) pressureSignals++;
    if(soldPrice===null && index>=20 && sellWindow && deviation>=threshold && pressureExhaustion){
      rawSoldPrice=point.price; soldPrice=point.price-slip; openCost=commission(soldPrice*quantity)+soldPrice*quantity*.0005; fees+=openCost; executionCost+=(rawSoldPrice-soldPrice)*quantity; trades+=1;
      actions.push({time:point.time,side:"卖出",price:soldPrice,quantity,curveIndex:curve.length});
    }
    const buySignal=index>=20 && ((deviation<=threshold*.35 && point.price>=previous.price) || deviation<=-threshold*.35);
    if(soldPrice!==null && (buySignal || point.time>=forceCloseTime || index===points.length-1)){
      const rawBuyPrice=point.price; const buyPrice=point.price+slip; const buyFee=commission(buyPrice*quantity); fees+=buyFee; executionCost+=(buyPrice-rawBuyPrice)*quantity;
      const theoreticalGross=((rawSoldPrice ?? soldPrice)-rawBuyPrice)*quantity; const cycleNet=(soldPrice-buyPrice)*quantity-openCost-buyFee;
      cash+=cycleNet; gross+=theoreticalGross; cycleNets.push(cycleNet); if(cycleNet>0){wins++;consecutiveLosses=0}else consecutiveLosses+=1;
      actions.push({time:point.time,side:"买回",price:buyPrice,quantity,curveIndex:curve.length}); soldPrice=null; rawSoldPrice=null; openCost=0;
    }
    const mark=cash+(soldPrice===null?0:(soldPrice-(point.price+slip))*quantity-openCost); peak=Math.max(peak,mark); maxDrawdown=Math.max(maxDrawdown,(peak-mark)/peak); curve.push(mark); curveTimes.push(point.time);
  }
  const noTradeReason = !eligiblePoints ? "随机起点后没有处于可开仓时段的样本" : !vwapSignals ? "价格未达到动态 VWAP 偏离阈值" : !pressureSignals ? "未出现压力位滞涨确认" : "信号未能在尾盘前完成闭环";
  return {net:cash-capital,gross,fees,executionCost,maxDrawdown,trades,wins,days:1,curve,curveTimes,cycleNets,startTime:points[start].time,status:trades?`融合策略 V3 完成：从 ${points[start].time} 开始逐点揭示，按动态 VWAP 与压力位滞涨执行反 T。`:`融合策略 V3 本次未形成完整反 T 条件：${noTradeReason}。`,actions};
}

const initialStocks = [
  { code: "601899", name: "紫金矿业", price: "--", change: "--" },
  { code: "601012", name: "隆基绿能", price: "--", change: "--" },
  { code: "000063", name: "中兴通讯", price: "--", change: "--" },
  { code: "600519", name: "贵州茅台", price: "--", change: "--" },
];

const representativeBacktestUniverse = [
  "601899", "603993", "601012", "000063", "600519", "600036",
  "000333", "300750", "601318", "600276", "002415", "600900",
  "601088", "600030", "601166", "600887", "600309", "600031",
  "601668", "600050", "600028", "601857", "600438", "600690",
  "000651", "000858", "000001", "000725", "002594", "002230",
  "002714", "300059", "300015", "300124", "688981", "688008",
];

const canonicalStockNames: Record<string, string> = {
  "601899": "紫金矿业", "603993": "洛阳钼业", "601012": "隆基绿能", "000063": "中兴通讯", "600519": "贵州茅台",
  "600036": "招商银行", "000333": "美的集团", "300750": "宁德时代", "601318": "中国平安", "600276": "恒瑞医药", "002415": "海康威视",
  "600900": "长江电力", "601088": "中国神华", "600030": "中信证券", "601166": "兴业银行", "600887": "伊利股份",
  "600309": "万华化学", "600031": "三一重工", "601668": "中国建筑", "600050": "中国联通", "600028": "中国石化",
  "601857": "中国石油", "600438": "通威股份", "600690": "海尔智家", "000651": "格力电器", "000858": "五粮液",
  "000001": "平安银行", "000725": "京东方A", "002594": "比亚迪", "002230": "科大讯飞", "002714": "牧原股份",
  "300059": "东方财富", "300015": "爱尔眼科", "300124": "汇川技术", "688981": "中芯国际", "688008": "澜起科技",
};
const representativeBacktestItems:StockUniverseItem[]=representativeBacktestUniverse.map(code=>({code,name:canonicalStockNames[code]??code,industry:"代表池",market:code.startsWith("6")?"沪市":"深市"}));

function diversifyStockUniverse(items:StockUniverseItem[],seed:string) {
  const shuffled=sampleWithSeed(items,items.length,seed);
  const firstByIndustry:StockUniverseItem[]=[];
  const remaining:StockUniverseItem[]=[];
  const seenIndustries=new Set<string>();
  shuffled.forEach(item=>{
    const industry=item.industry||"未分类";
    if(industry!=="未分类"&&!seenIndustries.has(industry)){
      seenIndustries.add(industry);
      firstByIndustry.push(item);
    }else remaining.push(item);
  });
  return [...firstByIndustry,...remaining];
}
const normalizeWatchlist = (list: { code:string; name:string; price:string; change:string }[]) => list.map(item => ({ ...item, name: canonicalStockNames[item.code] ?? item.name }));
const isZijinExperimentDeepLink = () => {
  if(typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("view") === "zijin-lab";
};
const ensureZijinExperimentStock = (list: typeof initialStocks) => {
  const normalized=normalizeWatchlist(list);
  if(normalized.some(item=>item.code==="601899"))return normalized;
  const zijin=initialStocks.find(item=>item.code==="601899");
  return zijin?[{...zijin},...normalized]:normalized;
};
const prepareWatchlistForCurrentEntry = (list: typeof initialStocks) => isZijinExperimentDeepLink()
  ? ensureZijinExperimentStock(list)
  : normalizeWatchlist(list);

const agents = [
  { avatar: "/agents/training.png", name: "训练兔", role: "严格模拟", state: "训练中", value: "76%", metric: "样本覆盖率" },
  { avatar: "/agents/challenger.png", name: "挑战兔", role: "影子验证", state: "待评审", value: "58%", metric: "样本外通过率" },
  { avatar: "/agents/official.png", name: "正式兔", role: "冠军策略", state: "运行中", value: "82%", metric: "历史胜率" },
  { avatar: "/agents/risk.png", name: "风控兔", role: "回撤监控", state: "低风险", value: "1.36%", metric: "最大回撤" },
];
const strategyProfiles = ["稳健档","平衡档","灵敏档"];


export default function Home() {
  const [authReady, setAuthReady] = useState(true);
  const [localAuth, setLocalAuth] = useState(false);
  const [authScreen,setAuthScreen]=useState<'landing'|'account'>('landing');
  const [demoMode,setDemoMode]=useState(false);
  const [accountName, setAccountName] = useState("jay cc");
  const [accountRole, setAccountRole] = useState("member");
  const remoteSyncReady = useRef(false);
  const [remoteSyncEpoch,setRemoteSyncEpoch]=useState(0);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [preferences, setPreferences] = useState<AccountPreferences>(DEFAULT_PREFERENCES);
  const [hasPersistedPreferences,setHasPersistedPreferences]=useState(false);
  const [stockPositions, setStockPositions] = useState<StockPositionMap>({});
  const [activeStock, setActiveStock] = useState(0);
  const [stockList, setStockList] = useState(initialStocks);
  const [profile, setProfile] = useState("平衡档");
  const [panel, setPanel] = useState("今日T循环");
  const [cycleStage, setCycleStage] = useState<'ready'|'opened'|'closed'>('ready');
  const [agentOpen, setAgentOpen] = useState(false);
  const [activeView, setActiveView] = useState("操盘台");
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [memberAdminOpen,setMemberAdminOpen]=useState(false);
  const [trainingRunning, setTrainingRunning] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(()=>{try{const saved=localStorage.getItem('rabbit-alert-settings');return saved?{sound:false,system:false,...JSON.parse(saved)}:{sound:false,system:false};}catch{return {sound:false,system:false};}});
  const [alertQueue, setAlertQueue] = useState<TradeAlertToast[]>([]);
  const alertToast=alertQueue[0]??null;
  const alertedEventKeys = useRef<Set<string>>(new Set());
  const serverAlertCursor = useRef(0);
  const serverAlertsInitialized = useRef(false);
  const riskAlertEpisodes = useRef<Record<string,string>>({});
  const nextPreviewRabbit = useRef<"buy"|"sell">("buy");
  const [customStrategy, setCustomStrategy] = useState("09:30开始实时扫描，至少4个真实分钟点后等待开盘价与VWAP双确认；正T、反T每次不超过可做T数量的1/3；扣费后目标净收益低于0.64%不执行。");
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [marketError, setMarketError] = useState("");
  const [marketQuotes, setMarketQuotes] = useState<Record<string, MarketData["quote"]>>({});
  const [marketSnapshots, setMarketSnapshots] = useState<Record<string, MarketData>>({});
  const [clockNow, setClockNow] = useState<Date|null>(null);
  const [tradeLedgerState,setTradeLedgerState]=useState<{key:string;rows:TradeLedgerRow[]}>({key:"",rows:[]});
  const [trialQuote, setTrialQuote] = useState<MarketData | null>(null);
  const [trialError, setTrialError] = useState("");
  const [marketContext, setMarketContext] = useState<MarketContext | null>(null);
  const [marketContextError, setMarketContextError] = useState("");
  const [eventRadar, setEventRadar] = useState<EventRadarResponse | null>(null);
  const [eventRadarError, setEventRadarError] = useState("");
  const [starredRevision, setStarredRevision] = useState(0);
  const [indicatorsVisible, setIndicatorsVisible] = useState(true);
  const stock = stockList[activeStock] || stockList[0];
  useEffect(()=>{
    if(!authReady||!localAuth||!isZijinExperimentDeepLink())return;
    const prepared=ensureZijinExperimentStock(stockList);
    const zijinIndex=prepared.findIndex(item=>item.code==='601899');
    const timer=window.setTimeout(()=>{
      if(prepared.length!==stockList.length)setStockList(prepared);
      setActiveStock(zijinIndex);
      setActiveView('单股智研');
    },0);
    return()=>window.clearTimeout(timer);
  },[authReady,localAuth,stockList]);
  useEffect(()=>{
    if(activeView!=='单股智研'||stock?.code!=='601899'||typeof window==='undefined')return;
    const params=new URLSearchParams(window.location.search);
    if(params.get('view')!=='zijin-lab')return;
    window.requestAnimationFrame(()=>document.getElementById('zijin-experiment-progress')?.scrollIntoView({block:'start'}));
  },[activeView,stock?.code]);
  const activePosition = resolveStockPosition(stockPositions, preferences, stock?.code ?? "");
  const tradingDate=clockNow?tradeLedgerDate(clockNow):"1970-01-01";
  const ledgerStorageKey=localAuth&&stock?.code&&clockNow?tradeLedgerKey(accountName,stock.code,tradingDate):"";
  const tradeLedgerRows=useMemo(
    ()=>tradeLedgerState.key===ledgerStorageKey?tradeLedgerState.rows:[],
    [tradeLedgerState.key,tradeLedgerState.rows,ledgerStorageKey],
  );
  const tradeLedgerSummary=useMemo(
    ()=>summarizeTradeLedger(tradeLedgerRows,activePosition,tradingDate),
    [tradeLedgerRows,activePosition,tradingDate],
  );
  const effectiveLivePosition=useMemo(()=>({
    ...activePosition,
    openingShares:tradeLedgerSummary.currentShares,
    sellable:tradeLedgerSummary.remainingSellable,
  }),[activePosition,tradeLedgerSummary.currentShares,tradeLedgerSummary.remainingSellable]);
  const currentTrial = trialQuote?.quote.code === stock?.code ? trialQuote : null;
  const currentMarket = marketData?.quote.code === stock?.code ? marketData : null;
  const currentContext = marketContext?.code === stock?.code ? marketContext : null;
  const currentEvents = eventRadar?.stocks.find(item => item.code === stock?.code) ?? null;
  const eventsByCode = useMemo(() => Object.fromEntries((eventRadar?.stocks ?? []).map(item => [item.code, item])), [eventRadar]);
  const activeQuote = currentTrial?.quote ?? currentMarket?.quote;
  const marketSession = useMemo(() => aShareSession(clockNow), [clockNow]);
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
  const rawMinutePoints = useMemo(() => currentTrial?.minutes?.length ? currentTrial.minutes : currentMarket?.minutes ?? [], [currentTrial, currentMarket]);
  const minutePoints = useMemo(() => rawMinutePoints.filter(point=>isAShareRegularTradingMinute(point.time)), [rawMinutePoints]);
  const afterHoursPoints = useMemo(() => rawMinutePoints.filter(point=>isAShareAfterHoursFixedPriceMinute(point.time)), [rawMinutePoints]);
  const afterHoursSummary = useMemo(() => {
    if (!afterHoursPoints.length) return null;
    return {
      price:afterHoursPoints.at(-1)!.price,
      totalVolume:afterHoursPoints.reduce((sum,point)=>sum+Math.max(0,point.volume||0),0),
      points:afterHoursPoints.length,
    };
  },[afterHoursPoints]);
  const chartModel = useMemo(() => {
    if (minutePoints.length < 2) return null;
    const prices=minutePoints.map(point=>point.price); const min=Math.min(...prices); const max=Math.max(...prices); const range=max-min||Math.max(max*.002,0.01);
    const pointAt=(point:{price:number},index:number)=>`${intradayChartX(minutePoints[index].time)},${20+(max-point.price)/range*210}`;
    const path=`M${minutePoints.map(pointAt).join(' L')}`;
    let weighted=0, totalVolume=0; const vwap=minutePoints.map((point,index)=>{weighted+=point.price*Math.max(point.volume,1);totalVolume+=Math.max(point.volume,1);return pointAt({price:weighted/totalVolume},index)});
    const maxVolume=Math.max(...minutePoints.map(point=>point.volume),1);
    const lastVwap=weighted/Math.max(totalVolume,1);
    const firstX=intradayChartX(minutePoints[0].time); const lastX=intradayChartX(minutePoints.at(-1)!.time);
    return {path,vwapPath:`M${vwap.join(' L')}`,min,max,last:minutePoints.at(-1)!,firstX,lastX,lastVwap,volumes:minutePoints.map((point,index)=>({x:intradayChartX(point.time),height:Math.max(2,point.volume/maxVolume*42),up:index===0||point.price>=minutePoints[index-1].price})),ticks:[max,max-range*.25,max-range*.5,max-range*.75,min]};
  },[minutePoints]);
  const stockState = useMemo(() => recognizeStockState(currentMarket?.bars ?? [], activeQuote, minutePoints), [currentMarket?.bars, activeQuote, minutePoints]);
  const stockAgent=useMemo(()=>resolveStockAgent(stock?.code),[stock?.code]);
  const stockAgentEvaluation=useMemo(()=>evaluateStockAgent({
    code:stock?.code,
    minutes:minutePoints,
    previousClose:activeQuote?.previousClose??null,
  }),[stock?.code,minutePoints,activeQuote?.previousClose]);
  const liveEngine = useMemo(() => runSmartTReplay(minutePoints, {
    capital:200_000,
    baseShares:Math.max(0,effectiveLivePosition.openingShares),
    sellable:effectiveLivePosition.sellable,
    feeRate:.025,
    slippage:.02,
    minCommission:true,
    slippageMode:"percent",
    forceCloseTime:"1450",
    profile,
    previousClose:activeQuote?.previousClose ?? null,
    randomValue:0,
  }),[minutePoints,effectiveLivePosition.openingShares,effectiveLivePosition.sellable,profile,activeQuote?.previousClose]);
  const currentObservations=(liveEngine.observations ?? []) as ReplayObservation[];
  // Observations are causal confirmation events. The live chart keeps every
  // event at observation.time; historical pivotTime is audit-only metadata.
  const visibleChartObservations=useMemo(()=>selectVisibleChartObservations(currentObservations),[currentObservations]);
  const intradayMarkerLayout=useMemo(()=>{
    if(!chartModel)return {observations:[],actions:[]};
    type LabelBox={left:number;right:number;top:number;bottom:number};
    const occupied:LabelBox[]=[];
    const range=chartModel.max-chartModel.min||Math.max(chartModel.max*.002,.01);
    const pointPosition=(time:string,price?:number)=>{
      const minuteIndex=minutePoints.findIndex(point=>point.time===time);
      if(minuteIndex<0)return null;
      const point=minutePoints[minuteIndex];
      return {x:intradayChartX(point.time),y:20+(chartModel.max-(price??point.price))/range*210};
    };
    const reserveLabel=(pointX:number,preferredBaseline:number,width:number,height:number,direction:-1|1)=>{
      const labelX=Math.max(width/2+5,Math.min(915-width/2,pointX));
      const offsets=[0,18,36,54,72,-18,-36,-54,-72];
      const candidates=offsets.map(offset=>Math.max(13,Math.min(245,preferredBaseline+offset*direction)));
      for(const baseline of candidates){
        const box={left:labelX-width/2-4,right:labelX+width/2+4,top:baseline-height+1,bottom:baseline+6};
        const collision=occupied.some(other=>box.left<other.right+3&&box.right>other.left-3&&box.top<other.bottom+3&&box.bottom>other.top-3);
        if(!collision){occupied.push(box);return {labelX,labelY:baseline};}
      }
      const fallback=candidates.at(-1)??preferredBaseline;
      occupied.push({left:labelX-width/2-4,right:labelX+width/2+4,top:fallback-height+1,bottom:fallback+6});
      return {labelX,labelY:fallback};
    };
    // Formal orders get first choice of label space. Every other marker is
    // stamped at its real confirmation minute; no historical pivot is backfilled.
    const actions=liveEngine.actions.flatMap((action,index)=>{
      const point=pointPosition(action.time);
      if(!point)return [];
      const isSell=action.side==="卖出";
      const label=action.direction==="反T"?(isSell?"反T卖":"反T回"):(isSell?"正T卖":"正T买");
      const labelWidth=label.length*9+16;
      const placed=reserveLabel(point.x,isSell?point.y-13:point.y+22,labelWidth,18,isSell?-1:1);
      return [{...point,...placed,index,isSell,label,labelWidth,action}];
    });
    const observations=visibleChartObservations.flatMap((observation,index)=>{
      const point=pointPosition(observation.time);
      if(!point)return [];
      const isSell=observation.direction==="反T";
      const qualified=observation.stage!=="watch";
      const assessment=observation.pivotAssessment??"unconfirmed";
      const sideClass=isSell?"sell":"buy";
      const currentLabel=observation.confirmationLabel??(assessment==="confirmed"?(isSell?"转弱确认":"转强确认"):assessment==="strong"?(isSell?"高位候选":"低位候选"):"观察");
      const labelWidth=currentLabel.length*8+14;
      const placed=reserveLabel(point.x,isSell?point.y+22:point.y-15,labelWidth,16,isSell?1:-1);
      return [{...point,...placed,index,isSell,qualified,assessment,sideClass,currentLabel,labelWidth,observation}];
    });
    return {observations,actions};
  },[chartModel,minutePoints,visibleChartObservations,liveEngine.actions]);
  const signalFunnel = (() => {
    const rows=stockList.flatMap(item=>{
      const snapshot=item.code===stock?.code ? (currentTrial ?? currentMarket ?? marketSnapshots[item.code]) : marketSnapshots[item.code];
      if(!snapshot?.minutes?.length)return [];
      const itemPosition=resolveStockPosition(stockPositions,preferences,item.code);
      const replay=item.code===stock?.code ? liveEngine : runSmartTReplay(snapshot.minutes,{
        capital:200_000,baseShares:itemPosition.plannedBase,sellable:itemPosition.sellable,feeRate:.025,slippage:.02,minCommission:true,slippageMode:"percent",forceCloseTime:"1450",profile,previousClose:snapshot.quote.previousClose??null,randomValue:0,
      });
      const observations=(replay.observations??[]) as ReplayObservation[];
      const formalCycles=replay.trades;
      return [{code:item.code,name:snapshot.quote.name||item.name,observations,formalCycles}];
    });
    const visible=rows.flatMap(row=>row.observations.map(observation=>({...observation,code:row.code,name:row.name})));
    const qualified=visible.filter(observation=>observation.stage!=="watch");
    const latest=[...visible].sort((left,right)=>right.time.localeCompare(left.time))[0]??null;
    const currentRow=rows.find(row=>row.code===stock?.code);
    const currentVisible=currentRow?.observations??[];
    const currentQualified=(currentRow?.observations??[]).filter(observation=>observation.stage!=="watch");
    const currentLatest=[...currentVisible].sort((left,right)=>right.time.localeCompare(left.time))[0]??null;
    return {
      scanned:rows.length,
      observations:visible.length,
      candidates:qualified.length,
      formal:rows.reduce((sum,row)=>sum+row.formalCycles,0),
      latest,
      currentObservations:currentVisible.length,
      currentCandidates:currentQualified.length,
      currentFormal:currentRow?.formalCycles??0,
      currentLatest,
    };
  })();
  const personalStrategyStats = useMemo(() => {
    const sessions=(currentMarket?.intradaySessions ?? [])
      .filter(session=>session.minutes.length>=180)
      .sort((left,right)=>right.date.localeCompare(left.date))
      .slice(0,20);
    const results=sessions.map(session=>runSmartTReplay(session.minutes,{
      capital:200_000,
      baseShares:activePosition.plannedBase,
      sellable:activePosition.sellable,
      feeRate:.025,
      slippage:.02,
      minCommission:true,
      slippageMode:"percent",
      forceCloseTime:"1450",
      profile,
      previousClose:session.previousClose,
      randomValue:0,
    }));
    const cycles=results.reduce((sum,item)=>sum+item.trades,0);
    const wins=results.reduce((sum,item)=>sum+item.wins,0);
    const net=results.reduce((sum,item)=>sum+item.net,0);
    const maxDrawdown=results.length?Math.max(...results.map(item=>item.maxDrawdown)):0;
    const confidence=cycles>=20?"高":cycles>=8?"中":"样本不足";
    return {sessions:sessions.length,cycles,wins,net,maxDrawdown,confidence,winRate:cycles?wins/cycles:null};
  },[currentMarket?.intradaySessions,activePosition.plannedBase,activePosition.sellable,profile]);
  const liveAgents=useMemo(()=>agents.map((agent,index)=>({
    ...agent,
    state:index===0?`${personalStrategyStats.sessions}日已读取`:index===1?`${personalStrategyStats.cycles}闭环已核对`:index===2?"正式版锁定":personalStrategyStats.maxDrawdown<.03?"风控绿灯":"需要关注",
    value:index===0?`${personalStrategyStats.sessions}/20`:index===1?`${personalStrategyStats.cycles}/20`:index===2?"V4":`${(personalStrategyStats.maxDrawdown*100).toFixed(2)}%`,
  })),[personalStrategyStats]);
  const openingAssessment = useMemo(() => {
    const price=activeQuote?.price;
    const quotedOpen=activeQuote?.open;
    const open=marketSession.phase==="auction-result" ? (quotedOpen&&quotedOpen>0?quotedOpen:price) : quotedOpen;
    const previousClose=activeQuote?.previousClose ?? (price != null && activeQuote?.change != null
      ? price-activeQuote.change
      : price != null && activeQuote?.changePercent != null && activeQuote.changePercent!==-100
        ? price/(1+activeQuote.changePercent/100)
        : null);
    if(!price || !open || !previousClose) return {session:"等待昨收",gapText:"开盘方向待确认",auction:"开盘方向待确认",confirmation:"0/4 条件确认",suggested:"反T",positiveTitle:"正T条件待确认",positiveCopy:"昨收、今开或实时价格不完整，暂不判断高低开。",negativeTitle:"反T条件待确认",negativeCopy:"昨收、今开或实时价格不完整，暂不判断高低开。"};
    const gap=(open-previousClose)/previousClose; const vwap=chartModel?.lastVwap ?? open;
    const aboveReference=price>=open && price>=vwap; const belowReference=price<=open && price<=vwap;
    const gapText=`${gap>=0?"高":"低"}开 ${gap>=0?"+":""}${(gap*100).toFixed(2)}%`;
    if(gap<=-.001) return {session:"低开",gapText,auction:aboveReference?"低开转强 · 正T观察":"低开承压 · 等待修复",confirmation:aboveReference?"3/4 条件确认":"2/4 条件确认",suggested:"正T",positiveTitle:aboveReference?"低开转强":"低开修复观察",positiveCopy:aboveReference?"价格已回到开盘价与 VWAP 上方，仍需二次确认。":"价格尚未同时站回开盘价与 VWAP，不急于补仓。",negativeTitle:"低开反弹观察",negativeCopy:"低开股票不能套用高开转弱逻辑；只有反弹到压力位并确认滞涨后才考虑反 T。"};
    if(gap>=.001) return {session:"高开",gapText,auction:belowReference?"高开转弱 · 反T观察":"高开偏强 · 等待回落",confirmation:belowReference?"3/4 条件确认":"2/4 条件确认",suggested:"反T",positiveTitle:"高开回踩观察",positiveCopy:"高开股票需等待回踩企稳，不能把高开直接当成正 T 买点。",negativeTitle:belowReference?"高开转弱":"高开滞涨观察",negativeCopy:belowReference?"价格跌回开盘价与 VWAP 下方，仍需回抽失败确认。":"价格尚未同时跌破开盘价与 VWAP，不急于卖出。"};
    return {session:"平开",gapText:`平开 ${(gap*100).toFixed(2)}%`,auction:"平开震荡 · 区间观察",confirmation:"2/4 条件确认",suggested:"正T",positiveTitle:"平开正T观察",positiveCopy:"等待价格回踩后重新站上 VWAP，再判断正 T。",negativeTitle:"平开反T观察",negativeCopy:"等待价格冲高后跌回 VWAP，再判断反 T。"};
  },[activeQuote,chartModel?.lastVwap,marketSession.phase]);
  const autoDecision = useMemo(() => {
    const price=activeQuote?.price ?? 0; const open=activeQuote?.open ?? 0; const vwap=chartModel?.lastVwap ?? 0;
    const lastTime=(minutePoints.at(-1)?.time ?? "").replace(/\D/g,"").slice(0,4);
    const inDecisionWindow=lastTime>="0933" && lastTime<="1430";
    const recent=minutePoints.slice(-4).map(point=>point.price);
    const rising=recent.length>=4 && recent.at(-1)!>=recent[0]*1.001;
    const falling=recent.length>=4 && recent.at(-1)!<=recent[0]*.999;
    const lowOpen=openingAssessment.session==="低开"; const highOpen=openingAssessment.session==="高开";
    const aboveReference=Boolean(price && open && vwap && price>=open && price>=vwap);
    const belowReference=Boolean(price && open && vwap && price<=open && price<=vwap);
    const directionConfirmed=(lowOpen&&aboveReference&&rising)||(highOpen&&belowReference&&falling);
    const confirmed=[lowOpen||highOpen,inDecisionWindow,lowOpen?aboveReference:highOpen?belowReference:false,lowOpen?rising:highOpen?falling:false].filter(Boolean).length;
    if(!marketSession.live) {
      const auctionBias=openingAssessment.session==="低开"
        ? "低开修复型正T预案：09:30 后等待站回竞价价与 VWAP"
        : openingAssessment.session==="高开"
          ? "高开回落型反T预案：09:30 后等待跌回竞价价与 VWAP"
          : "平开双向预案：等待连续竞价形成明确方向";
      const auctionReason=marketSession.phase==="auction-result"
        ? `09:25 集合竞价初判：${openingAssessment.gapText}；${auctionBias}。这不是买卖点；09:30 开始扫描，最早 09:33 显示候选，09:36 后才允许经确认的小仓正式信号。`
        : `${marketSession.label}：${marketSession.detail}`;
      return {status:"waiting" as const,mode:null,confirmed:marketSession.phase==="auction-result"?1:confirmed,reason:auctionReason,lastTime,inDecisionWindow:false,referenceConfirmed:false,trendConfirmed:false};
    }
    if(stockState.level==="risk") return {status:"locked" as const,mode:null,confirmed,reason:`股票状态风控：${stockState.details.join("；")}`,lastTime,inDecisionWindow,referenceConfirmed:false,trendConfirmed:false};
    if(currentEvents?.gate.hardLock) return {status:"locked" as const,mode:null,confirmed,reason:`事件雷达：${currentEvents.gate.label}，${currentEvents.gate.reason}。`,lastTime,inDecisionWindow,referenceConfirmed:false,trendConfirmed:false};
    if(currentEvents?.gate.level==="restricted") return {status:"waiting" as const,mode:null,confirmed,reason:`事件雷达：${currentEvents.gate.label}，请先核实原文。`,lastTime,inDecisionWindow,referenceConfirmed:false,trendConfirmed:false};
    if(currentContext?.gate.hardLock) {
      const triggers=currentContext.gate.reasons.length?currentContext.gate.reasons.join("、"):"多项外部指标同步走弱";
      return {status:"locked" as const,mode:null,confirmed,reason:`外部环境雷达 ${currentContext.gate.score}/100：${triggers}；禁止新开 T，只允许恢复底仓。`,lastTime,inDecisionWindow,referenceConfirmed:false,trendConfirmed:false};
    }
    if(currentContext?.gate.level==="restricted") return {status:"waiting" as const,mode:null,confirmed,reason:`外部环境雷达：${currentContext.gate.label}，暂停新开循环。`,lastTime,inDecisionWindow,referenceConfirmed:false,trendConfirmed:false};
    const latestAction=liveEngine.actions.at(-1);
    const fresh=Boolean(latestAction&&isRecentCausalEvent(lastTime,latestAction.time,3));
    if(latestAction&&fresh) return {status:"ready" as const,mode:(latestAction.direction??(lowOpen?"正T":"反T")) as "正T"|"反T",confirmed:4,reason:`融合引擎实时信号：${latestAction.time} ${latestAction.direction} ${latestAction.side}，成本、趋势、量价与风控均已通过。`,lastTime,inDecisionWindow,referenceConfirmed:true,trendConfirmed:true};
    if(!lowOpen&&!highOpen) return {status:"waiting" as const,mode:null,confirmed,reason:"平开或开盘数据不完整，等待形成明确方向。",lastTime,inDecisionWindow,referenceConfirmed:false,trendConfirmed:false};
    if(!inDecisionWindow) return {status:"waiting" as const,mode:null,confirmed,reason:lastTime&&lastTime>"1430"?"14:30 后不再自动开启新的 T。":"09:30 已开始扫描；积累 4 个真实分钟点后，最早 09:33 可在连续走势与 VWAP 确认后小仓试单。",lastTime,inDecisionWindow,referenceConfirmed:lowOpen?aboveReference:belowReference,trendConfirmed:lowOpen?rising:falling};
    return {status:"waiting" as const,mode:null,confirmed,reason:directionConfirmed?`基础方向已确认，但融合引擎仍在检查成本、量价和盈亏比。`:liveEngine.status,lastTime,inDecisionWindow,referenceConfirmed:lowOpen?aboveReference:belowReference,trendConfirmed:lowOpen?rising:falling};
  },[activeQuote?.price,activeQuote?.open,chartModel?.lastVwap,minutePoints,openingAssessment.session,stockState,currentEvents,currentContext,liveEngine,marketSession]);
  const decisionModel=useMemo(()=>{
    if(stockAgent.canExecute)return autoDecision;
    if(autoDecision.status==="locked")return {
      ...autoDecision,
      mode:null,
      reason:`${stockAgent.name}处于研究观察版；${autoDecision.reason}`,
    };
    const evaluation=stockAgentEvaluation;
    const score=evaluation?.score??0;
    return {
      status:"waiting" as const,
      mode:evaluation?.direction??null,
      confirmed:Math.min(3,Math.max(0,Math.floor(score/25))),
      reason:evaluation
        ? `${evaluation.title}：${evaluation.reasons[0]}（专属智能体尚未通过样本外验证，不开放正式执行）`
        : `${stockAgent.name}正在等待真实分钟数据。`,
      lastTime:evaluation?.asOfTime??"",
      inDecisionWindow:Boolean(evaluation?.asOfTime),
      referenceConfirmed:Boolean(evaluation&&Math.abs(evaluation.metrics.vwapBiasPct)>=.2),
      trendConfirmed:evaluation?.status==="candidate",
    };
  },[stockAgent,stockAgentEvaluation,autoDecision]);
  const signalMode:"正T"|"反T"=decisionModel.mode ?? (openingAssessment.session==="高开"?"反T":"正T");
  const cycleQuantity=Math.floor(Math.min(Math.max(0,effectiveLivePosition.openingShares),effectiveLivePosition.sellable)/3/100)*100;
  const displayedShares=cycleStage==='opened'
    ? effectiveLivePosition.openingShares+(signalMode==='正T'?cycleQuantity:-cycleQuantity)
    : effectiveLivePosition.openingShares;
  const confirmedCycleRows=useMemo<DeskHistoryRow[]>(()=>{
    const trades=tradeLedgerRows
      .filter(row=>row.status!=="已失效")
      .sort((left,right)=>String(left.time??"").localeCompare(String(right.time??"")));
    const used=new Set<number>();
    const rows:DeskHistoryRow[]=[];
    for(let index=0;index<trades.length;index+=1){
      if(used.has(index))continue;
      const first=trades[index];
      const match=trades.findIndex((candidate,candidateIndex)=>candidateIndex>index&&!used.has(candidateIndex)&&candidate.side!==first.side&&candidate.quantity===first.quantity);
      if(match<0)continue;
      used.add(index);used.add(match);
      const second=trades[match];
      const direction=first.side==="买入"?"正T循环":"反T循环";
      const gross=first.side==="买入"?(second.price-first.price)/first.price*100:(first.price-second.price)/first.price*100;
      rows.unshift({time:`${first.time??"--:--"}–${second.time??"--:--"}`,direction,price:`${first.price.toFixed(2)}→${second.price.toFixed(2)}`,quantity:`${first.quantity.toLocaleString("zh-CN")}股`,spread:`${gross>=0?"+":""}${gross.toFixed(2)}%`,status:"本机成交已配对",tone:first.side==="买入"?"buy":"sell"});
    }
    return rows;
  },[tradeLedgerRows]);
  const deskHistoryRows=useMemo<DeskHistoryRow[]>(()=>{
    if(panel==="今日T循环")return confirmedCycleRows;
    if(stockAgentEvaluation){
      if(panel!=="历史信号"||stockAgentEvaluation.status!=="candidate"||!stockAgentEvaluation.asOfTime)return [];
      const point=minutePoints.find(item=>item.time===stockAgentEvaluation.asOfTime);
      return [{
        time:`${stockAgentEvaluation.asOfTime.slice(0,2)}:${stockAgentEvaluation.asOfTime.slice(2)}`,
        direction:`${stockAgentEvaluation.direction??"双向"}专属候选`,
        price:point?point.price.toFixed(2):"—",
        quantity:"未下单",
        spread:`评分 ${stockAgentEvaluation.score}/100`,
        status:`${stockAgentEvaluation.title}；研究观察版，不生成正式成交`,
        tone:"candidate",
      }];
    }
    if(panel==="历史信号")return [...currentObservations].reverse().map(observation=>{
      const point=minutePoints.find(item=>item.time===observation.time);
      const time=`${observation.time.slice(0,2)}:${observation.time.slice(2)}`;
      const qualified=observation.stage!=="watch";
      return {time,direction:observationConfirmationLabel(observation),price:point?point.price.toFixed(2):"—",quantity:"未下单",spread:`预估 ${observation.edge.toFixed(2)}%`,status:`${observationDirectionNote(observation)}；${qualified?"候选门槛通过":observation.blockers[0]??"尚未达到候选门槛"}`,tone:"candidate"};
    });
    return [...liveEngine.actions].reverse().map(action=>({time:`${action.time.slice(0,2)}:${action.time.slice(2)}`,direction:`${action.direction??"T"}${action.side}`,price:action.price.toFixed(2),quantity:`${action.quantity.toLocaleString("zh-CN")}股`,spread:"引擎模拟",status:action.reason??"正式过滤通过",tone:action.side==="卖出"?"sell":"buy"}));
  },[panel,confirmedCycleRows,stockAgentEvaluation,currentObservations,minutePoints,liveEngine.actions]);
  useEffect(() => {
    const update=()=>setClockNow(new Date());
    update();
    const timer=window.setInterval(update,1_000);
    return()=>window.clearInterval(timer);
  },[]);
  useEffect(() => {
    if (!trainingRunning) return;
    const timer=window.setTimeout(()=>{setTrainingProgress(100);setTrainingRunning(false);},0);
    return()=>window.clearTimeout(timer);
  }, [trainingRunning]);
  useEffect(()=>{
    if(!localAuth||marketSession.tone!=="closed"||trainingRunning||personalStrategyStats.sessions===0)return;
    const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai"}).format(clockNow??new Date());
    const key=`rabbit-research-run:${accountName.toLowerCase()}:${day}`;
    try{if(localStorage.getItem(key)==="completed")return;}catch{}
    const timer=window.setTimeout(()=>{
      setTrainingProgress(0);
      setTrainingRunning(true);
    },0);
    return()=>window.clearTimeout(timer);
  },[localAuth,marketSession.tone,trainingRunning,personalStrategyStats.sessions,clockNow,accountName]);
  useEffect(()=>{
    if(trainingProgress!==100)return;
    const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai"}).format(clockNow??new Date());
    try{localStorage.setItem(`rabbit-research-run:${accountName.toLowerCase()}:${day}`,"completed");}catch{}
  },[trainingProgress,clockNow,accountName]);
  const playAlertTone=(risk=false)=>{
    try{
      const AudioContextClass=window.AudioContext||(window as typeof window & {webkitAudioContext:typeof AudioContext}).webkitAudioContext;
      const context=new AudioContextClass();
      const oscillator=context.createOscillator();const gain=context.createGain();
      oscillator.frequency.value=risk?660:880;gain.gain.value=.05;oscillator.connect(gain);gain.connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+(risk?0.32:0.16));
      oscillator.onended=()=>void context.close();
    }catch{}
  };
  const speakAlert=(text:string,risk=false)=>{
    playAlertTone(risk);
    try{
      if(!("speechSynthesis" in window))return;
      const speech=new SpeechSynthesisUtterance(text);
      speech.lang="zh-CN";speech.rate=1.02;speech.pitch=risk?0.82:1.08;speech.volume=.92;
      window.speechSynthesis.speak(speech);
    }catch{}
  };
  const queueAlert=(alert:TradeAlertToast)=>setAlertQueue(current=>[...current,alert].slice(-8));
  const updateAlertSetting=async (kind:keyof AlertSettings)=>{
    let enabled=!alertSettings[kind];
    if(kind==="system"&&enabled){
      if(!("Notification" in window))enabled=false;
      else enabled=(await Notification.requestPermission())==="granted";
    }
    const next={...alertSettings,[kind]:enabled};setAlertSettings(next);
    try{localStorage.setItem('rabbit-alert-settings',JSON.stringify(next));}catch{}
    if(kind==="sound"&&enabled)playAlertTone(false);
  };
  const previewRabbitAlert=()=>{
    const rabbit=nextPreviewRabbit.current;
    nextPreviewRabbit.current=rabbit==="buy"?"sell":"buy";
    const isBuy=rabbit==="buy";
    const title=`${stock.name} · ${isBuy?"正T买入/买回":"反T卖出"}`;
    const message=isBuy
      ?"价格、VWAP、趋势、量价与风控过滤通过；左兔提醒关注买入/买回。"
      :"价格、VWAP、趋势、量价与风控过滤通过；右兔提醒关注卖出。";
    queueAlert({level:"signal",rabbit,title,message});
    if(alertSettings.sound)speakAlert(`${stock.name}，${isBuy?"买入或买回":"卖出"}提醒`);
  };
  useEffect(()=>{
    if(!alertToast)return;
    const timer=window.setTimeout(()=>setAlertQueue(current=>current.slice(1)),alertToast.level==="risk"?12_000:8_000);
    return()=>window.clearTimeout(timer);
  },[alertToast]);
  useEffect(()=>{
    if(!marketSession.live)return;
    const normalizeRisk=(value:string)=>value.replace(/[+-]?\d+(?:\.\d+)?%?/g,"#").replace(/\s+/g," ").trim();
    for(const [index,item] of stockList.entries()){
      const active=index===activeStock;
      const snapshot=active?(currentTrial??currentMarket??marketSnapshots[item.code]):marketSnapshots[item.code];
      const points=(active?minutePoints:(snapshot?.minutes??[]).filter(point=>isAShareRegularTradingMinute(point.time)));
      if(!points.length)continue;
      const itemPosition=active?effectiveLivePosition:resolveStockPosition(stockPositions,preferences,item.code);
      const replay=active?liveEngine:runSmartTReplay(points,{
        capital:200_000,baseShares:itemPosition.openingShares,sellable:itemPosition.sellable,feeRate:.025,slippage:.02,minCommission:true,slippageMode:"percent",forceCloseTime:"1450",profile,previousClose:snapshot?.quote.previousClose??null,randomValue:0,
      });
      const observations=(replay.observations??[]) as ReplayObservation[];
      const latest=replay.actions.at(-1);
      const latestObservation=selectLatestAlertableObservation(observations) as ReplayObservation|undefined;
      const lastTime=(points.at(-1)?.time??"").replace(/\D/g,"").slice(0,4);
      const agentEvaluation=evaluateStockAgent({code:item.code,minutes:points,previousClose:snapshot?.quote.previousClose??null});
      const formalFresh=Boolean(!agentEvaluation&&latest&&isRecentCausalEvent(lastTime,latest.time,3));
      const riskMessage=active&&autoDecision.status==="locked"
        ? autoDecision.reason
        : eventsByCode[item.code]?.gate.hardLock
          ? `事件雷达：${eventsByCode[item.code].gate.label}，${eventsByCode[item.code].gate.reason}。`
          : "";
      const riskSignature=riskMessage?normalizeRisk(riskMessage):"";
      const isRisk=!formalFresh&&Boolean(riskMessage)&&riskAlertEpisodes.current[item.code]!==riskSignature;
      if(!riskMessage)delete riskAlertEpisodes.current[item.code];
      else if(isRisk)riskAlertEpisodes.current[item.code]=riskSignature;
      const candidateFresh=Boolean(latestObservation&&isRecentCausalEvent(lastTime,latestObservation.time,2));
      const agentCandidateFresh=Boolean(agentEvaluation?.status==="candidate"&&agentEvaluation.asOfTime&&isRecentCausalEvent(lastTime,agentEvaluation.asOfTime,2));
      const isCandidate=!isRisk&&!formalFresh&&(agentEvaluation?agentCandidateFresh:Boolean(candidateFresh&&latestObservation&&!latestObservation.executable));
      if(!isRisk&&!formalFresh&&!isCandidate)continue;
      const key=isRisk?`${item.code}:risk:${riskSignature}`:formalFresh?`${item.code}:${latest!.time}:${latest!.side}`:agentEvaluation?`${item.code}:agent:${agentEvaluation.asOfTime}:${agentEvaluation.direction}`:`${item.code}:candidate:${latestObservation!.time}:${latestObservation!.direction}`;
      const eventDate=snapshot?.sampleDate??clockNow?.toLocaleDateString("sv-SE")??"unknown-date";
      const persistedKey=`rabbit-alerted:${accountName.toLowerCase()}:${eventDate}:${key}`;
      let alreadyAlerted=!isRisk&&alertedEventKeys.current.has(persistedKey);
      try{alreadyAlerted=alreadyAlerted||(!isRisk&&localStorage.getItem(persistedKey)==="1");}catch{}
      if(alreadyAlerted)continue;
      if(!isRisk){alertedEventKeys.current.add(persistedKey);try{localStorage.setItem(persistedKey,"1");}catch{}}
      const rabbit=isRisk?"both":formalFresh?(latest!.side.includes("卖")?"sell":"buy"):((agentEvaluation?.direction??latestObservation!.direction)==="反T"?"sell":"buy");
      const title=isRisk?`${item.name} 风险锁定`:formalFresh?`${item.name} ${latest!.direction}${latest!.side}`:agentEvaluation?`${item.name} · ${agentEvaluation.title}`:`${item.name} ${latestObservation!.direction}候选观察`;
      const message=isRisk?riskMessage:formalFresh?(latest!.reason??`正式执行信号已通过趋势、量价、成本与风控过滤`):agentEvaluation?`${agentEvaluation.reasons[0]}；紫金专属研究观察，不是买卖指令。`:`${latestObservation!.reason}；${latestObservation!.blockers.join("；")||"等待正式过滤确认"}`;
      queueAlert({level:isRisk?"risk":formalFresh?"signal":"candidate",rabbit,title,message});
      const candidateSpeech=agentEvaluation
        ? `${item.name}，${agentEvaluation.direction??"做T"}专属候选观察，不是买卖指令`
        : isVwapDisplacementObservation(latestObservation)
        ? `${item.name}，价格${latestObservation!.direction==="正T"?"低位":"高位"}偏离均价线，请观察确认，不是买卖指令`
        : `${item.name}，${latestObservation?.direction??"做T"}候选观察，不是买卖指令`;
      if(alertSettings.sound)speakAlert(isRisk?`${item.name}，风险锁定，暂停做T`:formalFresh?`${item.name}，${latest!.direction}${latest!.side}提醒`:candidateSpeech,isRisk);
      if(alertSettings.system&&"Notification" in window&&Notification.permission==="granted")new Notification(`双兔助手 · ${title}`,{body:message,tag:key,requireInteraction:isRisk});
    }
  },[autoDecision.status,autoDecision.reason,liveEngine,minutePoints,marketSession.live,stockList,activeStock,currentTrial,currentMarket,marketSnapshots,effectiveLivePosition,stockPositions,preferences,profile,eventsByCode,alertSettings,clockNow,accountName]);
  useEffect(()=>{
    if(!localAuth||demoMode)return;
    let cancelled=false;
    const pull=async()=>{
      try{
        const response=await fetch(`/api/control/alerts?afterId=${serverAlertCursor.current}&limit=30`,{credentials:'include',cache:'no-store'});
        if(!response.ok)return;
        const payload=await response.json();
        const alerts=Array.isArray(payload.alerts)?payload.alerts:[];
        if(alerts.length)serverAlertCursor.current=Math.max(serverAlertCursor.current,...alerts.map((item:{id:number})=>Number(item.id)||0));
        if(cancelled)return;
        const recent=alerts.filter((item:{createdAt:string})=>Date.now()-new Date(item.createdAt).getTime()<5*60_000).reverse();
        for(const item of recent){
          const action=item.payload?.action;const observation=item.payload?.observation;
          const sell=String(action?.side??observation?.direction??item.title).includes('卖')||String(observation?.direction??'').includes('反T');
          const level=item.level==='formal'?'signal':'candidate';
          queueAlert({level,rabbit:sell?'sell':'buy',title:item.title,message:item.message});
          if(serverAlertsInitialized.current&&item.level!=='watch'&&alertSettings.sound)speakAlert(`${item.title}，${item.level==='formal'?'正式信号':'候选观察'}`);
          if(serverAlertsInitialized.current&&item.level!=='watch'&&alertSettings.system&&'Notification' in window&&Notification.permission==='granted')new Notification(`双兔助手 · ${item.title}`,{body:item.message,tag:`server-${item.id}`});
          void fetch(`/api/control/alerts/${item.id}/ack`,{method:'POST',credentials:'include'}).catch(()=>{});
        }
        serverAlertsInitialized.current=true;
      }catch{}
    };
    void pull();const timer=window.setInterval(()=>void pull(),5000);
    return()=>{cancelled=true;window.clearInterval(timer)};
  },[localAuth,demoMode,alertSettings.sound,alertSettings.system]);
  useEffect(() => {
    const timer = window.setTimeout(() => {void (async()=>{
      try {
        const response=await fetch('/api/control/auth/session',{credentials:'include',cache:'no-store'});
        if(response.ok){
          const payload=await response.json();
          const session=payload.user?.displayName||payload.user?.username;
          if(session){setLocalAuth(true);setAccountName(session);setAccountRole(payload.user?.role||'member');localStorage.setItem('rabbit-account-role',payload.user?.role||'member')}
        }
      } catch {}
      setAuthReady(true);
    })()}, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(()=>{
    if(!localAuth||demoMode||!accountName)return;
    let cancelled=false;
    void (async()=>{
      try{
        const [profileResponse,monitorResponse]=await Promise.all([
          fetch('/api/control/profile',{credentials:'include',cache:'no-store'}),
          fetch('/api/control/monitors',{credentials:'include',cache:'no-store'}),
        ]);
        if(cancelled)return;
        if(profileResponse.ok){
          const remote=await profileResponse.json();
          const data=remote.data??{};
          if(data.preferences){setPreferences(data.preferences);setHasPersistedPreferences(true);localStorage.setItem(`rabbit-prefs:${accountName.toLowerCase()}`,JSON.stringify(data.preferences))}
          if(data.alertSettings)setAlertSettings(current=>({...current,...data.alertSettings}));
          if(data.customStrategy)setCustomStrategy(data.customStrategy);
        }
        if(monitorResponse.ok){
          const remote=await monitorResponse.json();
          if(Array.isArray(remote.monitors)&&remote.monitors.length){
            const list=prepareWatchlistForCurrentEntry(remote.monitors.map((item:{code:string;name:string})=>({code:item.code,name:item.name,price:'--',change:'0.00%'})));
            const positions=Object.fromEntries(remote.monitors.map((item:{code:string;position:StockPosition})=>[item.code,normalizeStockPosition(item.position??{},item.code)]));
            setStockList(list);setStockPositions(positions);
            localStorage.setItem(`rabbit-watchlist:${accountName.toLowerCase()}`,JSON.stringify(list));
            for(const item of remote.monitors)saveStockPosition(localStorage,accountName,normalizeStockPosition(item.position??{},item.code));
          }
        }
      }catch{}finally{if(!cancelled){remoteSyncReady.current=true;setRemoteSyncEpoch(value=>value+1)}}
    })();
    return()=>{cancelled=true};
  },[localAuth,demoMode,accountName]);
  useEffect(()=>{
    if(!remoteSyncReady.current||!localAuth||demoMode||!accountName||!stockList.length)return;
    const timer=window.setTimeout(()=>{void Promise.all([
      fetch('/api/control/profile',{method:'PUT',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({data:{preferences,alertSettings,customStrategy}})}),
      fetch('/api/control/monitors',{method:'PUT',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({monitors:stockList.map(item=>({code:item.code,name:item.name,enabled:true,profile,position:stockPositions[item.code]??{}}))})}),
    ]).catch(()=>{})},800);
    return()=>window.clearTimeout(timer);
  },[localAuth,demoMode,accountName,stockList,stockPositions,preferences,alertSettings,customStrategy,profile,remoteSyncEpoch]);
  useEffect(() => {
    if (!localAuth || demoMode || !accountName || !stockList.length) return;
    const loaded:StockPositionMap=Object.fromEntries(stockList.map(item=>{
      const position=loadStockPosition(window.localStorage,accountName,item.code,preferences,hasPersistedPreferences);
      const persisted=position.updatedAt?position:saveStockPosition(window.localStorage,accountName,position);
      return [item.code,persisted];
    }));
    const timer=window.setTimeout(()=>{setStockPositions(loaded);if(Object.values(loaded).some(position=>position.needsConfirmation))setOnboardingOpen(true)},0);
    return()=>window.clearTimeout(timer);
  },[localAuth,demoMode,accountName,stockList,preferences.stock,preferences.baseShares,hasPersistedPreferences]);
  useEffect(()=>{
    if(!ledgerStorageKey||!stock?.code||tradingDate==="1970-01-01")return;
    const timer=window.setTimeout(()=>{
      try{
        const saved=localStorage.getItem(ledgerStorageKey);
        const parsed=saved?JSON.parse(saved):[];
        setTradeLedgerState({key:ledgerStorageKey,rows:normalizeTradeLedgerRows(parsed,tradingDate)});
      }catch{
        setTradeLedgerState({key:ledgerStorageKey,rows:[]});
      }
    },0);
    return()=>window.clearTimeout(timer);
  },[ledgerStorageKey,tradingDate,stock?.code]);
  useEffect(()=>{
    const timer=window.setTimeout(()=>setCycleStage('ready'),0);
    return()=>window.clearTimeout(timer);
  },[stock?.code]);
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
    if (!localAuth || !stock?.code) return;
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const change=currentMarket?.quote.changePercent;
        const query=change==null?"":`&change=${encodeURIComponent(change.toFixed(4))}`;
        const response=await fetch(`/api/market-context?code=${encodeURIComponent(stock.code)}${query}`,{cache:"no-store"});
        if(!response.ok) throw new Error("context unavailable");
        const data=await response.json() as MarketContext;
        if(!cancelled){setMarketContext(data);setMarketContextError("")}
      } catch {
        if(!cancelled){setMarketContext(null);setMarketContextError("外部环境行情暂不可用，已自动降为个股保守模式。");}
      } finally { inFlight=false; }
    };
    void load();
    const timer=window.setInterval(()=>void load(),15_000);
    return()=>{cancelled=true;window.clearInterval(timer)};
  },[localAuth,stock?.code,currentMarket?.quote.changePercent]);
  useEffect(() => {
    if (!localAuth || !stockList.length) return;
    let cancelled = false;
    let inFlight=false;
    const load=async()=>{
      if(inFlight)return;
      inFlight=true;
      try{
        const results=await Promise.allSettled(stockList.map(async item=>{
          const response=await fetch(`/api/market-data?code=${encodeURIComponent(item.code)}&mode=trial-realtime`,{cache:"no-store"});
          if(!response.ok)throw new Error("quote unavailable");
          return await response.json() as MarketData;
        }));
        const snapshots=fulfilledWatchlistSnapshots(results) as MarketData[];
        if(!cancelled&&snapshots.length){
          setMarketQuotes(current=>({...current,...Object.fromEntries(snapshots.map(snapshot=>[snapshot.quote.code,snapshot.quote]))}));
          setMarketSnapshots(current=>({...current,...Object.fromEntries(snapshots.map(snapshot=>[snapshot.quote.code,snapshot]))}));
        }
      }catch{}finally{inFlight=false;}
    };
    void load();
    // Inactive tabs remain monitored. Five seconds is sufficient for the
    // one-minute signal engine while avoiding ten simultaneous one-second feeds.
    const timer=window.setInterval(()=>void load(),5_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [localAuth, stockList]);
  useEffect(() => {
    if (!localAuth || !stockList.length) return;
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const params = new URLSearchParams({
          codes: stockList.slice(0,10).map(item => item.code).join(","),
          names: stockList.slice(0,10).map(item => item.name).join(","),
        });
        const response = await fetch(`/api/event-radar?${params.toString()}`, { cache:"no-store" });
        if (!response.ok) throw new Error("event radar unavailable");
        const data = await response.json() as EventRadarResponse;
        if (!cancelled) { setEventRadar(data); setEventRadarError(""); }
      } catch {
        if (!cancelled) {
          setEventRadar(null);
          setEventRadarError("事件雷达暂不可用；不使用旧消息改变当前信号。");
        }
      } finally { inFlight = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), marketSession.live ? 60_000 : 180_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [localAuth, stockList, marketSession.live]);
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
    const timer = window.setInterval(() => void load(), marketSession.live ? 1_000 : 30_000);
    const onVisibility=()=>{if(document.visibilityState==="visible")void load()};
    document.addEventListener("visibilitychange",onVisibility);
    return () => { cancelled = true; window.clearInterval(timer);document.removeEventListener("visibilitychange",onVisibility); };
  }, [localAuth, stock?.code, marketSession.live]);
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
  const openZijinExperiment = () => {
    const prepared=ensureZijinExperimentStock(stockList);
    const zijinIndex=prepared.findIndex(item=>item.code==='601899');
    setStockList(prepared);
    setActiveStock(Math.max(0,zijinIndex));
    setActiveView('单股智研');
    if(typeof window!=='undefined'){
      const url=new URL(window.location.href);
      url.searchParams.set('view','zijin-lab');
      window.history.replaceState({},'',`${url.pathname}?${url.searchParams.toString()}${url.hash}`);
    }
  };
  const saveTradeLedgerRows=(next:TradeLedgerRow[])=>{
    if(!ledgerStorageKey)return;
    const normalized=normalizeTradeLedgerRows(next,tradingDate);
    setTradeLedgerState({key:ledgerStorageKey,rows:normalized});
    try{localStorage.setItem(ledgerStorageKey,JSON.stringify(normalized));}catch{}
  };

  if(!authReady) return <main className="auth-loading"><img src="/rabbit-logo-compact.png" alt="双兔助手 做T神器"/></main>;
  if(!localAuth){
    const enterDemo=()=>{setDemoMode(true);setAccountName('演示访客');setStockPositions({});setPreferences(DEFAULT_PREFERENCES);setHasPersistedPreferences(false);const prepared=prepareWatchlistForCurrentEntry(initialStocks);setStockList(prepared);setActiveStock(isZijinExperimentDeepLink()?prepared.findIndex(item=>item.code==='601899'):0);setActiveView(isZijinExperimentDeepLink()?'单股智研':'首页');setLocalAuth(true)};
    if(authScreen==='landing')return <PublicLanding onDemo={enterDemo} onAccount={()=>setAuthScreen('account')}/>;
    return <AuthView onBack={()=>setAuthScreen('landing')} onDemo={enterDemo} onAuthenticated={(name,isNew,remember)=>{setDemoMode(false);setAccountName(name);setAccountRole(localStorage.getItem('rabbit-account-role')||'member');remoteSyncReady.current=false;setStockPositions({});setPreferences(DEFAULT_PREFERENCES);setHasPersistedPreferences(false);const prepared=prepareWatchlistForCurrentEntry(initialStocks);setStockList(prepared);setActiveStock(isZijinExperimentDeepLink()?prepared.findIndex(item=>item.code==='601899'):0);setActiveView(isZijinExperimentDeepLink()?'单股智研':'首页');setLocalAuth(true);try{const persistent=isNew||remember;(persistent?localStorage:sessionStorage).setItem('rabbit-auth-session',name);(persistent?sessionStorage:localStorage).removeItem('rabbit-auth-session');const saved=localStorage.getItem(`rabbit-prefs:${name.toLowerCase()}`);if(saved){setPreferences(JSON.parse(saved));setHasPersistedPreferences(true)}else setOnboardingOpen(true);const watchlist=localStorage.getItem(`rabbit-watchlist:${name.toLowerCase()}`);if(watchlist){const list=JSON.parse(watchlist);if(Array.isArray(list)&&list.length){const normalized=prepareWatchlistForCurrentEntry(list);setStockList(normalized);localStorage.setItem(`rabbit-watchlist:${name.toLowerCase()}`,JSON.stringify(normalized));}}const savedStrategy=localStorage.getItem(`rabbit-custom-strategy:${name.toLowerCase()}`)||localStorage.getItem('rabbit-custom-strategy');if(savedStrategy)setCustomStrategy(savedStrategy)}catch{} if(isNew)setOnboardingOpen(true)}}/>;
  }

  return (
    <main className={`app-shell session-${marketSession.tone}`}>
      <header className="topbar">
        <div className="brand brand-lockup" aria-label="双兔助手 做T神器 Rabbit Smart-T">
          <span className="brand-emblem"><img className="rabbit-logo" src="/rabbit-logo-compact.png" alt="双兔助手双兔黑金品牌标志"/><i /></span>
          <span className="brand-type"><strong aria-hidden="true"><span>双兔助手</span></strong><small>做<span className="brand-ascii-t">T</span>神器 · SMART-T</small></span>
        </div>
        <nav className="main-nav" aria-label="主导航">
          {['首页','操盘台','单股智研','多股监控','策略市场','持仓对账','模拟回测','智能训练'].map((item) => <button onClick={() => setActiveView(item)} className={activeView === item ? 'active' : ''} key={item}>{item}</button>)}
        </nav>
        <div className="top-actions">
          <span className={`market-open ${marketSession.tone}`} title={`${marketSession.label}：${marketSession.detail}；法定节假日以交易所公告为准`} aria-label={`${marketSession.label}：${marketSession.detail}`}><i /><span className="market-open-label">{marketSession.live?"监控中":marketSession.label}</span></span>
          <span className={`auto-off ${marketSession.live?"running":"paused"}`}><i />{marketSession.live?"自动判断运行中":"自动判断已暂停"} · 下单未连接</span>
          <span className="clock">{currentTrial ? new Date(currentTrial.sourceTimestamp || currentTrial.fetchedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : currentMarket ? new Date(currentMarket.fetchedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "--:--"}</span>
          <button className="profile-cycle" onClick={()=>setStrategyOpen(true)} aria-label={`Smart-T V4 当前使用${profile}，点击查看策略档位`} title="操盘台与模拟回测共用此档位"><span>V4 · {profile.replace('档','')}</span><i>⌄</i></button>
          <button className="strategy-help" onClick={()=>setStrategyOpen(true)}>策略说明</button>
          <button className="account-button" onClick={()=>setAccountOpen(true)} aria-label="打开账户中心"><span>{accountName.slice(0,1).toUpperCase()}</span><b>{accountName}</b><i>⌄</i></button>
          <button className="icon-button" onClick={()=>setOnboardingOpen(true)} aria-label="打开账户与监控设置" title="账户与监控设置">⚙</button>
        </div>
      </header>
      {demoMode&&<div className="demo-ribbon" role="status"><b>免注册演示</b><span>当前为本机临时体验，不代表正式账户；下单接口关闭，演示操作不会同步到其他设备。</span><button onClick={()=>{setDemoMode(false);setLocalAuth(false);setAuthScreen('account')}}>创建测试账户</button></div>}

      {activeView === "首页" ? <HomeView onNavigate={setActiveView} onOpenZijin={openZijinExperiment} stockCount={stockList.length} /> : activeView === "操盘台" ? <>
      <section className="ticker" aria-label="股票监控列表">
        {stockList.map((item, index) => (
          <div className={`ticker-item ${activeStock === index ? 'selected' : ''}`} key={item.code}>{(()=>{const quote=marketQuotes[item.code];const radar=eventsByCode[item.code];const change=quote?.changePercent == null ? item.change : `${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%`;const eventTag=radar?.counts.negative?<small className="ticker-event negative">利空 {radar.counts.negative}</small>:radar?.counts.positive?<small className="ticker-event positive">利好 {radar.counts.positive}</small>:radar?<small className="ticker-event quiet">暂无新增</small>:eventRadarError?<small className="ticker-event pending">雷达待更新</small>:<small className="ticker-event pending">扫描中</small>;return <><button onClick={() => setActiveStock(index)}><span>{item.code} {quote?.name || item.name}</span><b>{quote?.price?.toFixed(2) ?? item.price}</b><em className={change.startsWith('-') ? 'down' : ''}>{change}</em>{eventTag}</button><button className="ticker-remove" onClick={()=>removeStock(index)} disabled={stockList.length<=1} aria-label={`删除${item.name}`}>×</button></>})()}</div>
        ))}
        <button className="ticker-add" onClick={()=>setOnboardingOpen(true)}>＋ 管理监控</button>
      </section>

      <div className={`session-ribbon ${marketSession.tone}`} role="status" aria-live="polite">
        <span><i />{marketSession.live ? "实时监控模式" : marketSession.tone === "closed" ? "收盘复盘模式" : marketSession.tone === "postclose" ? "盘后交易模式" : marketSession.tone === "paused" ? "午间休市模式" : "开盘前模式"}</span>
        <strong>{marketSession.label}</strong>
        <small>{marketSession.detail}</small>
      </div>

      <section className="stock-head">
        <div className="stock-identity">
          <span className="stock-code">{stock.code}</span><h1>{activeQuote?.name || stock.name}</h1><button className="star" onClick={toggleStar} aria-label={starred ? "取消收藏当前股票" : "收藏当前股票"} aria-pressed={starred}>{starred ? "★" : "☆"}</button>
        </div>
        <div className={`quote ${activeQuote?.changePercent != null && activeQuote.changePercent < 0 ? "down" : activeQuote?.changePercent === 0 ? "flat" : ""}`}><strong>{activeQuote?.price?.toFixed(2) ?? "--"}</strong><span>{activeQuote?.changePercent == null ? "--" : `${activeQuote.changePercent >= 0 ? "+" : ""}${activeQuote.changePercent.toFixed(2)}%`}</span></div>
        <div className="quote-metrics">
          <span>今开 <b>{activeQuote?.open?.toFixed(2) ?? "--"}</b></span><span>最高 <b>{activeQuote?.high?.toFixed(2) ?? "--"}</b></span><span>最低 <b>{activeQuote?.low?.toFixed(2) ?? "--"}</b></span><span>数据 <b className="teal">{currentTrial ? "1 秒试用" : currentMarket ? "公开延迟" : "切换中"}</b></span><span>分钟线 <b className="teal">{minutePoints.length ? `${minutePoints.length} 点同步` : "等待数据"}</b></span>{afterHoursSummary&&<span>盘后 <b className="amber">{afterHoursSummary.price.toFixed(2)}</b></span>}
        </div>
        <div className="opening-assessment"><span>开盘状态</span><b>{openingAssessment.auction}</b><small>{openingAssessment.gapText} · {openingAssessment.confirmation}</small></div>
      </section>

      <section className="workspace">
        <div className="chart-zone">
          <div className="chart-tools">
            <div className="legend"><span><i className="coral-line"/>最新价 <b>{activeQuote?.price?.toFixed(2) ?? "--"}</b></span>{indicatorsVisible&&<span><i className="teal-line"/>均线参考</span>}<span className="causal-marker-legend"><i/>提醒按确认分钟实时落点 · 不回填峰谷</span></div>
            <span className={`live-scan ${marketSession.live?"":"paused"}`}><i/>{marketSession.live?(currentTrial ? `1 秒轮询试用 · ${currentTrial.provider}` : trialError || (currentMarket ? `公开行情 · ${currentMarket.delayed ? "延迟数据" : "已更新"}` : marketError || "连接行情中")):marketSession.detail}</span>
            <div className="intraday-only" title="操盘台当前仅使用当日 1 分钟分时数据">
              <i/>当日分时 <small>1分钟</small>
            </div>
            <button className="tool-button" onClick={()=>setIndicatorsVisible(value=>!value)} aria-pressed={indicatorsVisible}>{indicatorsVisible ? "隐藏指标" : "显示指标"}</button><button className="tool-button" onClick={()=>void document.documentElement.requestFullscreen?.().catch(()=>{})}>全屏</button>
          </div>
          <div className="chart-wrap">
            <div className="y-axis">{chartModel ? chartModel.ticks.map(value=><span key={value}>{value.toFixed(2)}</span>) : [0,1,2,3,4].map(value=><span key={value}>--</span>)}</div>
            <svg viewBox="0 0 920 300" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${activeQuote?.name || stock.name}当日分时图`}>
              <defs><linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff655f" stopOpacity=".18"/><stop offset="1" stopColor="#ff655f" stopOpacity="0"/></linearGradient></defs>
              {[50,100,150,200,250].map(y => <line key={y} x1="0" y1={y} x2="920" y2={y} className="grid-line"/>)}
              {A_SHARE_INTRADAY_AXIS.map(tick => {const x=intradaySlotX(tick.slot);return <line key={tick.label} x1={x} y1="0" x2={x} y2="300" className="grid-line vertical"/>})}
              {chartModel&&<><path d={`${chartModel.path} L${chartModel.lastX} 252 L${chartModel.firstX} 252 Z`} fill="url(#priceFill)" />
              {indicatorsVisible&&<path d={chartModel.vwapPath} className="vwap-path"/>}<path d={chartModel.path} className="price-path"/>
              {intradayMarkerLayout.observations.map(marker=><g key={`candidate-${marker.observation.time}-${marker.index}`} className={`candidate-signal-marker ${marker.qualified?marker.sideClass:"watch"} ${marker.assessment}`}><line x1={marker.x} y1={marker.y} x2={marker.labelX} y2={marker.labelY<marker.y?marker.labelY+5:marker.labelY-12} className="marker-label-leader"/><circle cx={marker.x} cy={marker.y} r={marker.qualified?5:4}/><rect x={marker.labelX-marker.labelWidth/2} y={marker.labelY-11} width={marker.labelWidth} height="16" rx="4"/><text x={marker.labelX} y={marker.labelY} textAnchor="middle">{marker.currentLabel}</text></g>)}
              {intradayMarkerLayout.actions.map(marker=><g className={`live-signal-marker ${marker.isSell?'sell':'buy'}`} key={`${marker.action.time}-${marker.action.side}-${marker.index}`}><line x1={marker.x} y1={marker.y} x2={marker.labelX} y2={marker.labelY<marker.y?marker.labelY+6:marker.labelY-13} className="marker-label-leader"/><circle cx={marker.x} cy={marker.y} r="6" className={marker.isSell?'sell':'buy'}/><rect x={marker.labelX-marker.labelWidth/2} y={marker.labelY-12} width={marker.labelWidth} height="18" rx="4"/><text x={marker.labelX} y={marker.labelY} textAnchor="middle" className={marker.isSell?'sell':'buy'}>{marker.label}</text></g>)}
              <line x1="0" y1={20+(chartModel.max-chartModel.last.price)/(chartModel.max-chartModel.min||Math.max(chartModel.max*.002,.01))*210} x2="920" y2={20+(chartModel.max-chartModel.last.price)/(chartModel.max-chartModel.min||Math.max(chartModel.max*.002,.01))*210} className="last-line"/><circle cx={chartModel.lastX} cy={20+(chartModel.max-chartModel.last.price)/(chartModel.max-chartModel.min||Math.max(chartModel.max*.002,.01))*210} r="4" className="last-dot"/></>}
              <line x1="0" y1="252" x2="920" y2="252" className="volume-divider"/>
              {chartModel?.volumes.map((bar,index)=><rect key={index} x={bar.x-1.35} y={300-bar.height} width="2.7" height={bar.height} rx=".45" className={bar.up?'volume':'volume red'}/>) }
            </svg>
            <div className="price-flag">{chartModel?.last.price.toFixed(2) ?? '--'}</div>
            <div className="x-axis">{A_SHARE_INTRADAY_AXIS.map(tick=><span key={tick.label} style={{left:`${intradaySlotX(tick.slot)/9.2}%`}}>{tick.label}</span>)}</div>
          </div>
          {afterHoursSummary&&<div className="after-hours-strip" role="status" aria-label="盘后固定价格交易数据">
            <span><i/>盘后固定价</span><b>15:05–15:30</b><strong>¥{afterHoursSummary.price.toFixed(2)}</strong>
            <small>{afterHoursSummary.points} 个成交点 · 成交量 {afterHoursSummary.totalVolume.toLocaleString("zh-CN")} · 仅展示，不触发做 T 信号</small>
          </div>}
          <div className="signal-tape">
            <span className="tape-title">信号证据</span>
            <span><i className={openingAssessment.session==="低开"||openingAssessment.session==="高开"?"ok":"wait"}>{openingAssessment.session==="低开"||openingAssessment.session==="高开"?"✓":"·"}</i>{openingAssessment.gapText}</span>
            <span><i className={decisionModel.referenceConfirmed?"ok":"wait"}>{decisionModel.referenceConfirmed?"✓":"·"}</i>开盘价 + VWAP</span>
            <span><i className={decisionModel.trendConfirmed?"ok":"wait"}>{decisionModel.trendConfirmed?"✓":"·"}</i>连续走势确认</span>
            <span><i className={decisionModel.inDecisionWindow?"ok":"wait"}>{decisionModel.inDecisionWindow?"✓":"·"}</i>{decisionModel.lastTime||"--:--"} 时间门控</span>
          </div>
        </div>

        <aside className="decision-zone">
          {alertToast&&<div className={`trade-alert-toast ${alertToast.level} rabbit-${alertToast.rabbit}`} role="alert"><span className={`rabbit-speaker ${alertToast.rabbit}`} aria-hidden="true"/><div className="rabbit-speech"><small>{alertToast.level==="candidate"?`${alertToast.rabbit==="buy"?"左兔":"右兔"} · 候选观察`:alertToast.rabbit==="buy"?"左兔 · 买入/买回提醒":alertToast.rabbit==="sell"?"右兔 · 卖出提醒":"双兔 · 风控提醒"}</small><b>{alertToast.title}</b><span>{alertToast.message}</span></div>{alertQueue.length>1&&<em className="alert-queue-count">+{alertQueue.length-1}</em>}<button onClick={()=>setAlertQueue(current=>current.slice(1))} aria-label="关闭提醒">×</button></div>}
          <div className="signal-funnel" aria-label="候选观察与正式执行信号">
            <div className="signal-layer candidate"><span>本股实时观察</span><b>{stockAgentEvaluation?Number(stockAgentEvaluation.status==="candidate"):signalFunnel.currentObservations}<small> 个</small></b><em>{stockAgentEvaluation?`${stockAgent.name} · ${stockAgentEvaluation.title}`:`正式候选 ${signalFunnel.currentCandidates} · 全自选观察 ${signalFunnel.observations}`}</em></div>
            <i>→</i>
            <div className="signal-layer formal"><span>本股正式闭环</span><b>{stockAgent.canExecute?signalFunnel.currentFormal:0}<small> 个</small></b><em>{stockAgent.canExecute?`全部自选 ${signalFunnel.formal} · V4 过滤后保留`:"研究观察版 · 尚未开放正式执行"}</em></div>
          </div>
          <div className="signal-funnel-note"><span>{stockAgentEvaluation?(stockAgentEvaluation.asOfTime?`专属评估 ${stockAgentEvaluation.asOfTime.slice(0,2)}:${stockAgentEvaluation.asOfTime.slice(2)} · ${stockAgentEvaluation.direction??"等待方向"}`:"紫金智能体等待真实分钟数据"):(signalFunnel.currentLatest?`本股最新观察 ${signalFunnel.currentLatest.time.slice(0,2)}:${signalFunnel.currentLatest.time.slice(2)} · ${signalFunnel.currentLatest.direction}`:"本股当前尚无实时观察")}</span><em>{stockAgentEvaluation?"601899 自动切换专属智能体；离开该股票自动恢复 V4。":"均价线大偏离先预警；趋势、量价、成本和风控全部通过后才进入正式层"}</em></div>
          {stockAgentEvaluation&&<div className={`zijin-opening-card stock-agent-card ${stockAgentEvaluation.status}`}>
            <div><span>已自动调用 · {stockAgent.name}</span><b>{stockAgentEvaluation.title}</b><em>{stockAgentEvaluation.asOfTime?`${stockAgentEvaluation.asOfTime.slice(0,2)}:${stockAgentEvaluation.asOfTime.slice(2)}`:"--:--"} · {stockAgentEvaluation.score}/100</em></div>
            <p>{stockAgentEvaluation.reasons[0]}</p>
            <small>{stockAgentEvaluation.phase==="opening"?"早盘专属层":"全天因子层"} · 振幅 {stockAgentEvaluation.metrics.rangePct.toFixed(2)}% · 距VWAP {stockAgentEvaluation.metrics.vwapBiasPct>=0?"+":""}{stockAgentEvaluation.metrics.vwapBiasPct.toFixed(2)}% · 量比 {stockAgentEvaluation.metrics.volumeRatio==null?"待数据":`${stockAgentEvaluation.metrics.volumeRatio.toFixed(2)}×`}</small>
            <i>{stockAgent.badge} · 与 V4 隔离 · 只给候选和解释，不生成正式成交</i>
          </div>}
          <div className="alert-channel"><div><span>全自选股双兔提醒</span><small>均价线大偏离、正式候选、正式买卖点与新风险全股提醒；同一点只提醒一次</small></div><div className="alert-channel-actions"><button onClick={previewRabbitAlert}>预览</button><button className={alertSettings.sound?"active":""} onClick={()=>void updateAlertSetting("sound")} aria-pressed={alertSettings.sound}>语音 {alertSettings.sound?"已开":"关闭"}</button><button className={alertSettings.system?"active":""} onClick={()=>void updateAlertSetting("system")} aria-pressed={alertSettings.system}>通知 {alertSettings.system?"已开":"关闭"}</button></div></div>
          <div className={`auto-direction ${decisionModel.status}`}><div><span>{stockAgent.canExecute?"自动方向":"专属研究方向"}</span><b>{decisionModel.status==="locked"?"风控锁定":decisionModel.mode??"等待确认"}</b></div><small>{decisionModel.reason}</small><em>{decisionModel.confirmed}/4</em></div>
          <div className="decision-label"><span>{stockAgent.name}</span><em>{stockAgent.canExecute?(decisionModel.status==="ready"?"信号已确认":decisionModel.status==="locked"?"禁止开T":"1秒监控中"):stockAgent.badge}</em></div>
          <div className={`stock-state ${stockState.level}`}>
            <div><span>股票状态识别器</span><b>{stockState.label}</b></div><strong>{stockState.score}<small>/100</small></strong>
            <p>{stockState.summary}</p><ul>{stockState.details.map(detail=><li key={detail}>{detail}</li>)}</ul><em>{stockState.action}</em>
          </div>
          <div className={`context-radar ${currentContext?.gate.level ?? "loading"} event-${currentEvents?.gate.level ?? "loading"}`}>
            <div className="context-radar-head"><span>全市场风险雷达 · {currentContext?.profile ?? "加载中"}</span><b>{Math.max(currentContext?.gate.score ?? 0,currentEvents?.gate.score ?? 0)||"--"}<small>/100</small></b></div>
            <p><i/>{currentContext?.gate.label ?? "正在获取指数、行业与关联品种"}</p>
            <strong>{(currentContext?.gate.action ?? marketContextError) || "15 秒级异步风控，不阻塞 1 秒个股监控"}</strong>
            {Boolean(currentContext?.items.length)&&<div className="context-radar-grid">{currentContext!.items.slice(0,6).map(item=><span key={item.id}><small>{item.label}</small><b className={(item.changePercent??0)>0?"up":(item.changePercent??0)<0?"down":""}>{item.changePercent==null?"--":`${item.changePercent>0?"+":""}${item.changePercent.toFixed(2)}%`}</b></span>)}</div>}
            <div className="event-radar-summary"><span>事件雷达 · {eventRadar?.scanned ?? 0}/{Math.min(stockList.length,10)} 股</span><b className={currentEvents?.gate.level ?? "loading"}>{currentEvents?.gate.label ?? "正在扫描公告与公开资讯"}</b><small>{currentEvents?.gate.action ?? (eventRadarError || "盘中每 60 秒更新；来源发布时间可能存在延迟")}</small></div>
            {Boolean(currentEvents?.items.length)&&<div className="event-radar-list">{currentEvents!.items.slice(0,3).map(item=><a href={item.url} target="_blank" rel="noreferrer" key={item.id} className={item.sentiment}><i>{item.sentiment==="negative"?"利空":item.sentiment==="positive"?"利好":"中性"}</i><span><b>{item.title}</b><small>{item.relatedCount&&item.relatedCount>1?`合并 ${item.relatedCount} 个来源 · `:""}{item.source} · {new Date(item.publishedAt).toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})} · {item.reason}</small></span></a>)}</div>}
            <div className="context-radar-foot"><span>{currentContext?.gate.reasons.join(" · ") || "公开行情仅供人工研判"}</span><em>{eventRadar?.sources.join(" + ") || eventRadarError || "多源事件扫描加载中"}</em></div>
          </div>
          <div className="opening-causal"><span>09:30 起实时扫描</span><b>仅使用已出现数据 · 无需手动切换</b><small>最早 09:33 显示候选，09:36–09:44 经连续走势与 VWAP 确认后才允许小仓正式信号；09:45 后恢复完整过滤。</small></div>
          <h2>{signalMode === '反T' ? openingAssessment.negativeTitle : openingAssessment.positiveTitle}</h2>
          <p className="decision-copy">{signalMode === '反T' ? openingAssessment.negativeCopy : openingAssessment.positiveCopy}</p>
          <button disabled={!stockAgent.canExecute||cycleQuantity<100||(cycleStage==='ready'&&decisionModel.status!=="ready")} className={`primary-action ${cycleStage !== 'ready' ? 'confirmed' : ''}`} onClick={() => setCycleStage(cycleStage === 'ready' ? 'opened' : cycleStage === 'opened' ? 'closed' : 'ready')}>
            <span>{!stockAgent.canExecute?'紫金智能体观察中 · 未开放执行':cycleQuantity<100?'先设置本股底仓与昨日可卖':cycleStage === 'ready' ? decisionModel.status==="locked"?'风控锁定 · 暂停做T':decisionModel.status!=="ready"?'等待自动信号':(signalMode === '反T' ? `反T信号 · 卖出 ${cycleQuantity.toLocaleString()} 股` : `正T信号 · 买入 ${cycleQuantity.toLocaleString()} 股`) : cycleStage === 'opened' ? (signalMode === '反T' ? '记录等量买回' : '记录等量卖出') : '本次T已闭环'}</span>
            <small>{cycleStage === 'ready' ? '记录首笔成交' : cycleStage === 'opened' ? '完成反向成交' : '开始下一次循环'} →</small>
          </button>
          <div className={`closure-guard ${cycleStage}`}>
            <div><span>当日闭环控制</span><b><i/>{cycleStage === 'ready' ? '允许开T' : cycleStage === 'opened' ? '等待闭环' : '已恢复底仓'}</b></div>
            <p><span>计划数量</span><strong>{cycleQuantity.toLocaleString()} 股</strong></p><p><span>当前持仓</span><strong>{displayedShares.toLocaleString()} 股</strong></p><p><span>收盘目标</span><strong>{effectiveLivePosition.plannedBase.toLocaleString()} 股</strong></p>
            <div className="cycle-progress"><i className="done"/><span/><i className={cycleStage !== 'ready' ? 'done' : ''}/><span/><i className={cycleStage === 'closed' ? 'done' : ''}/></div>
            <div className="cycle-labels"><span>校验通过</span><span>首笔成交</span><span>等量闭环</span></div>
            <small>{tradeLedgerSummary.oversold?'本机流水显示卖出超过昨日可卖或当前持仓为负，请立即核对券商成交。':cycleQuantity<100?'当前股票未设置足够的计划底仓与剩余可卖数量，请到持仓对账核对。':cycleStage === 'ready' ? (signalMode === '正T' ? `本股今日剩余可卖 ${effectiveLivePosition.sellable.toLocaleString()} 股；买入后需卖出等量旧仓。` : '卖出后需在 14:50 前买回等量股份。') : cycleStage === 'opened' ? `尚有 ${cycleQuantity.toLocaleString()} 股未配对，新的${signalMode}信号已冻结。` : '买卖数量相等，实际持仓已恢复计划底仓。'}</small>
          </div>
          <div className="decision-stats live-performance"><div title="使用当前股票最近完整交易日的真实分时，按当前V4档位、费用和滑点计算"><span>本股历史胜率</span><b>{personalStrategyStats.winRate===null?'—':`${(personalStrategyStats.winRate*100).toFixed(1)}%`}</b><small>{personalStrategyStats.wins}/{personalStrategyStats.cycles} 个闭环</small></div><div><span>有效样本</span><b>{personalStrategyStats.sessions}<small> 日</small></b><small>可信度：{personalStrategyStats.confidence}</small></div><div><span>历史扣费净收益</span><b className={personalStrategyStats.net>0?'positive':personalStrategyStats.net<0?'negative':''}>{personalStrategyStats.cycles?money(personalStrategyStats.net):'—'}</b><small>随当前股票与档位更新</small></div></div>
          <div className="risk-box"><div><span>扣费净止盈区间</span><b>+0.64% ~ +1.00%</b></div><div><span>风险边界</span><b>-0.60%</b></div><p>扣费净收益达到 0.64% 后只启动利润保护，不立即卖：走势继续有利则持有，出现连续反向动能、明显回吐或跌破保护底线才退出；达到 1.00% 上限直接锁定。若价格重新站回 VWAP 并放量上攻，反T预案立即失效。</p></div>
          <button className="automation-reserved" disabled><span><i />自动交易接口</span><b>已预留 · 当前关闭</b></button>
          <div className="position-row"><span>计划仓位</span><div className="position-dots"><i className="on"/><i/><i/></div><b>1 / 3</b></div>
        </aside>
      </section>

      <section className="lower-panel">
        <div className="history">
          <div className="lower-tabs">{['今日T循环','历史信号','模拟记录'].map(item=><button key={item} onClick={()=>setPanel(item)} className={panel===item?'active':''}>{item}</button>)}</div>
          <div className="history-head"><span>时间</span><span>方向</span><span>价格</span><span>数量</span><span>价差</span><span>状态</span></div>
          {deskHistoryRows.length?deskHistoryRows.map((row,index)=><div className="history-row" key={`${row.time}-${row.direction}-${index}`}><span>{row.time}</span><span className={row.tone??""}>{row.direction}</span><span>{row.price}</span><span>{row.quantity}</span><span className={row.spread.startsWith("+")?"accent":""}>{row.spread}</span><span>{row.status}</span></div>):<div className="history-empty"><b>{panel==="今日T循环"?"暂无已确认闭环":panel==="历史信号"?"当前尚无候选或正式信号":"当前尚无正式模拟动作"}</b><span>{panel==="今日T循环"?"这里只读取“持仓对账”中本机已补录并能等量配对的真实成交，不再展示固定演示流水。":panel==="历史信号"?"反弹/回落观察会保留原因；通过趋势、量价、成本与风控后才升级为正式动作。":"只有 Smart‑T V4 正式过滤通过的模拟动作才会出现在这里。"}</span></div>}
        </div>
        <div className={`agents ${agentOpen ? 'open' : ''}`}>
          <button className="agents-title" onClick={()=>setAgentOpen(!agentOpen)}><span>四兔盘后研究</span><small>{trainingRunning?'正在核对真实完整分时':trainingProgress===100?'今日研究已完成':'收盘后自动 · 可手动运行'}</small><b>{agentOpen?'收起':'详情'}⌃</b></button>
          {agentOpen && <div className="training-console">
            <div className="training-control"><div><span>当前股票 · {stockAgent.name}{stockAgent.canExecute?"":"（研究观察版）"}</span><b>{trainingRunning?'真实分时核对中':trainingProgress===100?'本轮已完成':'等待盘后研究'}</b></div><button onClick={()=>{setTrainingProgress(trainingProgress===100?0:trainingProgress);setTrainingRunning(true)}} disabled={trainingRunning}>{trainingRunning?'研究中…':trainingProgress===100?'重新核对':'运行盘后研究'}</button></div>
            <div className="training-progress"><div style={{width:`${trainingProgress}%`}}/><span>{trainingProgress}%</span></div>
            <div className="training-metrics"><p><span>完整样本</span><b>{personalStrategyStats.sessions} 日</b></p><p><span>{stockAgent.canExecute?"正式闭环":"V4 对照闭环"}</span><b>{personalStrategyStats.cycles}</b></p><p><span>{stockAgent.canExecute?"扣费胜率":"V4 对照胜率"}</span><b>{personalStrategyStats.winRate===null?'—':`${(personalStrategyStats.winRate*100).toFixed(1)}%`}</b></p><p><span>扣费净盈亏</span><b className={personalStrategyStats.net>=0?'teal':'negative'}>{personalStrategyStats.cycles?money(personalStrategyStats.net):'—'}</b></p><p><span>最差回撤</span><b>-{(personalStrategyStats.maxDrawdown*100).toFixed(2)}%</b></p></div>
            <div className="training-log"><span>本机</span><p>{trainingRunning?`训练兔正在核对 ${personalStrategyStats.sessions} 个真实完整交易日`:`已核对 ${personalStrategyStats.cycles} 个扣费闭环；样本不足时不生成可晋升候选`}</p><em>自动晋升关闭</em></div>
          </div>}
          <div className="agent-grid">{liveAgents.map((agent,i)=><button className="agent" key={agent.name} onClick={()=>setActiveView("智能训练")} aria-label={`查看${agent.name}训练详情`}><span className={`agent-icon a${i}`}><img src={agent.avatar} alt={`${agent.name} AI头像`}/></span><span><b>{agent.name}</b><small>{agent.role}</small></span><em><i/>{agent.state}</em><strong>{agent.value}</strong></button>)}</div>
        </div>
      </section>
      </> : activeView === "单股智研" ? <SingleStockResearchView key={`${accountName}:${stock.code}`} accountName={accountName} stock={stock} quote={activeQuote} marketData={marketData} profile={profile} position={activePosition} manualCount={tradeLedgerSummary.validCount} onOpenConsole={()=>setActiveView('操盘台')} /> : activeView === "多股监控" ? <MultiWatchView stocks={stockList} onManage={()=>setOnboardingOpen(true)} onOpen={(index)=>{setActiveStock(index);setActiveView('操盘台')}} /> : activeView === "策略市场" ? <StrategyMarketView key={accountName} accountName={accountName} /> : activeView === "持仓对账" ? <HoldingsView key={`${accountName}:${stock.code}:${tradingDate}`} position={activePosition} stock={stock} tradingDate={tradingDate} rows={tradeLedgerRows} onRowsChange={saveTradeLedgerRows} /> : activeView === "智能训练" ? <TrainingView running={trainingRunning} progress={trainingProgress} evidence={personalStrategyStats} onRun={()=>{setTrainingProgress(trainingProgress===100?0:trainingProgress);setTrainingRunning(true)}} /> : <BacktestView key={`${stock.code}:${activePosition.plannedBase}:${activePosition.sellable}`} profile={profile} setProfile={setProfile} position={activePosition} stock={stock} stocks={stockList} activeStock={activeStock} onSelectStock={setActiveStock} />}

      {strategyOpen && <div className="strategy-overlay" role="dialog" aria-modal="true" aria-label="策略选择与说明">
        <div className="strategy-dialog">
          <div className="strategy-dialog-head"><div><span>SMART‑T FUSION V4</span><h2>同一套 V4，三个清晰档位</h2><p>稳健、平衡、灵敏只调整 Smart‑T 融合策略 V4 的确认门槛与信号频率，不是三套互不相干的策略；四兔训练只产生候选参数，不作为手动档位。</p></div><button onClick={()=>setStrategyOpen(false)} aria-label="关闭策略说明">×</button></div>
          <div className="strategy-cards">
            {[
              {name:'稳健档',tag:'少做，只做最确定',fit:'震荡市、新手、重视回撤',score:'至少 6/6',cycles:'每日最多 1 个正式闭环',spread:'0.64% 保护 / 1.00% 止盈 · 最短 5 分钟',risk:'候补点照常显示，正式点可能为空'},
              {name:'平衡档',tag:'确认与机会兼顾',fit:'大多数正常交易日',score:'至少 4/6',cycles:'每日最多 1 个正式闭环',spread:'0.64% 保护 / 1.00% 止盈 · 最短 4 分钟',risk:'默认推荐'},
              {name:'灵敏档',tag:'更早发现拐点',fit:'活跃行情、熟练用户',score:'至少 4/6',cycles:'每日最多 2 个正式闭环',spread:'0.64% 保护 / 1.00% 止盈 · 最短 3 分钟',risk:'候补更多，但仍需成本与风控过滤'},
            ].map(item=><button key={item.name} onClick={()=>setProfile(item.name)} className={`strategy-card ${profile===item.name?'selected':''}`}><div><h3>{item.name}</h3><span>{profile===item.name?'当前使用':'选择'}</span></div><strong>{item.tag}</strong><p>{item.fit}</p><ul><li>确认分：{item.score}</li><li>{item.cycles}</li><li>{item.spread}</li></ul><em>{item.risk}</em></button>)}
          </div>
          <div className="custom-strategy"><div className="custom-head"><div><h3>自定义规则草稿</h3><p>用于记录你的研究想法。自然语言目前不会直接变成可执行参数，也不会冒充已运行策略。</p></div><span>仅保存备注</span></div><textarea value={customStrategy} onChange={e=>setCustomStrategy(e.target.value)} aria-label="自定义做T规则草稿"/><div className="hard-guards"><span>正式执行仍受：</span><b>可卖数量</b><b>费用与滑点</b><b>14:30开仓限制</b><b>尾盘仓位恢复</b><b>连续失败熔断</b></div></div>
          <div className="opening-rule"><span>开盘因果规则</span><p>09:30立即开始扫描；积累至少4个真实分钟点后即可出现候选。低开重新站上VWAP、高开跌破VWAP且确认后，分两次各 1/6；早盘累计不超过 1/3，所有判断只使用当时及此前数据。</p><button onClick={()=>{try{localStorage.setItem(`rabbit-custom-strategy:${accountName.toLowerCase()}`,customStrategy)}catch{}setStrategyOpen(false)}}>保存规则草稿</button></div>
        </div>
      </div>}

      {accountOpen && <div className="account-overlay" role="dialog" aria-modal="true" aria-label="账户中心" onMouseDown={e=>{if(e.target===e.currentTarget)setAccountOpen(false)}}><div className="account-dialog">
        <div className="account-head"><div className="account-avatar">{accountName.slice(0,1).toUpperCase()}</div><div><span>{demoMode?'免注册演示已进入':'服务器账户已登录'}</span><h2>{accountName}</h2><p>{demoMode?'临时演示会话':accountRole==='admin'?'管理员账户':'会员账户 · 跨设备同步'}</p></div><button onClick={()=>setAccountOpen(false)} aria-label="关闭账户中心">×</button></div>
        <div className="account-plan"><div><span>当前状态</span><b>{demoMode?'免注册演示':accountRole==='admin'?'运营管理员':'个人体验版'}</b><small>{demoMode?'不跨设备同步，刷新后可能丢失':'监控清单、持仓设置和提醒偏好已保存到服务器'}</small></div><em>{demoMode?'演示中':'已激活'}</em></div>
        <div className="account-stats"><div><span>监控股票</span><b>{stockList.length} / 10</b></div><div><span>后台监控</span><b>{demoMode?'关闭':'已连接'}</b></div><div><span>策略版本</span><b>V4</b></div></div>
        <div className="account-settings"><h3>账户偏好</h3><label><span>默认股票<small>进入操盘台后优先显示</small></span><b>{preferences.stock.split(' ')[0]}</b></label><label><span>当前股票计划底仓<small>{stock.code} · 用于当日闭环校验</small></span><b>{activePosition.plannedBase.toLocaleString()} 股</b></label><label><span>风险偏好<small>影响提醒强度，不绕过硬风控</small></span><b>{preferences.risk}</b></label><label><span>自动交易<small>券商接口尚未连接</small></span><b className="account-off">关闭</b></label></div>
        <div className="account-security"><i>✓</i><p><b>{demoMode?'演示边界':'密码与会话安全'}</b><span>{demoMode?'演示不连接券商、不执行下单，也不会冒充正式账户。':'密码使用 scrypt 加盐哈希保存；登录会话使用 HttpOnly Cookie，前端不会读取密码或会话令牌。'}</span></p></div>
        <div className="account-footer-actions"><button onClick={()=>setAccountOpen(false)}>完成</button><button onClick={()=>{setAccountOpen(false);setOnboardingOpen(true)}}>修改偏好</button>{accountRole==='admin'&&!demoMode&&<button onClick={()=>{setAccountOpen(false);setMemberAdminOpen(true)}}>会员后台</button>}<button onClick={()=>{void fetch('/api/control/auth/logout',{method:'POST',credentials:'include'}).catch(()=>{});try{localStorage.removeItem('rabbit-auth-session');localStorage.removeItem('rabbit-account-role');sessionStorage.removeItem('rabbit-auth-session')}catch{} remoteSyncReady.current=false;setAccountOpen(false);setDemoMode(false);setAuthScreen('landing');setLocalAuth(false)}}>{demoMode?'退出演示':'退出登录'}</button></div>
      </div></div>}
      {memberAdminOpen&&<MemberAdminView onClose={()=>setMemberAdminOpen(false)}/>}
      {onboardingOpen&&<OnboardingView key={`${accountName}:${Object.keys(stockPositions).length}:${stockList.length}`} accountName={accountName} initial={preferences} initialList={stockList} initialPositions={stockPositions} onSave={(next,list,positions)=>{setPreferences(next);setHasPersistedPreferences(true);setStockList(list);setStockPositions(positions);setActiveStock(current=>Math.min(current,list.length-1));try{localStorage.setItem(`rabbit-prefs:${accountName.toLowerCase()}`,JSON.stringify(next));localStorage.setItem(`rabbit-watchlist:${accountName.toLowerCase()}`,JSON.stringify(list))}catch{}setOnboardingOpen(false)}}/>}

      <footer><span><i className="online"/>公开行情试用 · 操盘台 1 秒请求 · 非交易级</span><span>仅用于策略研究与提醒，不构成投资建议</span><span><a href="/terms">用户协议</a> · <a href="/privacy">隐私政策</a> · Rabbit Quant V1.0</span></footer>
    </main>
  );
}

function AuthView({onAuthenticated,onBack,onDemo}:{onAuthenticated:(name:string,isNew:boolean,remember:boolean)=>void;onBack:()=>void;onDemo:()=>void}) {
  const [mode,setMode]=useState<'login'|'register'>('login');
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [showPassword,setShowPassword]=useState(false);
  const [remember,setRemember]=useState(true);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [agreed,setAgreed]=useState(false);
  const [resetMode,setResetMode]=useState(false);
  const [resetToken,setResetToken]=useState('');
  const strength=password.length<8?0:Number(/[A-Z]/.test(password))+Number(/[a-z]/.test(password))+Number(/\d/.test(password))+Number(/[^A-Za-z0-9]/.test(password));
  const requestReset=async()=>{
    const name=username.trim();
    if(name.length<3){setError('请先输入需要找回的账号');return;}
    setBusy(true);setError('');
    try{const response=await fetch('/api/control/auth/reset-request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:name})});const payload=await response.json();setResetMode(true);setError(payload.message||'申请已记录，请联系管理员获取一次性重置码。');}
    catch{setError('暂时无法提交找回申请，请稍后重试');}finally{setBusy(false)}
  };
  const submit=async()=>{
    setError('');
    const name=username.trim();
    if(resetMode){
      if(!resetToken.trim()){setError('请输入管理员提供的一次性重置码');return;}
      if(password.length<8){setError('新密码至少需要 8 个字符');return;}
      setBusy(true);
      try{const response=await fetch('/api/control/auth/reset',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:resetToken.trim(),password})});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'重置码无效');setResetMode(false);setResetToken('');setError(payload.message||'密码已更新，请重新登录。');}
      catch(error){setError(error instanceof Error?error.message:'密码重置失败');}finally{setBusy(false)}
      return;
    }
    if(name.length<3){setError('用户名至少需要 3 个字符');return;}
    if(password.length<8){setError('密码至少需要 8 个字符');return;}
    if(mode==='register'&&password!==confirm){setError('两次输入的密码不一致');return;}
    if(mode==='register'&&!agreed){setError('请先阅读并同意用户协议和隐私政策');return;}
    setBusy(true);
    try{
      const response=await fetch(`/api/control/auth/${mode==='register'?'register':'login'}`,{
        method:'POST',headers:{'content-type':'application/json'},credentials:'include',
        body:JSON.stringify({username:name,password,displayName:name,remember:mode==='register'?true:remember}),
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||'账号服务暂不可用');
      localStorage.setItem('rabbit-account-role',payload.user?.role||'member');
      onAuthenticated(payload.user?.displayName||payload.user?.username||name,mode==='register',remember);
    }catch(error){setError(error instanceof Error?error.message:'账号服务暂不可用，请稍后重试');}finally{setBusy(false);}
  };
  return <main className="auth-page">
    <div className="auth-entry-floating">
      <button type="button" onClick={onBack}>← 产品首页</button>
      <span><a href="/terms" target="_blank" rel="noreferrer">用户协议</a><i/> <a href="/privacy" target="_blank" rel="noreferrer">隐私政策</a></span>
      <button type="button" onClick={onDemo}>免注册演示</button>
    </div>
    <section className="auth-brand-panel"><div className="auth-brand"><img src="/rabbit-brand-gold.png" alt="双兔助手双兔黑金品牌标志"/><span><b aria-label="双兔助手 做T神器"><span aria-hidden="true">双兔助手</span></b><small>做T神器 · RABBIT QUANT</small></span></div><div className="auth-message"><span className="eyebrow">RABBIT SMART‑T</span><h1>把复杂的盘面，<br/><em>变成简单的操作。</em></h1><p>多股监控、正反T决策、当日仓位闭环与四兔持续训练。</p></div><div className="auth-points"><span><i/>市场雷达硬门控</span><span><i/>T+1可卖数量校验</span><span><i/>收盘恢复计划底仓</span></div><small className="auth-disclaimer">策略研究工具 · 不构成投资建议</small></section>
    <section className="auth-form-panel"><div className="auth-card"><div className="auth-card-head"><span>{resetMode?'RESET PASSWORD':mode==='login'?'WELCOME BACK':'CREATE ACCOUNT'}</span><h2>{resetMode?'使用一次性重置码':mode==='login'?'登录做T神器':'创建服务器账户'}</h2><p>{resetMode?'输入管理员提供的 30 分钟有效重置码，并设置新密码。':mode==='login'?'继续查看你的监控、回测和训练记录。':'注册后可在电脑和手机使用同一监控清单。'}</p></div><div className="auth-tabs"><button className={mode==='login'&&!resetMode?'active':''} onClick={()=>{setMode('login');setResetMode(false);setError('')}}>登录</button><button className={mode==='register'?'active':''} onClick={()=>{setMode('register');setResetMode(false);setError('')}}>注册</button></div><label className="auth-field"><span>账号</span><input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" placeholder="用户名或邮箱"/></label>{resetMode&&<label className="auth-field"><span>一次性重置码</span><input value={resetToken} onChange={e=>setResetToken(e.target.value)} autoComplete="one-time-code" placeholder="粘贴管理员提供的重置码"/></label>}<label className="auth-field"><span>{resetMode?'新密码':'密码'}</span><div><input value={password} onChange={e=>setPassword(e.target.value)} type={showPassword?'text':'password'} autoComplete={mode==='login'&&!resetMode?'current-password':'new-password'} placeholder="至少 8 个字符"/><button onClick={()=>setShowPassword(!showPassword)} type="button">{showPassword?'隐藏':'显示'}</button></div></label>{mode==='register'&&!resetMode&&<><div className="password-strength"><span>密码强度</span><i className={strength>0?'on':''}/><i className={strength>1?'on':''}/><i className={strength>2?'on':''}/><i className={strength>3?'on':''}/><b>{strength<2?'较弱':strength<4?'可用':'较强'}</b></div><label className="auth-field"><span>确认密码</span><input value={confirm} onChange={e=>setConfirm(e.target.value)} type={showPassword?'text':'password'} autoComplete="new-password" placeholder="再次输入密码"/></label><label className="terms-check"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/><span>我已阅读并同意《用户协议》和《隐私政策》，理解本工具不构成投资建议。</span></label></>}{mode==='login'&&!resetMode&&<div className="auth-options"><label><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/><span>记住登录</span></label><button type="button" onClick={()=>void requestReset()}>忘记密码？</button></div>}{resetMode&&<div className="auth-options"><span>重置后旧设备会自动退出</span><button type="button" onClick={()=>{setResetMode(false);setError('')}}>返回登录</button></div>}{error&&<div className="auth-error"><i>!</i>{error}</div>}<button className="auth-submit" onClick={submit} disabled={busy}>{busy?'正在验证…':resetMode?'更新密码':mode==='login'?'登录':'注册并进入'}<span>→</span></button><div className="auth-local-note"><i>i</i><p><b>服务器账户</b><span>账号、监控股票和持仓设置保存在服务器，可跨设备同步；密码仅保存为不可逆哈希。</span></p></div></div><footer className="auth-footer">© 2026 Rabbit Quant · 用户协议 · 隐私政策</footer></section>
  </main>;
}

function MemberAdminView({onClose}:{onClose:()=>void}){
  const [members,setMembers]=useState<MemberRecord[]>([]);
  const [busyId,setBusyId]=useState('');
  const [error,setError]=useState('');
  const [resetInfo,setResetInfo]=useState<{username:string;token:string;expiresAt:string}|null>(null);
  const load=async()=>{setError('');try{const response=await fetch('/api/control/admin/members',{credentials:'include',cache:'no-store'});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'无法读取会员');setMembers(payload.members??[])}catch(error){setError(error instanceof Error?error.message:'无法读取会员')}};
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[]);
  const updateStatus=async(member:MemberRecord)=>{setBusyId(member.id);setError('');try{const response=await fetch(`/api/control/admin/members/${member.id}`,{method:'PATCH',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({status:member.status==='active'?'paused':'active'})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'状态更新失败');await load()}catch(error){setError(error instanceof Error?error.message:'状态更新失败')}finally{setBusyId('')}};
  const issueReset=async(member:MemberRecord)=>{setBusyId(member.id);setError('');try{const response=await fetch(`/api/control/admin/members/${member.id}/reset`,{method:'POST',credentials:'include'});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'无法生成重置码');setResetInfo(payload)}catch(error){setError(error instanceof Error?error.message:'无法生成重置码')}finally{setBusyId('')}};
  return <div className="member-admin-overlay" role="dialog" aria-modal="true" aria-label="会员后台" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><section className="member-admin-panel"><header><div><span>MEMBER CONTROL</span><h2>会员与后台监控</h2><p>查看正式注册会员、跨设备监控数和后台告警；暂停会员后其所有登录会话立即失效。</p></div><button onClick={onClose} aria-label="关闭会员后台">×</button></header>{error&&<div className="member-admin-error">{error}</div>}{resetInfo&&<div className="member-reset-token"><span>{resetInfo.username} 的一次性重置码</span><code>{resetInfo.token}</code><small>{new Date(resetInfo.expiresAt).toLocaleString('zh-CN')} 前有效；发送给会员后请勿再次公开。</small><button onClick={()=>void navigator.clipboard?.writeText(resetInfo.token)}>复制重置码</button></div>}<div className="member-admin-summary"><span>正式会员 <b>{members.filter(item=>item.role==='member').length}</b></span><span>正在监控 <b>{members.reduce((sum,item)=>sum+Number(item.monitorCount||0),0)} 只</b></span><span>后台告警 <b>{members.reduce((sum,item)=>sum+Number(item.alertCount||0),0)} 条</b></span><button onClick={()=>void load()}>刷新</button></div><div className="member-table"><div className="member-row member-head"><span>会员</span><span>状态</span><span>监控 / 告警</span><span>最近登录</span><span>操作</span></div>{members.map(member=><div className="member-row" key={member.id}><span><b>{member.displayName}</b><small>{member.username} · {member.role==='admin'?'管理员':'会员'}</small></span><span><em className={member.status}>{member.status==='active'?'正常':'已暂停'}</em></span><span><b>{member.monitorCount} / {member.alertCount}</b></span><span><small>{member.lastLoginAt?new Date(member.lastLoginAt).toLocaleString('zh-CN'):'从未登录'}</small></span><span>{member.role==='admin'?<small>系统管理员</small>:<><button disabled={busyId===member.id} onClick={()=>void updateStatus(member)}>{member.status==='active'?'暂停':'恢复'}</button><button disabled={busyId===member.id} onClick={()=>void issueReset(member)}>重置码</button></>}</span></div>)}</div></section></div>;
}

function HomeView({onNavigate,onOpenZijin,stockCount}:{onNavigate:(view:string)=>void;onOpenZijin:()=>void;stockCount:number}) {
  const timeParts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());
  const readPart=(type:string)=>timeParts.find(part=>part.type===type)?.value??'';
  const marketMinute=(Number(readPart('hour'))||0)*60+(Number(readPart('minute'))||0);
  const isTradingDay=['Mon','Tue','Wed','Thu','Fri'].includes(readPart('weekday'));
  const isMarketSession=isTradingDay&&((marketMinute>=555&&marketMinute<=690)||(marketMinute>=780&&marketMinute<=900));
  return <section className="product-home">
    <div className="home-hero">
      <div className="home-copy"><span className="eyebrow">RABBIT SMART‑T WORKSPACE</span><h1>看清买卖点，<br/><em>当天完成每一次T。</em></h1><p>集合竞价研判、市场雷达、正反T决策、仓位闭环和四兔训练集中在一个简单的交易工作台。</p><div className="home-actions"><div><button onClick={()=>onNavigate('操盘台')}>{isMarketSession?'进入盘中操盘台':'进入今日操盘台'} <span>→</span></button><small><i className={isMarketSession?'live':''}/>{isMarketSession?'当前为盘中监控时段':'当前为盘后复盘时段'}</small></div><button onClick={()=>onNavigate('模拟回测')}>先做模拟回测</button></div><div className="home-trust"><span><i/>不自动下单</span><span><i/>T+1仓位校验</span><span><i/>收盘恢复底仓</span><em>正在持续扫描：{stockCount} 只自选股</em></div></div>
      <div className="home-terminal"><div className="terminal-head"><span>601899 紫金矿业</span><em><i/>策略示例 · 非实时</em></div><div className="terminal-price"><strong>--</strong><span>进入操盘台查看</span><small>市场雷达仅作界面示例</small></div><svg viewBox="0 0 600 180" preserveAspectRatio="none"><defs><linearGradient id="homeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#28d7c4" stopOpacity=".18"/><stop offset="1" stopColor="#28d7c4" stopOpacity="0"/></linearGradient></defs><path d="M0 145 C45 132 70 151 105 116 S170 127 205 88 S270 99 310 69 S370 91 410 58 S485 74 525 40 S570 52 600 20 L600 180 L0 180Z" fill="url(#homeFill)"/><path d="M0 145 C45 132 70 151 105 116 S170 127 205 88 S270 99 310 69 S370 91 410 58 S485 74 525 40 S570 52 600 20" className="home-line"/></svg><div className="terminal-signal"><span><i className="rabbit-dot-home">兔</i><b>研究提示</b></span><p>实时行情与回测请进入操盘台。</p><em>不构成投资建议</em></div></div>
    </div>
    <button className="home-zijin-entry" onClick={onOpenZijin} aria-label="打开紫金矿业实验室训练进度">
      <span><i/>601899 · 专属智能体</span>
      <div><b>紫金矿业实验室</b><small>查看五年分钟样本训练、样本外验证与当前通过状态；独立研究，不自动写入 Smart-T V4。</small></div>
      <em>查看训练进度 →</em>
    </button>
    <div className="home-strip"><button className="home-widget" onClick={()=>onNavigate('持仓对账')}><span>今日闭环</span><b>查看账本</b><small>只统计已录入且完成配对的成交 →</small></button><button className="home-widget" onClick={()=>onNavigate('多股监控')}><span>监控股票</span><b>{stockCount} 只</b><small>盘中持续扫描 · 打开看板 →</small></button><button className="home-widget profit-widget" onClick={()=>onNavigate('持仓对账')}><span>已确认净收益</span><b>按流水计算</b><small>没有真实成交记录时不展示演示收益 →</small></button><button className="home-widget" onClick={()=>onNavigate('智能训练')}><span>四兔研究</span><b>盘后自动</b><small>真实完整分时 · 查看研究证据 →</small></button></div>
    <div className="home-workflow"><div className="workflow-head"><div><span className="eyebrow">DAILY WORKFLOW</span><h2>每天只看四件事</h2></div><p>减少指标堆叠，把操作顺序固定下来。</p></div><div className="workflow-grid">{[{n:'01',title:'先看市场',copy:'集合竞价与市场雷达先决定今天能不能做、优先正T还是反T。',action:'多股监控',icon:'⌁'},{n:'02',title:'再等信号',copy:'价格、VWAP、量能和确认分同时满足，才显示可执行机会。',action:'操盘台',icon:'⌗'},{n:'03',title:'当天闭环',copy:'首笔成交后冻结同向信号，等量反向成交并恢复原底仓。',action:'持仓对账',icon:'⇄'},{n:'04',title:'收盘复盘',copy:'使用真实费用和可卖数量回放，训练参数只进入候选区。',action:'智能训练',icon:'◇'}].map(item=><button key={item.n} onClick={()=>onNavigate(item.action)}><span>{item.n}</span><i>{item.icon}</i><h3>{item.title}</h3><p>{item.copy}</p><em>{item.action} →</em></button>)}</div></div>
    <div className="home-risk"><span>重要提示</span><p>做T不保证盈利。所有信号仅用于策略研究和提醒；自动交易接口保持关闭，候选策略必须人工晋升。</p><button onClick={()=>onNavigate('模拟回测')}>查看可信回测</button></div>
  </section>;
}

function OnboardingView({accountName,initial,initialList,initialPositions,onSave}:{accountName:string;initial:AccountPreferences;initialList:typeof initialStocks;initialPositions:StockPositionMap;onSave:(value:AccountPreferences,list:typeof initialStocks,positions:StockPositionMap)=>void}){
  const [stock,setStock]=useState(initial.stock);
  const [risk,setRisk]=useState(initial.risk);
  const [list,setList]=useState(initialList);
  const [positions,setPositions]=useState<StockPositionMap>(()=>Object.fromEntries(initialList.map(item=>[item.code,initialPositions[item.code]??migrateLegacyPosition(initial,item.code)])));
  const [newCode,setNewCode]=useState('');
  const [newName,setNewName]=useState('');
  const [listError,setListError]=useState('');
  const selectedCode=stock.match(/\d{6}/)?.[0]??list[0]?.code??'';
  const selectedStock=list.find(item=>item.code===selectedCode)??list[0];
  const selectedPosition=positions[selectedCode]??migrateLegacyPosition(initial,selectedCode);
  const updatePosition=(field:"plannedBase"|"openingShares"|"sellable",value:number)=>setPositions(current=>{
    const existing=current[selectedCode]??migrateLegacyPosition(initial,selectedCode);
    return {...current,[selectedCode]:normalizeStockPosition({...existing,[field]:Math.max(0,Math.floor(value))},selectedCode)};
  });
  const add=()=>{const code=newCode.replace(/\D/g,'').slice(0,6);const name=newName.trim();if(code.length!==6||!name){setListError('请输入6位股票代码和股票名称');return}if(list.some(item=>item.code===code)){setListError('该股票已经在监控列表中');return}const next=[...list,{code,name,price:'--',change:'0.00%'}];setList(next);setPositions(current=>({...current,[code]:normalizeStockPosition({},code)}));setStock(`${code} ${name}`);setNewCode('');setNewName('');setListError('')};
  const remove=(code:string)=>{if(list.length<=1){setListError('至少需要保留一只监控股票');return}const next=list.filter(item=>item.code!==code);setList(next);setPositions(current=>{const updated={...current};delete updated[code];return updated});if(stock.startsWith(code))setStock(`${next[0].code} ${next[0].name}`);setListError('')};
  const save=()=>{
    const savedPositions:StockPositionMap=Object.fromEntries(list.map(item=>{
      const position=positions[item.code]??migrateLegacyPosition(initial,item.code);
      return [item.code,confirmStockPosition(window.localStorage,accountName,position)];
    }));
    const defaultPosition=savedPositions[selectedCode]??normalizeStockPosition({},selectedCode);
    onSave({stock,baseShares:defaultPosition.plannedBase,risk},list,savedPositions);
  };
  return <div className="onboarding-overlay"><div className="onboarding-card"><div className="onboarding-head"><span>ACCOUNT SETUP</span><h2>设置你的交易工作台</h2><p>每只股票独立保存持仓，切换股票不会串用底仓。</p></div><div className="onboarding-step watchlist-step"><b>01</b><div><span>监控股票与默认股票</span><div className="preference-watchlist">{list.map(item=><div className={stock.startsWith(item.code)?'active':''} key={item.code}><button onClick={()=>setStock(`${item.code} ${item.name}`)}><b>{item.name}</b><small>{item.code}</small></button><button onClick={()=>remove(item.code)} aria-label={`删除${item.name}`}>×</button></div>)}</div><div className="stock-add-row"><input value={newCode} onChange={e=>setNewCode(e.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" autoComplete="off" placeholder="6位代码"/><input value={newName} onChange={e=>setNewName(e.target.value)} autoComplete="off" placeholder="股票名称"/><button onClick={add}>＋ 添加</button></div>{listError&&<small className="list-error">{listError}</small>}<small>先点击一只股票，再单独填写它的持仓；被选中的股票同时作为默认股票。</small></div></div><div className="onboarding-step"><b>02</b><div><span>{selectedStock?`${selectedStock.name}（${selectedCode}）持仓`:'当前股票持仓'}</span><div className="position-setup-grid"><label><span>计划底仓</span><div><input type="text" inputMode="numeric" value={selectedPosition.plannedBase||''} onChange={event=>updatePosition('plannedBase',Number(event.target.value.replace(/\D/g,''))||0)}/><em>股</em></div><small>收盘恢复目标</small></label><label><span>开盘实际持仓</span><div><input type="text" inputMode="numeric" value={selectedPosition.openingShares||''} onChange={event=>updatePosition('openingShares',Number(event.target.value.replace(/\D/g,''))||0)}/><em>股</em></div><small>今日开盘前实际数量</small></label><label><span>昨日可卖</span><div><input type="text" inputMode="numeric" value={selectedPosition.sellable||''} onChange={event=>updatePosition('sellable',Number(event.target.value.replace(/\D/g,''))||0)}/><em>股</em></div><small>受 T+1 规则约束</small></label></div><small>昨日可卖不会超过开盘实际持仓；不足 100 股时，本股不会生成正式做 T 执行信号。</small></div></div><div className="onboarding-step"><b>03</b><div><span>风险偏好</span><div className="risk-options">{['稳健','平衡','积极'].map(item=><button className={risk===item?'active':''} onClick={()=>setRisk(item)} key={item}>{item}</button>)}</div><small>仅调整信号频率，不能绕过可卖数量和当日闭环规则。</small></div></div><button className="onboarding-save" onClick={save}>保存全部股票持仓 <span>→</span></button></div></div>;
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
type AutoResearchSample = { date:string; cycles:number; wins:number; net:number; status:string };

function SingleStockResearchView({accountName,stock,quote,marketData,profile,position,manualCount,onOpenConsole}:{accountName:string;stock:{code:string;name:string;price:string;change:string};quote:MarketData['quote']|undefined;marketData:MarketData|null;profile:string;position:StockPosition;manualCount:number;onOpenConsole:()=>void}) {
  const [zijinTrainingProgress,setZijinTrainingProgress]=useState<ZijinTrainingProgress|null>(null);
  useEffect(()=>{
    if(stock.code!=="601899"){
      const resetTimer=window.setTimeout(()=>setZijinTrainingProgress(null),0);
      return()=>window.clearTimeout(resetTimer);
    }
    let active=true;
    let timer:number|undefined;
    const load=async()=>{
      try{
        const response=await fetch(`/research/zijin-training-progress.json?t=${Date.now()}`,{cache:"no-store"});
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const payload=await response.json() as ZijinTrainingProgress;
        if(active&&payload.stock?.code==="601899"){
          setZijinTrainingProgress(payload);
          if(payload.status==="running")timer=window.setTimeout(()=>void load(),2000);
        }
      }catch{
        /* 保留上一份真实状态；连接失败时低频重试，不伪造训练进度。 */
        if(active)timer=window.setTimeout(()=>void load(),10000);
      }
    };
    void load();
    return()=>{active=false;if(timer!==undefined)window.clearTimeout(timer)};
  },[stock.code]);
  const storageKey=`rabbit-stock-research:${accountName.toLowerCase()}:${stock.code}`;
  const [notes,setNotes]=useState<StockResearchNote[]>(()=>{try{const saved=localStorage.getItem(storageKey);const parsed=saved?JSON.parse(saved):[];return Array.isArray(parsed)?parsed:[]}catch{return [];}});
  const [feedback,setFeedback]=useState('');
  const [mode,setMode]=useState('观察');
  const [outcome,setOutcome]=useState('待验证');
  const [saveMessage,setSaveMessage]=useState('');
  const relevantData=marketData?.quote.code===stock.code?marketData:null;
  const bars=useMemo(()=>relevantData?.bars??[],[relevantData]);
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
  const autoSamples=useMemo<AutoResearchSample[]>(()=>[...(relevantData?.intradaySessions??[])]
    .filter(session=>session.minutes.length>=180)
    .sort((left,right)=>right.date.localeCompare(left.date))
    .slice(0,20)
    .map(session=>{
      const result=runSmartTReplay(session.minutes,{capital:200_000,baseShares:position.plannedBase,sellable:position.sellable,feeRate:.025,slippage:.02,minCommission:true,slippageMode:"percent",forceCloseTime:"1450",profile,previousClose:session.previousClose,randomValue:0});
      return {date:session.date,cycles:result.trades,wins:result.wins,net:result.net,status:result.trades?`${result.trades} 个闭环 · ${money(result.net)}`:"无正式信号"};
    }),[relevantData?.intradaySessions,position.plannedBase,position.sellable,profile]);
  const autoCycles=autoSamples.reduce((sum,item)=>sum+item.cycles,0);
  const autoWins=autoSamples.reduce((sum,item)=>sum+item.wins,0);
  const autoNet=autoSamples.reduce((sum,item)=>sum+item.net,0);
  const zijinOpeningEvidence=useMemo(()=>{
    if(stock.code!=="601899")return null;
    const sessions=[...(relevantData?.intradaySessions??[])]
      .filter(session=>session.minutes.length>=6)
      .sort((left,right)=>right.date.localeCompare(left.date))
      .slice(0,20);
    let candidateDays=0,positiveDays=0,reverseDays=0;
    for(const session of sessions){
      let firstCandidate:ReturnType<typeof evaluateZijinOpeningPlaybook>|null=null;
      const opening=session.minutes.filter(minute=>minute.time>="0930"&&minute.time<="1030");
      for(let index=5;index<opening.length;index+=1){
        const evaluation=evaluateZijinOpeningPlaybook(opening.slice(0,index+1),{previousClose:session.previousClose});
        if(evaluation.status==="candidate"){firstCandidate=evaluation;break;}
      }
      if(!firstCandidate)continue;
      candidateDays+=1;
      if(firstCandidate.direction==="正T")positiveDays+=1;
      if(firstCandidate.direction==="反T")reverseDays+=1;
    }
    return {sessions:sessions.length,candidateDays,positiveDays,reverseDays};
  },[stock.code,relevantData?.intradaySessions]);
  const zijinFactorResearch=useMemo(()=>stock.code==="601899"?analyzeZijinFactorResearch({
    sessions:relevantData?.intradaySessions??[],
    liveMinutes:relevantData?.minutes??[],
    previousClose:relevantData?.quote.previousClose??null,
  }):null,[stock.code,relevantData?.intradaySessions,relevantData?.minutes,relevantData?.quote]);
  const samples=autoSamples.length+notes.length+manualCount;
  const maturity=samples<10?'样本不足':samples<30?'观察中':'候选验证';
  const candidate=stats.range===0?'等待数据形成候选':stats.range<3.5?'低波动回踩观察':'高波动分批观察';
  const saveNote=()=>{const note=feedback.trim();if(!note)return;const next=[{id:`${Date.now()}`,date:new Date().toLocaleDateString('zh-CN'),mode,outcome,note},...notes];setNotes(next);try{localStorage.setItem(storageKey,JSON.stringify(next));}catch{}setFeedback('');setOutcome('待验证');setSaveMessage(`已保存：${mode} · ${outcome}`);window.setTimeout(()=>setSaveMessage(''),2500);};
  const quoteDirection=quote?.changePercent==null?'neutral':quote.changePercent>0?'positive':quote.changePercent<0?'negative':'neutral';
  const validationFinished=zijinTrainingProgress?.stage==="blind-test"||zijinTrainingProgress?.stage==="completed";
  const blindFinished=zijinTrainingProgress?.stage==="completed";
  const validationRan=zijinTrainingProgress?.latest.validationRan??Boolean(validationFinished&&zijinTrainingProgress?.latest.validationTrades);
  const blindRan=zijinTrainingProgress?.latest.blindRan??Boolean(blindFinished&&zijinTrainingProgress?.latest.blindTrades);
  const historicalPassed=zijinHistoricalEvidence.selectedModel.passedValidationGate;
  return <section className="stock-research-view">
    <div className="research-head"><div><span className="eyebrow">SINGLE STOCK RESEARCH · AUTO + REVIEW</span><h1>系统自动研究，用户只负责确认</h1><p>系统会读取这只股票的完整分时回放、日线股性和本机成交记录；你只需要确认结论是否有效，必要时补充一句原因。</p></div><button onClick={onOpenConsole}>去看今日信号 →</button></div>
    <div className="research-purpose"><b>这个页面只回答 3 个问题</b><div><p><i>01</i><span><strong>它平时怎么走？</strong><small>看振幅、趋势、量能和日内习惯</small></span></p><p><i>02</i><span><strong>什么做 T 条件更适合？</strong><small>根据历史记录形成观察方案</small></span></p><p><i>03</i><span><strong>今天的信号靠谱吗？</strong><small>把历史股性作为操盘台的参考背景</small></span></p></div><em>看实时买卖信号请进入“操盘台”</em></div>
    <div className="research-status"><div className="research-asset"><span><small>{stock.code}</small><strong>{stock.name}</strong></span><b>{quote?.price?.toFixed(2)??'--'}</b><em className={quoteDirection}>{quote?.changePercent==null?'行情等待中':`${quote.changePercent>=0?'+':''}${quote.changePercent.toFixed(2)}%`}</em></div><div className="research-maturity"><p><i/>档案成熟度：<strong>{maturity}</strong></p><span>研究样本 {samples} / 30 条</span><b className="maturity-progress"><em style={{width:`${Math.min(100,samples/30*100)}%`}}/></b><small>自动分时 {autoSamples.length} 日 · 人工复盘 {notes.length} 条 · 本机成交 {manualCount} 笔</small></div></div>
    {stock.code==="601899"&&<div id="zijin-experiment-progress" className={`zijin-training-live zijin-training-prominent ${zijinTrainingProgress?.status??'loading'}`}>
      <div className="zijin-training-title"><div><span><i/>紫金矿业 · 四兔真实训练进度</span><b>{!zijinTrainingProgress?'正在连接服务器训练记录…':zijinTrainingProgress.status==="running"?zijinTrainingProgress.message:zijinTrainingProgress.latest.passedValidationGate?'本轮因果审计完成｜通过验证，等待人工评审':'本轮因果审计完成｜没有可晋级参数'}</b></div><strong>{zijinTrainingProgress?`${zijinTrainingProgress.progress}%`:'--'}</strong></div>
      <div className="zijin-training-track"><i style={{width:`${zijinTrainingProgress?.progress??0}%`}}/></div>
      {zijinTrainingProgress?<>
        <div className="zijin-training-stats"><p><span>当前阶段</span><b>{zijinTrainingProgress.stage==="training"?"训练集选参":zijinTrainingProgress.stage==="validation"?"2025 样本外":zijinTrainingProgress.stage==="blind-test"?"2026 盲测":zijinTrainingProgress.stage==="completed"?"本轮完成":"数据准备"}</b><small>{zijinTrainingProgress.totalCandidates?`${zijinTrainingProgress.processedCandidates}/${zijinTrainingProgress.totalCandidates} 组参数`:"读取历史库"}</small></p><p><span>训练集</span><b>{zijinTrainingProgress.latest.trainingWinRate==null?'--':`${(zijinTrainingProgress.latest.trainingWinRate*100).toFixed(1)}%`}</b><small>{zijinTrainingProgress.latest.trainingTrades??0} 笔 · 平均 {zijinTrainingProgress.latest.trainingAverageNetPct?.toFixed(3)??'--'}%</small></p><p><span>样本外</span><b>{validationFinished&&!validationRan?'封存':zijinTrainingProgress.latest.validationWinRate==null?'--':`${(zijinTrainingProgress.latest.validationWinRate*100).toFixed(1)}%`}</b><small>{validationFinished&&!validationRan?'训练门槛未过，未读取':`${zijinTrainingProgress.latest.validationTrades??0} 笔 · 平均 ${zijinTrainingProgress.latest.validationAverageNetPct?.toFixed(3)??'--'}%`}</small></p><p><span>最终盲测</span><b>{blindFinished&&!blindRan?'封存':zijinTrainingProgress.latest.blindWinRate==null?'--':`${(zijinTrainingProgress.latest.blindWinRate*100).toFixed(1)}%`}</b><small>{blindFinished&&!blindRan?'2025 未过，未读取':`${zijinTrainingProgress.latest.blindTrades??0} 笔 · 平均 ${zijinTrainingProgress.latest.blindAverageNetPct?.toFixed(3)??'--'}%`}</small></p></div>
        <div className="zijin-implementation-steps" aria-label="紫金矿业实验实施进度">
          <p className="done"><i>1</i><span><b>历史数据整理</b><small>4.3 年 1 分钟库已完成审计</small></span><em>已完成</em></p>
          <p className={zijinTrainingProgress.stage==="training"?'pending':zijinTrainingProgress.latest.passedTrainingGate?'done':'failed'}><i>2</i><span><b>因果参数训练</b><small>{zijinTrainingProgress.processedCandidates}/{zijinTrainingProgress.totalCandidates} 组参数，不读取未来分钟</small></span><em>{zijinTrainingProgress.stage==="training"?'进行中':zijinTrainingProgress.latest.passedTrainingGate?'通过':'选参完成 · 未通过'}</em></p>
          <p className={!validationFinished?'pending':!validationRan?'sealed':zijinTrainingProgress.latest.passedValidationGate?'done':'failed'}><i>3</i><span><b>样本外验证</b><small>只使用训练期未见过的 2025 数据</small></span><em>{!validationFinished?'等待':!validationRan?'封存未运行':zijinTrainingProgress.latest.passedValidationGate?'通过':'已执行 · 未通过'}</em></p>
          <p className={!blindFinished?'pending':!blindRan?'sealed':zijinTrainingProgress.latest.passedValidationGate?'done':'failed'}><i>4</i><span><b>2026 最终盲测</b><small>只在 2025 通过后开启，避免反复偷看</small></span><em>{!blindFinished?'等待':!blindRan?'封存未运行':zijinTrainingProgress.latest.passedValidationGate?'完成':'已审计 · 不晋级'}</em></p>
          <p className="pending"><i>5</i><span><b>接入 V4 影子观察</b><small>必须先通过样本外验证和人工评审</small></span><em>未开始</em></p>
        </div>
        <div className="zijin-training-verdict"><b>本轮真实结论</b><span>{zijinTrainingProgress.latest.passedValidationGate?'候选通过训练与样本外门槛，但仍只允许人工评审和模拟观察。':validationRan||blindRan?'旧轮次四阶段均已执行，但训练集和样本外净期望为负；结果只保留为失败证据，后续不重复使用 2026 盲测调参。':'训练集没有合格候选，2025 与 2026 数据继续封存；下一轮须先补充真实外部因子。'}</span><em>{zijinTrainingProgress.latest.nextAction??'补充真实外部因子后再开启新一轮因果训练'}</em></div>
        <footer><span>任务 {zijinTrainingProgress.runId} · 更新 {new Date(zijinTrainingProgress.updatedAt).toLocaleString('zh-CN')}</span><b>{zijinTrainingProgress.status==="running"?"训练中":zijinTrainingProgress.latest.passedValidationGate?"通过验证，等待人工评审":"未通过门槛，不进入 V4"}</b></footer>
      </>:<footer><span>训练数据仍在服务器保留，页面会自动重试</span><b>连接中</b></footer>}
    </div>}
    <div className="research-grid">
      <div className="research-column research-primary"><article className="research-card research-summary"><span>这只股票当前的研究结论</span><h2>{candidate}</h2><p>{stats.trend}；近20日平均振幅 {stats.range?`${stats.range.toFixed(2)}%`:'待计算'}。系统已自动回放 {autoSamples.length} 个完整交易日，形成 {autoCycles} 个闭环，扣费后净收益 {autoSamples.length?money(autoNet):'等待样本'}。</p><div><b>这不是自动买卖指令</b><small>自动研究只负责形成证据；正式买卖点仍由操盘台 V4 逐分钟过滤，风险规则拥有一票否决权。</small></div></article><article className="research-card feedback-card"><span>确认系统判断是否正确</span><p>系统已经自动收集客观数据。只有主观结论需要你确认；选择标签、写一句原因再保存。</p><div className="feedback-control"><small>判断类型</small><div>{['观察','正T','反T'].map(item=><button key={item} className={mode===item?'active':''} onClick={()=>{setMode(item);setSaveMessage('')}}>{item}{mode===item?' ✓':''}</button>)}</div></div><div className="feedback-control"><small>实际结果</small><div>{['待验证','有效','无效'].map(item=><button key={item} className={outcome===item?'active':''} onClick={()=>{setOutcome(item);setSaveMessage('')}}>{item}{outcome===item?' ✓':''}</button>)}</div></div><textarea value={feedback} onChange={event=>{setFeedback(event.target.value);setSaveMessage('')}} placeholder="例如：10:15 回踩后量能未跟上，因此没有执行；等待是正确的。"/><button onClick={saveNote} disabled={!feedback.trim()}>{saveMessage||'保存本次人工确认'}</button></article></div>
      <div className="research-column research-secondary"><article className="research-card"><span>股性指纹 · 日线</span><div className="fingerprint"><p><small>平均振幅</small><b>{stats.range?`${stats.range.toFixed(2)}%`:'--'}</b></p><p><small>阳线天数</small><b>{bars.length?`${stats.upDays}/20`:'--'}</b></p><p><small>20日均价</small><b>{stats.ma20?stats.ma20.toFixed(2):'--'}</b></p><p><small>量能比</small><b>{stats.volumeRatio?`${stats.volumeRatio.toFixed(2)}×`:'--'}</b></p></div><small className="data-note">日线用于股性背景；盘中信号仍使用已出现的分钟数据。</small></article><article className="research-card"><span>待验证规律</span><ul className="candidate-list">{zijinOpeningEvidence&&<li><b>紫金早盘高波动观察</b><small>09:30–10:30 只用当时已出现的振幅、VWAP、三分钟动量与量比；近 {zijinOpeningEvidence.sessions} 个完整样本中 {zijinOpeningEvidence.candidateDays} 日形成候选（正T {zijinOpeningEvidence.positiveDays} / 反T {zijinOpeningEvidence.reverseDays}），尚不直接执行。</small><em>{zijinOpeningEvidence.sessions>=10?'验证中':'收集中'}</em></li>}<li><b>{candidate}</b><small>{stats.range<3.5?'振幅偏小时，提高确认门槛，避免费用吃掉价差。':'波动偏大时，缩小单次仓位并限制连续试错。'}</small><em>{autoSamples.length>=10?'验证中':'收集中'}</em></li><li><b>{stats.trend.includes('上方')?'趋势内回撤观察':'均值回归观察'}</b><small>{autoCycles?`真实分时已形成 ${autoCycles} 个闭环，盈利 ${autoWins} 个。`:'还没有足够正式闭环，不输出胜率。'}</small><em>{autoCycles>=20?'可评审':'待样本'}</em></li><li><b>开盘分阶段确认</b><small>09:33–09:44 允许 1/6 底仓小仓试单；仍须通过连续走势、VWAP、成本与风控过滤，09:45 后恢复完整确认。</small><em>V4硬规则</em></li></ul><small className="candidate-explain">这里是研究假设，不是可点击启用的另一套策略。</small></article></div>
    </div>
    {zijinFactorResearch&&<section className="zijin-factor-lab">
      <div className="zijin-factor-head"><div><span>ZIJIN FACTOR RESEARCH · 独立实验区</span><h2>紫金矿业专属因子研究</h2><p>只研究 VWAP 偏离、三分钟动量、量比和日内振幅；历史未来数据仅用于完整交易日的结果标签，盘中快照只读取当前分钟及之前的数据。</p></div><em>{zijinFactorResearch.live.status==="candidate"?"出现待验证组合":zijinFactorResearch.live.status==="watch"?"因子监控中（非训练）":"等待分钟样本"}</em></div>
      <div className="zijin-factor-grid"><div><span>VWAP 偏离</span><b>{zijinFactorResearch.live.vwap===null?'--':`${zijinFactorResearch.live.vwapBiasPct>=0?'+':''}${zijinFactorResearch.live.vwapBiasPct.toFixed(2)}%`}</b><small>{zijinFactorResearch.live.vwap===null?'等待数据':`VWAP ${zijinFactorResearch.live.vwap.toFixed(2)}`}</small></div><div><span>3 分钟动量</span><b>{zijinFactorResearch.live.points?`${zijinFactorResearch.live.momentum3Pct>=0?'+':''}${zijinFactorResearch.live.momentum3Pct.toFixed(2)}%`:'--'}</b><small>只使用已出现分钟</small></div><div><span>短量比</span><b>{zijinFactorResearch.live.volumeRatio===null?'--':`${zijinFactorResearch.live.volumeRatio.toFixed(2)}×`}</b><small>最近 3 分钟 / 前序均量</small></div><div><span>研究方向</span><b>{zijinFactorResearch.live.directionLabel??'等待'}</b><small>{zijinFactorResearch.live.label} · {zijinFactorResearch.live.score}/100</small></div></div>
      <div className="zijin-history-audit">
        <div className="zijin-history-head"><div><span>四兔历史审计 · 4.3 年 1 分钟库</span><h3>{historicalPassed?'全量因子组合已通过样本外门槛':'全量因子组合未通过研究门槛'}</h3><p>训练兔只看 2022–2024，挑战兔只看 2025，风控兔最后盲审 2026；最早按下一分钟开盘价成交，同一分钟同时触发止盈止损时按止损优先。</p></div><em>{historicalPassed?'等待人工评审':'未进入 V4'}</em></div>
        <div className="zijin-history-metrics"><p><span>完整交易日</span><b>{zijinHistoricalEvidence.dataset.tradingDays.toLocaleString()}</b><small>{zijinHistoricalEvidence.dataset.firstDate}—{zijinHistoricalEvidence.dataset.lastDate}</small></p><p><span>训练期胜率</span><b className={zijinHistoricalEvidence.results.training.averageNetPct>=0?'positive':'negative'}>{(zijinHistoricalEvidence.results.training.winRate*100).toFixed(1)}%</b><small>{zijinHistoricalEvidence.results.training.trades} 次 · 平均 {zijinHistoricalEvidence.results.training.averageNetPct.toFixed(3)}%</small></p><p><span>2025 样本外</span><b className={zijinHistoricalEvidence.results.validation.averageNetPct>=0?'positive':'negative'}>{(zijinHistoricalEvidence.results.validation.winRate*100).toFixed(1)}%</b><small>{zijinHistoricalEvidence.results.validation.trades} 次 · 平均 {zijinHistoricalEvidence.results.validation.averageNetPct.toFixed(3)}%</small></p><p><span>2026 盲测</span><b className={zijinHistoricalEvidence.results.blindTest.averageNetPct>=0?'positive':'negative'}>{(zijinHistoricalEvidence.results.blindTest.winRate*100).toFixed(1)}%</b><small>{zijinHistoricalEvidence.results.blindTest.trades} 次 · 平均 {zijinHistoricalEvidence.results.blindTest.averageNetPct.toFixed(3)}%</small></p></div>
        <div className="zijin-history-verdict"><b>{historicalPassed?'下一步':'为什么拒绝'}</b><span>{historicalPassed?'通过样本外门槛只代表可以人工评审；该实验仍与 V4 隔离，必须先进入模拟观察，不能自动修改正式策略。':`扣除 ${zijinHistoricalEvidence.methodology.roundTripCostPct.toFixed(2)}% 往返成本后，训练或验证仍未达到正期望与胜率门槛。该组合只保留为失败证据，后续研究会加入开盘阶段、板块相对强弱和量价衰竭因子，不会为了显示高胜率放宽结果标签。`}</span></div>
      </div>
      <div className={`zijin-pattern-result ${zijinPeerPatternDiscovery.conclusion.status}`}>
        <div className="zijin-pattern-title"><div><span>紫金规律扫描 · 阶段二已完成</span><h3>{zijinPeerPatternDiscovery.conclusion.message}</h3><p>阶段一已检验 {zijinPatternDiscovery.dataset.labeledScenarios.toLocaleString()} 个仅靠紫金自身价量形成的候选场景；阶段二加入 6 只黄金、铜和有色同业的同分钟强弱，以及只来自前一交易日和前 5/20 日的历史结构。</p></div><em>{zijinPeerPatternDiscovery.conclusion.deployment}</em></div>
        <div className="zijin-pattern-metrics"><p><span>因果候选场景</span><b>{zijinPeerPatternDiscovery.dataset.labeledScenarios.toLocaleString()}</b><small>下一分钟开盘成交；不读未来</small></p><p><span>完整交易日</span><b>{zijinPeerPatternDiscovery.dataset.tradingDays.toLocaleString()}</b><small>{zijinPeerPatternDiscovery.dataset.firstDate}—{zijinPeerPatternDiscovery.dataset.lastDate}</small></p><p><span>分钟面板</span><b>{zijinPeerPatternDiscovery.dataset.stockCount} 股</b><small>{zijinPeerPatternDiscovery.dataset.minuteRows.toLocaleString()} 行 · 覆盖 {(zijinPeerPatternDiscovery.dataset.meanPeerCoverage*100).toFixed(0)}%</small></p><p><span>跨期稳定规律</span><b>{zijinPeerPatternDiscovery.stableRuleCount}</b><small>2025 验证后才开启 2026 盲测</small></p></div>
        <div className="zijin-pattern-next"><b>胜率不能靠回看最高低点制造</b><span>{zijinPeerPatternDiscovery.stableRuleCount?`已发现 ${zijinPeerPatternDiscovery.stableRuleCount} 组通过盲测的候选，下一步仍需模拟观察和人工评审。`:`同业与历史结构仍未形成可部署规则。后续需要补入 ${zijinPeerPatternDiscovery.conclusion.nextRequiredFactors.join('、')}；未达到 65% 样本外门槛的规律继续淘汰。`}</span></div>
      </div>
      <div className={`zijin-pattern-result zijin-external-stage ${zijinExternalFactorReadiness.status}`}>
        <div className="zijin-pattern-title"><div><span>紫金规律扫描 · 阶段三数据接入</span><h3>{zijinExternalFactorReadiness.message}</h3><p>阶段三把国际金价、铜价、大盘指数、港股紫金和公告事件作为研究慢层。每个值必须在当时已经公开，并通过“来源时间 ≤ A 股当前分钟”的因果对齐；它不会直接改变盘中 V4 买卖点。</p></div><em>{zijinExternalFactorReadiness.deployment}</em></div>
        <div className="zijin-external-sources">{zijinExternalFactorReadiness.requiredSources.map(source=><p key={source.id} className={source.status}><span>{source.label}</span><b>{source.status==='ready'?'已接入':'等待数据'}</b><small>{source.role} · {source.resolution}</small></p>)}</div>
        <div className="zijin-pattern-next"><b>当前没有启动外部因子训练</b><span>{zijinExternalFactorReadiness.nextStep} 未导入真实数据前不显示胜率，也不会伪装成持续训练。</span></div>
      </div>
      <div className="zijin-evidence"><p><span>完整分时</span><b>{zijinFactorResearch.evidence.sessions} 日</b></p><p><span>历史候选样本</span><b>{zijinFactorResearch.evidence.samples} 条</b></p><p><span>样本外验证</span><b>{zijinFactorResearch.evidence.validationSamples} 条</b></p><p><span>验证胜率</span><b>{zijinFactorResearch.evidence.ready&&zijinFactorResearch.evidence.validationWinRate!==null?`${(zijinFactorResearch.evidence.validationWinRate*100).toFixed(1)}%`:'暂不展示'}</b></p><strong>{zijinFactorResearch.evidence.label}；当前展示最近一次离线训练结果，数据更新后需重新启动训练；盘中判断只读取当前及此前分钟。</strong></div>
      <footer><b>与 Smart‑T V4 隔离</b><span>不会修改档位、买卖点或风控阈值；通过样本外验证和人工评审后，才允许进入模拟观察。</span></footer>
    </section>}
    <div className="research-bottom"><div><span>自动分时研究</span><b>{autoSamples.length} 个完整交易日</b>{autoSamples.length?<div className="auto-sample-list">{autoSamples.slice(0,3).map(item=><p key={item.date}><b>{item.date}</b><em className={item.net>=0?'valid':'invalid'}>{item.status}</em></p>)}</div>:<small>公开源尚未提供可用的完整历史分时，系统不会伪造样本。</small>}</div><div><span>最近人工确认</span>{notes.length?notes.slice(0,3).map(note=><p key={note.id}><b>{note.date} · {note.mode}</b><em className={note.outcome==='有效'?'valid':note.outcome==='无效'?'invalid':''}>{note.outcome}</em><small>{note.note}</small></p>):<p className="empty-note">尚无人工确认；这不会阻止系统自动计算客观分时样本。</p>}</div><aside><span>升级规则</span><b>自动收集 → 样本外验证 → 人工评审</b><small>达到 30 条只代表可以评审，不代表自动启用。正式策略与真实下单始终保持人工控制。</small></aside></div>
  </section>;
}

const marketStrategies = [
  {rank:1,name:'胡萝卜波段兔',author:'A客户',mode:'模拟盘',win:78,returns:8.6,drawdown:2.1,cycles:41,days:36,risk:'中风险',price:0,followers:126,tags:['VWAP','反T','量能确认'],summary:'高开转弱后等待回抽失败，分批反T；14:50前强制恢复底仓。'},
  {rank:2,name:'稳稳闭环兔',author:'量化小林',mode:'模拟盘',win:72,returns:6.9,drawdown:1.2,cycles:68,days:63,risk:'低风险',price:19,followers:284,tags:['低回撤','正反T','硬风控'],summary:'以低频高确认信号为主，单次不超过底仓1/4，连续失败两次即停止。'},
  {rank:3,name:'开盘雷达兔',author:'北辰',mode:'回测',win:69,returns:11.3,drawdown:4.8,cycles:93,days:90,risk:'高风险',price:39,followers:91,tags:['集合竞价','开盘30分','趋势过滤'],summary:'09:30开始扫描，至少4个真实分钟点后只用当时已出现数据判断低开转强与高开转弱。'},
  {rank:4,name:'午后均值兔',author:'青禾',mode:'模拟盘',win:74,returns:5.2,drawdown:1.9,cycles:37,days:45,risk:'中风险',price:9,followers:76,tags:['均值回归','VWAP','午后'],summary:'午后偏离VWAP后等待量价收敛，优先完成已有循环，不追逐新信号。'},
  {rank:5,name:'新锐挑战兔',author:'NeoQuant',mode:'回测',win:66,returns:13.7,drawdown:6.4,cycles:29,days:22,risk:'高风险',price:0,followers:48,tags:['灵敏档','超买超卖','小样本'],summary:'灵敏型候选策略，收益较高但样本量较少，目前仅允许历史回测与模拟观察。'},
];

const builtInStrategies = [
  {id:'steady-pullback',name:'稳健回踩观察',tag:'低频 · 低回撤优先',fit:'适合先建立纪律：仅在趋势背景与回踩确认同时满足时观察。',rules:['09:30 开始扫描，09:33 前只积累样本','价格结构与量能同时确认','单日最多 2 次候选'],risk:'连续两次无效后，当日暂停'},
  {id:'opening-reversal',name:'开盘反转确认',tag:'开盘 · 正反T候选',fit:'观察高开转弱或低开转强，不用第一根波动直接下结论。',rules:['09:30 起扫描，09:33 最早确认','回抽失败/站回需二次确认','不追逐快速拉升或跳水'],risk:'09:45 前仅用 1/6 底仓试单'},
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
    <div className="market-hero"><div><span className="eyebrow">RABBIT STRATEGY MARKET</span><h1>策略智能体排行榜</h1><p>发现、比较并模拟跟随优秀的用户策略。所有指标都同时展示样本与风险，不用单一胜率制造错觉。</p></div></div>
    <div className="market-guard"><b>测试版安全边界</b><span>支持策略发布、订阅与模拟跟随</span><span>真实资金自动交易保持关闭</span><span>不代管资金，不承诺收益</span></div>
    <section className="builtin-strategies"><div className="builtin-head"><div><span className="eyebrow">BUILT-IN PLAYBOOKS</span><h2>内置策略库</h2><p>这些是透明的研究规则，不是收益承诺。启用后只进入模拟观察和记录，不会自动下单。</p></div><b>已启用 {enabledBuiltIns.length} / {builtInStrategies.length}</b></div><div className="builtin-grid">{builtInStrategies.map(item=>{const enabled=enabledBuiltIns.includes(item.id);return <article className={enabled?'enabled':'disabled'} key={item.id}><div><span>{item.tag}</span><em>{enabled?'运行中':'未启用'}</em></div><h3>{item.name}</h3><p>{item.fit}</p><ul>{item.rules.map(rule=><li key={rule}>{rule}</li>)}</ul><small>风控：{item.risk}</small><button onClick={()=>toggleBuiltIn(item.id)}>{enabled?'取消观察 · 运行中':'启用模拟观察'}</button></article>})}</div></section>
    <div className="market-stats"><div><span>公开策略</span><b>128</b><small>46个通过样本检查</small></div><div><span>今日模拟跟随</span><b>1,284</b><small>全部由用户主动开启</small></div><div><span>平均闭环胜率</span><b>68.4%</b><small>至少20次闭环才统计</small></div><div><span>风险暂停</span><b className="amber-text">7</b><small>触发回撤或仓位异常</small></div></div>
    <div className="market-toolbar"><div>{['综合榜','胜率榜','收益榜','低回撤榜'].map(item=><button className={sort===item?'active':''} onClick={()=>setSort(item)} key={item}>{item}</button>)}</div><div className="market-toolbar-actions"><span>排行榜每个交易日收盘后更新</span><button className="market-publish" onClick={()=>setPublishing(true)}>＋ 发布我的策略</button></div></div>
    <div className="market-list"><div className="market-row market-title"><span>排名 / 策略</span><span>验证状态</span><span>胜率</span><span>扣费净收益</span><span>最大回撤</span><span>样本</span><span>订阅</span><span/></div>{rows.map(item=><div className="market-row" key={item.name}><span className="market-name"><i>{item.rank<=3?`TOP ${item.rank}`:`#${item.rank}`}</i><b>{item.name}</b><small>{item.author} · {item.tags.join(' / ')}</small></span><span><em className={item.mode==='模拟盘'?'verified':'backtested'}>{item.mode}</em><small>{item.days}个交易日</small></span><strong className="market-win">{item.win}%</strong><strong className="market-return">+{item.returns}%</strong><strong className="market-drawdown">-{item.drawdown}%</strong><span><b>{item.cycles}次闭环</b><em className={`risk-badge ${item.risk==='高风险'?'high':item.risk==='中风险'?'medium':'low'}`}>{item.risk}</em></span><span><b>{item.price===0?'免费':`¥${item.price}/月`}</b><small>{item.followers}人关注</small></span><button onClick={()=>setSelected(item)}>查看策略 →</button></div>)}</div>
    {selected&&<div className="market-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null)}}><div className="strategy-detail"><button className="detail-close" onClick={()=>setSelected(null)}>×</button><span className="eyebrow">STRATEGY PROFILE · #{selected.rank}</span><h2>{selected.name}</h2><p>{selected.summary}</p><div className="detail-author"><span>创建者</span><b>{selected.author}</b><em>{selected.mode} · {selected.days}个交易日</em></div><div className="detail-metrics"><div><span>闭环胜率</span><b>{selected.win}%</b></div><div><span>扣费净收益</span><b className="teal">+{selected.returns}%</b></div><div><span>最大回撤</span><b>-{selected.drawdown}%</b></div><div><span>有效样本</span><b>{selected.cycles}次</b></div></div><div className="detail-rules"><h3>策略说明</h3><p>费用、滑点、T+1可卖数量和尾盘恢复为系统硬风控，订阅者不能关闭。</p><p>模拟跟随只生成提醒和虚拟成交记录，不会连接或操作真实券商账户。</p></div><button className={subscribed.includes(selected.name)?'followed':''} onClick={()=>follow(selected.name)}>{subscribed.includes(selected.name)?'✓ 已加入模拟跟随':selected.price===0?'免费模拟跟随':`订阅并模拟跟随 · ¥${selected.price}/月`}</button><small>历史表现不代表未来收益 · 可随时停止跟随</small></div></div>}
    {publishing&&<div className="market-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setPublishing(false)}}><div className="publish-card"><button className="detail-close" onClick={()=>setPublishing(false)}>×</button><span className="eyebrow">PUBLISH STRATEGY</span><h2>发布我的策略智能体</h2><p>测试版将先把策略送入回测与模拟观察，不会直接进入真实交易。</p><label>策略名称<input value={draftName} onChange={e=>{setDraftName(e.target.value);setDraftMessage('')}} placeholder="例如：我的稳健反T兔"/></label><label>策略说明<textarea value={draftSummary} onChange={e=>{setDraftSummary(e.target.value);setDraftMessage('')}} placeholder="用直白语言说明买入、卖出、仓位和停止条件"/></label><div><label>分享方式<select><option>免费分享</option><option>付费订阅（审核后开放）</option></select></label><label>风险等级<select><option>低风险</option><option>中风险</option><option>高风险</option></select></label></div><button onClick={saveDraft}>保存草稿</button><small>{draftMessage||'至少完成20次有效闭环后，才会显示在公开排行榜。'}</small></div></div>}
  </section>;
}

function TrainingView({running,progress,evidence,onRun}:{running:boolean;progress:number;evidence:{sessions:number;cycles:number;wins:number;net:number;maxDrawdown:number;confidence:string;winRate:number|null};onRun:()=>void}) {
  const currentStage=progress<40?1:progress<70?2:progress<90?3:4;
  const reviewReady=progress===100&&!running;
  const sampleCoverage=Math.min(100,evidence.sessions/20*100);
  const validationCoverage=Math.min(100,evidence.cycles/20*100);
  const canReview=evidence.sessions>=20&&evidence.cycles>=20;
  const primaryAction=()=>reviewReady?document.getElementById('promotion-review')?.scrollIntoView({behavior:'smooth',block:'center'}):onRun();
  return <section className="module-view training-view">
    <div className="module-head"><div><span className="eyebrow">SMART-T FUSION V4 · RESEARCH PIPELINE</span><h1>四兔盘后研究中心</h1><p>收盘后首次打开网站会自动检查当前股票的完整分时样本；它不是云端常驻任务，也不会自动改策略或下单。</p></div><button className="lab-run" onClick={primaryAction} disabled={running}>{running?'正在检查真实样本…':reviewReady?'查看本轮证据':'运行盘后研究'}<span>→</span></button></div>
    <div className="training-purpose"><div><span>训练目标</span><h2>让 V4 在扣除费用后更稳，而不是把历史胜率刷高</h2><p>候选参数包括 VWAP 偏离、连续确认、最低净价差、单次仓位、连续失败熔断和尾盘恢复时间。任何候选都必须通过未见样本和风控检查，再由人工决定是否进入模拟观察。</p></div><div className="training-role-grid"><p><b>训练兔</b><span>历史分时寻找候选</span></p><p><b>挑战兔</b><span>未见样本防过拟合</span></p><p><b>正式兔</b><span>只运行已批准版本</span></p><p><b>风控兔</b><span>异常一票否决</span></p></div></div>
    <div className={`lab-progress ${!running&&progress<100?'paused':''}`}><div className="lab-progress-head"><span>当前股票 · 最近 {evidence.sessions} 个完整交易日 · Smart-T V4 {evidence.confidence}</span><b>{running?'正在核对':progress===100?'本轮检查完成':'等待盘后运行'} · {progress}%</b></div><i><em style={{width:`${progress}%`}}/></i><div className="lab-stages"><span className={progress>0?'done':''}>读取真实分时</span><span className={`${progress>=40?'done ':''}${currentStage===1&&!running?'current':''}`}>训练兔统计</span><span className={`${progress>=70?'done ':''}${currentStage===2&&!running?'current':''}`}>挑战兔验证</span><span className={`${progress>=90?'done ':''}${currentStage===3&&!running?'current':''}`}>风控兔检查</span><span className={`${progress===100?'done ':''}${currentStage===4&&!running?'current':''}`}>人工评审门</span></div></div>
    <div className="lab-grid">{agents.map((agent,index)=>{const value=index===0?sampleCoverage:index===1?validationCoverage:index===2?(canReview?100:0):Math.min(100,evidence.maxDrawdown*1000);const label=index===0?`${evidence.sessions}/20 日`:index===1?`${evidence.cycles}/20 闭环`:index===2?(canReview?'可评审':'正式版锁定'):`${(evidence.maxDrawdown*100).toFixed(2)}%`;return <article className={`lab-agent ${index===3&&evidence.maxDrawdown<.03?'risk-safe':''}`} key={agent.name}><div><span className={`agent-icon a${index}`}><img src={agent.avatar} alt={`${agent.name} AI头像`}/></span><p><b>{agent.name}</b><small>{index===0?'真实分时覆盖':index===1?'有效闭环验证':index===2?'正式版本门控':'最大回撤检查'}</small></p><em>{index===0?(running?'统计中':'已读取'):index===1?'样本外检查':index===2?'需人工批准':evidence.maxDrawdown<.03?'风控绿灯':'风控关注'}</em></div><strong>{label}<small>{index===0?'自动样本':index===1?'扣费闭环':index===2?'自动晋升关闭':'最差历史回撤'}</small></strong><i><span style={{width:`${value}%`}}/></i><p>{index===0?'统计真实完整交易日，不制造随机样本。':index===1?'验证扣费后闭环表现，未交易日不算亏损。':index===2?'只有人工确认后才允许进入模拟观察。':'回撤、费用和仓位异常拥有一票否决权。'}</p></article>})}</div>
    <div className="lab-results"><div className="lab-metrics"><h2>当前真实证据</h2><div><p><span>完整交易日</span><b>{evidence.sessions}</b></p><p><span>正式闭环</span><b>{evidence.cycles}</b></p><p><span>盈利闭环</span><b>{evidence.wins}</b></p><p><span>扣费胜率</span><b>{evidence.winRate===null?'—':`${(evidence.winRate*100).toFixed(1)}%`}</b></p><p><span>扣费净盈亏</span><b className={evidence.net>=0?'positive':'negative'}>{evidence.cycles?money(evidence.net):'—'}</b></p><p><span>最大回撤</span><b>-{(evidence.maxDrawdown*100).toFixed(2)}%</b></p></div><small>这些数值来自当前股票已取得的完整分时回放，不再展示固定演示胜率、收益或候选编号。</small></div><div className="promotion-card" id="promotion-review"><span>Smart-T V4 研究门</span><h2>{canReview?'可以进入人工评审':'继续积累真实样本'}</h2><p>{canReview?'样本数量达到最低评审门槛；仍需核对不同市场环境、费用与风险。':'至少需要 20 个完整交易日且形成 20 个有效闭环，才讨论候选参数。'}</p><button disabled>{canReview?'人工评审功能待开放':'样本不足 · 不生成候选'}</button><small>自动晋升永久关闭；四兔不会直接改动操盘台正式版本。</small></div></div>
    <div className="lab-log"><h2>本轮研究记录</h2>{[['本机','训练兔',`读取 ${evidence.sessions} 个完整交易日`],['本机','挑战兔',evidence.cycles?`核对 ${evidence.cycles} 个扣费闭环，盈利 ${evidence.wins} 个`:'当前没有足够正式闭环'],['本机','风控兔',`最差历史回撤 ${(evidence.maxDrawdown*100).toFixed(2)}%`],['本机','正式兔',canReview?'达到人工评审数量门槛，正式版仍锁定':'样本不足，不生成可晋升版本']].map(row=><div className={`log-${row[1]}`} key={`${row[1]}-${row[2]}`}><time>{row[0]}</time><i/><b>{row[1]}</b><span>{row[2]}</span></div>)}</div>
  </section>;
}

function HoldingsView({position,stock,tradingDate,rows,onRowsChange}:{position:StockPosition;stock:{code:string;name:string;price:string;change:string};tradingDate:string;rows:TradeLedgerRow[];onRowsChange:(next:TradeLedgerRow[])=>void}) {
  const [filter, setFilter] = useState("全部流水");
  const [planDone, setPlanDone] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [formError,setFormError]=useState("");
  const summary=useMemo(()=>summarizeTradeLedger(rows,position,tradingDate),[rows,position,tradingDate]);
  const isInvalid=(row:TradeLedgerRow)=>row.status==='已失效';
  const currentShares=summary.currentShares;
  const targetGap=summary.targetGap;
  const hasDeviation=targetGap!==0;
  const allRows = summary.rows;
  const visibleRows = allRows.filter(row => filter === "全部流水" || (filter === "未配对" ? row.status !== "已配对" && row.status !== "已失效" : row.side === filter));
  const invalidate=(id:string)=>onRowsChange(allRows.map(row=>row.id===id?{...row,status:'已失效',cycle:'用户手动设为失效',result:'不计入持仓'}:row));
  const submitTrade=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    setFormError("");
    const form=new FormData(event.currentTarget);
    const side:TradeLedgerRow['side']=String(form.get('side'))==='卖出'?'卖出':'买入';
    const price=Number(form.get('price'));
    const quantity=Number(form.get('qty'));
    if(!Number.isFinite(price)||price<=0){setFormError("成交价必须大于 0。");return;}
    if(!Number.isInteger(quantity)||quantity<100||quantity%100!==0){setFormError("A 股数量必须是 100 股的整数倍。");return;}
    const maxSellable=Math.min(summary.remainingSellable,Math.max(0,summary.currentShares));
    if(side==='卖出'&&quantity>maxSellable){
      setFormError(`本股当前最多可卖 ${maxSellable.toLocaleString("zh-CN")} 股（昨日剩余可卖 ${summary.remainingSellable.toLocaleString("zh-CN")} 股、当前持仓 ${Math.max(0,summary.currentShares).toLocaleString("zh-CN")} 股），本次 ${quantity.toLocaleString("zh-CN")} 股未保存。`);
      return;
    }
    const now=new Date();
    const id=globalThis.crypto?.randomUUID?.()??`${now.getTime()}-${Math.random().toString(36).slice(2)}`;
    const row:TradeLedgerRow={id,tradingDate,time:now.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),side,price,quantity,cycle:'手动待配对',fee:'待计算',result:'—',status:'未配对'};
    onRowsChange([row,...allRows]);
    event.currentTarget.reset();
    setManualOpen(false);
  };
  return <section className="holdings-view">
    <div className="holdings-head">
      <div><span className="eyebrow">POSITION RECONCILIATION</span><h1>持仓与成交对账</h1><p>这里只统计你的成交记录，不统计市场行情。当前未连接券商，手动补录后才会更新本机持仓与当日闭环。</p></div>
      <div className="reconcile-state"><i/><span>{tradingDate} · 当前股票独立账本</span><b>本机记录</b></div>
    </div>
    {summary.oversold&&<div className="ledger-form-error" role="alert"><b>账本异常：</b>累计卖出已超过昨日可卖，或当前持仓已经为负。正式信号已按剩余可卖数量收紧，请立即核对券商实际成交。</div>}
    <div className="position-overview">
      <div className="position-identity"><span>{stock.code}</span><h2>{stock.name}</h2><small>沪深A · T+1</small></div>
      <div className="position-metric" title="当前股票独立保存的收盘恢复目标"><span>计划底仓</span><b>{position.plannedBase.toLocaleString()}<small> 股</small></b></div>
      <div className="position-metric" title="今日开盘前实际持仓"><span>开盘持仓</span><b>{position.openingShares.toLocaleString()}<small> 股</small></b></div>
      <div className="position-metric" title="受 A 股 T+1 规则约束"><span>昨日可卖</span><b>{position.sellable.toLocaleString()}<small> 股</small></b></div>
      <div className="position-metric" title="开盘持仓加本机有效成交"><span>当前持仓</span><b>{currentShares.toLocaleString()}<small> 股</small></b></div>
      <div className="position-metric" title="卖出成交会实时扣减可卖数量"><span>剩余可卖</span><b>{summary.remainingSellable.toLocaleString()}<small> 股</small></b></div>
      <div className={`position-metric exposure-metric ${hasDeviation?'warning':'profit'}`} title={hasDeviation?'收盘前应恢复计划底仓':'已恢复计划底仓'}><span>距计划底仓</span><b>{targetGap>0?'+':''}{targetGap.toLocaleString()}<small> 股</small></b></div>
    </div>
    <div className="reconcile-grid">
      <div className="ledger-panel">
        <div className="panel-top"><div><h2>我的今日成交记录</h2><p>公开行情无法读取券商成交；只有你为当前账户、当前股票、当前交易日补录的有效记录，才会更新持仓和操盘台可卖数量。</p></div><div><button className="manual-entry-button" onClick={()=>{setManualOpen(value=>!value);setFormError("")}}>{manualOpen?'收起补录':'＋ 手动补录成交'}</button>{allRows.length>0&&<button onClick={()=>{onRowsChange([]);setFormError("")}}>清空本股记录</button>}</div></div>
        {manualOpen&&<form className="manual-trade-form" onSubmit={submitTrade}><select name="side" defaultValue="买入"><option>买入</option><option>卖出</option></select><input name="price" type="number" min="0.01" step="0.01" required placeholder="成交价"/><input name="qty" type="number" min="100" step="100" required placeholder="数量（股）"/><button type="submit">保存成交</button></form>}
        {formError&&<div className="ledger-form-error" role="alert"><b>补录失败：</b>{formError}</div>}
        <div className="ledger-filter">{["全部流水","买入","卖出","未配对"].map(item=>{const count=allRows.filter(row=>item==='全部流水'||(item==='未配对'?row.status!=="已配对":row.side===item)).length;return <button key={item} className={filter===item?'active':''} onClick={()=>setFilter(item)}>{item}<span>{count}</span></button>})}</div>
        <div className="ledger-table">
          <div className="ledger-row ledger-title"><span>成交时间</span><span>方向</span><span>成交价</span><span>数量</span><span>配对循环</span><span>费用</span><span>循环净收益</span><span>状态</span></div>
          {visibleRows.length?visibleRows.map(row=>{const result=row.result??'—';return <div className="ledger-row" key={row.id}><span>{row.time??'--:--:--'}</span><span className={row.side==='买入'?'buy-text':'sell-text'}>{row.side}</span><b>{row.price.toFixed(2)}</b><span>{row.quantity.toLocaleString('zh-CN')}</span><span>{row.cycle??'手动待配对'}</span><span>{row.fee??'待计算'}</span><b className={result.startsWith('+')?'positive':''}>{result}</b><span><em className={row.status==='已配对'?'matched':'unmatched'}>{row.status}</em>{!isInvalid(row)&&<button className="invalidate-trade" onClick={()=>invalidate(row.id)}>设为失效</button>}</span></div>}):<div className="ledger-empty">当前股票今天还没有补录成交</div>}
        </div>
      </div>
      <aside className="recovery-panel">
        <span className="recovery-kicker">INTRADAY CLOSE ALERT</span><h2>{hasDeviation?`距计划底仓：${targetGap>0?'多出':'不足'} ${Math.abs(targetGap).toLocaleString()} 股`:'当前已恢复计划底仓'}</h2><p>{hasDeviation?`本股开盘持仓加今日有效补录后，相对计划底仓偏离 ${Math.abs(targetGap).toLocaleString()} 股。请先核对券商实际持仓与昨日可卖，再决定如何闭环。`:'没有待闭合的本股仓位偏离。后续补录的买卖成交会自动反映在这里。'}</p>
        {hasDeviation?<><div className="close-deadline"><span>最迟处理时间</span><b>14:50</b><em>到点仍未闭合将升级告警</em></div><div className="recovery-scale"><div><span>目标底仓 {position.plannedBase.toLocaleString()}</span><b>当前 {currentShares.toLocaleString()}</b></div><i><em style={{width:`${Math.min(100,Math.max(8,position.plannedBase?Math.max(0,currentShares)/position.plannedBase*100:0))}%`}}/></i><small>这里以本股开盘持仓和本机补录成交计算，执行前必须自行核对券商实际持仓与可卖数量。</small></div><div className="recovery-steps"><h3>动态风控处理</h3><div><b>01</b><p><strong>冻结新的同向信号</strong><span>仓位恢复计划底仓前，不再新开同方向做T循环。</span></p></div><div><b>02</b><p><strong>核对本股可卖旧仓</strong><span>当前偏离 {Math.abs(targetGap).toLocaleString()} 股；今日剩余可卖为 {summary.remainingSellable.toLocaleString()} 股。</span></p></div><div><b>03</b><p><strong>14:50 强制升级告警</strong><span>仍未闭合则标记为异常敞口，不计入策略成功收益。</span></p></div></div><button className={planDone?'done':''} onClick={()=>setPlanDone(!planDone)}>{planDone?'✓ 当日平仓提醒已开启':'开启当日平仓提醒'}<span>→</span></button></>:<div className="recovery-safe"><i>✓</i><div><b>本机账本已平衡</b><span>计划底仓与当前持仓一致，无需展示静态处置规则。</span></div><dl><div><dt>今日买入</dt><dd>{summary.bought.toLocaleString()} 股</dd></div><div><dt>今日卖出</dt><dd>{summary.sold.toLocaleString()} 股</dd></div><div><dt>距计划底仓</dt><dd>0 股</dd></div></dl></div>}
        <small className="recovery-note">这里只生成风控提醒，不会自动下单；自动交易接口仍保持关闭。</small>
      </aside>
    </div>
    <div className="cycle-summary"><div><span>今日买入</span><b>{summary.bought.toLocaleString()} 股</b><small>本股有效补录</small></div><div><span>今日卖出</span><b>{summary.sold.toLocaleString()} 股</b><small>本股有效补录</small></div><div><span>有效成交</span><b>{summary.validCount} 笔</b><small>已失效不计入</small></div><div><span>距计划底仓</span><b className={hasDeviation?'warn':''}>{Math.abs(targetGap).toLocaleString()} 股</b><small>收盘目标必须为 0</small></div><div><span>账本状态</span><b>{summary.oversold?'异常':hasDeviation?'待核对':'已平衡'}</b><small>不替代券商实际数据</small></div></div>
  </section>;
}

function BacktestView({ profile, setProfile, position, stock, stocks, activeStock, onSelectStock }: { profile: string; setProfile: (value: string) => void; position:StockPosition; stock:{code:string;name:string;price:string;change:string}; stocks:{code:string;name:string;price:string;change:string}[]; activeStock:number; onSelectStock:(index:number)=>void }) {
  const [capital, setCapital] = useState(200000);
  const [baseShares, setBaseShares] = useState(position.plannedBase);
  const [sellable, setSellable] = useState(position.sellable);
  const [feeRate, setFeeRate] = useState(0.025);
  const [slippage, setSlippage] = useState(0.02);
  const [minCommission, setMinCommission] = useState(true);
  const [slippageMode, setSlippageMode] = useState<"percent"|"tick">("percent");
  const [forceCloseTime, setForceCloseTime] = useState("1450");
  const [running, setRunning] = useState(false);
  const [runMode, setRunMode] = useState<"single"|"batch"|null>(null);
  const [singleRunCount, setSingleRunCount] = useState(0);
  const [singleRunDate, setSingleRunDate] = useState("");
  const [requestedSessionDate, setRequestedSessionDate] = useState("");
  const [availableSessionDates, setAvailableSessionDates] = useState<string[]>([]);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [batch, setBatch] = useState<BatchBacktestResult | null>(null);
  const [source, setSource] = useState<MarketData | null>(null);
  const [error, setError] = useState("");
  const [runStatus, setRunStatus] = useState("等待运行");
  const [accountNotice, setAccountNotice] = useState("");
  const [batchFetchProgress, setBatchFetchProgress] = useState({ready:0,attempted:0});
  const [lastAction, setLastAction] = useState<"idle"|"single"|"batch">("idle");
  const batchRunSequence = useRef(0);
  const selectBacktestStock=(index:number)=>{
    setRequestedSessionDate("");
    setAvailableSessionDates([]);
    setSingleRunDate("");
    setResult(null);
    setBatch(null);
    setSource(null);
    setError("");
    setRunStatus("等待运行");
    setLastAction("idle");
    onSelectStock(index);
  };
  const replay=(data:MarketData,account?:{capital:number;baseShares:number;sellable:number}):BacktestResult=>runSmartTReplay(data.minutes ?? [],{
    capital:account?.capital ?? capital,baseShares:account?.baseShares ?? baseShares,sellable:account?.sellable ?? sellable,feeRate,slippage,minCommission,slippageMode,forceCloseTime,profile,
    previousClose:data.quote.previousClose ?? data.bars.at(-2)?.close ?? null,
    randomValue:0,
  });
  const replayLegacy=(data:MarketData,account?:{capital:number;baseShares:number;sellable:number})=>runIntradayBlindReplayLegacy(data.minutes ?? [],account?.capital ?? capital,account?.baseShares ?? baseShares,account?.sellable ?? sellable,feeRate,slippage,minCommission,slippageMode,forceCloseTime,0);
  const fetchStock=async (code:string) => {
    const response=await fetch(`/api/market-data?code=${encodeURIComponent(code)}`, { cache:"no-store" });
    if(!response.ok) throw new Error("market unavailable");
    return await response.json() as MarketData;
  };
  const sessionData=(data:MarketData,session:IntradaySession):MarketData=>{
    const prices=session.minutes.map(point=>point.price);
    const open=prices[0] ?? null; const price=prices.at(-1) ?? null;
    const previousClose=session.previousClose;
    return {...data,sampleDate:session.date,minutes:session.minutes,intradaySessions:data.intradaySessions,quote:{...data.quote,price,previousClose,open,high:prices.length?Math.max(...prices):null,low:prices.length?Math.min(...prices):null,change:price!==null&&previousClose!==null?price-previousClose:null,changePercent:price!==null&&previousClose?((price-previousClose)/previousClose)*100:null}};
  };
  const runSingle = async () => {
    const attempt=singleRunCount+1;
    setSingleRunCount(attempt); setSingleRunDate("");
    setLastAction("single");
    setAccountNotice("");
    setRunning(true); setRunMode("single"); setError(""); setResult(null); setBatch(null); setSource(null);
    setRunStatus(`第 ${attempt} 次：正在获取 ${stock.code} ${stock.name} 最新完整分时…`);
    try {
      const fetched=await fetchStock(stock.code);
      const sessions=[...(fetched.intradaySessions ?? [])].sort((left,right)=>right.date.localeCompare(left.date));
      if(!sessions.length) {
        setResult(null);
        setBatch(null);
        setError("当前未取得完整交易日的 1 分钟分时，未执行回测；半日行情不会被误当成收盘。");
        setRunStatus("未取得完整分时样本");
        return;
      }
      // One click means one complete trading day. The engine still decides
      // causally minute by minute, but repeated clicks must not manufacture
      // extra samples by changing the reveal point inside the same day.
      setAvailableSessionDates(sessions.map(session=>session.date));
      const selected=sessions.find(session=>session.date===requestedSessionDate) ?? sessions[0];
      const data=sessionData(fetched,selected);
      setSingleRunDate(selected.date);
      setSource(data);
      const configuredQuantity=Math.min(baseShares,sellable);
      const replayCapital=capital>0?capital:200_000;
      const fallbackShares=standardBacktestShares(data,replayCapital);
      const useStandardAccount=configuredQuantity<300;
      const replayAccount=useStandardAccount?{capital:replayCapital,baseShares:fallbackShares,sellable:fallbackShares}:undefined;
      if(useStandardAccount&&fallbackShares>=300){
        setCapital(replayCapital);
        setBaseShares(fallbackShares);
        setSellable(fallbackShares);
        setAccountNotice(`原模拟底仓不足 300 股，本次已使用标准模拟底仓 ${fallbackShares.toLocaleString("zh-CN")} 股；仅用于回测，不写入持仓对账。`);
      }
      const calculated=replay(data,replayAccount);
      setResult(calculated);
      setBatch(null);
      const candidateCount=calculated.diagnostics?.candidates ?? 0;
      const observationCount=buildCausalReferencePoints(data.minutes ?? [],calculated.observations ?? []).length;
      setRunStatus(calculated.trades
        ? `全日回放完成：形成 ${calculated.trades} 个闭环，净收益 ${money(calculated.net)}`
        : `全日回放完成：展示 ${observationCount} 个候补观察点，出现 ${candidateCount} 次候选判定，0 个通过正式过滤`);
      setTimeout(()=>document.getElementById("single-backtest-result")?.scrollIntoView({behavior:"smooth",block:"start"}),0);
    } catch {
      setResult(null); setBatch(null); setSource(null);
      setError("公开行情源暂不可用，未生成测试结果。请稍后重试。");
      setRunStatus("行情获取失败");
    } finally { setRunning(false); setRunMode(null); }
  };
  const runBatch = async () => {
    batchRunSequence.current += 1;
    const entropy=new Uint32Array(2);
    if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(entropy);
    else { entropy[0]=Math.floor(Math.random()*0xffffffff); entropy[1]=Math.floor(Math.random()*0xffffffff); }
    const seed=`batch-${Date.now().toString(36)}-${entropy[0].toString(36)}-${entropy[1].toString(36)}-${batchRunSequence.current.toString(36)}`;
    setLastAction("batch");
    setAccountNotice("随机批次统一使用 ¥200,000 现金及约 ¥90,000 的逐股标准模拟底仓，不读取当前股票的真实持仓。");
    setBatchFetchProgress({ready:0,attempted:0});
    setRunning(true); setRunMode("batch"); setError(""); setRunStatus("正在读取全 A 股股票池…");
    try {
      let universeResponse:StockUniverseResponse={provider:"representative-fallback",total:representativeBacktestItems.length,fallback:true,stocks:representativeBacktestItems};
      try {
        const response=await fetch("/api/stock-universe",{cache:"no-store"});
        if(!response.ok)throw new Error("stock universe unavailable");
        const payload=await response.json() as StockUniverseResponse;
        const valid=(payload.stocks??[]).filter(item=>/^\d{6}$/.test(item.code)&&item.name);
        if(valid.length<30)throw new Error("stock universe incomplete");
        universeResponse={...payload,total:valid.length,stocks:valid};
      } catch {
        universeResponse={provider:"representative-fallback",total:representativeBacktestItems.length,fallback:true,stocks:representativeBacktestItems};
      }
      const queue=diversifyStockUniverse(universeResponse.stocks,`${seed}:market`);
      const sampledItems=queue.slice(0,10);
      const sampledCodes=sampledItems.map(item=>item.code);
      const available:{item:StockUniverseItem;data:MarketData}[]=[];
      let cursor=0;
      let attempted=0;
      while(available.length<10 && cursor<queue.length){
        const wave=queue.slice(cursor,cursor+(10-available.length));
        cursor+=wave.length;
        setRunStatus(`正在从${universeResponse.fallback?"代表回退池":"全 A 股"}获取真实分时 · 已取得 ${available.length}/10 · 已尝试 ${attempted} 只`);
        const fetched=await Promise.allSettled(wave.map(async item=>({item,data:await fetchStock(item.code)})));
        attempted+=wave.length;
        available.push(...fetched.flatMap(entry=>entry.status==="fulfilled" && (entry.value.data.intradaySessions ?? []).length ? [entry.value] : []));
        setBatchFetchProgress({ready:available.length,attempted});
        setRunStatus(`真实分时已取得 ${available.length}/10 · 已尝试 ${attempted} 只${available.length<10?"，正在自动补抽":"，开始逐股因果回放"}`);
      }
      if(!available.length) throw new Error("no random batch minute data");
      const trials=available.flatMap(selected=>{
        const sessionPool=[...selected.data.intradaySessions!]
          .sort((left,right)=>right.date.localeCompare(left.date))
          .slice(0,5);
        const session=sampleWithSeed(sessionPool,1,`${seed}:${selected.item.code}:session`)[0];
        if(!session)return [];
        const data=sessionData(selected.data,session);
        const batchCapital=200_000;
        const batchShares=standardBacktestShares(data,batchCapital);
        const account={capital:batchCapital,baseShares:batchShares,sellable:batchShares};
        return [{selected:{...selected,data},result:replay(data,account),legacy:replayLegacy(data,account)}];
      });
      const results=trials.map(item=>item.result);
      const legacyResults=trials.map(item=>item.legacy);
      const summarize=(items:BacktestResult[]):BatchMetrics=>{
        const cycleNets=items.flatMap(item=>item.cycleNets);
        const roundNets=items.map(item=>item.net);
        const positive=cycleNets.filter(value=>value>0).reduce((sum,value)=>sum+value,0);
        const negative=Math.abs(cycleNets.filter(value=>value<0).reduce((sum,value)=>sum+value,0));
        return {samples:items.length,completed:cycleNets.length,wins:cycleNets.filter(value=>value>0).length,gross:items.reduce((sum,item)=>sum+item.gross,0),fees:items.reduce((sum,item)=>sum+item.fees,0),executionCost:items.reduce((sum,item)=>sum+item.executionCost,0),net:items.reduce((sum,item)=>sum+item.net,0),tradingRounds:items.filter(item=>item.trades>0).length,profitableRounds:roundNets.filter(value=>value>0).length,losingRounds:roundNets.filter(value=>value<0).length,profitFactor:negative?positive/negative:null,maxDrawdown:Math.max(...items.map(item=>item.maxDrawdown))};
      };
      const metrics=summarize(results); const legacy=summarize(legacyResults);
      const roundNets=results.map(item=>item.net).sort((a,b)=>a-b);
      const stockFeedback=available.map(selected=>{
        const stockTrials=trials.filter(item=>item.selected.item.code===selected.item.code);
        const stockResults=stockTrials.map(item=>item.result);
        const completed=stockResults.reduce((sum,item)=>sum+item.trades,0);
        const wins=stockResults.reduce((sum,item)=>sum+item.wins,0);
        let positiveT=0; let reverseT=0;
        stockResults.forEach(item=>{
          const seen=new Set<number>();
          item.actions.forEach(action=>{
            if(!action.cycleId || seen.has(action.cycleId)) return;
            seen.add(action.cycleId);
            if(action.direction==="正T") positiveT+=1;
            if(action.direction==="反T") reverseT+=1;
          });
        });
        const rawCandidates=stockResults.reduce((sum,item)=>sum+(item.diagnostics?.candidates ?? 0),0);
        const candidates=stockResults.reduce((sum,item)=>sum+(item.observations?.filter(observation=>observation.stage==="candidate").length ?? 0),0);
        const regimeBlocked=stockResults.reduce((sum,item)=>sum+(item.diagnostics?.regimeBlocked ?? 0),0);
        const costBlocked=stockResults.reduce((sum,item)=>sum+(item.diagnostics?.costBlocked ?? 0),0);
        const scoreBlocked=stockResults.reduce((sum,item)=>sum+(item.diagnostics?.scoreBlocked ?? 0),0);
        const structureBlocked=stockResults.reduce((sum,item)=>sum+(item.diagnostics?.structureBlocked ?? 0),0);
        const strongSellTrendBlocked=stockResults.reduce((sum,item)=>sum+(item.diagnostics?.strongSellTrendBlocked ?? 0),0);
        const strongBuyTrendBlocked=stockResults.reduce((sum,item)=>sum+(item.diagnostics?.strongBuyTrendBlocked ?? 0),0);
        const net=stockResults.reduce((sum,item)=>sum+item.net,0);
        const primaryTrial=stockTrials[0];
        const referenceObservations=primaryTrial
          ? buildCausalReferencePoints(primaryTrial.selected.data.minutes ?? [],primaryTrial.result.observations ?? []) as ReplayObservation[]
          : [];
        const keyObservations=referenceObservations.length;
        const feedback=completed
          ? net>0
            ? `形成 ${completed} 个闭环，扣费后盈利`
            : net<0
              ? `形成 ${completed} 个闭环但扣费后亏损，展开查看原因`
              : `形成 ${completed} 个闭环，扣费后持平`
          : rawCandidates===0
            ? "已有买卖观察参考，但未形成正式候选"
            : strongSellTrendBlocked>0
              ? "单边强势仍在 VWAP 上方，逆势反T候选已拦截"
              : strongBuyTrendBlocked>0
                ? "单边弱势仍在 VWAP 下方，逆势正T候选已拦截"
            : structureBlocked>=rawCandidates*.5
              ? "候选主要被量价结构确认拦截"
              : scoreBlocked>=rawCandidates*.5
                ? "候选评分未达到正式入场门槛"
            : regimeBlocked>=rawCandidates*.5
              ? "候选主要被趋势冲突拦截"
              : costBlocked>=rawCandidates*.5
                ? "预期空间不足以覆盖成本与风险"
                : "量价确认不足，未强行开仓";
        return {
          code:selected.item.code,
          name:selected.data.quote.name || selected.item.name,
          date:primaryTrial?.selected.data.sampleDate ?? "",
          sessions:selected.data.intradaySessions?.length ?? 0,
          samples:stockResults.length,
          completed,
          wins,
          winRate:completed?wins/completed:null,
          positiveT,
          reverseT,
          net,
          noTrade:stockResults.filter(item=>item.trades===0).length,
          candidates,
          keyObservations,
          strongSellTrendBlocked,
          strongBuyTrendBlocked,
          feedback,
          minutes:primaryTrial?.selected.data.minutes ?? [],
          actions:primaryTrial?.result.actions ?? [],
          observations:referenceObservations,
          cycles:primaryTrial?buildBatchCycles(primaryTrial.result,{feeRate,slippage,minCommission,slippageMode}):[],
        };
      });
      const representative=trials.find(item=>item.selected.item.code===stock.code && item.result.trades>0) ?? trials.find(item=>item.selected.item.code===stock.code) ?? trials.find(item=>item.result.trades>0) ?? trials[0];
      setResult(representative.result); setSource(representative.selected.data);
      const uniqueSessions=trials.length;
      const middle=Math.floor(roundNets.length/2);
      const medianNet=roundNets.length%2 ? roundNets[middle] : ((roundNets[middle-1] ?? 0)+(roundNets[middle] ?? 0))/2;
      const candidateStocks=results.filter(item=>item.observations?.some(observation=>observation.stage==="candidate")).length;
      const candidateDecisions=results.reduce((sum,item)=>sum+(item.observations?.filter(observation=>observation.stage==="candidate").length ?? 0),0);
      const referenceStocks=stockFeedback.filter(item=>new Set(item.observations.map(observation=>observation.direction)).size===2).length;
      const keyObservations=stockFeedback.reduce((sum,item)=>sum+item.keyObservations,0);
      const replacementStocks=Math.max(0,attempted-sampledCodes.length);
      const industries=new Set(available.map(item=>item.item.industry).filter(Boolean)).size;
      setBatch({...metrics,seed,rounds:trials.length,stocks:available.length,attemptedStocks:attempted,replacementStocks,uniqueSessions,noTrade:results.filter(item=>item.trades===0).length,referenceStocks,candidateStocks,candidateDecisions,keyObservations,averageNet:metrics.net/Math.max(1,trials.length),medianNet,providers:[...new Set(available.map(item=>item.data.provider))],universeSize:universeResponse.total,universeProvider:universeResponse.provider,fallbackUniverse:universeResponse.fallback,industries,legacy,stockFeedback});
      setRunStatus(`随机${available.length}股测试完成：观察参考 ${referenceStocks}/${available.length} 股，正式候选 ${candidateStocks}/${available.length} 股，正式触发 ${metrics.tradingRounds}/${available.length} 股`);
    } catch {
      setResult(null); setBatch(null); setSource(null);
      setError("公开行情池当前没有取得任何可用的完整 1 分钟分时；本次没有伪造或补齐数据，请稍后重试。");
      setRunStatus("随机10股测试未完成");
    } finally { setRunning(false); setRunMode(null); }
  };
  const fullDayMinutes=source?.minutes ?? [];
  const fullDayPrices=fullDayMinutes.map(point=>point.price);
  const observedMin=fullDayPrices.length?Math.min(...fullDayPrices):0;
  const observedMax=fullDayPrices.length?Math.max(...fullDayPrices):1;
  const pricePadding=Math.max(.01,(observedMax-observedMin)*.12);
  const chartMin=Math.max(.01,observedMin-pricePadding),chartMax=observedMax+pricePadding;
  const chartTicks=Array.from({length:5},(_,index)=>chartMax-(chartMax-chartMin)*index/4);
  const chartPoint = (value:number,index:number) => ({ x:65+(index/Math.max(1,fullDayMinutes.length-1))*755, y:18+((chartMax-value)/Math.max(.01,chartMax-chartMin))*184 });
  const points = fullDayPrices.length > 1 ? fullDayPrices.map((value,index)=>{ const point=chartPoint(value,index); return `${point.x},${point.y}`; }).join(" ") : "";
  const previousClose=source?.quote.previousClose ?? null;
  const previousCloseY=previousClose && previousClose>=chartMin && previousClose<=chartMax ? chartPoint(previousClose,0).y : null;
  const formatTime=(value:string|undefined)=>value && value.length>=4 ? `${value.slice(0,2)}:${value.slice(2,4)}` : "--:--";
  const formatDate=(value:string|undefined)=>value && value.length===8 ? `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}` : value ?? "—";
  const visibleBacktestObservations=result
    ? selectVisibleChartObservations(buildCausalReferencePoints(fullDayMinutes,result.observations ?? []) as ReplayObservation[])
    : [];
  const cycles = (() => {
    const paired: { first: ReplayAction; second: ReplayAction }[] = [];
    let pending: ReplayAction | null = null;
    result?.actions.forEach(action => {
      if (!pending) pending = action;
      else if (!action.cycleId || !pending.cycleId || action.cycleId === pending.cycleId) { paired.push({ first: pending, second: action }); pending = null; }
    });
    return paired.map(({ first, second }, index) => {
      const raw=(action:ReplayAction)=>slippageMode === "tick" ? action.price+(action.side==="卖出"?slippage:-slippage) : action.price/(action.side==="卖出"?1-slippage/100:1+slippage/100);
      const rawFirst=raw(first),rawSecond=raw(second); const quantity=first.quantity;
      const direction=first.side==="卖出"?"反T":"正T";
      const gross=(direction==="正T"?rawSecond-rawFirst:rawFirst-rawSecond)*quantity;
      const executionCost=(Math.abs(rawFirst-first.price)+Math.abs(rawSecond-second.price))*quantity;
      const commission=(action:ReplayAction)=>Math.max(minCommission ? 5 : 0, action.price*action.quantity*feeRate/100);
      const fees=commission(first)+commission(second)+(first.side==="卖出"?first.price*quantity*.0005:second.price*quantity*.0005);
      const holdingMinutes=Number(second.meta?.hold??Math.max(0,tradingMinuteOffset(second.time)-tradingMinuteOffset(first.time)));
      return { index: index + 1, first, second, direction, holdingMinutes, gross, executionCost, fees, net: gross - executionCost - fees };
    });
  })();
  return <section className="backtest-view">
    <div className="backtest-head">
      <div><span className="eyebrow">FULL-DAY CAUSAL REPLAY</span><h1>完整交易日分时盲测</h1><p>从开盘到收盘逐分钟推进，策略在每一分钟只能读取当时及此前数据；回放完成后显示整日分时并标注真实决策点。</p></div>
      <div className="integrity-badges"><span><i/>真实分时数据</span><span><i/>无未来函数</span><span><i/>真实可卖数量</span></div>
    </div>
    <div className="backtest-grid">
      <aside className="backtest-config">
        <div className="config-title"><h2>回测参数</h2><span>{running ? "计算中" : runStatus}</span></div>
        <label>回测股票<select className="backtest-stock-select" value={activeStock} onChange={event=>selectBacktestStock(Number(event.target.value))} aria-label="选择回测股票">{stocks.map((item,index)=><option key={item.code} value={index}>{item.code} {item.name}</option>)}</select></label>
        <label>买卖逻辑<div className="field static-field"><b>Smart-T 融合策略 V4</b><span>正/反 T + 开盘试单 + 趋势量价 + 成本风控</span></div></label>
        <div className="field-pair"><label>样本来源<div className="field static-field date-display"><b>{source ? "公开真实分时" : "运行后显示"}</b><span>{batch ? `${batch.uniqueSessions} 个不重复股票日` : source?.sampleDate ?? "完整交易日"}</span></div></label><label>决策方式<div className="field static-field date-display"><b>全日逐分钟因果判断</b><span>不读未来高低点/收盘价</span></div></label></div>
        <label>回放交易日
          <select value={requestedSessionDate} onChange={event=>setRequestedSessionDate(event.target.value)} disabled={!availableSessionDates.length}>
            <option value="">最新完整交易日{availableSessionDates[0]?`（${formatDate(availableSessionDates[0])}）`:"（首次运行后列出）"}</option>
            {availableSessionDates.slice(1).map(date=><option key={date} value={date}>{formatDate(date)}</option>)}
          </select>
          <small className="config-inline-help">首次运行会读取可用的完整交易日；随后可选择历史日期重新逐分钟回放。</small>
        </label>
        <label>V4 策略档位<div className="profile-picker">{strategyProfiles.map(item=><button type="button" className={profile===item?'active':''} onClick={()=>setProfile(item)} key={item}>{item.replace('档','')}</button>)}</div><small className="config-inline-help">与操盘台共用当前档位；同一套 Smart-T 融合策略 V4，仅调整确认门槛与信号频率。</small></label>
        <div className="broker-account-box">
          <div className="broker-account-head"><b>模拟证券账户</b><span>仅用于回测撮合，不连接真实券商</span></div>
          <div className="field-pair"><label>可用资金（现金）<NumberStepper value={capital} unit="元" step={10000} min={0} onChange={setCapital}/><small>可直接输入；正 T 先买入时受此金额约束</small></label><label>计划底仓（收盘目标）<NumberStepper value={baseShares} unit="股" step={100} min={0} onChange={setBaseShares}/><small>开盘前已有、收盘时应恢复的持仓数量</small></label></div>
          <div className="field-pair"><label>昨日持仓可卖<NumberStepper value={sellable} unit="股" step={100} min={0} onChange={setSellable}/><small>T+1 下今天允许先卖出的旧仓数量</small></label><label>单次做 T 上限<div className="field static-field"><b>{Math.floor(Math.min(baseShares, sellable)/3/100)*100}</b><span>股</span></div><small>取底仓与可卖量较小值的 1/3，按 100 股取整</small></label></div>
          <div className="position-logic-help"><b>下单与闭环逻辑</b><div><span><i>正 T</i>现金买入 → 卖出等量昨日旧仓</span><span><i>反 T</i>卖出昨日旧仓 → 低位等量买回</span></div><p>两种方式都不改变计划底仓。正 T 会按可用资金自动缩量，反 T 会受昨日可卖旧仓约束；不足 100 股时不生成订单。</p></div>
        </div>
        {accountNotice&&<p className="account-notice">{accountNotice}</p>}
        <label>券商费率模板<select value={`${feeRate}-${minCommission}`} onChange={event=>{const templates:{[key:string]:[number,boolean]}={"0.025-true":[0.025,true],"0.01-false":[0.01,false],"0.0085-true":[0.0085,true]};const value=templates[event.target.value];if(value){setFeeRate(value[0]);setMinCommission(value[1])}}}><option value="0.025-true">默认行业价：万2.5（最低5元）</option><option value="0.01-false">常见大客户价：万1免五</option><option value="0.0085-true">尊享价：万0.85（最低5元）</option></select></label>
        <div className="cost-box"><div><span>佣金</span><NumberStepper value={feeRate} unit="%" step={0.005} min={0} decimals={3} onChange={setFeeRate}/></div><label className="fee-toggle"><input type="checkbox" checked={minCommission} onChange={event=>setMinCommission(event.target.checked)}/> 每笔佣金不足 5 元按 5 元收取</label><div><span>单边滑点</span><span className="slippage-controls"><select value={slippageMode} onChange={event=>{setSlippageMode(event.target.value as "percent"|"tick");setSlippage(event.target.value==="tick"?0.01:0.02)}}><option value="percent">百分比</option><option value="tick">跳数（元）</option></select><NumberStepper value={slippage} unit={slippageMode==="tick"?"元":"%"} step={slippageMode==="tick"?0.01:0.005} min={0} decimals={3} onChange={setSlippage}/></span></div><div><span>印花税</span><b>卖出 0.05%</b></div></div>
        <label>尾盘强制恢复时间<select value={forceCloseTime} onChange={event=>setForceCloseTime(event.target.value)}><option value="1445">14:45</option><option value="1450">14:50</option><option value="1455">14:55</option></select></label>
        <button className="run-backtest" onClick={()=>void runSingle()} disabled={running}>{runMode==='single'?`正在全日回放 ${stock.code}…`:`全日回放 ${stock.code} ${stock.name}`}<span>→</span></button>
        <div className="replay-secondary-actions"><button type="button" onClick={()=>void runBatch()} disabled={running}>{runMode==='batch'?`全A股抽取/回放 ${batchFetchProgress.ready}/10（已尝试 ${batchFetchProgress.attempted}）`:'全A股随机10股真实分时批次'}</button></div>
        <div className={`single-run-status ${running?'running':error?'error':result||batch?'done':'idle'}`} role="status" aria-live="polite"><i/><span><b>{running?(runMode==='batch'?'正在测试全A股随机10股批次…':`正在全日回放 ${stock.code}…`):error?'运行失败':lastAction==='batch'&&batch?`${batch.fallbackUniverse?'代表池回退':'全A股'}随机10股完成 · 正式触发 ${batch.tradingRounds}/${batch.stocks} 股`:lastAction==='single'&&result?(result.trades?`全日回放完成：触发 ${result.trades} 个做T闭环`:`全日回放完成：${result.diagnostics?.candidates ?? 0} 次候选判定，0 个正式闭环`):'等待选择测试'}</b><small>{runStatus}{singleRunDate?` · ${formatDate(singleRunDate)} 完整交易日`:''}</small></span></div>
        <p className="seed-note">单股测试按所选股票回放；批量测试优先从当前全 A 股普通股票列表中无放回随机抽取 10 只，并尽量分散行业。行情缺失会自动补抽；全市场列表不可用时会明确显示“代表池回退”。</p>
        <p className="config-note">连续失败 2 次当日停止；14:30 后不新开 T；{forceCloseTime.slice(0,2)}:{forceCloseTime.slice(2)} 前强制恢复计划底仓，避免尾盘流动性恶化。</p>
        <p className="config-note">状态：{runStatus}</p>
        {error&&<p className="config-note">{error}</p>}
      </aside>
      <div className="backtest-results" id="single-backtest-result">
        {batch&&<BatchReport batch={batch} representativeCode={source?.quote.code}/>}
        <div className="result-summary">
          <div className="result-primary"><span>{batch?"批次样本净收益":"净收益"}</span><strong className={result?pnlClass(result.net):""}>{result ? money(result.net) : "—"}</strong><em className={result?pnlClass(result.net):""}>{result ? `${(result.net/capital*100).toFixed(3)}%` : "运行后显示"}</em></div>
          <div><span>理论毛收益</span><b className={result?pnlClass(result.gross):""}>{result ? money(result.gross) : "—"}</b><small>未扣费用与滑点</small></div><div><span>费用与滑点</span><b className={result?"pnl-loss":""}>{result ? money(-(result.fees+result.executionCost)) : "—"}</b><small>佣金、印花税及双向滑点</small></div><div><span>最大回撤</span><b className={result&&result.maxDrawdown>0?"pnl-loss":""}>{result ? `-${(result.maxDrawdown*100).toFixed(3)}%` : "—"}</b><small>{source ? "费用进入逐点资金曲线" : "运行后显示"}</small></div>
        </div>
        <div className="equity-panel">
          <div className="panel-heading">
            <div><h2>{source?`完整交易日真实分时 · ${source.quote.code} ${source.quote.name}`:"完整交易日真实分时"}</h2><span>{result ? `${formatDate(source?.sampleDate)} · ${formatTime(fullDayMinutes[0]?.time)} 至 ${formatTime(fullDayMinutes.at(-1)?.time)} · 策略从 ${formatTime(result.startTime)} 起逐分钟判断` : "运行后显示"}</span></div>
            <div className="curve-legend"><span><i/>真实分时价格</span><span className="base-legend"><i/>昨收</span><span className="sell-marker">● 卖出</span><span className="buy-marker">● 买入 / 买回</span>{visibleBacktestObservations.length>0&&<span className="candidate-marker">○ 候补观察</span>}</div>
          </div>
          <svg viewBox="0 0 840 230" preserveAspectRatio="none" aria-label="完整交易日真实分时及做T买卖点">
            <defs><linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#28d7c4" stopOpacity=".16"/><stop offset="1" stopColor="#28d7c4" stopOpacity="0"/></linearGradient></defs>
            {chartTicks.map((value,index)=>{const y=18+index*46;return <g key={value}><line x1="65" x2="820" y1={y} y2={y} className="equity-grid"/><text x="57" y={y+3} textAnchor="end" className="equity-axis-label">¥{value.toFixed(2)}</text></g>})}
            {previousCloseY!==null&&<line x1="65" x2="820" y1={previousCloseY} y2={previousCloseY} className="equity-base-line"/>}
            {points&&<>
              <polyline points={`${points} 820,202 65,202`} fill="url(#equityFill)"/>
              <polyline points={points} className="equity-line" fill="none"/>
              {visibleBacktestObservations.map((observation,index)=>{
                const minuteIndex=fullDayMinutes.findIndex(point=>point.time===observation.time);
                if(minuteIndex<0)return null;
                const price=observation.price ?? fullDayMinutes[minuteIndex].price;
                const point=chartPoint(price,minuteIndex);
                const isSell=observation.direction==="反T";
                const fill="#d6a63f";
                const label=observationConfirmationLabel(observation);
                return <g className="backtest-candidate-marker" key={`${observation.direction}-${observation.time}-${index}`}>
                  <title>{`${label}；${observationDirectionNote(observation)}；${observation.reason}${observation.blockers.length?`；未通过：${observation.blockers.join("；")}`:""}`}</title>
                  <circle cx={point.x} cy={point.y} r="4" fill="#071312" stroke={fill} strokeWidth="1.7"/>
                  <text x={point.x} y={isSell?point.y-9:point.y+15} textAnchor="middle" fill={fill}>{label}</text>
                </g>;
              })}
              {result?.actions.map((action,index)=>{
                const minuteIndex=fullDayMinutes.findIndex(point=>point.time===action.time);
                if(minuteIndex<0)return null;
                const point=chartPoint(fullDayMinutes[minuteIndex].price,minuteIndex);
                const isSell=action.side==="卖出";
                const fill=isSell?"#ff6464":"#28d7c4";
                const label=action.direction==="反T"?(isSell?"反T先卖":"反T买回"):(action.side==="买入"?"正T买入":"正T卖出");
                return <g key={`${action.side}-${action.time}-${index}`}><title>{action.reason ?? label}</title><circle cx={point.x} cy={point.y} r="5" fill={fill} stroke="#071312" strokeWidth="2"/><text x={point.x} y={isSell?point.y-10:point.y+17} textAnchor="middle" fill={fill} fontSize="10" fontWeight="700">{label}</text></g>;
              })}
              <text x="65" y="222" className="equity-time-label">{formatTime(fullDayMinutes[0]?.time)}</text>
              <text x="442" y="222" textAnchor="middle" className="equity-time-label">{formatTime(fullDayMinutes[Math.floor(fullDayMinutes.length/2)]?.time)}</text>
              <text x="820" y="222" textAnchor="end" className="equity-time-label">{formatTime(fullDayMinutes.at(-1)?.time)}</text>
            </>}
          </svg>
          <div className="chart-truth-note"><span>曲线展示整日真实 1 分钟价格；悬停标记可查看触发或拦截原因，决策不读取未来数据</span><b>开 {fullDayPrices[0]?.toFixed(2) ?? "—"} · 高 {observedMax.toFixed(2)} · 低 {observedMin.toFixed(2)} · 收 {fullDayPrices.at(-1)?.toFixed(2) ?? "—"}</b></div>
        </div>
        {result&&<div className="replay-actions"><div className="panel-heading"><div><h2>盲测循环复盘</h2><span>{cycles.length ? "每个闭环均列出持仓时间、开仓与平仓原因" : "本次没有完整循环"}</span></div></div>{cycles.length ? <div className="cycle-list">{cycles.map(cycle=><article className={`cycle-row ${cycle.net>=0?"profit":"loss"}`} key={`${cycle.first.time}-${cycle.second.time}`}><div><b>{cycle.direction} 循环 #{cycle.index}</b><span>{cycle.first.side} {cycle.first.time} ¥ {cycle.first.price.toFixed(2)} → {cycle.second.side} {cycle.second.time} ¥ {cycle.second.price.toFixed(2)}</span><p className="cycle-reason"><em>开仓依据</em>{cycle.first.reason ?? "趋势、量价与成本门槛同时通过"}</p><p className="cycle-reason"><em>平仓依据</em>{cycle.second.reason ?? "达到闭环或风控退出条件"}</p></div><div><small>持仓时间</small><b>{cycle.holdingMinutes} 分钟</b></div><div><small>数量</small><b>{cycle.first.quantity.toLocaleString()} 股</b></div><div><small>毛收益</small><b>{money(cycle.gross)}</b></div><div><small>费用 + 滑点</small><b>{money(-(cycle.fees + cycle.executionCost))}</b></div><div><small>单次循环净收益</small><strong>{money(cycle.net)}</strong></div></article>)}</div> : <p className="config-note">策略在本完整交易日内没有形成同时满足成本、趋势和风控条件的正/反 T 循环，资金不变；整日真实分时仍保留用于复盘。</p>}<p className="config-note">毛收益按未滑点理论成交价计算；“费用 + 滑点”已包含佣金、卖出印花税和双向滑点。</p></div>}
        {result&&<details className="candidate-audit" key={`candidate-audit-${singleRunDate}`} open={result.trades===0 || undefined}>
          <summary><span><b>候选信号过滤审计</b><small>{result.trades===0?"没有正式闭环时自动展开，展示关键拦截样本":"展开查看关键候选及过滤原因"}</small></span><em>候选判定 {result.diagnostics?.candidates ?? 0} 次 · {result.trades} 个正式闭环</em></summary>
          <div className="candidate-audit-metrics">
            <span><small>候选判定次数</small><b>{result.diagnostics?.candidates ?? 0}</b></span>
            <span><small>候补观察点</small><b>{visibleBacktestObservations.length}</b></span>
            <span><small>趋势拦截（强趋势 {result.diagnostics?.strongTrendBlocked ?? 0}）</small><b>{result.diagnostics?.regimeBlocked ?? 0}</b></span>
            <span><small>成本拦截</small><b>{result.diagnostics?.costBlocked ?? 0}</b></span>
            <span><small>资金/仓位拦截</small><b>{result.diagnostics?.cashBlocked ?? 0}</b></span>
            <span><small>正式闭环</small><b>{result.trades}</b></span>
          </div>
          {visibleBacktestObservations.length>0?<div className="candidate-audit-list">{visibleBacktestObservations.map((observation,index)=>{
            const pivotState=observation.pivotAssessment==="strong"?"强确认":observation.pivotAssessment==="confirmed"?"已确认":"未确认";
            return <article key={`${observation.direction}-${observation.time}-${index}`} className={observation.executable?"passed":observation.stage==="candidate"?"candidate":"watch"}>
              <header><span><i>{observation.stage==="candidate"?"候选":"观察"}</i><b>{formatTime(observation.time)} · {observationConfirmationLabel(observation)}</b></span><em>{observation.score}/{observation.threshold} 分 · 预估价差 {observation.edge.toFixed(2)}%</em></header>
              <p>{observationDirectionNote(observation)}；{observation.reason}</p>
              {observation.pivotTime&&<small>此前参考：{formatTime(observation.pivotTime)} ¥{observation.pivotPrice?.toFixed(2) ?? "—"} · {observation.pivotLabel ?? pivotState}；提示只在 {formatTime(observation.time)} 确认</small>}
              <div className="candidate-audit-blockers">{observation.executable?<span className="passed">已通过正式过滤</span>:observation.blockers.map((blocker,blockerIndex)=><span key={`${blocker}-${blockerIndex}`}>{blocker}</span>)}</div>
            </article>;
          })}</div>:<p className="candidate-audit-empty">本交易日没有形成达到展示门槛的观察点；不是按钮失效，也不会虚构信号。</p>}
          <p className="candidate-audit-foot">“候选判定次数”按触发条件的分钟累计，不等于独立信号；每只股票每天最多展示 2 个候补买点和 2 个候补卖点，同方向至少间隔约 16 个有效分钟点。候补不可执行，只有同时通过趋势、成本、仓位和风控，才升级为正式买卖点。</p>
        </details>}
        <div className="result-bottom"><div className="metric-table"><div><span>交易日</span><b>{result?.days ?? "—"}</b></div><div><span>模拟循环</span><b>{result?.trades ?? "—"}</b></div><div><span>胜出循环</span><b>{result?.wins ?? "—"}</b></div><div><span>循环胜率</span><b className="teal">{result?.trades ? `${(result.wins/result.trades*100).toFixed(2)}%` : "—"}</b></div><div><span>底仓设定</span><b>{baseShares.toLocaleString()} 股</b></div><div><span>数据源</span><b>{source?.provider ?? "—"}</b></div></div><div className="failure-panel"><h3>计算说明</h3><p><span>样本证券</span><b>{source ? `${source.quote.code} ${source.quote.name}` : "未运行"}</b></p><p><span>样本交易日</span><b>{source?.sampleDate ?? "—"}</b></p><p><span>样本规模</span><b>{source ? `${source.minutes?.length ?? 0} 个分钟点` : "—"}</b></p><p><span>执行规则</span><b>逐点揭示，不看未来</b></p><p><span>费用模型</span><b>佣金 + 滑点 + 印花税</b></p><p><span>计算状态</span><b className="failure-alert">{result?.status ?? "等待运行"}</b></p></div></div>
      </div>
    </div>
  </section>;
}

function NumberStepper({value,unit,step,min,onChange,decimals=0}:{value:number;unit:string;step:number;min:number;onChange:(value:number)=>void;decimals?:number}) {
  const format=(number:number)=>decimals ? number.toFixed(decimals) : number.toLocaleString('zh-CN');
  const commit=(draft:string)=>{
    const normalized=draft.replace(/,/g,'').replace(decimals?/[^\d.]/g:/\D/g,'');
    const parsed=Number(normalized);
    if(normalized!==''&&Number.isFinite(parsed))onChange(Math.max(min,Number(parsed.toFixed(decimals))));
  };
  return <div className="number-stepper" role="group" aria-label={`${value}${unit}`}>
    <button type="button" onClick={()=>onChange(Math.max(min,Number((value-step).toFixed(decimals))))} aria-label={`减少${step}${unit}`}>−</button>
    <label><input key={value} type="text" inputMode={decimals?"decimal":"numeric"} defaultValue={format(value)} onFocus={event=>event.currentTarget.select()} onBlur={event=>commit(event.currentTarget.value)} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();if(event.key==='Escape'){event.currentTarget.value=format(value);event.currentTarget.blur()}}} aria-label={`输入${unit}数值`}/><em>{unit}</em></label>
    <button type="button" onClick={()=>onChange(Number((value+step).toFixed(decimals)))} aria-label={`增加${step}${unit}`}>＋</button>
  </div>;
}
