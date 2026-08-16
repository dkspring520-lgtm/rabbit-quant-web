"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import type { ZijinFactorLifecycle } from "./zijin-factor-lifecycle-panel";
import "./globals.css";
import "./backtest.css";
import "./holdings.css";
import "./modules.css";
import "./home.css";
import "./onboarding.css";
import "./watchlist.css";
import "./marketplace.css";
import "./mobile.css";
import "./minimal.css";
import "./bunny-light.css";
import "./brand-cute.css";
import "./position-setup.css";
import "./referral.css";
import { buildHistoricalSimilarityArchive, runSmartTReplay } from "@/lib/smart-t-engine.mjs";
import { A_SHARE_INTRADAY_AXIS, intradayChartX, intradaySlotX, isAShareAfterHoursFixedPriceMinute, isAShareClosingAuctionMinute, isAShareRegularTradingMinute } from "@/lib/intraday-axis.mjs";
import { confirmStockPosition, loadStockPosition, migrateLegacyPosition, normalizeStockPosition, saveStockPosition } from "@/lib/stock-position.mjs";
import type { StockPosition } from "@/lib/stock-position.mjs";
import { normalizeTradeLedgerRows, summarizeTradeLedger, tradeLedgerDate, tradeLedgerKey } from "@/lib/trade-ledger.mjs";
import type { TradeLedgerRow } from "@/lib/trade-ledger.mjs";
import { analyzeZijinFactorResearch } from "@/lib/zijin-factor-research.mjs";
import { evaluateZijinOpeningPlaybook } from "@/lib/zijin-opening-playbook.mjs";
import { evaluateStockAgent, STOCK_AGENTS } from "@/lib/stock-agent-router.mjs";
import { randomizedUniqueQueue, sampleWithSeed } from "@/lib/batch-sampler.mjs";
import { buildCausalReferencePoints } from "@/lib/causal-reference-points.mjs";
import { mergeZijinReplayObservations } from "@/lib/zijin-replay-candidates.mjs";
import { buildZijinL2CausalReplayObservations, mergeZijinL2ReplayMinutes } from "@/lib/zijin-l2-causal-replay.mjs";
import { aShareSession } from "@/lib/a-share-session.mjs";
import { compactCandidateAlertHistory, compactChartObservations, compactRepairChartMarkers, fulfilledWatchlistSnapshots, isRecentCausalEvent, isVwapDisplacementObservation, selectLatestAlertableObservation } from "@/lib/live-monitor-alerts.mjs";
import { moveWatchlistItem, moveWatchlistItemByCode } from "@/lib/watchlist-order.mjs";
import { enforceWatchlistLimit, watchlistLimitForRole } from "@/lib/watchlist-limits.mjs";
import { normalizeWatchlistEntries } from "@/lib/watchlist-normalization.mjs";
import { REFERENCE_DATA_BOOTSTRAP_DELAY_MS, clientPollingInterval, isFastMarketDataPhase, passiveWatchlistItems, shouldRunClientPolling, shouldRunTradingDeskPolling } from "@/lib/client-polling-policy.mjs";
import { evaluateZijinSchedulerHealth } from "@/lib/zijin-scheduler-health.mjs";
import { evaluateZijinExperimentalReminder } from "@/lib/zijin-experimental-reminder.mjs";
import { conciseAlertSpeech, resolveAlertDelivery } from "@/lib/alert-delivery-policy.mjs";
import { cumulativeIntradayAverage, symmetricIntradayScale } from "@/lib/intraday-chart-model.mjs";
import { buildZijinPricePlan } from "@/lib/zijin-price-plan.mjs";
import { buildZijinPreopenPricePlan, evaluateZijinPreopenGate } from "@/lib/zijin-preopen-price-plan.mjs";
import { buildZijinMainForceTrack } from "@/lib/zijin-main-force-track.mjs";
import { evaluateZijinFundResponse } from "@/lib/zijin-fund-response.mjs";
import { summarizeZijinMainForceIntent } from "@/lib/zijin-main-force-intent.mjs";
import { analyzeZijinAhLinkage } from "@/lib/zijin-ah-linkage.mjs";
import { evaluateWeb4Microstructure } from "@/lib/web4-microstructure.mjs";
import { evaluateWeb4RealtimeMonitor } from "@/lib/web4-realtime-monitor.mjs";
import { evaluateZijinDisplacementWatch } from "@/lib/zijin-displacement-reminder.mjs";
import { explainTrainingRejection } from "@/lib/training-rejection-summary.mjs";
import { normalizeStrategyProfile, STRATEGY_PROFILES, STRATEGY_PROFILE_META } from "@/lib/strategy-profile.mjs";
import { normalizeProfitMode, profitModeSummary, smartTProfitModeOptions } from "@/lib/profit-mode.mjs";
import { resolveBacktestStrategyExperiment } from "@/lib/zijin-strategy-experiments.mjs";
import { resolveHistoricalPreviousClose } from "@/lib/historical-session-anchor.mjs";
import { executePersonalTrainingOrder, scorePersonalTrainingActions, summarizePersonalTraining, summarizeTrainingCycles } from "@/lib/personal-replay-training.mjs";
import { runZijinV29ShadowReplay, runZuoTV1ReconstructedReplay } from "@/lib/factor-research/zuot-v2-shadow.mjs";
import { clientFetch as fetch, startClientPolling } from "@/lib/client-polling.mjs";
const PublicLanding = dynamic(() => import("./public-landing"), {
  loading: () => <main className="public-site public-site-loading" aria-busy="true" />,
});
const ZijinFactorLifecyclePanel = dynamic(
  () => import("./zijin-factor-lifecycle-panel").then(module => module.ZijinFactorLifecyclePanel),
  { ssr:false },
);

const LIVE_CHART = Object.freeze({
  width: 920,
  height: 320,
  plotLeft: 62,
  // Reserve the right gutter for the symmetric percentage axis.
  plotRight: 858,
  priceTop: 20,
  priceBottom: 230,
  volumeTop: 252,
  volumeBottom: 300,
});

const liveChartX = (time:string|number|null|undefined) =>
  intradayChartX(time, LIVE_CHART.plotLeft, LIVE_CHART.plotRight - LIVE_CHART.plotLeft);

const liveChartSlotX = (slot:number) =>
  intradaySlotX(slot, LIVE_CHART.plotLeft, LIVE_CHART.plotRight - LIVE_CHART.plotLeft);

const liveChartPriceY = (price:number, min:number, max:number) => {
  const range=max-min||Math.max(max*.002,.01);
  return LIVE_CHART.priceTop+(max-price)/range*(LIVE_CHART.priceBottom-LIVE_CHART.priceTop);
};

const formatMainForceAmount = (value:number) => {
  const absolute=Math.abs(value);
  const sign=value>0?"+":value<0?"−":"";
  if(absolute>=100_000_000)return `${sign}${(absolute/100_000_000).toFixed(2)}亿`;
  if(absolute>=10_000)return `${sign}${(absolute/10_000).toFixed(1)}万`;
  return `${sign}${Math.round(absolute)}`;
};

const formatIntradayVolume = (value:number) => {
  const safe=Math.max(0,Number(value)||0);
  if(safe>=100_000_000)return `${(safe/100_000_000).toFixed(2)} 亿股`;
  if(safe>=10_000)return `${(safe/10_000).toFixed(1)} 万股`;
  return `${Math.round(safe).toLocaleString("zh-CN")} 股`;
};

const base64UrlToUint8Array = (value:string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = window.atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};

type MarketBar = { date:string; open:number; close:number; high:number; low:number; volume:number; amount:number };
type IntradayMinute = {time:string;price:number;volume:number;high?:number|null;low?:number|null;averagePrice?:number|null;timeVolumeBaseline?:number|null};
type IntradaySession = { date:string; previousClose:number|null; minutes:IntradayMinute[] };
type PersonalReplayArchive = { session:IntradaySession; source:string; coverage:{sessions:number;firstDate:string;lastDate:string|null} };
type MarketData = { provider:string; delayed:boolean; trial?:boolean; fetchedAt:string; sourceTimestamp?:string|null; sampleDate?:string; quote:{ code:string; name:string; price:number|null; previousClose?:number|null; change:number|null; changePercent:number|null; open:number|null; high:number|null; low:number|null; volume?:number|null; amount?:number|null }; bars:MarketBar[]; minutes?:IntradayMinute[]; intradaySessions?:IntradaySession[] };
type StockState = { label:string; level:"up"|"flat"|"down"|"risk"; score:number; summary:string; action:string; details:string[] };
type MarketContextItem = { id:string; label:string; group:"market"|"sector"|"related"|"cross"|"currency"; price:number|null; changePercent:number|null; sourceTimestamp:string|null; provider:string; inverse?:boolean };
type MarketContext = { code:string; profile:string; fetchedAt:string; items:MarketContextItem[]; gate:{ score:number; level:"normal"|"caution"|"restricted"|"locked"|"degraded"; label:string; action:string; positionFraction:number; hardLock:boolean; reasons:string[] }; availableSources:string[]; errors:string[]; events:{ status:string; label:string; participatesInGate:boolean } };
type EventRadarItem = { id:string; code:string; title:string; summary:string; url:string; source:string; sources?:string[]; relatedCount?:number; provider:string; official:boolean; publishedAt:string; sentiment:"positive"|"negative"|"neutral"; severity:"critical"|"warning"|"info"; reason:string; ageHours:number };
type EventRadarStock = { code:string; name:string; items:EventRadarItem[]; counts:{ positive:number; negative:number; neutral:number }; gate:{ level:"normal"|"caution"|"restricted"|"locked"; hardLock:boolean; score:number; label:string; action:string; reason:string } };
type EventRadarResponse = { fetchedAt:string; scanned:number; requested:number; pollSeconds:number; sources:string[]; stocks:EventRadarStock[]; errors:string[] };
type ZijinHkMarket = { symbol:string; name:string; provider:string; fetchedAt:string; sourceTimestamp:string|null; quote:{price:number;previousClose:number;changePercent:number}; minutes:{time:string;price:number}[] };
type TradingDeskSnapshot = { fetchedAt:string; market:MarketData|null; context:MarketContext|null; eventRadar:EventRadarResponse|null; zijinHk:ZijinHkMarket|null; errors:string[] };
type AlertSettings = { sound:boolean; system:boolean; background:boolean };
type TradeAlertToast = { id?:string; code?:string; eventKey?:string; source?:string; createdAt?:string; marketDate?:string; marketTime?:string; price?:number; level:"candidate"|"signal"|"risk"; rabbit:"buy"|"sell"|"both"; title:string; message:string };
function tradeAlertLabel(alert:TradeAlertToast){
  if(alert.level==="risk"||alert.rabbit==="both")return "风险提醒";
  if(alert.level==="candidate")return alert.rabbit==="buy"?"低位观察":"高位观察";
  return alert.rabbit==="buy"?"买入 / 买回":"卖出 / 减仓";
}
function tradeAlertGuide(alert:TradeAlertToast){
  if(alert.level==="risk"||alert.rabbit==="both")return "先暂停操作，查看风险依据";
  if(alert.level==="candidate")return "仅观察，尚未形成买卖点；同一点只提醒一次";
  return alert.rabbit==="buy"?"确认价格与仓位后再买":"确认价格与仓位后再卖";
}
type MonitorScanLog = { id:string|number; code:string; name:string; marketDate:string; marketTime:string; price:number|null; result:string; reason:string; provider:string|null; eventKey:string|null; createdAt:string; deliveryStatus?:"stored"|"displayed"|"notified"|"failed"|null; deliveryChannel?:string|null; deliveredAt?:string|null; deliveryError?:string|null };
type StockIdentityResult = { inputCode:string; inputName:string; code:string; name:string; status:"valid"|"corrected"|"unknown"; reason:string };
type Membership = { active:boolean; planId:MembershipPlanId|null; expiresAt:string|null; referralCode:string|null; referralCredits:number; referralReviews:number; referralRewardDays:number };
type MemberRecord = { id:string; username:string; displayName:string; role:"admin"|"member"; status:"active"|"paused"; createdAt:string; lastLoginAt:string|null; monitorCount:number; alertCount:number; membership:Membership|null };
type MembershipPlanId = "day"|"monthly"|"yearly";
type IssuedMembershipCode = { code:string; planId:MembershipPlanId; planLabel:string; days:number; createdAt:string; expiresAt:string };
type ZijinTrainingProgress = {
  schemaVersion:number;
  stock:{code:string;name:string};
  runId:string;
  status:"idle"|"running"|"completed"|"failed";
  stage:string;
  progress:number;
  processedCandidates:number;
  totalCandidates:number;
  message:string;
  updatedAt:string;
  meta?:{source:"runtime"|"bundled";servedAt:string;stale:boolean;automationSource?:"runtime"|"bundled"|null;reportSource?:"runtime"|"bundled"|null;automationStale?:boolean;automationHealth?:{status:"running"|"waiting"|"offline"|"failed"|"disabled";label:string;detail:string;heartbeatAgeSeconds:number|null;overdueSeconds:number}|null;trainerAlert?:{at:string;event:string;reason:string;action?:string}|null;trainerAlertHistorical?:boolean};
  automation?:{
    schemaVersion:number;
    stock:{code:string;name:string};
    scheduler:{enabled:boolean;mode:"change-driven";status:"idle"|"running"|"failed";reason:string;lastCheckAt:string;heartbeatAt:string;nextCheckAt:string;staleAfterSeconds:number};
    run:{id:string|null;stage:string;progress:number;startedAt:string|null;elapsedSeconds:number;currentTask:string};
    input:{data:{path:string;size:number;mtimeNs:number;sha256:string};protocol:{path:string;size:number;mtimeNs:number;sha256:string};sealed2026:boolean};
    rabbits:{
      training:{status:string;task:string;completed:number;total:number};
      challenger:{status:string;task:string;completed:number;total:number};
      risk:{status:string;task:string;completed:number;total:number};
      official:{status:string;task:string;completed:number;total:number};
      overallProgress:number;
    };
    lastRun:null|{id:string;status:string;startedAt:string;completedAt:string;elapsedSeconds?:number;qualifiedHypotheses?:number;ledgerRecords?:number;dataSha256:string;protocolSha256:string;reportHash?:string;error?:string};
    history:{path:string|null;appendOnly:boolean;hashChained:boolean};
    updatedAt:string;
  }|null;
  currentExperiment?:null|{
    experimentId:string;runId:string;status:string;reads2026:boolean;affectsV4:boolean;elapsedSeconds:number;generatedAt:string;
    qualifiedHypothesisIds:string[];
    ledger:{records:number;runRecords:number;verified:boolean;chainTip:string};
    sampleFormationDiagnostic?:{
      diagnosticOnly:boolean;canSelectParameters:boolean;
      population:{start:string;end:string;causalAnchors:number};
      outcomeLabel:{entry:string;netTargetPct:[number,number];roundTripCostPct:number;maximumHoldMinutes:number;futureBarsUsedForSelection:boolean};
      hypotheses:Array<{
        hypothesisId:string;name:string;session:string;diagnosticOnly:boolean;
        stages:Array<{id:string;count:number}>;
        primaryBottleneck:{stage:string;removed:number};
        targetTouched:number;targetTouchRate:number|null;medianHoldMinutes:number|null;
      }>;
    };
    hypotheses:Array<{
      hypothesisId:string;name:string;outOfSampleWinRate:number;
      outerQuarters:Array<{trades:number;wins:number;netPct:number;stressNetPct:number}>;
      evaluation:{passedRollingOutOfSample:boolean;metrics:{meanNetPct:number;meanStressNetPct:number;positiveQuarterRatio:number;pbo:number;deflatedSharpeProbability:number}};
    }>;
  };
  latest:{
    tradingDays?:number;
    trainingTrades?:number; trainingWinRate?:number|null; trainingAverageNetPct?:number;
    validationTrades?:number; validationWinRate?:number|null; validationAverageNetPct?:number;
    blindTrades?:number; blindWinRate?:number|null; blindAverageNetPct?:number;
    passedTrainingGate?:boolean; passedValidationGate?:boolean; elapsedSeconds?:number;
    qualifiedCandidates?:number; validationRan?:boolean; blindRan?:boolean; nextAction?:string;
  };
};

type ZijinShadowAB = {
  experimentId:string;
  stock:{code:string;name:string};
  registeredAt:string;
  updatedAt:string;
  status:"waiting"|"observing"|"closed"|"degraded";
  affectsV4:false;
  sendsAlerts:false;
  usesFutureMinutes:false;
  marketDate:string|null;
  source:{provider:string|null;sourceTimestamp:string|null;fetchedAt:string|null;peerCoverage?:number;externalCoverage?:{ready:number;total:number;missing:string[]};externalObservedAt?:string;error:string|null};
  costPolicy:{baseRoundTripPct:number;stressRoundTripPct:number};
  targetPolicy:{minimumNetPct:number;maximumNetPct:number;maximumHoldMinutes:number};
  prospectiveGate:{minimumResolvedTrades:number;minimumResearchCandidateWinRate?:number;minimumWinRate:number;requirePositiveBaseNetPct:boolean;requirePositiveStressNetPct:boolean;manualReviewRequired:boolean};
  models:Record<"A"|"B"|"C"|"D"|"E"|"F"|"G"|"H"|"I"|"J",{
    id:string;label:string;sourceRound:number;sessionStart:string;sessionEnd:string;maxSignalsPerDay:number;side:"long"|"short";executionMode?:"shadow-trade"|"observe-only";
    today:{candidates:number;entries:number;exits:number;wins:number;netPct:number;lastDecision:string;activeTrade:null|{pendingEntry?:boolean;entryTime?:string;entryPrice?:number}};
    total:{candidateDays:number;candidates:number;resolvedTrades:number;wins:number;winRate:number|null;netPct:number;stressNetPct:number};
    rejectionReasons:Record<string,number>;
  }>;
  integrity:{eventCount:number;lastHash:string};
  meta?:{source:"runtime"|"bundled";servedAt:string;stale:boolean};
};

type RabbitProgressStatus = "running"|"completed"|"paused"|"error";

function RabbitProgressMeter({
  label,
  detail,
  progress,
  status="running",
  stages=[],
  compact=false,
}: {
  label:string;
  detail:string;
  progress:number|null;
  status?:RabbitProgressStatus;
  stages?:string[];
  compact?:boolean;
}) {
  const normalized=progress===null?null:Math.max(0,Math.min(100,Math.round(progress)));
  const statusLabel=status==="completed"?"已完成":status==="paused"?"等待中":status==="error"?"需检查":"运行中";
  return <section
    className={`rabbit-progress ${status} ${compact?"compact":""} ${normalized===null?"indeterminate":""}`}
    role="progressbar"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    {...(normalized===null?{}:{"aria-valuenow":normalized})}
  >
    <header><div><span><i/>{label}</span><b>{detail}</b></div><strong>{normalized===null?(status==="error"?"不可用":status==="paused"?"等待开始":"读取中"):`${normalized}%`}<small>{statusLabel}</small></strong></header>
    <div className="rabbit-progress-rail">
      <div className="rabbit-progress-grid"/>
      <i className="rabbit-progress-fill" style={normalized===null?undefined:{width:`${normalized}%`}}/>
      <span className="rabbit-progress-orbit" style={normalized===null?undefined:{left:`clamp(18px, ${normalized}%, calc(100% - 18px))`}}><Image src="/rabbit-logo-compact.png" alt="" width={24} height={24}/><i/></span>
    </div>
    {stages.length>0&&<div className="rabbit-progress-stages">{stages.map((stage,index)=>{const threshold=stages.length===1?100:index/(stages.length-1)*100;const reached=normalized!==null&&normalized>=threshold;const current=normalized!==null&&index===Math.min(stages.length-1,Math.floor(normalized/Math.max(1,100/Math.max(1,stages.length-1))));return <span className={`${reached?"done ":""}${current?"current":""}`} key={stage}><i/>{stage}</span>})}</div>}
  </section>;
}

function FourRabbitAutomationDashboard({progress}:{progress:ZijinTrainingProgress}) {
  const automation=progress.automation;
  if(!automation)return <section className="zijin-auto-dashboard unavailable"><b>四兔自动研究状态尚未接入</b><span>当前只保留已审计的历史训练结论，不显示估算进度。</span></section>;
  const health=progress.meta?.automationHealth??evaluateZijinSchedulerHealth(automation.scheduler);
  const stale=health.status==="offline";
  const running=health.status==="running";
  const rabbits=[
    {id:"training",name:"训练兔",scope:"601899 专属选参",...automation.rabbits.training},
    {id:"challenger",name:"挑战兔",scope:"未见样本盲测",...automation.rabbits.challenger},
    {id:"risk",name:"风控兔",scope:"费用与过拟合审计",...automation.rabbits.risk},
    {id:"official",name:"正式兔",scope:"仅管理影子观察资格",...automation.rabbits.official},
  ];
  const statusText=(status:string)=>status==="running"?"运行中":status==="completed"?"本轮完成":status==="qualified"?"待人工评审":status==="blocked"?"未获准":status==="failed"?"运行失败":"等待中";
  const timeLabel=(value:string|undefined)=>{if(!value)return "--";const date=new Date(value);return Number.isNaN(date.getTime())?"--":date.toLocaleString("zh-CN",{hour12:false});};
  const ageLabel=health.heartbeatAgeSeconds==null?"无法确认":health.heartbeatAgeSeconds<60?`${health.heartbeatAgeSeconds} 秒前`:health.heartbeatAgeSeconds<3600?`${Math.floor(health.heartbeatAgeSeconds/60)} 分钟前`:`${Math.floor(health.heartbeatAgeSeconds/3600)} 小时前`;
  return <section className={`zijin-auto-dashboard ${health.status}`} aria-label="紫金矿业四兔自动研究看板">
    <header><div><span>ZIJIN AUTO RESEARCH · 真实调度</span><h3>四兔现在在做什么</h3><p><b>训练对象：601899 紫金矿业</b> · 独立研究，不自动修改通用 V4。</p></div><em>{health.label}</em></header>
    <div className={`zijin-scheduler-health ${health.status}`}><b>{health.label}</b><span>{health.detail}</span>{stale&&<small>这不是“仍在训练”，而是后台调度服务没有继续报到；第 4 轮历史结果仍然有效。</small>}{progress.meta?.trainerAlert&&<small>{progress.meta.trainerAlertHistorical?"历史恢复记录（已恢复）":"最近自动恢复"}：{timeLabel(progress.meta.trainerAlert.at)} · {progress.meta.trainerAlert.reason}</small>}</div>
    <div className="zijin-auto-summary"><p><span>当前任务</span><b>{running?(automation.run.currentTask||automation.scheduler.reason):health.detail}</b></p><p><span>调度方式</span><b>数据或实验协议变化后运行</b></p><p><span>最近心跳</span><b>{timeLabel(automation.scheduler.heartbeatAt)}<small>{ageLabel}</small></b></p><p><span>本轮耗时</span><b>{automation.run.elapsedSeconds?`${automation.run.elapsedSeconds} 秒`:"尚未运行"}</b></p></div>
    <div className="zijin-auto-rabbits">{rabbits.map(rabbit=><article className={rabbit.status} key={rabbit.id}><div><i aria-hidden="true">兔</i><span><b>{rabbit.name}</b><small>{rabbit.scope}</small></span><em>{statusText(rabbit.status)}</em></div><p>{rabbit.task}</p><footer><span>{rabbit.completed}/{rabbit.total}</span><i><b style={{width:`${Math.max(0,Math.min(100,rabbit.total?rabbit.completed/rabbit.total*100:0))}%`}}/></i></footer></article>)}</div>
    <footer><span>最近结果：{automation.lastRun?`${automation.lastRun.qualifiedHypotheses??0} 个模型通过 · 账本 ${automation.lastRun.ledgerRecords??0} 条`:"尚无自动运行记录"}</span><span>2026 数据：{automation.input.sealed2026?"封存，不参与选参":"未封存"}</span><span>不会自动晋级：需盲测、影子盘和人工批准</span></footer>
  </section>;
}

type StrategyProfile = "稳健档" | "平衡档" | "灵敏档";
type ProfitMode = "standard" | "zijin-small-spread";
type ReplayProfitOptions = {
  profileOverrides?: Record<string, number>;
  minimumNetProfitAmount?: number;
  minimumGrossSpreadAmount?: number;
};
type AccountPreferences = { stock:string; baseShares:number; risk:string; strategyProfile:StrategyProfile; profitMode:ProfitMode };
type StockPositionMap = Record<string, StockPosition>;
const DEFAULT_PREFERENCES:AccountPreferences={stock:"601899 紫金矿业",baseShares:0,risk:"稳健",strategyProfile:"平衡档",profitMode:"standard"};
const normalizeAccountPreferences=(value:Partial<AccountPreferences>|null|undefined):AccountPreferences=>({
  ...DEFAULT_PREFERENCES,
  ...(value??{}),
  strategyProfile:normalizeStrategyProfile(value?.strategyProfile) as StrategyProfile,
  profitMode:normalizeProfitMode(value?.profitMode) as ProfitMode,
});

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
const formalActionSide=(value:unknown):"buy"|"sell"=>String(value??"").includes("卖")?"sell":"buy";
const formalExecutionLabel=(direction:"正T"|"反T"|undefined,side:"buy"|"sell")=>
  direction==="反T"
    ? side==="sell"?"反T先卖":"反T买回"
    : side==="sell"?"正T卖出":"正T买入";
type ReplayObservation = { time:string; price?:number; direction:"正T"|"反T"; score:number; threshold:number; scoreBreakdown?:{direction:number;location:number;trigger:number;thresholds:{direction:number;location:number;trigger:number};passed:{direction:boolean;location:boolean;trigger:boolean};confirmed:boolean}; similarity?:{samples:number;ready:boolean;hitRate:number|null;averageFavorablePct:number|null;averageAdversePct:number|null}; edge:number; executable:boolean; stage?:"watch"|"candidate"; coverageOnly?:boolean; pairGap?:number|null; pivotTime?:string; pivotPrice?:number; pivotLabel?:string; pivotAssessment?:"strong"|"confirmed"|"unconfirmed"; confirmationLabel?:string; repairPhase?:"bottom-watch"|"repair-confirmed"|"repair-extended"; blockers:string[]; reason:string; l2Strict?:boolean; candidateKey?:string; watchKey?:string };
type L2ReplayState = { available:boolean; source:string; minuteCount:number; observations:ReplayObservation[]; reason:string };
type CandidateObservationCycle = { id:number; direction:"正T"|"反T"; entryTime:string; entryPrice:number; entryLabel:string; exitTime:string; exitPrice:number; exitLabel:string; grossPct:number; holdingMinutes:number; mfePct:number; maePct:number; bestTime:string; worstTime:string; outcomeMode:"post-replay-causal"; favorable:boolean; status:string };
type CandidateOutcome = { direction:"正T"|"反T"; time:string; price:number; outcomeMode:"post-replay-fixed-horizon"; horizons:{minutes:number;complete:boolean;endTime?:string;returnPct?:number;mfePct?:number;maePct?:number;bestTime?:string;worstTime?:string}[] };
type OpenCandidateObservation = { direction:"正T"|"反T"; time:string; price:number; label:string; status:"候补未闭环" };
type DeskHistoryRow = { time:string; direction:string; price:string; quantity:string; spread:string; status:string; tone?:"buy"|"sell"|"candidate" };
type BacktestResult = { net:number; gross:number; fees:number; executionCost:number; maxDrawdown:number; trades:number; wins:number; days:number; curve:number[]; curveTimes:string[]; cycleNets:number[]; candidateCycles?:CandidateObservationCycle[]; candidateOutcomes?:CandidateOutcome[]; openCandidate?:OpenCandidateObservation|null; startTime:string; status:string; actions:ReplayAction[]; observations?:ReplayObservation[]; diagnostics?:Record<string,number> };
type BatchMetrics = { samples:number; completed:number; wins:number; gross:number; fees:number; executionCost:number; net:number; tradingRounds:number; profitableRounds:number; losingRounds:number; profitFactor:number|null; maxDrawdown:number };
type BacktestReplayEngine = "closure-first"|"zuot-v1-reconstructed-shadow"|"zijin-v29-shadow";
type ReplayExitTarget = 0.5|1|2|2.5;
const BACKTEST_REPLAY_ENGINE_META:Record<BacktestReplayEngine,{label:string;logic:string;note:string}>={
  "closure-first":{label:"内置闭环",logic:"正/反 T + 开盘观察 + 趋势量价 + 成本风控",note:"正式闭环的因果回放基线"},
  "zuot-v1-reconstructed-shadow":{label:"zuoT-v1 重建影子",logic:"VWAP + 量能 + MACD + OFI + 技术位置",note:"仅模拟研究，不影响操盘台正式信号或交易链路"},
  "zijin-v29-shadow":{label:"V2.9 紫金影子",logic:"VWAP + 量能 + MACD + 5分钟方向 + L2/OFI确认",note:"仅限601899历史L2因果回放，不影响正式策略"},
};
type ReplayMinute = { time:string; price:number; volume:number };
type PersonalTrainingAction = { id:string; time:string; minuteIndex:number; side:"buy"|"sell"; quantity:number; marketPrice:number; executionPrice:number; gross:number; fee:number };
type PersonalTrainingRecord = { id:string; completedAt:string; code:string; name:string; date:string; actions:PersonalTrainingAction[]; net:number; totalNet?:number; closedQuantity?:number; fees:number; accuracy:number|null };
type PersonalTrainingExecution = { ok:true; cash:number; shares:number; action:Omit<PersonalTrainingAction,"id"|"time"|"minuteIndex"> } | { ok:false; error:string };

function formatTime(value:string|undefined) {
  return value && value.length>=4 ? `${value.slice(0,2)}:${value.slice(2,4)}` : "--:--";
}
type StockUniverseItem = { code:string; name:string; industry:string; market:string };
type StockUniverseResponse = { provider:string; total:number; fallback:boolean; warning?:string; stocks:StockUniverseItem[] };
type StockBatchCycle = { id:number; direction:"正T"|"反T"; entry:ReplayAction; exit:ReplayAction; holdingMinutes:number; gross:number; fees:number; executionCost:number; net:number; outcome:"盈利"|"亏损"|"持平"; explanation:string };
type StockBatchFeedback = { code:string; name:string; date:string; sessions:number; samples:number; completed:number; wins:number; winRate:number|null; positiveT:number; reverseT:number; net:number; noTrade:number; candidates:number; keyObservations:number; strongSellTrendBlocked:number; strongBuyTrendBlocked:number; feedback:string; minutes:ReplayMinute[]; actions:ReplayAction[]; observations:ReplayObservation[]; cycles:StockBatchCycle[] };
type BatchBacktestResult = BatchMetrics & { seed:string; rounds:number; stocks:number; attemptedStocks:number; replacementStocks:number; overlapWithPrevious:number; uniqueSessions:number; noTrade:number; referenceStocks:number; candidateStocks:number; candidateDecisions:number; keyObservations:number; averageNet:number; medianNet:number; providers:string[]; universeSize:number; universeProvider:string; fallbackUniverse:boolean; industries:number; legacy:BatchMetrics; stockFeedback:StockBatchFeedback[] };
type MultiDayRunKind = "recent"|"random-10"|"since-2025";
type MultiDayBacktestResult = BatchMetrics & { code:string; name:string; modeLabel:string; scopeLabel:string; requestedDays:number; testedDays:number; firstDate:string; lastDate:string; noTrade:number; averageNet:number; l2Required:boolean; l2AvailableDays:number; l2MissingDays:number; l2MinuteCount:number; recentDays:number; recentCompleted:number; recentWins:number; recentNet:number; recentProfitFactor:number|null; healthStatus:"样本积累中"|"近期稳定"|"近期转弱"; approvalStatus:"继续影子"|"待5bp压力测试"; outcomes:{date:string;trades:number;wins:number;net:number;candidates:number}[] };

function median(values:number[]) {
  if(!values.length)return 0;
  const ordered=[...values].sort((left,right)=>left-right);
  const middle=Math.floor(ordered.length/2);
  return ordered.length%2?ordered[middle]:((ordered[middle-1]??0)+(ordered[middle]??0))/2;
}

function addHistoricalTimeVolumeBaseline(data:MarketData, session:IntradaySession):IntradaySession {
  const history=(data.intradaySessions??[])
    .filter(item=>item.date<session.date)
    .sort((left,right)=>right.date.localeCompare(left.date))
    .slice(0,20);
  if(history.length<3)return session;
  const byTime=new Map<string,number[]>();
  history.forEach(item=>item.minutes.forEach(point=>{
    if(point.volume<=0)return;
    byTime.set(point.time,[...(byTime.get(point.time)??[]),point.volume]);
  }));
  return {...session,minutes:session.minutes.map(point=>{
    const samples=byTime.get(point.time)??[];
    return {...point,timeVolumeBaseline:samples.length>=3?median(samples):null};
  })};
}

function buildReplayChartObservations(code:string|undefined, minutes:ReplayMinute[], observations:ReplayObservation[], repairObservations:ReplayObservation[] = []) {
  return code === "601899"
    ? mergeZijinReplayObservations(observations, repairObservations) as ReplayObservation[]
    : buildCausalReferencePoints(minutes, observations) as ReplayObservation[];
}

function compactIntradayPrompt(value:string, fallback="等待确认") {
  const normalized=value.replace(/[·•\s]/g,"");
  if(/正T.*(?:候选|观察)/.test(normalized))return "正T候选";
  if(/反T.*(?:候选|观察)/.test(normalized))return "反T候选";
  if(/候选卖点|卖点候选/.test(normalized))return "候选卖点";
  if(/候选买点|买点候选/.test(normalized))return "候选买点";
  if(/买压.*确认|低位.*买压/.test(normalized))return "买压确认";
  if(/卖压.*确认|高位.*卖压/.test(normalized))return "卖压确认";
  if(/低位.*修复加速|修复加速/.test(normalized))return "修复加速";
  if(/冲高回落.*加速|回落加速/.test(normalized))return "回落加速";
  if(/前高.*确认/.test(normalized))return "前高确认";
  if(/前低.*确认/.test(normalized))return "前低确认";
  if(/转强.*确认/.test(normalized))return "转强确认";
  if(/转弱.*确认/.test(normalized))return "转弱确认";
  if(normalized.length===4)return normalized;
  return normalized.length>4?normalized.slice(0,4):fallback;
}

function observationConfirmationLabel(observation: ReplayObservation) {
  const rawLabel=observation.confirmationLabel ?? (observation.direction==="正T"?"反弹观察":"回落观察");
  const clearerLabels:Record<string,string>={
    "低位参考":"支撑观察",
    "高位参考":"压力观察",
    "覆盖候选·低位参考":"支撑观察",
    "覆盖候选·高位参考":"压力观察",
    "反弹参考":"反弹确认",
    "回落参考":"回落确认",
  };
  const label=clearerLabels[rawLabel]??rawLabel;
  const resolvedLabel=observation.direction==="正T"&&label==="反弹观察"&&observation.time<="1000"?"修复观察":label;
  return compactIntradayPrompt(resolvedLabel);
}

function observationDirectionNote(observation: ReplayObservation) {
  return `候补${observation.direction}方向 · 不可执行`;
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
    if(net<0){
      const totalCost=fees+executionCost;
      const breakdown=`毛收益 ${money(gross)}；费用+滑点 ${money(-totalCost)}；净收益 ${money(net)}`;
      explanation=gross<=0
        ? `价格没有按${direction==="正T"?"买入后反弹":"卖出后回落"}方向走出价差，先出现价格亏损。${breakdown}`
        : `价格曾按入场方向运行，但价差不足以覆盖费用与滑点。${breakdown}`;
      if(/止损/.test(exit.reason??"")) explanation+=" 退出纪律：触发止损。";
      else if(/时间退出/.test(exit.reason??"")) explanation+=" 退出纪律：达到持有时间上限。";
      else if(/强制恢复/.test(exit.reason??"")) explanation+=" 退出纪律：尾盘强制恢复底仓。";
    }
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

function BatchStockDrawer({item,onClose}:{item:BatchBacktestResult["stockFeedback"][number];onClose:()=>void}) {
  return <>
    <button type="button" className="batch-drawer-backdrop" aria-label="关闭复盘详情" onClick={onClose}/>
    <aside className="batch-stock-drawer" role="dialog" aria-modal="true" aria-label={`${item.code}复盘详情`}>
      <header className="batch-drawer-head"><div><span>单股因果复盘</span><b>{item.code} {item.name}</b><small>{item.date.slice(0,4)}-{item.date.slice(4,6)}-{item.date.slice(6,8)} · {item.completed ? `${item.completed} 个正式闭环` : "无正式闭环"}</small></div><button type="button" onClick={onClose} aria-label="关闭复盘详情">×</button></header>
      <div className="batch-drawer-summary"><span><small>观察 / 候补</small><b>{item.keyObservations} / {item.candidates}</b></span><span><small>正T / 反T</small><b>{item.positiveT} / {item.reverseT}</b></span><span><small>净收益</small><b className={pnlClass(item.net)}>{money(item.net)}</b></span></div>
      <BatchMiniChart minutes={item.minutes} actions={item.actions} observations={item.observations}/>
      <div className="batch-drawer-cycles">{item.cycles.length ? item.cycles.map(cycle=><article key={cycle.id} className={cycle.net<0?"cycle-loss":"cycle-profit"}><header><b>第 {cycle.id} 轮 · {cycle.direction} · {cycle.outcome}</b><strong>{money(cycle.net)}</strong></header><div className="cycle-route"><span>{replayTime(cycle.entry.time)} {cycle.entry.side} ¥{cycle.entry.price.toFixed(3)}</span><i>→</i><span>{replayTime(cycle.exit.time)} {cycle.exit.side} ¥{cycle.exit.price.toFixed(3)}</span><em>{cycle.entry.quantity.toLocaleString()} 股</em></div><p className="cycle-explanation"><b>{cycle.net<0?"亏损原因":"结果说明"}：</b>{cycle.explanation}</p><p><b>入场：</b>{cycle.entry.reason??"由当分钟量价与趋势条件共同触发。"}</p><p><b>退出：</b>{cycle.exit.reason??"由止盈、止损或时间纪律触发。"}</p></article>) : <article className="cycle-no-trade"><header><b>为什么没有交易？</b></header><p>{item.feedback}。观察参考不可执行，未通过正式门槛不会生成买卖点。</p>{item.observations.map((observation,index)=><div key={`${observation.time}-${index}`}><b>{replayTime(observation.time)} {observationConfirmationLabel(observation)}</b><span>{observationDirectionNote(observation)}；{observation.blockers.length?observation.blockers.join("；"):"量价确认不足"}</span></div>)}</article>}</div>
    </aside>
  </>;
}

function BatchReport({batch,representativeCode}:{batch:BatchBacktestResult;representativeCode?:string}) {
  const [expanded,setExpanded]=useState<string|null>(null);
  const [feedbackSort,setFeedbackSort]=useState<"net"|"completed"|"candidates"|"reverseT">("net");
  const [feedbackFilter,setFeedbackFilter]=useState<"all"|"loss"|"trade"|"empty">("all");
  const visibleFeedback=useMemo(()=>batch.stockFeedback.filter(item=>feedbackFilter==="all"||(feedbackFilter==="loss"&&item.net<0)||(feedbackFilter==="trade"&&item.completed>0)||(feedbackFilter==="empty"&&item.completed===0)).sort((left,right)=>feedbackSort==="completed"?right.completed-left.completed:feedbackSort==="candidates"?right.candidates-left.candidates:feedbackSort==="reverseT"?right.reverseT-left.reverseT:right.net-left.net),[batch.stockFeedback,feedbackFilter,feedbackSort]);
  const selectedDetail=batch.stockFeedback.find(item=>item.code===expanded)??null;
  return <section className="batch-report" aria-label="随机10股真实分时批次汇总">
    <div className="batch-report-head"><div><span>RANDOM 10-STOCK FULL-DAY CAUSAL REPLAY</span><h2>全A股随机10股真实分时批次</h2></div><div className="batch-run-meta"><em>{batch.fallbackUniverse?"代表池回退":"全A股池"} {batch.universeSize.toLocaleString()} 只 · 本批 {batch.industries} 个行业</em><small>与上一批重复 {batch.overlapWithPrevious} 只</small>{batch.replacementStocks>0&&<small>行情缺失自动补抽 {batch.replacementStocks} 只（共尝试 {batch.attemptedStocks} 只）</small>}</div></div>
    <div className="batch-coverage"><b>观察覆盖 {batch.referenceStocks}/{batch.stocks} 股</b><span>条件候补 {batch.candidateStocks}/{batch.stocks} 股</span><span>正式触发 {batch.tradingRounds}/{batch.stocks} 股</span><span>正式闭环 {batch.completed} 个 · {batch.wins} 盈 / {Math.max(0,batch.completed-batch.wins)} 亏</span><small>每股最多展示 2 个低位/反弹参考和 2 个高位/回落参考，全部标记在当时能够确认的分钟，不回填全天高低点；自动参考不可执行。只有引擎真实产生且继续通过趋势、量价、成本和风控的点才标为候补买卖点或正式交易。</small></div>
    <div className="batch-metrics"><div><span>扣费后循环胜率</span><strong>{batch.completed?`${(batch.wins/batch.completed*100).toFixed(2)}%`:'—'}</strong><small>{batch.wins}/{batch.completed} 个闭环盈利</small></div><div><span>毛收益</span><b className={pnlClass(batch.gross)}>{money(batch.gross)}</b><small>{batch.samples.toLocaleString()} 个随机股票日</small></div><div><span>交易费用 + 滑点</span><b className="pnl-loss">{money(-(batch.fees+batch.executionCost))}</b><small>费用 {money(-batch.fees)} · 滑点 {money(-batch.executionCost)}</small></div><div><span>总净收益</span><b className={pnlClass(batch.net)}>{money(batch.net)}</b><small>平均每股日 {money(batch.averageNet)}</small></div><div><span>有交易 / 盈利 / 亏损日</span><b>{batch.tradingRounds} / {batch.profitableRounds} / {batch.losingRounds}</b><small>共 {batch.rounds} 个随机股票日</small></div><div><span>盈利因子 / 最差回撤</span><b>{batch.profitFactor===null?'—':batch.profitFactor.toFixed(2)} / -{(batch.maxDrawdown*100).toFixed(2)}%</b><small>{batch.providers.join(' / ')}</small></div></div>
    <div className="ab-compare"><b>主测 {batch.engineLabel}</b><span>对照 {batch.comparisonLabel}</span><span>闭环 {batch.legacy.completed}</span><span>胜率 {batch.legacy.completed?(batch.legacy.wins/batch.legacy.completed*100).toFixed(2):'—'}%</span><span className={pnlClass(batch.legacy.net)}>对照净收益 {money(batch.legacy.net)}</span><strong className={pnlClass(batch.net-batch.legacy.net)}>相对差额 {money(batch.net-batch.legacy.net)}</strong></div>
    <div className="stock-feedback"><div className="stock-feedback-head"><div><b>随机股票逐股反馈</b><span>股票和近5个可用完整交易日都会重新抽取；点“复盘”查看观察参考、正式点位、费用及失败原因</span></div><div className="stock-feedback-tools"><label>筛选<select value={feedbackFilter} onChange={event=>setFeedbackFilter(event.target.value as typeof feedbackFilter)}><option value="all">全部股票</option><option value="loss">净收益为负</option><option value="trade">有正式闭环</option><option value="empty">无正式闭环</option></select></label><label>排序<select value={feedbackSort} onChange={event=>setFeedbackSort(event.target.value as typeof feedbackSort)}><option value="net">净收益</option><option value="completed">闭环次数</option><option value="candidates">候补次数</option><option value="reverseT">反T次数</option></select></label><em>正T / 反T 为完整日内的闭环数</em></div></div><div className="stock-feedback-scroll"><table><thead><tr><th>股票</th><th>交易日</th><th>观察参考 / 条件候补</th><th>闭环</th><th>扣费胜率</th><th>正T / 反T</th><th>净收益</th><th>无正式闭环日</th><th>反馈</th><th>详情</th></tr></thead><tbody>{visibleFeedback.map(item=><Fragment key={item.code}><tr className={item.code===representativeCode?'representative':''}><td><b>{item.code}</b><span>{item.name}</span></td><td>{item.date.slice(4,6)}-{item.date.slice(6,8)}</td><td>{item.keyObservations} / {item.candidates}</td><td>{item.completed}</td><td>{item.winRate===null?'—':`${(item.winRate*100).toFixed(2)}%`}</td><td>{item.positiveT} / {item.reverseT}</td><td className={pnlClass(item.net)}>{money(item.net)}</td><td>{item.noTrade} / {item.samples}</td><td>{item.feedback}</td><td><button type="button" className="batch-detail-toggle" aria-expanded={expanded===item.code} onClick={()=>setExpanded(current=>current===item.code?null:item.code)}>{expanded===item.code?'收起':'复盘'}</button></td></tr>{expanded===item.code&&<tr className="batch-detail-row"><td colSpan={10}><div className="batch-stock-detail"><div><div className="batch-detail-title"><b>{item.code} {item.name} · {item.date.slice(0,4)}-{item.date.slice(4,6)}-{item.date.slice(6,8)}</b><span>{item.completed?`${item.completed} 个正式闭环`:`${item.keyObservations} 个因果观察参考，0 个正式闭环`}</span></div><BatchMiniChart minutes={item.minutes} actions={item.actions} observations={item.observations}/></div><div className="batch-cycle-details">{item.cycles.length?item.cycles.map(cycle=><article key={cycle.id} className={cycle.net<0?'cycle-loss':'cycle-profit'}><header><b>第 {cycle.id} 轮 · {cycle.direction} · {cycle.outcome}</b><strong>{money(cycle.net)}</strong></header><div className="cycle-route"><span>{replayTime(cycle.entry.time)} {cycle.entry.side} ¥{cycle.entry.price.toFixed(3)}</span><i>→</i><span>{replayTime(cycle.exit.time)} {cycle.exit.side} ¥{cycle.exit.price.toFixed(3)}</span><em>{cycle.entry.quantity.toLocaleString()} 股</em></div><dl><div><dt>理论毛收益</dt><dd>{money(cycle.gross)}</dd></div><div><dt>手续费</dt><dd>{money(-cycle.fees)}</dd></div><div><dt>双向滑点</dt><dd>{money(-cycle.executionCost)}</dd></div></dl><p className="cycle-explanation"><b>{cycle.net<0?'亏损原因':'结果说明'}：</b>{cycle.explanation}</p><p><b>入场依据：</b>{cycle.entry.reason??'由当分钟量价与趋势条件共同触发。'}</p><p><b>退出依据：</b>{cycle.exit.reason??'由止盈、止损或时间纪律触发。'}</p></article>):<article className="cycle-no-trade"><header><b>为什么没有交易？</b></header><p>{item.feedback}。观察参考不可执行，未通过正式门槛不会生成买卖点。</p>{item.strongSellTrendBlocked>0&&<div className="hard-risk-block"><b>风控硬拦截</b><span>强势交易日仍在 VWAP 上方，拦截 {item.strongSellTrendBlocked} 次逆势反T判定，避免低位卖出后追高买回。</span></div>}{item.strongBuyTrendBlocked>0&&<div className="hard-risk-block"><b>风控硬拦截</b><span>弱势交易日仍在 VWAP 下方，拦截 {item.strongBuyTrendBlocked} 次逆势正T判定，避免下跌中补仓后继续承压。</span></div>}{item.observations.map((observation,index)=><div key={`${observation.time}-${index}`}><b>{replayTime(observation.time)} {observationConfirmationLabel(observation)}</b><span>{observationDirectionNote(observation)}；{observation.blockers.length?observation.blockers.join('；'):'量价确认不足'}</span></div>)}</article>}</div></div></td></tr>}</Fragment>)}</tbody></table></div></div>{selectedDetail&&<BatchStockDrawer item={selectedDetail} onClose={()=>setExpanded(null)}/>}
    <p>每次点击都先对当前全 A 股普通股票池重新洗牌并无放回抽取 10 只；最近 6 批已经出现的股票会排到队尾，行情缺失再从全市场继续补抽。只有全市场列表暂时不可用时才明确回退代表池。每股图上最多保留 2 个低位/反弹参考和 2 个高位/回落参考，条件候补与正式闭环另行标注。</p>
  </section>;
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

function diversifyStockUniverse(items:StockUniverseItem[],seed:string,recentCodes:string[]=[]):StockUniverseItem[] {
  // Start from a true full-market shuffle. Industry remains a result metric,
  // rather than a hard template that controls the first ten positions.
  return randomizedUniqueQueue(items,seed,recentCodes,"code") as StockUniverseItem[];
}
const normalizeWatchlist = (list: { code:string; name:string; price:string; change:string }[]) => normalizeWatchlistEntries(list, canonicalStockNames) as typeof initialStocks;
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
  { id: "training", avatar: "/agents/training.png", name: "训练兔", role: "提出 V4.x 候选" },
  { id: "challenger", avatar: "/agents/challenger.png", name: "挑战兔", role: "未见股票与日期盲测" },
  { id: "risk", avatar: "/agents/risk.png", name: "风控兔", role: "费用与过拟合否决" },
  { id: "official", avatar: "/agents/official.png", name: "正式兔", role: "管理影子观察资格" },
];
const strategyProfiles = STRATEGY_PROFILES;
type UiTheme = "dark" | "light";
type InitialAuth = {
  localAuth: boolean;
  demoMode: boolean;
  accountName: string;
  accountRole: string;
  accountMembership: Membership | null;
};

function ReleaseVersion() {
  const [release,setRelease]=useState<{
    shortCommit?:string;
    buildTime?:string|null;
    releaseShortCommit?:string;
    releaseBuildTime?:string|null;
  }|null>(null);
  useEffect(()=>{
    let active=true;
    const load=()=>void fetch("/api/control/version",{cache:"no-store"})
      .then(response=>response.ok?response.json():Promise.reject(new Error("version unavailable")))
      .then((payload:{shortCommit?:string;buildTime?:string|null;releaseShortCommit?:string;releaseBuildTime?:string|null})=>{if(active)setRelease(payload)})
      .catch(()=>{});
    load();
    const timer=window.setInterval(load,60_000);
    return()=>{active=false;window.clearInterval(timer)};
  },[]);
  const displayedCommit=release?.releaseShortCommit||release?.shortCommit;
  const displayedTime=release?.releaseBuildTime||release?.buildTime;
  const shortCommit=!release?"检测中":displayedCommit&&displayedCommit!=="development"?displayedCommit.slice(0,8):"本地";
  const webCommit=release?.shortCommit&&release.shortCommit!==displayedCommit?` · Web ${release.shortCommit.slice(0,8)}`:"";
  const title=displayedTime?`发布时间 ${new Date(displayedTime).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}${webCommit}`:"正在核对服务器版本";
  return <span className="release-version" title={title}><b>版本 闭环-{shortCommit}</b><span><a href="/terms">协议</a> · <a href="/privacy">隐私</a></span></span>;
}


export default function Home({initialAuth,onLogout,theme:uiTheme,onToggleTheme:toggleUiTheme}:{initialAuth?:InitialAuth;onLogout?:()=>void;theme:UiTheme;onToggleTheme:()=>void}) {
  const [authReady, setAuthReady] = useState(Boolean(initialAuth));
  const [localAuth, setLocalAuth] = useState(Boolean(initialAuth?.localAuth));
  const [authScreen,setAuthScreen]=useState<'landing'|'account'>('landing');
  const [demoMode,setDemoMode]=useState(Boolean(initialAuth?.demoMode));
  const [accountName, setAccountName] = useState(initialAuth?.accountName ?? "jay cc");
  const [accountRole, setAccountRole] = useState(initialAuth?.accountRole ?? "member");
  const [accountMembership,setAccountMembership]=useState<Membership|null>(initialAuth?.accountMembership ?? null);
  const [inviteMessage,setInviteMessage]=useState("");
  const monitorLimit=watchlistLimitForRole(accountRole,accountMembership?.active===true,accountMembership?.planId);
  const remoteSyncReady = useRef(false);
  const [remoteSyncEpoch,setRemoteSyncEpoch]=useState(0);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [preferences, setPreferences] = useState<AccountPreferences>(DEFAULT_PREFERENCES);
  const [hasPersistedPreferences,setHasPersistedPreferences]=useState(false);
  const [stockPositions, setStockPositions] = useState<StockPositionMap>({});
  const [activeStock, setActiveStock] = useState(0);
  const [stockList, setStockList] = useState(initialStocks);
  const validatedWatchlistSignature = useRef("");
  const [profile, setProfile] = useState<StrategyProfile>(DEFAULT_PREFERENCES.strategyProfile);
  const [panel, setPanel] = useState("今日T循环");
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [cycleStage, setCycleStage] = useState<'ready'|'opened'|'closed'>('ready');
  const [openedCycleSide,setOpenedCycleSide]=useState<"buy"|"sell"|null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [activeView, setActiveView] = useState("首页");
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [memberAdminOpen,setMemberAdminOpen]=useState(false);
  const [alertLogOpen,setAlertLogOpen]=useState(false);
  const [zijinResearchEnabled,setZijinResearchEnabled]=useState(false);
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(()=>{try{const saved=localStorage.getItem('rabbit-alert-settings');return saved?{sound:false,system:false,background:false,...JSON.parse(saved)}:{sound:false,system:false,background:false};}catch{return {sound:false,system:false,background:false};}});
  const [backgroundPushState,setBackgroundPushState]=useState<"idle"|"ready"|"unsupported"|"error">("idle");
  const [backgroundPushTesting,setBackgroundPushTesting]=useState(false);
  const [alertQueue, setAlertQueue] = useState<TradeAlertToast[]>([]);
  const [alertHistory,setAlertHistory]=useState<TradeAlertToast[]>([]);
  const alertToast=alertQueue[0]??null;
  const alertSequence=useRef(0);
  const latestActiveChange=useRef<number|null>(null);
  const deliveredAlertByCode=useRef<Record<string,TradeAlertToast>>({});
  const speechQueue=useRef<{spoken:string;risk:boolean;clip?:"buy"|"sell"|"risk"}[]>([]);
  const speechBusy=useRef(false);
  const alertedEventKeys = useRef<Set<string>>(new Set());
  const queuedAlertEventKeys = useRef<Set<string>>(new Set());
  const lastFormalAlertAtBySide = useRef<Record<string,number>>({});
  const lastCandidateAlertBySide = useRef<Record<string,{at:number;rank:number;time:string}>>({});
  const [frozenZijinPreopenPlan,setFrozenZijinPreopenPlan] = useState<{date:string;plan:ReturnType<typeof buildZijinPreopenPricePlan>}|null>(null);
  const cycleStageRef=useRef(cycleStage);
  const openedCycleSideRef=useRef(openedCycleSide);
  const serverAlertCursor = useRef(0);
  const serverAlertsInitialized = useRef(false);
  const riskAlertEpisodes = useRef<Record<string,string>>({});
  const nextPreviewRabbit = useRef<"buy"|"sell">("buy");
  useEffect(()=>{cycleStageRef.current=cycleStage;},[cycleStage]);
  useEffect(()=>{openedCycleSideRef.current=openedCycleSide;},[openedCycleSide]);
  useEffect(()=>{
    const timer=window.setTimeout(()=>{
      try{
        const saved=localStorage.getItem(`rabbit-alert-history:${accountName.toLowerCase()}`);
        const parsed=saved?JSON.parse(saved):[];
        setAlertHistory(Array.isArray(parsed)?parsed.slice(0,200):[]);
      }catch{setAlertHistory([])}
    },0);
    return()=>window.clearTimeout(timer);
  },[accountName]);
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
  const [zijinHkMarket,setZijinHkMarket]=useState<ZijinHkMarket|null>(null);
  const [marketContextError, setMarketContextError] = useState("");
  const [eventRadar, setEventRadar] = useState<EventRadarResponse | null>(null);
  const [eventRadarError, setEventRadarError] = useState("");
  const [starredRevision, setStarredRevision] = useState(0);
  const [indicatorsVisible, setIndicatorsVisible] = useState(true);
  const [signalLayerVisible,setSignalLayerVisible]=useState(true);
  const [pricePlanLayerVisible,setPricePlanLayerVisible]=useState(true);
  const [volumeLayerVisible,setVolumeLayerVisible]=useState(true);
  const [rabbitTrackerVisible,setRabbitTrackerVisible]=useState(()=>{
    try{return localStorage.getItem("rabbit-chart-tracker-visible")!=="false"}catch{return true}
  });
  const [tEntryPrice,setTEntryPrice]=useState("");
  const [tExitPrice,setTExitPrice]=useState("");
  const [tQuantity,setTQuantity]=useState("1000");
  const [tUseConservativeFee,setTUseConservativeFee]=useState(true);
  const [decisionAuditOpen,setDecisionAuditOpen]=useState(false);
  const [tCalculatorOpen,setTCalculatorOpen]=useState(false);
  const [showAllPriceLevels,setShowAllPriceLevels]=useState(false);
  const [decisionZoneMode,setDecisionZoneMode]=useState<"focus"|"all">("focus");
  const [draggedStockCode, setDraggedStockCode] = useState<string | null>(null);
  const [dragOverStockCode, setDragOverStockCode] = useState<string | null>(null);
  const draggedStockCodeRef = useRef<string | null>(null);
  const [workspaceFullscreen, setWorkspaceFullscreen] = useState(false);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const intradayChartRef = useRef<SVGSVGElement | null>(null);
  const [intradayCursorTime,setIntradayCursorTime]=useState<string|null>(null);
  const [tShareOpen,setTShareOpen]=useState(false);
  const [tShareQrEnabled,setTShareQrEnabled]=useState(true);
  const [tShareBusy,setTShareBusy]=useState(false);
  const [tShareImage,setTShareImage]=useState("");
  const [tShareMessage,setTShareMessage]=useState("");
  useEffect(()=>{
    try{localStorage.setItem("rabbit-chart-tracker-visible",String(rabbitTrackerVisible))}catch{}
  },[rabbitTrackerVisible]);
  const stock = stockList[activeStock] || stockList[0];
  const activeProfitMode=preferences.profitMode;
  const activeProfitSummary=profitModeSummary(stock?.code,activeProfitMode);
  const setProfitMode=(value:ProfitMode)=>setPreferences(current=>{
    const next={...current,profitMode:value};
    if(!demoMode&&accountName){try{localStorage.setItem(`rabbit-prefs:${accountName.toLowerCase()}`,JSON.stringify(next))}catch{}}
    return next;
  });
  useEffect(()=>{
    if(!localAuth||!accountName||!stockList.length)return;
    const signature=stockList.map(item=>`${item.code}:${item.name}`).join('|');
    if(validatedWatchlistSignature.current===signature)return;
    validatedWatchlistSignature.current=signature;
    let cancelled=false;
    void fetch('/api/stock-identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stocks:stockList.map(({code,name})=>({code,name}))})})
      .then(async response=>{
        if(!response.ok)throw new Error('证券身份校验暂不可用');
        return response.json() as Promise<{stocks:StockIdentityResult[]}>;
      })
      .then(payload=>{
        if(cancelled||!Array.isArray(payload.stocks))return;
        const resolvedByInput=new Map(payload.stocks.filter(item=>item.status!=='unknown').map(item=>[item.inputCode,item]));
        const correctedCodes=new Map<string,string>();
        const unique=new Map<string,(typeof stockList)[number]>();
        for(const item of stockList){
          const resolved=resolvedByInput.get(item.code);
          const next=resolved?{...item,code:resolved.code,name:resolved.name}:item;
          correctedCodes.set(item.code,next.code);
          if(!unique.has(next.code))unique.set(next.code,next);
        }
        const next=[...unique.values()];
        const nextSignature=next.map(item=>`${item.code}:${item.name}`).join('|');
        if(nextSignature===signature)return;
        const selectedCode=correctedCodes.get(stockList[activeStock]?.code)??next[0]?.code;
        setStockList(next);
        setActiveStock(Math.max(0,next.findIndex(item=>item.code===selectedCode)));
        setStockPositions(current=>{
          const updated={...current};
          for(const [oldCode,newCode] of correctedCodes){
            if(oldCode!==newCode&&updated[oldCode]){
              updated[newCode]=updated[newCode]??updated[oldCode];
              delete updated[oldCode];
            }
          }
          return updated;
        });
        setPreferences(current=>{
          const preferredCode=current.stock.match(/\d{6}/)?.[0]??'';
          const repairedCode=correctedCodes.get(preferredCode)??preferredCode;
          const repaired=next.find(item=>item.code===repairedCode)??next[0];
          return repaired?{...current,stock:`${repaired.code} ${repaired.name}`}:current;
        });
        try{localStorage.setItem(`rabbit-watchlist:${accountName.toLowerCase()}`,JSON.stringify(next));}catch{}
      })
      .catch(()=>{});
    return()=>{cancelled=true};
  },[localAuth,accountName,stockList,activeStock]);
  const selectActiveStock=useCallback((index:number)=>{
    const nextIndex=Math.max(0,Math.min(index,stockList.length-1));
    const nextCode=stockList[nextIndex]?.code;
    setActiveStock(nextIndex);
    if(!nextCode||!accountName||typeof window==='undefined')return;
    try{localStorage.setItem(`rabbit-active-stock:${accountName.toLowerCase()}`,nextCode)}catch{}
  },[accountName,stockList]);
  useEffect(()=>{
    const handleDeskShortcut=(event:KeyboardEvent)=>{
      if(activeView!=="操盘台"||event.altKey||event.ctrlKey||event.metaKey)return;
      const target=event.target as HTMLElement|null;
      if(target?.matches("input, textarea, select, [contenteditable='true']"))return;
      if(event.key==="ArrowDown"||event.key==="ArrowUp"){
        event.preventDefault();
        const delta=event.key==="ArrowDown"?1:-1;
        selectActiveStock((activeStock+delta+stockList.length)%stockList.length);
      }
      if(event.code==="Space"){
        event.preventDefault();
        document.querySelector<HTMLElement>(".t-calculator input")?.focus();
      }
    };
    document.addEventListener("keydown",handleDeskShortcut);
    return()=>document.removeEventListener("keydown",handleDeskShortcut);
  },[activeView,activeStock,selectActiveStock,stockList.length]);
  useEffect(()=>{
    if(!localAuth||!accountName||!stockList.length||isZijinExperimentDeepLink())return;
    const timer=window.setTimeout(()=>{
      try{
        const savedCode=localStorage.getItem(`rabbit-active-stock:${accountName.toLowerCase()}`);
        const savedIndex=stockList.findIndex(item=>item.code===savedCode);
        if(savedIndex>=0)setActiveStock(current=>current===savedIndex?current:savedIndex);
      }catch{}
    },0);
    return()=>window.clearTimeout(timer);
  },[localAuth,accountName,stockList]);
  useEffect(()=>{
    const syncFullscreenState=()=>setWorkspaceFullscreen(document.fullscreenElement===workspaceRef.current);
    const closeFallback=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document.fullscreenElement)setWorkspaceFullscreen(false)};
    document.addEventListener('fullscreenchange',syncFullscreenState);
    document.addEventListener('keydown',closeFallback);
    return()=>{document.removeEventListener('fullscreenchange',syncFullscreenState);document.removeEventListener('keydown',closeFallback)};
  },[]);
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
    if(!authReady||typeof window==="undefined")return;
    const requested=new URLSearchParams(window.location.search).get("view");
    if(requested!=="membership")return;
    const timer=window.setTimeout(()=>{
      if(localAuth)setAccountOpen(true);
      else setAuthScreen("account");
    },0);
    return()=>window.clearTimeout(timer);
  },[authReady,localAuth]);
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
  const baseActiveQuote = currentTrial?.quote ?? currentMarket?.quote;
  const marketSession = useMemo(() => aShareSession(clockNow), [clockNow]);
  const marketDataActive = useMemo(() => isFastMarketDataPhase(marketSession), [marketSession]);
  const premiumEnabled=accountRole==="admin"||(!demoMode&&accountMembership?.active===true);
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
  const saveStockOrder=(next:typeof initialStocks)=>{
    const selectedCode=stockList[activeStock]?.code;
    setStockList(next);
    const selectedIndex=next.findIndex(item=>item.code===selectedCode);
    setActiveStock(selectedIndex>=0?selectedIndex:0);
    try{localStorage.setItem(`rabbit-watchlist:${accountName.toLowerCase()}`,JSON.stringify(next));}catch{}
  };
  const moveStock=(fromIndex:number,toIndex:number)=>{
    if(fromIndex===toIndex||toIndex<0||toIndex>=stockList.length)return;
    saveStockOrder(moveWatchlistItem(stockList,fromIndex,toIndex));
  };
  const startStockDrag=(event:React.DragEvent<HTMLElement>,code:string)=>{
    draggedStockCodeRef.current=code;
    setDraggedStockCode(code);
    event.dataTransfer.effectAllowed='move';
    event.dataTransfer.setData('text/plain',code);
  };
  const finishStockDrag=()=>{
    draggedStockCodeRef.current=null;
    setDraggedStockCode(null);
    setDragOverStockCode(null);
  };
  const dropStock=(event:React.DragEvent<HTMLElement>,targetCode:string)=>{
    event.preventDefault();
    const sourceCode=event.dataTransfer.getData('text/plain')||draggedStockCodeRef.current||draggedStockCode;
    if(sourceCode&&sourceCode!==targetCode)saveStockOrder(moveWatchlistItemByCode(stockList,sourceCode,targetCode));
    finishStockDrag();
  };
  const toggleWorkspaceFullscreen=async()=>{
    const target=workspaceRef.current;
    if(!target)return;
    if(!target.requestFullscreen){setWorkspaceFullscreen(value=>!value);return;}
    try{
      if(document.fullscreenElement===target)await document.exitFullscreen?.();
      else{
        if(document.fullscreenElement)await document.exitFullscreen?.();
        await target.requestFullscreen?.();
      }
    }catch{}
  };
  const [liveL2ByMinute,setLiveL2ByMinute]=useState<Record<string,ZijinL2State>>({});
  const [liveL2Status,setLiveL2Status]=useState<ZijinL2State|null>(null);
  const [liveL2Transport,setLiveL2Transport]=useState<"connecting"|"stream"|"polling">("connecting");
  const [liveL2PushLatencyMs,setLiveL2PushLatencyMs]=useState<number|null>(null);
  useEffect(()=>{
    if(!localAuth||stock?.code!=="601899"||!shouldRunTradingDeskPolling(activeView,document.visibilityState))return;
    let active=true;
    let timer:number|undefined;
    let source:EventSource|null=null;
    let streamWatchdog:number|undefined;
    let lastStreamPayloadAt=Date.now();
    const closeStream=()=>{
      source?.close();
      source=null;
      if(streamWatchdog!==undefined){
        window.clearInterval(streamWatchdog);
        streamWatchdog=undefined;
      }
    };
    const applyPayload=(payload:ZijinL2State)=>{
      const minute=payload.lastExchangeTime?.match(/^\d{8}-(\d{4})/)?.[1];
      const stale=payload.status?.stale||payload.meta?.stale;
      if(!active)return;
      const servedAt=Date.parse(payload.meta?.servedAt??"");
      setLiveL2PushLatencyMs(Number.isFinite(servedAt)?Math.max(0,Date.now()-servedAt):null);
      setLiveL2Status(payload);
      if(payload.status?.connected&&!stale){
        setLiveL2ByMinute(current=>{
          const next={...current};
          for(const bar of payload.recentMinutes??[]){
            if(!/^\d{4}$/.test(bar.time))continue;
            const isCurrent=bar.time===minute;
            next[bar.time]=isCurrent
              ? {...payload,l2Bar:bar}
              : {
                status:{...payload.status,stale:false},
                meta:{...payload.meta,stale:false},
                flow:{
                  activeBuyRatio60s:bar.activeBuyRatio,
                  netActiveNotional60s:bar.netActiveNotional,
                  bigOrderNetNotional60s:bar.bigOrderNetNotional,
                  activeBuyVolume60s:bar.activeBuyVolume,
                  activeSellVolume60s:bar.activeSellVolume,
                  activeBuyNotional60s:bar.activeBuyNotional,
                  activeSellNotional60s:bar.activeSellNotional,
                  bigBuyNotional60s:bar.bigBuyNotional,
                  bigSellNotional60s:bar.bigSellNotional,
                  bigBuyVolume60s:bar.bigBuyVolume,
                  bigSellVolume60s:bar.bigSellVolume,
                },
                book:{lastPrice:bar.price},
                l2Bar:bar,
              };
          }
          if(minute&&!next[minute])next[minute]=payload;
          return next;
        });
      }
    };
    const poll=async()=>{
      try{
        const response=await fetch(`/api/research/zijin-l2-orderflow?t=${Date.now()}`,{cache:"no-store"});
        const payload=await response.json() as ZijinL2State;
        applyPayload(payload);
      }catch{if(active)setLiveL2Status({error:"L2 status endpoint unavailable",status:{connected:false,stale:true}})}
      if(active)timer=window.setTimeout(()=>void poll(),marketDataActive?300:60_000);
    };
    const startPolling=()=>{
      if(!active||timer!==undefined)return;
      setLiveL2Transport("polling");
      void poll();
    };
    if(marketDataActive&&typeof EventSource!=="undefined"){
      setLiveL2Transport("connecting");
      source=new EventSource(`/api/research/zijin-l2-orderflow?stream=1&t=${Date.now()}`);
      source.addEventListener("snapshot",event=>{
        try{
          const payload=JSON.parse((event as MessageEvent<string>).data) as ZijinL2State;
          lastStreamPayloadAt=Date.now();
          applyPayload(payload);
          if(active)setLiveL2Transport("stream");
        }catch{}
      });
      source.onerror=()=>{
        closeStream();
        startPolling();
      };
      streamWatchdog=window.setInterval(()=>{
        if(!active||!source||Date.now()-lastStreamPayloadAt<=3_000)return;
        closeStream();
        startPolling();
      },1_000);
    }else startPolling();
    return()=>{
      active=false;
      closeStream();
      if(timer!==undefined)window.clearTimeout(timer);
    };
  },[localAuth,activeView,stock?.code,marketDataActive]);
  const liveL2CollectorAlive=Boolean(liveL2Status&&(liveL2Status.status?.collectorAlive!==false&&liveL2Status.meta?.collectorStale!==true));
  const liveL2Stale=Boolean(!liveL2CollectorAlive||liveL2Status?.status?.stale||liveL2Status?.meta?.stale);
  const liveL2HasTicks=Boolean((liveL2Status?.messages?.transaction??0)>0||(liveL2Status?.messages?.order??0)>0);
  const liveL2FeedAgeSeconds=Number.isFinite(liveL2Status?.status?.feedAgeSeconds)
    ? liveL2Status?.status?.feedAgeSeconds
    : liveL2Status?.status?.ageSeconds;
  const liveL2LatencyMs=Number.isFinite(liveL2FeedAgeSeconds)
    ? Math.max(0,Math.round((liveL2FeedAgeSeconds??0)*1000))
    : null;
  const liveL2LatencyText=liveL2LatencyMs===null?"行情年龄待测":`行情年龄 ${liveL2LatencyMs} ms`;
  const liveL2TransportText=liveL2Transport==="stream"
    ? `主动推送${liveL2PushLatencyMs===null?"":` ${liveL2PushLatencyMs} ms`}`
    : liveL2Transport==="polling"
      ? "轮询降级"
      : "推送连接中";
  const liveL2HeartbeatSeconds=Number.isFinite(liveL2Status?.status?.heartbeatAgeSeconds)
    ? Math.max(0,Math.round(liveL2Status?.status?.heartbeatAgeSeconds??0))
    : null;
  const liveL2LastPrice=Number(liveL2Status?.book?.lastPrice);
  const liveL2PriceUsable=stock?.code==="601899"
    &&liveL2Status?.status?.connected===true
    &&!liveL2Stale
    &&liveL2HasTicks
    &&Number.isFinite(liveL2LastPrice)
    &&liveL2LastPrice>0
    &&(!baseActiveQuote?.price||Math.abs(liveL2LastPrice-baseActiveQuote.price)/Math.max(baseActiveQuote.price,.01)<=.05);
  const activeQuote=useMemo(()=>{
    if(!liveL2PriceUsable)return baseActiveQuote;
    const previousClose=liveL2Status?.session?.previousClose??baseActiveQuote?.previousClose;
    const change=previousClose&&previousClose>0?liveL2LastPrice-previousClose:baseActiveQuote?.change??null;
    const changePercent=previousClose&&previousClose>0?change!/previousClose*100:baseActiveQuote?.changePercent??null;
    return {
      ...(baseActiveQuote??{code:"601899",name:stock?.name??"紫金矿业",open:null,high:null,low:null,change:null,changePercent:null}),
      price:liveL2LastPrice,
      previousClose,
      open:liveL2Status?.session?.open??baseActiveQuote?.open??null,
      high:liveL2Status?.session?.high??baseActiveQuote?.high??null,
      low:liveL2Status?.session?.low??baseActiveQuote?.low??null,
      volume:liveL2Status?.session?.volume??baseActiveQuote?.volume??null,
      amount:liveL2Status?.session?.amount??baseActiveQuote?.amount??null,
      change,
      changePercent,
    };
  },[baseActiveQuote,liveL2PriceUsable,liveL2LastPrice,liveL2Status?.session,stock.name]);
  useEffect(()=>{
    latestActiveChange.current=activeQuote?.changePercent??null;
  },[activeQuote?.changePercent]);
  // Connection payloads may include an endpoint or a broker-provided error.  Keep
  // those transport details out of the console UI; this card is a service-status
  // indicator, not a connection diagnostic.
  const l2ConsoleNode="上海节点";
  const l2ConnectionLimited=Boolean(liveL2Status?.error&&/maximum|active connections|连接.*上限|额度/i.test(liveL2Status.error));
  const l2ConsoleStatus=stock.code!=="601899"
    ? {tone:"inactive",label:"L2：未启用",detail:"仅紫金矿业接入"}
    : !marketSession.live
      ? {tone:"paused",label:"L2：休市待命",detail:`${l2ConsoleNode} · ${marketSession.label}，开市后恢复实时校验`}
    : !liveL2Status
      ? {tone:"loading",label:"L2：连接中",detail:"正在核验上海节点"}
    : !liveL2CollectorAlive
      ? {tone:"off",label:"L2：采集器离线",detail:`${l2ConsoleNode} · 心跳${liveL2HeartbeatSeconds===null?"已中断":`中断 ${liveL2HeartbeatSeconds} 秒`}`}
    : l2ConnectionLimited
      ? {tone:"off",label:"L2：连接受限",detail:"账号连接额度已满，请清理旧连接"}
    : liveL2Status?.status?.authorized===false
      ? {tone:"off",label:"L2：权限 OFF",detail:"账号未获 601899 数据权限"}
    : liveL2Status?.status?.connected&&!liveL2Stale
      ? {tone:"ok",label:"L2：接口 OK",detail:`${l2ConsoleNode} · ${liveL2HasTicks?"十档与逐笔在线":"十档在线，逐笔待数据"} · ${liveL2TransportText} · ${liveL2LatencyText}`}
    : marketSession.live
      ? {tone:"stale",label:"L2：行情中断",detail:`${l2ConsoleNode} · ${liveL2LatencyText}`}
      : {tone:"off",label:"L2：接口 OFF",detail:`${l2ConsoleNode} · 连接未建立`};
  const rawMinutePoints = useMemo(
    () => currentTrial?.minutes?.length ? currentTrial.minutes : currentMarket?.minutes ?? [],
    [currentTrial,currentMarket?.minutes],
  );
  const l2MinutePoints=useMemo(()=>stock.code==="601899"?liveL2ByMinute:{},[stock.code,liveL2ByMinute]);
  const minutePoints = useMemo(() => {
    type LiveMinutePoint = {
      time:string; price:number; volume:number; high?:number|null; low?:number|null; averagePrice?:number|null;
      dataSource:"public-fallback"|"l2-primary"; l2?:ZijinL2State;
    };
    const merged=new Map<string,LiveMinutePoint>(rawMinutePoints
      .filter(point=>isAShareRegularTradingMinute(point.time))
      .map(point=>[point.time,{...point,dataSource:"public-fallback" as const}]));
    for(const [time,l2] of Object.entries(l2MinutePoints)){
      if(!isAShareRegularTradingMinute(time))continue;
      if(l2.status?.connected!==true||l2.status?.authorized===false||l2.status?.stale===true||l2.meta?.stale===true)continue;
      const base=merged.get(time);
      const l2Price=Number(l2.l2Bar?.price??l2.book?.lastPrice);
      const l2High=Number(l2.l2Bar?.high);
      const l2Low=Number(l2.l2Bar?.low);
      const priceCompatible=Number.isFinite(l2Price)&&l2Price>0
        &&(!base||Math.abs(l2Price-base.price)/Math.max(base.price,.01)<=.05);
      if(!priceCompatible)continue;
      // The snapshot field is cumulative for the whole session. A collector
      // restart can therefore make the first derived L2 minute look enormous.
      // Keep the public minute bar for completed minutes and only use the
      // genuine rolling 60-second transaction flow for the active minute.
      const flowVolume=Number(l2.flow?.tradeVolume60s);
      const publicVolume=Number(base?.volume);
      const derivedBarVolume=Number(l2.l2Bar?.volume);
      const l2Volume=Number.isFinite(flowVolume)&&flowVolume>0
        ? flowVolume
        : Number.isFinite(publicVolume)&&publicVolume>0
          ? publicVolume
          : Number.isFinite(derivedBarVolume)&&derivedBarVolume>0
            ? derivedBarVolume
            : 0;
      merged.set(time,{
        ...(base??{time,price:l2Price,volume:0}),
        price:l2Price,
        high:Number.isFinite(l2High)&&l2High>0?l2High:base?.high??l2Price,
        low:Number.isFinite(l2Low)&&l2Low>0?l2Low:base?.low??l2Price,
        volume:Number.isFinite(l2Volume)&&l2Volume>0?l2Volume:base?.volume??0,
        averagePrice:l2.l2Bar?.averagePrice??base?.averagePrice??null,
        dataSource:"l2-primary",
        l2,
      });
    }
    return [...merged.values()].sort((a,b)=>a.time.localeCompare(b.time)).map(point=>{
      // Some upstream snapshots occasionally carry a day-level high/low in a
      // minute bar.  It must not stretch the intraday scale when it is plainly
      // inconsistent with that minute's last price.
      const price=Number(point.price);
      if(!Number.isFinite(price)||price<=0)return point;
      const high=Number(point.high);
      const low=Number(point.low);
      return {
        ...point,
        high:Number.isFinite(high)&&high>=price&&high<=price*1.06?high:price,
        low:Number.isFinite(low)&&low<=price&&low>=price*.94?low:price,
      };
    });
  }, [rawMinutePoints,l2MinutePoints]);
  const l2CalculationCoverage=useMemo(
    ()=>stock?.code==="601899"?minutePoints.filter(point=>point.dataSource==="l2-primary").length:0,
    [stock?.code,minutePoints],
  );
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
    const prices=minutePoints.flatMap(point=>[
      point.price,
      Number.isFinite(point.high)&&Number(point.high)>0?Number(point.high):point.price,
      Number.isFinite(point.low)&&Number(point.low)>0?Number(point.low):point.price,
    ]);
    const averageSeries=cumulativeIntradayAverage(minutePoints);
    const scale=symmetricIntradayScale(
      [...prices,...averageSeries],
      activeQuote?.previousClose,
      {tickCount:9,minimumPercent:.005,paddingFactor:1.08},
    );
    if(!scale)return null;
    const {min,max}=scale;
    const pointAt=(point:{price:number},index:number)=>`${liveChartX(minutePoints[index].time)},${liveChartPriceY(point.price,min,max)}`;
    const path=`M${minutePoints.map(pointAt).join(' L')}`;
    const vwap=averageSeries.map((price,index)=>pointAt({price},index));
    const sortedVolumes=minutePoints.map(point=>Math.max(0,point.volume)).sort((left,right)=>left-right);
    const volumeReference=Math.max(1,sortedVolumes[Math.floor((sortedVolumes.length-1)*.92)]??1);
    const lastVwap=averageSeries.at(-1) ?? minutePoints.at(-1)!.price;
    const firstX=liveChartX(minutePoints[0].time); const lastX=liveChartX(minutePoints.at(-1)!.time);
    const biasValues=minutePoints.map((point,index)=>{
      const average=averageSeries[index]??point.price;
      return average>0?(point.price-average)/average*100:0;
    });
    const biasScale=Math.max(1.5,...biasValues.map(value=>Math.abs(value)));
    const biasMiddle=LIVE_CHART.volumeTop+(LIVE_CHART.volumeBottom-LIVE_CHART.volumeTop)/2;
    const biasAmplitude=(LIVE_CHART.volumeBottom-LIVE_CHART.volumeTop)*.38;
    const biasPath=`M${biasValues.map((value,index)=>`${liveChartX(minutePoints[index].time)},${biasMiddle-(value/biasScale)*biasAmplitude}`).join(" L")}`;
    const volumeSignals=minutePoints.map((point,index)=>{
      const prior=minutePoints.slice(Math.max(0,index-20),index)
        .map(item=>Math.max(0,Number(item.volume)||0))
        .filter(value=>value>0);
      const baseline=prior.length>=5
        ? prior.reduce((sum,value)=>sum+value,0)/prior.length
        : null;
      const ratio=baseline&&baseline>0?Math.max(0,point.volume)/baseline:null;
      return {ratio,abnormal:ratio!==null&&ratio>=3};
    });
    const peakVolumeIndex=minutePoints.reduce((bestIndex,point,index)=>
      Math.max(0,point.volume)>Math.max(0,minutePoints[bestIndex]?.volume??0)?index:bestIndex,0);
    const peakVolumePoint=minutePoints[peakVolumeIndex];
    const latestPoint=minutePoints.at(-1)!;
    const preCloseAuctionIndex=minutePoints.findLastIndex(point=>point.time<"1457");
    const preCloseAuctionPoint=preCloseAuctionIndex>=0?minutePoints[preCloseAuctionIndex]:null;
    const closingAuctionMovePct=isAShareClosingAuctionMinute(latestPoint.time)&&preCloseAuctionPoint?.price
      ? (latestPoint.price-preCloseAuctionPoint.price)/preCloseAuctionPoint.price*100
      : null;
    const closingAuctionJump=closingAuctionMovePct!==null&&Math.abs(closingAuctionMovePct)>=.3
      ? {
        x:liveChartX(latestPoint.time),
        y:liveChartPriceY(latestPoint.price,min,max),
        time:latestPoint.time,
        movePct:closingAuctionMovePct,
      }
      : null;
    let latestVwapCross:null|{x:number;y:number;time:string;direction:"up"|"down";index:number}=null;
    for(let index=1;index<minutePoints.length;index+=1){
      if(isAShareClosingAuctionMinute(minutePoints[index].time))continue;
      const previousDelta=minutePoints[index-1].price-averageSeries[index-1];
      const currentDelta=minutePoints[index].price-averageSeries[index];
      if((previousDelta<0&&currentDelta>=0)||(previousDelta>0&&currentDelta<=0)){
        latestVwapCross={
          x:liveChartX(minutePoints[index].time),
          y:liveChartPriceY(minutePoints[index].price,min,max),
          time:minutePoints[index].time,
          direction:currentDelta>=0?"up":"down",
          index,
        };
      }
    }
    const recentVwapCross=latestVwapCross&&latestVwapCross.index>=minutePoints.length-3?latestVwapCross:null;
    return {
      path,vwapPath:`M${vwap.join(' L')}`,min,max,last:minutePoints.at(-1)!,firstX,lastX,lastVwap,
      biasPath,
      latestBias:biasValues.at(-1)??0,
      biasAlert:Math.abs(biasValues.at(-1)??0)>=1.5,
      peakVolume:{
        x:liveChartX(peakVolumePoint.time),
        time:peakVolumePoint.time,
        volume:Math.max(0,peakVolumePoint.volume),
        ratio:volumeSignals[peakVolumeIndex]?.ratio??null,
        abnormal:volumeSignals[peakVolumeIndex]?.abnormal??false,
      },
      closingAuctionJump,
      recentVwapCross,
      lastY:liveChartPriceY(minutePoints.at(-1)!.price,min,max),
      points:minutePoints.map((point,index)=>({
        ...point,
        averagePrice:averageSeries[index]??point.price,
        biasPercent:(averageSeries[index]??point.price)>0
          ? (point.price-(averageSeries[index]??point.price))/(averageSeries[index]??point.price)*100
          : 0,
        x:liveChartX(point.time),
        y:liveChartPriceY(point.price,min,max),
      })),
      volumes:minutePoints.map((point,index)=>{
        const normalized=Math.min(1.35,Math.max(0,point.volume)/volumeReference);
        return {
          x:liveChartX(point.time),
          height:Math.max(3,Math.sqrt(normalized/1.35)*44),
          up:index===0||point.price>=minutePoints[index-1].price,
          ratio:volumeSignals[index].ratio,
          abnormal:volumeSignals[index].abnormal,
        };
      }),
      ticks:scale.ticks.map(tick=>({...tick,y:liveChartPriceY(tick.value,min,max)})),
    };
  },[minutePoints,activeQuote?.previousClose]);
  const zijinAhLinkage=useMemo(()=>{
    if(stock?.code!=="601899"||!zijinHkMarket)return analyzeZijinAhLinkage();
    const sourceTime=zijinHkMarket.sourceTimestamp?new Date(zijinHkMarket.sourceTimestamp).getTime():NaN;
    const stale=marketSession.live&&(!Number.isFinite(sourceTime)||clockNow===null||clockNow.getTime()-sourceTime>120_000);
    if(stale)return {...analyzeZijinAhLinkage(),label:"港股数据延迟",reason:"港股分钟数据超过120秒未更新"};
    return analyzeZijinAhLinkage({
      aMinutes:minutePoints,
      aPreviousClose:activeQuote?.previousClose,
      hkMinutes:zijinHkMarket.minutes,
      hkPreviousClose:zijinHkMarket.quote.previousClose,
    });
  },[stock?.code,zijinHkMarket,minutePoints,activeQuote?.previousClose,marketSession.live,clockNow]);
  const zijinHkOverlay=useMemo(()=>{
    if(!chartModel||!zijinAhLinkage.available||!activeQuote?.previousClose||zijinAhLinkage.points.length<2)return null;
    const path=zijinAhLinkage.points.map((point,index)=>{
      const aEquivalent=activeQuote.previousClose!*(1+point.hkReturnPercent/100);
      return `${index?"L":"M"}${liveChartX(point.time)},${liveChartPriceY(aEquivalent,chartModel.min,chartModel.max)}`;
    }).join(" ");
    return {path,last:zijinAhLinkage.points.at(-1)!};
  },[chartModel,zijinAhLinkage,activeQuote]);
  const stockState = useMemo(() => recognizeStockState(currentMarket?.bars ?? [], activeQuote, minutePoints), [currentMarket?.bars, activeQuote, minutePoints]);
  const isZijinStock=stock?.code===STOCK_AGENTS.zijin.code;
  const zijinMainForceTrack=useMemo(
    ()=>buildZijinMainForceTrack(isZijinStock?(liveL2Status?.recentMinutes??[]):[]),
    [isZijinStock,liveL2Status?.recentMinutes],
  );
  const zijinMainForcePeak=useMemo(
    ()=>Math.max(1,...zijinMainForceTrack.bars.map(bar=>Math.abs(bar.netNotional))),
    [zijinMainForceTrack.bars],
  );
  const zijinFundResponse=useMemo(
    ()=>evaluateZijinFundResponse(zijinMainForceTrack.bars),
    [zijinMainForceTrack.bars],
  );
  const positiveTBlockedByFlow=Boolean(isZijinStock&&zijinFundResponse.positiveTBlocked);
  const zijinMainForceIntent=useMemo(
    ()=>summarizeZijinMainForceIntent(zijinMainForceTrack.bars),
    [zijinMainForceTrack.bars],
  );
  const nextSessionOutlook=useMemo(()=>{
    const previousClose=Number(activeQuote?.previousClose);
    const prices=minutePoints.map(point=>Number(point.price)).filter(price=>Number.isFinite(price)&&price>0);
    const close=prices.at(-1)??0;
    if(prices.length<20||!Number.isFinite(previousClose)||previousClose<=0||close<=0){
      return {ready:false as const,stage:"数据准备中",detail:"至少需要 20 个有效分钟点与昨收，收盘后自动生成下一交易日结构预判。"};
    }
    const high=Math.max(...prices,Number(activeQuote?.high)||0);
    const low=Math.min(...prices.filter(price=>price>0),Number(activeQuote?.low)>0?Number(activeQuote?.low):Number.POSITIVE_INFINITY);
    const open=Number(activeQuote?.open)>0?Number(activeQuote?.open):prices[0];
    const vwap=chartModel?.lastVwap??close;
    const changePct=(close-previousClose)/previousClose*100;
    const vwapBiasPct=(close-vwap)/Math.max(vwap,.01)*100;
    const closePosition=(close-low)/Math.max(high-low,.01);
    const recentStart=prices[Math.max(0,prices.length-20)];
    const recentMovePct=(close-recentStart)/Math.max(recentStart,.01)*100;
    const recentVolume=minutePoints.slice(-20).reduce((sum,point)=>sum+Math.max(0,Number(point.volume)||0),0);
    const priorVolume=minutePoints.slice(Math.max(0,minutePoints.length-40),-20).reduce((sum,point)=>sum+Math.max(0,Number(point.volume)||0),0);
    const volumeRatio=priorVolume>0?recentVolume/priorVolume:1;
    const factors:string[]=[];
    const signals:number[]=[];
    const intradayScore=(changePct>=.8?2:changePct<=-.8?-2:0)
      +(vwapBiasPct>=.18?1:vwapBiasPct<=-.18?-1:0)
      +(recentMovePct>=.15?1:recentMovePct<=-.15?-1:0)
      +(volumeRatio>=1.15?(recentMovePct>=0?1:-1):0);
    signals.push(intradayScore);
    factors.push(`分时 ${changePct>=0?"+":""}${changePct.toFixed(2)}% · 尾盘 ${recentMovePct>=0?"+":""}${recentMovePct.toFixed(2)}%`);

    const bars=(currentMarket?.bars??[]).filter(bar=>[bar.open,bar.high,bar.low,bar.close].every(value=>Number.isFinite(value)&&value>0)).slice(-20);
    const closes=bars.map(bar=>bar.close);
    let dailyScore=0;
    if(closes.length>=20){
      const average=(values:number[])=>values.reduce((sum,value)=>sum+value,0)/values.length;
      const ma5=average(closes.slice(-5));
      const ma20=average(closes);
      dailyScore=close>ma5&&ma5>ma20?2:close<ma5&&ma5<ma20?-2:close>=ma20?1:-1;
      factors.push(`日线 ${dailyScore>=2?"多头排列":dailyScore<=-2?"空头排列":close>=ma20?"站上20日线":"位于20日线下"}`);
    }
    const candleRange=Math.max(high-low,.01);
    const candleBody=(close-open)/candleRange;
    const upperShadow=(high-Math.max(open,close))/candleRange;
    const lowerShadow=(Math.min(open,close)-low)/candleRange;
    const candleScore=closePosition>=.72&&candleBody>=.18?1
      :closePosition<=.28&&candleBody<=-.18?-1
      :upperShadow>=.45&&closePosition<.55?-1
      :lowerShadow>=.45&&closePosition>.45?1:0;
    signals.push(dailyScore+candleScore);
    factors.push(`K线 ${candleScore>0?"下影承接":candleScore<0?"上影承压":`收盘位于振幅${Math.round(closePosition*100)}%`}`);

    const contextAverage=(group:"market"|"sector")=>{
      const values=(currentContext?.items??[])
        .filter(item=>item.group===group&&Number.isFinite(item.changePercent))
        .map(item=>Number(item.changePercent));
      return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
    };
    const marketChange=contextAverage("market");
    const sectorChange=contextAverage("sector");
    const contextSignal=(marketChange===null?0:marketChange>=.35?1:marketChange<=-.35?-1:0)
      +(sectorChange===null?0:sectorChange>=.45?1:sectorChange<=-.45?-1:0);
    if(marketChange!==null)factors.push(`大盘 ${marketChange>=0?"+":""}${marketChange.toFixed(2)}%`);
    if(sectorChange!==null)factors.push(`板块 ${sectorChange>=0?"+":""}${sectorChange.toFixed(2)}%`);
    signals.push(contextSignal);

    const l2Ready=isZijinStock&&liveL2PriceUsable&&l2CalculationCoverage>=20&&zijinFundResponse.ready&&zijinMainForceIntent.available;
    if(l2Ready){
      const l2Signal=zijinFundResponse.state==="push"||zijinMainForceIntent.state==="accumulation"?1
        :zijinFundResponse.state==="outflow"||zijinFundResponse.state==="absorbed"||zijinMainForceIntent.state==="outflow"?-1:0;
      signals.push(l2Signal);
      factors.push(`L2 ${zijinMainForceIntent.label} · ${zijinFundResponse.label}`);
    }else if(isZijinStock){
      factors.push("L2 证据不足，暂不计分");
    }

    const clampScore=(value:number)=>Math.max(-100,Math.min(100,value));
    const numericOrNull=(value:unknown)=>{
      if(value===null||value===undefined)return null;
      const parsed=Number(value);
      return Number.isFinite(parsed)?parsed:null;
    };
    const average=(values:(number|null)[])=>{
      const available=values.filter((value):value is number=>value!==null&&Number.isFinite(value));
      return available.length?available.reduce((sum,value)=>sum+value,0)/available.length:null;
    };
    const contextLabelAverage=(labels:string[])=>average(labels.map(label=>{
      const item=(currentContext?.items??[]).find(candidate=>candidate.label===label);
      return numericOrNull(item?.changePercent);
    }));
    const factorDirection=(ready:boolean,value:number)=>!ready?"待数据":value>=15?"偏强":value<=-15?"偏弱":"中性";
    const goldChange=contextLabelAverage(["黄金ETF","沪金连续","纽约黄金"]);
    const copperChange=contextLabelAverage(["沪铜连续","伦铜"]);
    const commodityChange=average([goldChange,copperChange]);
    const commodityReady=commodityChange!==null;
    const commodityScore=clampScore((commodityChange??0)*50);
    const bookImbalance=numericOrNull(liveL2Status?.book?.nearTouchImbalance);
    const bookReady=Boolean(l2Ready&&bookImbalance!==null);
    const bookScore=clampScore((bookImbalance??0)*300);
    const activeBuyRatio=numericOrNull(liveL2Status?.flow?.activeBuyRatio60s);
    const activeNet=numericOrNull(liveL2Status?.flow?.netActiveNotional60s);
    const bigOrderNet=numericOrNull(liveL2Status?.flow?.bigOrderNetNotional60s);
    const flowReady=Boolean(l2Ready&&(activeBuyRatio!==null||activeNet!==null||bigOrderNet!==null));
    const intentBias=zijinMainForceIntent.state==="accumulation"||zijinFundResponse.state==="push"?28
      :zijinMainForceIntent.state==="outflow"||zijinFundResponse.state==="outflow"||zijinFundResponse.state==="absorbed"?-28:0;
    const flowScore=clampScore(
      (activeBuyRatio===null?0:(activeBuyRatio-.5)*160)
      +(activeNet===null?0:Math.sign(activeNet)*18)
      +(bigOrderNet===null?0:Math.sign(bigOrderNet)*12)
      +intentBias,
    );
    const hkChange=contextLabelAverage(["港股紫金矿业"]);
    const marketGroupChange=average([marketChange,sectorChange,hkChange]);
    const marketReady=marketGroupChange!==null;
    const marketScore=clampScore((marketGroupChange??0)*45);
    const eventReady=Boolean(currentEvents);
    const eventCount=(currentEvents?.counts.positive??0)+(currentEvents?.counts.negative??0)+(currentEvents?.counts.neutral??0);
    const eventBalance=eventCount
      ?((currentEvents?.counts.positive??0)-(currentEvents?.counts.negative??0))/eventCount*60
      :0;
    const eventScore=clampScore(currentEvents?.gate.hardLock?-100
      :currentEvents?.gate.level==="restricted"?-65
        :currentEvents?.gate.level==="caution"?Math.min(-20,eventBalance)
          :eventBalance);
    const groups=[
      {
        key:"commodity",label:"商品",ready:commodityReady,score:Math.round(commodityScore),direction:factorDirection(commodityReady,commodityScore),
        detail:commodityReady?`黄金 ${goldChange===null?"--":`${goldChange>=0?"+":""}${goldChange.toFixed(2)}%`} · 铜 ${copperChange===null?"--":`${copperChange>=0?"+":""}${copperChange.toFixed(2)}%`}`:"金铜行情待接入",
      },
      {
        key:"book",label:"盘口",ready:bookReady,score:Math.round(bookScore),direction:factorDirection(bookReady,bookScore),
        detail:bookReady?`近端失衡 ${(bookImbalance!*100).toFixed(1)}% · ${zijinFundResponse.label}`:"连续 L2 盘口待确认",
      },
      {
        key:"flow",label:"资金",ready:flowReady,score:Math.round(flowScore),direction:factorDirection(flowReady,flowScore),
        detail:flowReady?`主动买 ${activeBuyRatio===null?"--":`${(activeBuyRatio*100).toFixed(1)}%`} · ${zijinMainForceIntent.label}`:"主动成交方向待确认",
      },
      {
        key:"market",label:"市场",ready:marketReady,score:Math.round(marketScore),direction:factorDirection(marketReady,marketScore),
        detail:marketReady?`大盘 ${marketChange===null?"--":`${marketChange>=0?"+":""}${marketChange.toFixed(2)}%`} · 板块 ${sectorChange===null?"--":`${sectorChange>=0?"+":""}${sectorChange.toFixed(2)}%`}`:"大盘、板块与港股联动待接入",
      },
      {
        key:"event",label:"事件",ready:eventReady,score:Math.round(eventScore),direction:factorDirection(eventReady,eventScore),
        detail:eventReady?`${currentEvents!.gate.label} · 正${currentEvents!.counts.positive}/负${currentEvents!.counts.negative}`:"公告与公开资讯待扫描",
      },
    ];
    const directionalGroups=groups.filter(group=>group.ready&&Math.abs(group.score)>=15);
    const positiveGroups=directionalGroups.filter(group=>group.score>0).length;
    const negativeGroups=directionalGroups.filter(group=>group.score<0).length;
    const resonanceDirection=positiveGroups>=3?"up":negativeGroups>=3?"down":"mixed";
    const resonance={
      direction:resonanceDirection,
      label:resonanceDirection==="up"?`${positiveGroups}/5 组偏强共振`:resonanceDirection==="down"?`${negativeGroups}/5 组偏弱共振`:"独立因子尚未共振",
      detail:directionalGroups.length?directionalGroups.map(group=>`${group.label}${group.direction}`).join(" · "):"等待至少两个独立分组形成有效方向",
    };
    const externalGroups=groups.filter(group=>["commodity","market","event"].includes(group.key)&&group.ready);
    const externalScore=externalGroups.length?externalGroups.reduce((sum,group)=>sum+group.score,0)/externalGroups.length:0;
    const stockResponseScore=clampScore(changePct*35+vwapBiasPct*30+recentMovePct*25);
    const expectationGap=externalGroups.length<2
      ?{direction:"waiting",label:"预期差待数据",detail:"至少需要两个外部因子组"}
      :externalScore>=25&&stockResponseScore<externalScore-25
        ?{direction:"up",label:"潜在正向预期差",detail:"外部因子先转强，股价响应仍落后"}
        :externalScore<=-25&&stockResponseScore>externalScore+25
          ?{direction:"down",label:"潜在负向预期差",detail:"外部因子先转弱，股价尚未充分响应"}
          :{direction:"flat",label:"未见明显预期差",detail:"外部变化与当前股价响应基本同步"};
    const localScore=clampScore(intradayScore*18+(dailyScore+candleScore)*10);
    const weightedScore=(parts:{score:number;weight:number;ready:boolean}[])=>{
      const available=parts.filter(part=>part.ready);
      const totalWeight=available.reduce((sum,part)=>sum+part.weight,0);
      return totalWeight?clampScore(available.reduce((sum,part)=>sum+part.score*part.weight,0)/totalWeight):0;
    };
    const makeHorizon=(minutes:5|15|30|60,parts:{score:number;weight:number;ready:boolean}[])=>{
      const value=weightedScore(parts);
      const coverage=parts.reduce((sum,part)=>sum+(part.ready?part.weight:0),0)/parts.reduce((sum,part)=>sum+part.weight,0);
      return {
        minutes,
        score:Math.round(value),
        direction:value>=12?"偏强":value<=-12?"偏弱":"震荡",
        coverage:Math.round(coverage*100),
      };
    };
    const local={score:localScore,ready:true};
    const commodity={score:commodityScore,ready:commodityReady};
    const book={score:bookScore,ready:bookReady};
    const flow={score:flowScore,ready:flowReady};
    const market={score:marketScore,ready:marketReady};
    const event={score:eventScore,ready:eventReady};
    const horizons=[
      makeHorizon(5,[{...local,weight:.25},{...book,weight:.30},{...flow,weight:.25},{...commodity,weight:.08},{...market,weight:.07},{...event,weight:.05}]),
      makeHorizon(15,[{...local,weight:.20},{...book,weight:.25},{...flow,weight:.20},{...commodity,weight:.18},{...market,weight:.10},{...event,weight:.07}]),
      makeHorizon(30,[{...local,weight:.20},{...book,weight:.12},{...flow,weight:.18},{...commodity,weight:.25},{...market,weight:.15},{...event,weight:.10}]),
      makeHorizon(60,[{...local,weight:.25},{...book,weight:.08},{...flow,weight:.12},{...commodity,weight:.25},{...market,weight:.17},{...event,weight:.13}]),
    ];
    const baseScore=signals.reduce((sum,value)=>sum+value,0);
    const multiFactorScore=weightedScore([
      {...local,weight:.30},{...commodity,weight:.18},{...book,weight:.16},{...flow,weight:.16},{...market,weight:.12},{...event,weight:.08},
    ]);
    const structureScore=clampScore(baseScore*8+multiFactorScore*.65);
    const direction=structureScore>=18?"偏强":structureScore<=-18?"偏弱":"震荡";
    const researchStrength=Math.min(76,Math.round(Math.abs(structureScore)));
    const confidenceText=`研究 ${researchStrength}`;
    const historicalRanges=bars.slice(-10).map(bar=>(bar.high-bar.low)/Math.max(bar.close,.01)).filter(value=>Number.isFinite(value)&&value>0);
    const historicalRangePct=historicalRanges.length?historicalRanges.reduce((sum,value)=>sum+value,0)/historicalRanges.length:(high-low)/close;
    const todayRangePct=(high-low)/Math.max(close,.01);
    const expectedMovePct=Math.min(.045,Math.max(.012,(historicalRangePct*.6+todayRangePct*.4)*.58));
    const lowerMultiplier=direction==="偏强"?.75:direction==="偏弱"?1.15:1;
    const upperMultiplier=direction==="偏强"?1.15:direction==="偏弱"?.75:1;
    const modelSupport=close*(1-expectedMovePct*.58);
    const modelResistance=close*(1+expectedMovePct*.58);
    const nearbySupport=Math.max(0,...bars.slice(-10).map(bar=>bar.low).filter(value=>value<close&&value>=close*(1-expectedMovePct)));
    const nearbyResistance=Math.min(Number.POSITIVE_INFINITY,...bars.slice(-10).map(bar=>bar.high).filter(value=>value>close&&value<=close*(1+expectedMovePct)));
    const support=nearbySupport>0?Math.max(modelSupport,nearbySupport):modelSupport;
    const resistance=Number.isFinite(nearbyResistance)?Math.min(modelResistance,nearbyResistance):modelResistance;
    const failure=direction==="偏强"?`跌破 ¥${support.toFixed(2)}，偏强结构失效`:
      direction==="偏弱"?`收复 ¥${resistance.toFixed(2)}，偏弱结构失效`:
      `放量突破 ¥${resistance.toFixed(2)} 或跌破 ¥${support.toFixed(2)}，震荡结构改变`;
    return {
      ready:true as const,
      stage:marketSession.live?"盘中动态观察":"盘后结构预判",
      direction,
      confidenceText,
      lower:close*(1-expectedMovePct*lowerMultiplier),
      upper:close*(1+expectedMovePct*upperMultiplier),
      support,
      resistance,
      failure,
      factors:factors.slice(0,6),
      groups,
      resonance,
      expectationGap,
      horizons,
      validation:{label:"样本外待验证",detail:"研究结构不显示历史胜率，也不影响正式闭环。"},
    };
  },[activeQuote?.previousClose,activeQuote?.open,activeQuote?.high,activeQuote?.low,chartModel?.lastVwap,currentContext?.items,currentEvents,currentMarket?.bars,isZijinStock,l2CalculationCoverage,liveL2PriceUsable,liveL2Status,marketSession.live,minutePoints,zijinFundResponse,zijinMainForceIntent]);
  const zijinMainForceCumulative=useMemo(()=>{
    const bars=zijinMainForceTrack.bars;
    if(!bars.length)return null;
    const values=[0,...bars.map(bar=>bar.cumulativeNetNotional)];
    const rawMin=Math.min(...values);
    const rawMax=Math.max(...values);
    const rawRange=Math.max(1,rawMax-rawMin);
    const min=rawMin-rawRange*.1;
    const max=rawMax+rawRange*.1;
    const top=7;
    const bottom=65;
    const yFor=(value:number)=>top+(max-value)/(max-min)*(bottom-top);
    const points=bars.map(bar=>({
        x:liveChartX(bar.time),
      y:yFor(bar.cumulativeNetNotional),
      value:bar.cumulativeNetNotional,
    }));
    const ticks=[max,(max+min)/2,min].map(value=>({value,y:yFor(value)}));
    return {
      path:`M${points.map(point=>`${point.x},${point.y}`).join(" L")}`,
      last:points.at(-1)??null,
      ticks,
    };
  },[zijinMainForceTrack.bars]);
  useEffect(()=>{
    const timer=window.setTimeout(()=>setIntradayCursorTime(null),0);
    return()=>window.clearTimeout(timer);
  },[stock?.code]);
  const intradayCursor=useMemo(()=>{
    if(!intradayCursorTime||!chartModel)return null;
    const point=chartModel.points.find(item=>item.time===intradayCursorTime);
    if(!point)return null;
    const previousClose=Number(activeQuote?.previousClose);
    const changePercent=Number.isFinite(previousClose)&&previousClose>0
      ? (point.price-previousClose)/previousClose*100
      : null;
    const mainForce=isZijinStock
      ? zijinMainForceTrack.bars.find(bar=>bar.time===point.time)??null
      : null;
    return {...point,changePercent,mainForce};
  },[intradayCursorTime,chartModel,activeQuote?.previousClose,isZijinStock,zijinMainForceTrack.bars]);
  const mainForceCursorX=intradayCursor?.x??null;
  const updateIntradayCursor=(clientX:number,clientY:number)=>{
    const svg=intradayChartRef.current;
    if(!svg||!chartModel?.points.length)return;
    const matrix=svg.getScreenCTM();
    if(!matrix)return;
    const pointer=svg.createSVGPoint();
    pointer.x=clientX;
    pointer.y=clientY;
    const local=pointer.matrixTransform(matrix.inverse());
    const targetX=Math.max(LIVE_CHART.plotLeft,Math.min(LIVE_CHART.plotRight,local.x));
    let nearest=chartModel.points[0];
    let distance=Math.abs(nearest.x-targetX);
    for(const point of chartModel.points.slice(1)){
      const nextDistance=Math.abs(point.x-targetX);
      if(nextDistance<distance){
        nearest=point;
        distance=nextDistance;
      }
    }
    setIntradayCursorTime(current=>current===nearest.time?current:nearest.time);
  };
  const handleIntradayPointer=(event:ReactPointerEvent<SVGSVGElement>)=>{
    updateIntradayCursor(event.clientX,event.clientY);
  };
  const handleIntradayPointerDown=(event:ReactPointerEvent<SVGSVGElement>)=>{
    updateIntradayCursor(event.clientX,event.clientY);
    if(event.pointerType!=="mouse")event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handleIntradayKeyDown=(event:ReactKeyboardEvent<SVGSVGElement>)=>{
    if(!chartModel?.points.length)return;
    if(event.key==="Escape"){
      setIntradayCursorTime(null);
      return;
    }
    if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;
    event.preventDefault();
    const currentIndex=Math.max(0,chartModel.points.findIndex(point=>point.time===intradayCursorTime));
    const nextIndex=Math.max(0,Math.min(chartModel.points.length-1,currentIndex+(event.key==="ArrowRight"?1:-1)));
    setIntradayCursorTime(chartModel.points[nextIndex].time);
  };
  const zijinPricePlan=useMemo(()=>isZijinStock?buildZijinPricePlan({
    minutes:minutePoints,
    previousClose:activeQuote?.previousClose??null,
    open:activeQuote?.open??null,
    vwap:chartModel?.lastVwap??null,
    l2Coverage:l2CalculationCoverage,
    atrPct:liveL2Status?.volatility?.atrPct14??null,
  }):null,[isZijinStock,minutePoints,activeQuote?.previousClose,activeQuote?.open,chartModel?.lastVwap,l2CalculationCoverage,liveL2Status?.volatility?.atrPct14]);
  const isPreopenPlanPhase=["preauction","auction","auction-result"].includes(marketSession.phase);
  const l2ExchangeMinute=liveL2Status?.lastExchangeTime?.match(/^\d{8}-(\d{4})/)?.[1]??null;
  const preopenIndicativePrice=useMemo(()=>[
    liveL2Status?.session?.open,
    liveL2Status?.book?.lastPrice,
    activeQuote?.open,
    activeQuote?.price,
  ].map(Number).find(value=>Number.isFinite(value)&&value>0)??null,[liveL2Status?.session?.open,liveL2Status?.book?.lastPrice,activeQuote?.open,activeQuote?.price]);
  const zijinPreopenPricePlan=useMemo(()=>isZijinStock&&isPreopenPlanPhase?buildZijinPreopenPricePlan({
    phase:marketSession.phase,
    asOfTime:l2ExchangeMinute,
    previousClose:liveL2Status?.session?.previousClose??activeQuote?.previousClose??null,
    indicativePrice:preopenIndicativePrice,
    bookImbalance:liveL2Status?.book?.nearTouchImbalance??null,
    activeBuyRatio:liveL2Status?.flow?.activeBuyRatio60s??null,
    atrPct:liveL2Status?.volatility?.atrPct14??null,
    spreadBps:liveL2Status?.book?.spreadBps??null,
    l2Connected:liveL2Status?.status?.connected===true,
    l2Stale:liveL2Status?.status?.stale!==false,
  }):null,[isZijinStock,isPreopenPlanPhase,marketSession.phase,l2ExchangeMinute,liveL2Status?.session?.previousClose,activeQuote?.previousClose,preopenIndicativePrice,liveL2Status?.book?.nearTouchImbalance,liveL2Status?.flow?.activeBuyRatio60s,liveL2Status?.volatility?.atrPct14,liveL2Status?.book?.spreadBps,liveL2Status?.status?.connected,liveL2Status?.status?.stale]);
  const preopenPlanDate=clockNow?.toLocaleDateString("sv-SE",{timeZone:"Asia/Shanghai"})??"";
  const preopenPlanStorageKey=`rabbit-zijin-preopen-plan:${preopenPlanDate}`;
  useEffect(()=>{
    if(!isZijinStock){setFrozenZijinPreopenPlan(null);return;}
    if(frozenZijinPreopenPlan?.date&&frozenZijinPreopenPlan.date!==preopenPlanDate){setFrozenZijinPreopenPlan(null);return;}
    if(!frozenZijinPreopenPlan&&preopenPlanDate){
      try{
        const saved=JSON.parse(localStorage.getItem(preopenPlanStorageKey)??"null");
        if(saved?.ready){setFrozenZijinPreopenPlan({date:preopenPlanDate,plan:saved as ReturnType<typeof buildZijinPreopenPricePlan>});return;}
      }catch{}
    }
    if(marketSession.phase==="auction-result"&&zijinPreopenPricePlan?.ready){
      setFrozenZijinPreopenPlan(current=>current?.date===preopenPlanDate&&current.plan.asOfTime===zijinPreopenPricePlan.asOfTime
        ?current
        :{date:preopenPlanDate,plan:zijinPreopenPricePlan});
      try{localStorage.setItem(preopenPlanStorageKey,JSON.stringify(zijinPreopenPricePlan));}catch{}
    }
  },[frozenZijinPreopenPlan?.date,isZijinStock,marketSession.phase,preopenPlanDate,preopenPlanStorageKey,zijinPreopenPricePlan]);
  const zijinPreopenGate=useMemo(()=>evaluateZijinPreopenGate({
    plan:frozenZijinPreopenPlan?.date===preopenPlanDate?frozenZijinPreopenPlan.plan:null,
    minutes:minutePoints,
  }),[frozenZijinPreopenPlan,minutePoints,preopenPlanDate]);
  const displayedZijinPricePlan=isPreopenPlanPhase?zijinPreopenPricePlan:zijinPricePlan;
  const zijinChartPriceOverlay=useMemo(()=>{
    if(!premiumEnabled||!isZijinStock||isPreopenPlanPhase||!chartModel||!displayedZijinPricePlan?.ready||!("riskPlan" in displayedZijinPricePlan))return null;
    const visibleBand=(range:[number,number],kind:"buy"|"sell")=>{
      const low=Math.max(chartModel.min,Math.min(...range));
      const high=Math.min(chartModel.max,Math.max(...range));
      if(low>high)return null;
      const top=liveChartPriceY(high,chartModel.min,chartModel.max);
      const bottom=liveChartPriceY(low,chartModel.min,chartModel.max);
      return {kind,top,bottom,height:Math.max(2,bottom-top),label:kind==="buy"?"正T区":"反T区"};
    };
    const allLines=[
      {kind:"buy-stop",label:"正T止损",price:displayedZijinPricePlan.riskPlan.positiveT.hardStop},
      {kind:"buy-profit",label:"正T止盈1",price:displayedZijinPricePlan.riskPlan.positiveT.takeProfit1},
      {kind:"buy-profit",label:"正T止盈2",price:displayedZijinPricePlan.riskPlan.positiveT.takeProfit2},
      {kind:"sell-stop",label:"反T止损",price:displayedZijinPricePlan.riskPlan.reverseT.hardStop},
      {kind:"sell-profit",label:"反T买回1",price:displayedZijinPricePlan.riskPlan.reverseT.takeProfit1},
      {kind:"sell-profit",label:"反T买回2",price:displayedZijinPricePlan.riskPlan.reverseT.takeProfit2},
    ].filter(line=>line.price>=chartModel.min&&line.price<=chartModel.max)
      .map(line=>({...line,y:liveChartPriceY(line.price,chartModel.min,chartModel.max)}));
    const currentPrice=Number(activeQuote?.price??chartModel.last.price);
    const lines=showAllPriceLevels
      ? allLines
      : [...allLines].sort((left,right)=>Math.abs(left.price-currentPrice)-Math.abs(right.price-currentPrice)).slice(0,2);
    return {
      bands:[
        visibleBand(displayedZijinPricePlan.buyRange,"buy"),
        visibleBand(displayedZijinPricePlan.sellRange,"sell"),
      ].filter((band):band is NonNullable<typeof band>=>Boolean(band)),
      lines,
      hiddenCount:Math.max(0,allLines.length-lines.length),
    };
  },[premiumEnabled,isZijinStock,isPreopenPlanPhase,chartModel,displayedZijinPricePlan,activeQuote?.price,showAllPriceLevels]);
  // The member-facing desk and replay share the audited closure-first path.
  // 紫金研究层 remains explanatory only and cannot create an extra trade point.
  const stockAgent=STOCK_AGENTS.smartT;
  const stockAgentEvaluation=useMemo(()=>evaluateStockAgent({
    code:stock?.code,
    minutes:minutePoints,
    previousClose:activeQuote?.previousClose??null,
    historicalBars:currentMarket?.bars??[],
    preopenGate:zijinPreopenGate,
  }),[stock?.code,minutePoints,activeQuote?.previousClose,currentMarket?.bars,zijinPreopenGate]);
  const zijinRepair=stockAgentEvaluation?.metrics?.repair??null;
  // An unconfirmed repair is a moving state, not a historical event. Keep it
  // in the side status panel only. The chart receives a fixed marker solely
  // from buildZijinL2CausalReplayObservations at the causal confirmation minute.
  const zijinStructure=stockAgentEvaluation?.metrics?.structure??null;
  const visibleStockAgentEvaluation=zijinResearchEnabled&&isZijinStock?stockAgentEvaluation:null;
  const similarityArchive=useMemo(
    ()=>buildHistoricalSimilarityArchive(currentMarket?.intradaySessions ?? [],{asOfDate:currentMarket?.sampleDate ?? null}),
    [currentMarket?.intradaySessions,currentMarket?.sampleDate],
  );
  const liveStrategyExperiment=resolveBacktestStrategyExperiment(stock?.code,"closure-first");
  const liveEngine = useMemo(() => {
    const profitOptions=smartTProfitModeOptions(stock?.code,preferences.profitMode) as ReplayProfitOptions;
    return runSmartTReplay(minutePoints, {
      capital:200_000,
      baseShares:Math.max(0,effectiveLivePosition.openingShares),
      sellable:effectiveLivePosition.sellable,
      feeRate:.025,
      slippage:.02,
      minCommission:true,
      slippageMode:"percent",
      forceCloseTime:"1450",
      profile:liveStrategyExperiment.profile ?? profile,
      volatilityMode:liveStrategyExperiment.volatilityMode,
      previousClose:activeQuote?.previousClose ?? null,
      similarityArchive,
      randomValue:0,
      ...profitOptions,
      profileOverrides:{...(profitOptions.profileOverrides??{}),...liveStrategyExperiment.profileOverrides},
      positionSizeMode:liveStrategyExperiment.positionSizeMode,
      strategyVersion:"closure-first",
      directionPermission:isZijinStock?{
        enabled:true,
        mode:"shadow-only",
        status:zijinPreopenGate.status,
        allowedDirections:zijinPreopenGate.allowedDirections,
        expiresAt:zijinPreopenGate.expiresAt,
        reason:zijinPreopenGate.reason,
      }:undefined,
    });
  },[minutePoints,effectiveLivePosition.openingShares,effectiveLivePosition.sellable,profile,activeQuote?.previousClose,stock?.code,preferences.profitMode,similarityArchive,liveStrategyExperiment,isZijinStock,zijinPreopenGate]);
  const zijinRepairHistory=useMemo(
    ()=>(isZijinStock?buildZijinL2CausalReplayObservations(minutePoints):[]) as ReplayObservation[],
    [isZijinStock,minutePoints],
  );
  const currentObservations=useMemo(
    ()=>buildReplayChartObservations(stock?.code,minutePoints,(liveEngine.observations ?? []) as ReplayObservation[],zijinRepairHistory),
    [stock?.code,minutePoints,liveEngine.observations,zijinRepairHistory],
  );
  const latestReverseTObservation=useMemo(
    ()=>[...currentObservations].reverse().find(observation=>observation.direction==="反T")??null,
    [currentObservations],
  );
  const freshReverseTObservation=useMemo(()=>{
    const latestTime=minutePoints.at(-1)?.time;
    return latestTime&&latestReverseTObservation&&isRecentCausalEvent(latestTime,latestReverseTObservation.time,3)
      ? latestReverseTObservation
      : null;
  },[latestReverseTObservation,minutePoints]);
  const reverseTDisplayObservation=freshReverseTObservation??latestReverseTObservation;
  // Keep the live card in sync with the replay action vocabulary. Previously a
  // reverse-T observation was rendered as the generic "最近观察", so a formal
  // reverse-T action visible in backtest had no matching label on the desk.
  const latestReverseTAction=useMemo(
    ()=>[...liveEngine.actions].reverse().find(action=>action.direction==="反T")??null,
    [liveEngine.actions],
  );
  const freshReverseTAction=useMemo(()=>{
    const latestTime=minutePoints.at(-1)?.time;
    return latestTime&&latestReverseTAction&&isRecentCausalEvent(latestTime,latestReverseTAction.time,3)
      ? latestReverseTAction
      : null;
  },[latestReverseTAction,minutePoints]);
  const reverseTSignalLabel=freshReverseTAction
    ? formalExecutionLabel("反T",formalActionSide(freshReverseTAction.side))
    : reverseTDisplayObservation
      ? observationConfirmationLabel(reverseTDisplayObservation)
      : "暂无候补";
  const reverseTSignalDetail=freshReverseTAction
    ? `${formatTime(freshReverseTAction.time)} · ¥${freshReverseTAction.price.toFixed(2)} · 正式信号`
    : reverseTDisplayObservation
      ? `${formatTime(reverseTDisplayObservation.time)} · ¥${reverseTDisplayObservation.price?.toFixed(2)??"--"}${freshReverseTObservation?" · 候补确认":" · 最近观察"}`
      : "等待均价上方观察与回落确认";
  // Observations are causal confirmation events. The live chart keeps every
  // event at observation.time; historical pivotTime is audit-only metadata.
  const visibleChartObservations=useMemo(
    ()=>{
      const eligible=positiveTBlockedByFlow
        ? currentObservations.filter(observation=>observation.direction!=="正T")
        : currentObservations;
      return compactChartObservations(eligible,isZijinStock?45:30,{mergeRepairPhases:isZijinStock}) as ReplayObservation[];
    },
    [currentObservations,isZijinStock,minutePoints,positiveTBlockedByFlow],
  );
  const activeChartDate=currentTrial?.sampleDate??currentMarket?.sampleDate??clockNow?.toLocaleDateString("sv-SE")??null;
  const rabbitTrackerSignal=useMemo(()=>{
    const latestTime=minutePoints.at(-1)?.time;
    if(!latestTime)return null;
    const recentAction=[...(liveEngine.actions??[])].reverse().find(action=>isRecentCausalEvent(latestTime,action.time,2));
    if(recentAction&&!(positiveTBlockedByFlow&&recentAction.direction==="正T")){
      const sell=recentAction.side==="卖出";
      return {
        key:`action-${recentAction.time}-${recentAction.side}`,
        label:sell?"卖点提醒":"买点提醒",
        tone:sell?"sell":"buy",
        source:"action" as const,
        time:recentAction.time,
        price:recentAction.price,
      };
    }
    const displacement=isZijinStock?evaluateZijinDisplacementWatch(minutePoints):null;
    if(displacement?.stage==="displacement-candidate"&&!(positiveTBlockedByFlow&&displacement.direction==="正T")&&isRecentCausalEvent(latestTime,displacement.time,2)){
      return {
        key:`displacement-${displacement.id}`,
        label:compactIntradayPrompt(displacement.label),
        tone:displacement.direction==="反T"?"sell":"buy",
        source:"displacement" as const,
        time:displacement.time,
        price:displacement.price,
      };
    }
    const recentObservation=[...currentObservations].reverse().find(observation=>!(positiveTBlockedByFlow&&observation.direction==="正T")&&isRecentCausalEvent(latestTime,observation.time,2));
    if(!recentObservation)return null;
    const rawLabel=recentObservation.confirmationLabel
      ?? (recentObservation.direction==="反T"?"高位观察":"低位观察");
    return {
      key:`observation-${recentObservation.time}-${rawLabel}`,
      label:compactIntradayPrompt(rawLabel),
      tone:"watch",
      source:"observation" as const,
      time:recentObservation.time,
      price:recentObservation.price,
    };
  },[currentObservations,isZijinStock,liveEngine.actions,minutePoints,positiveTBlockedByFlow]);
  const intradayMarkerLayout=useMemo(()=>{
    if(!chartModel)return {observations:[],actions:[],rabbitCandidates:[]};
    type LabelBox={left:number;right:number;top:number;bottom:number};
    const occupied:LabelBox[]=[];
    const pointPosition=(time:string,price?:number,allowRecentFallback=false)=>{
      const exactPoint=minutePoints.find(point=>point.time===time);
      // Quote streams can briefly skip the confirmation minute while the
      // causal engine has already produced its action. Formal markers may use
      // only the immediately preceding real minute; observations remain exact.
      const point=exactPoint??(allowRecentFallback
        ?[...minutePoints].reverse().find(candidate=>isRecentCausalEvent(time,candidate.time,1))
        :undefined);
      if(!point)return null;
      return {x:liveChartX(point.time),y:liveChartPriceY(price??point.price,chartModel.min,chartModel.max)};
    };
    const reserveLabel=(pointX:number,preferredBaseline:number,width:number,height:number,direction:-1|1)=>{
      const clampLabelX=(value:number)=>Math.max(LIVE_CHART.plotLeft+width/2+4,Math.min(LIVE_CHART.plotRight-width/2-18,value));
      const verticalOffsets=[0,18,36,54,72,-18,-36,-54,-72];
      const horizontalOffsets=[0,-Math.max(24,width*.72),Math.max(24,width*.72),-Math.max(40,width*1.18),Math.max(40,width*1.18)];
      const candidates=verticalOffsets.flatMap(offset=>horizontalOffsets.map(horizontalOffset=>({
        labelX:clampLabelX(pointX+horizontalOffset),
        baseline:Math.max(13,Math.min(245,preferredBaseline+offset*direction)),
      })));
      for(const candidate of candidates){
        const box={left:candidate.labelX-width/2-4,right:candidate.labelX+width/2+4,top:candidate.baseline-height+1,bottom:candidate.baseline+6};
        const collision=occupied.some(other=>box.left<other.right+3&&box.right>other.left-3&&box.top<other.bottom+3&&box.bottom>other.top-3);
        if(!collision){occupied.push(box);return {labelX:candidate.labelX,labelY:candidate.baseline};}
      }
      const fallback=candidates.at(-1)??{labelX:clampLabelX(pointX),baseline:preferredBaseline};
      occupied.push({left:fallback.labelX-width/2-4,right:fallback.labelX+width/2+4,top:fallback.baseline-height+1,bottom:fallback.baseline+6});
      return {labelX:fallback.labelX,labelY:fallback.baseline};
    };
    // Formal orders get first choice of label space. Every other marker is
    // stamped at its real confirmation minute; no historical pivot is backfilled.
    const actions=liveEngine.actions.flatMap((action,index)=>{
      // A live minute can be updated more than once by the public quote feed.
      // Anchor the marker to the price captured by the causal decision instead
      // of the first point sharing the same HHmm timestamp.
      const point=pointPosition(action.time,action.price,true);
      if(!point)return [];
      const isSell=action.side==="卖出";
      const label=formalExecutionLabel(action.direction,isSell?"sell":"buy");
      const labelWidth=label.length*9+16;
      const placed=reserveLabel(point.x,isSell?point.y-13:point.y+22,labelWidth,18,isSell?-1:1);
      return [{...point,...placed,index,isSell,label,labelWidth,action}];
    });
    // Keep the chart readable: each side gets one latest, highest-priority
    // candidate label. Earlier candidates remain as hoverable dots with their
    // full text in <title>; formal execution markers are handled separately.
    const observationLabelSlots=new Set<number>();
    (['buy','sell'] as const).forEach(side=>{
      let best:{index:number;priority:number;time:number}|null=null;
      visibleChartObservations.forEach((candidate,index)=>{
        const candidateSide=candidate.direction==="反T"?"sell":"buy";
        if(candidateSide!==side||candidate.stage==="watch")return;
        const priority=candidate.repairPhase==="repair-confirmed"
          ?4
          :candidate.pivotAssessment==="confirmed"
            ?3
            :candidate.pivotAssessment==="strong"
              ?2
              :candidate.stage==="candidate"?1:0;
        const time=Number(String(candidate.time??"").replace(/\D/g,"").slice(-4))||0;
        if(!best||priority>best.priority||(priority===best.priority&&time>=best.time))best={index,priority,time};
      });
      if(best)observationLabelSlots.add(best.index);
    });
    const observations=visibleChartObservations.flatMap((observation,index)=>{
      const markerPrice=observation.coverageOnly&&Number.isFinite(observation.pivotPrice) ? observation.pivotPrice : observation.price;
      const point=pointPosition(observation.time,markerPrice);
      if(!point)return [];
      const isSell=observation.direction==="反T";
      const qualified=observation.stage!=="watch";
      const assessment=observation.pivotAssessment??"unconfirmed";
      const sideClass=isSell?"sell":"buy";
      const rawLabel=observationConfirmationLabel(observation)??(assessment==="confirmed"?(isSell?"转弱确认":"转强确认"):assessment==="strong"?(isSell?"高位候选":"低位候选"):"观察");
      const currentLabel=rawLabel;
      const labelWidth=currentLabel.length*8+14;
      const labelVisible=true;
      const labelRendered=observationLabelSlots.has(index);
      const placed=labelRendered
        ? reserveLabel(point.x,isSell?point.y+22:point.y-15,labelWidth,16,isSell?1:-1)
        : {labelX:point.x,labelY:point.y};
      return [{...point,...placed,index,isSell,qualified,assessment,sideClass,currentLabel,labelWidth,labelVisible,labelRendered,observation}];
    });
    // Every delivered candidate reminder is evidence, not just the latest
    // rabbit state. Plot the recorded minute on its own chart so an alert such
    // as the 14:05 displacement confirmation remains reviewable after later
    // quotes replace the tracker bubble.
    const chartCandidateAlerts=alertHistory.filter(alert=>{
      if(alert.level!=="candidate"||alert.code!==stock.code)return false;
      const createdAt=alert.createdAt?new Date(alert.createdAt):null;
      const createdDate=createdAt&&!Number.isNaN(createdAt.getTime())
        ?createdAt.toLocaleDateString("sv-SE",{timeZone:"Asia/Shanghai"})
        :null;
      return Boolean(activeChartDate&&(alert.marketDate??createdDate)===activeChartDate);
    });
    const recordedCandidates=(isZijinStock
      ?compactCandidateAlertHistory(chartCandidateAlerts,{episodeMinutes:20,ignoreBefore:"0935"})
      :chartCandidateAlerts).flatMap((alert,index)=>{
      if(alert.level!=="candidate"||alert.code!==stock.code)return [];
      const createdAt=alert.createdAt?new Date(alert.createdAt):null;
      const createdDate=createdAt&&!Number.isNaN(createdAt.getTime())
        ?createdAt.toLocaleDateString("sv-SE",{timeZone:"Asia/Shanghai"})
        :null;
      if(!activeChartDate||(alert.marketDate??createdDate)!==activeChartDate)return [];
      const createdTime=createdAt&&!Number.isNaN(createdAt.getTime())
        ?createdAt.toLocaleTimeString("en-GB",{timeZone:"Asia/Shanghai",hour12:false}).replace(/:/g,"")
        :"";
      const time=String(alert.marketTime??createdTime).replace(/\D/g,"").slice(-4);
      if(!/^\d{4}$/.test(time))return [];
      const minute=minutePoints.find(point=>point.time===time);
      const markerPrice=Number.isFinite(alert.price)?Number(alert.price):minute?.price;
      const point=pointPosition(time,markerPrice);
      if(!point)return [];
      const label=compactIntradayPrompt(alert.title.replace(`${stock.name} · `,"").replace(`${stock.name} `,"").trim(),"候选提醒");
      const isSell=alert.rabbit==="sell";
      const labelWidth=label.length*8+16;
      const placed=reserveLabel(point.x,isSell?point.y+22:point.y-15,labelWidth,16,isSell?1:-1);
      return [{...point,...placed,isSell,label,labelWidth,time,price:markerPrice,key:`recorded-${alert.eventKey??alert.id??index}`}];
    });
    // The rabbit can surface the faster displacement candidate before the
    // minute engine promotes it into replay.observations. Keep that causal
    // point on the chart at the exact signal minute/price after the rabbit
    // moves on, instead of leaving the only evidence in a transient bubble.
    const rabbitCandidates=rabbitTrackerSignal?.source==="displacement"
      ?(()=>{
          const point=pointPosition(rabbitTrackerSignal.time,rabbitTrackerSignal.price);
          if(!point)return [];
          const duplicate=observations.some(marker=>marker.observation.time===rabbitTrackerSignal.time&&marker.currentLabel===rabbitTrackerSignal.label)
            ||recordedCandidates.some(marker=>marker.key===`recorded-${rabbitTrackerSignal.key}`||marker.label===rabbitTrackerSignal.label&&marker.x===point.x);
          if(duplicate)return [];
          const isSell=rabbitTrackerSignal.tone==="sell";
          const label=compactIntradayPrompt(rabbitTrackerSignal.label);
          const labelWidth=label.length*8+16;
          const placed=reserveLabel(point.x,isSell?point.y+22:point.y-15,labelWidth,16,isSell?1:-1);
          return [{...point,...placed,isSell,label,labelWidth,time:rabbitTrackerSignal.time,price:rabbitTrackerSignal.price,key:rabbitTrackerSignal.key}];
        })()
      :[];
    return {observations,actions,rabbitCandidates:[...recordedCandidates,...rabbitCandidates]};
  },[activeChartDate,alertHistory,chartModel,isZijinStock,minutePoints,stock.code,stock.name,uiTheme,visibleChartObservations,liveEngine.actions,rabbitTrackerSignal]);
  const intradayCursorSignal=useMemo(()=>{
    if(!intradayCursor)return "无提醒";
    const action=intradayMarkerLayout.actions.find(marker=>marker.action.time===intradayCursor.time);
    if(action)return action.label;
    const observation=intradayMarkerLayout.observations.find(marker=>marker.observation.time===intradayCursor.time);
    return observation?.currentLabel??"暂无提醒";
  },[intradayCursor,intradayMarkerLayout]);
  const signalFunnel = (() => {
    const rows=stockList.flatMap(item=>{
      const snapshot=item.code===stock?.code ? (currentTrial ?? currentMarket ?? marketSnapshots[item.code]) : marketSnapshots[item.code];
      if(!snapshot?.minutes?.length)return [];
      const itemPosition=resolveStockPosition(stockPositions,preferences,item.code);
      const itemExperiment=resolveBacktestStrategyExperiment(item.code,"closure-first");
      const itemProfitOptions=smartTProfitModeOptions(item.code,preferences.profitMode) as ReplayProfitOptions;
      const replay=item.code===stock?.code ? liveEngine : runSmartTReplay(snapshot.minutes,{
        capital:200_000,baseShares:itemPosition.plannedBase,sellable:itemPosition.sellable,feeRate:.025,slippage:.02,minCommission:true,slippageMode:"percent",forceCloseTime:"1450",profile:itemExperiment.profile??profile,previousClose:snapshot.quote.previousClose??null,randomValue:0,
        ...itemProfitOptions,
        profileOverrides:{...(itemProfitOptions.profileOverrides??{}),...itemExperiment.profileOverrides},
        positionSizeMode:itemExperiment.positionSizeMode,
        volatilityMode:itemExperiment.volatilityMode,
        strategyVersion:itemExperiment.label,
      });
      const observations=item.code===stock?.code
        ? currentObservations
        : (replay.observations??[]) as ReplayObservation[];
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
    const experiment=resolveBacktestStrategyExperiment(stock?.code,"closure-first");
    const profitOptions=smartTProfitModeOptions(stock?.code,preferences.profitMode) as ReplayProfitOptions;
    const results=sessions.map(session=>runSmartTReplay(session.minutes,{
      capital:200_000,
      baseShares:activePosition.plannedBase,
      sellable:activePosition.sellable,
      feeRate:.025,
      slippage:.02,
      minCommission:true,
      slippageMode:"percent",
      forceCloseTime:"1450",
      profile:experiment.profile??profile,
      previousClose:session.previousClose,
      randomValue:0,
      ...profitOptions,
      profileOverrides:{...(profitOptions.profileOverrides??{}),...experiment.profileOverrides},
      positionSizeMode:experiment.positionSizeMode,
      volatilityMode:experiment.volatilityMode,
      strategyVersion:experiment.label,
    }));
    const cycles=results.reduce((sum,item)=>sum+item.trades,0);
    const wins=results.reduce((sum,item)=>sum+item.wins,0);
    const net=results.reduce((sum,item)=>sum+item.net,0);
    const maxDrawdown=results.length?Math.max(...results.map(item=>item.maxDrawdown)):0;
    const confidence=cycles>=20?"高":cycles>=8?"中":"样本不足";
    return {sessions:sessions.length,cycles,wins,net,maxDrawdown,confidence,winRate:cycles?wins/cycles:null};
  },[currentMarket?.intradaySessions,activePosition.plannedBase,activePosition.sellable,profile,stock?.code,preferences.profitMode]);
  const liveAgents=useMemo(()=>agents.map((agent)=>({
    ...agent,
    state:agent.id==="training"?`${personalStrategyStats.sessions}日已读取`:agent.id==="challenger"?`${personalStrategyStats.cycles}闭环已核对`:agent.id==="risk"?(personalStrategyStats.maxDrawdown<.03?"风控绿灯":"需要关注"):"正式版锁定",
    value:agent.id==="training"?`${personalStrategyStats.sessions}/20`:agent.id==="challenger"?`${personalStrategyStats.cycles}/20`:agent.id==="risk"?`${(personalStrategyStats.maxDrawdown*100).toFixed(2)}%`:"V4",
  })),[personalStrategyStats]);
  const localEvidenceCoverage=Math.min(100,Math.min(personalStrategyStats.sessions/20*100,personalStrategyStats.cycles/20*100));
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
  },[activeQuote?.price,activeQuote?.open,chartModel?.lastVwap,minutePoints,openingAssessment.session,openingAssessment.gapText,stockState,currentEvents,currentContext,liveEngine,marketSession]);
  const decisionModel=useMemo(()=>{
    if(stockAgent.canExecute)return autoDecision;
    if(autoDecision.status==="locked")return {
      ...autoDecision,
      mode:null,
      reason:`${stockAgent.name}处于研究观察版；${autoDecision.reason}`,
    };
    const evaluation=visibleStockAgentEvaluation;
    const score=evaluation?.score??0;
    return {
      status:"waiting" as const,
      mode:evaluation?.direction??null,
      confirmed:Math.min(3,Math.max(0,Math.floor(score/25))),
      reason:evaluation
        ? `${evaluation.title}：${evaluation.reasons[0]}（紫金研究模型尚未毕业，不开放正式执行）`
        : `${stockAgent.name}正在等待真实分钟数据。`,
      lastTime:evaluation?.asOfTime??"",
      inDecisionWindow:Boolean(evaluation?.asOfTime),
      referenceConfirmed:Boolean(evaluation&&Math.abs(evaluation.metrics.vwapBiasPct)>=.2),
      trendConfirmed:evaluation?.status==="candidate",
    };
  },[stockAgent,visibleStockAgentEvaluation,autoDecision]);
  const signalMode:"正T"|"反T"=positiveTBlockedByFlow
    ?"反T"
    :decisionModel.mode ?? (openingAssessment.session==="高开"?"反T":"正T");
  const latestFormalAction=useMemo(()=>{
    const latest=liveEngine.actions.at(-1)??null;
    return latest&&isRecentCausalEvent(decisionModel.lastTime,latest.time,3)?latest:null;
  },[decisionModel.lastTime,liveEngine.actions]);
  const latestFormalActionMarked=useMemo(
    ()=>Boolean(latestFormalAction&&intradayMarkerLayout.actions.some(marker=>marker.action===latestFormalAction)),
    [intradayMarkerLayout.actions,latestFormalAction],
  );
  const formalActionMarkerPending=Boolean(
    decisionModel.status==="ready"&&latestFormalAction&&!latestFormalActionMarked&&!(positiveTBlockedByFlow&&latestFormalAction.direction==="正T"),
  );
  const decisionActionSide:"buy"|"sell"|null=
    decisionModel.status==="ready"&&latestFormalAction&&latestFormalActionMarked&&!(positiveTBlockedByFlow&&latestFormalAction.direction==="正T")
      ?formalActionSide(latestFormalAction.side)
      :null;
  const decisionActionDirection:"正T"|"反T"=
    (latestFormalAction?.direction??signalMode) as "正T"|"反T";
  const decisionExecutionLabel=decisionActionSide
    ? formalExecutionLabel(decisionActionDirection,decisionActionSide)
    : `${signalMode}信号`;
  const expectedClosingSide=openedCycleSide==="buy"?"sell":openedCycleSide==="sell"?"buy":null;
  const decisionMatchesCycle=cycleStage!=="opened"||Boolean(decisionActionSide&&expectedClosingSide===decisionActionSide);
  const secondLevelSignal=isZijinStock?liveL2Status?.secondState:null;
  const web4Microstructure=useMemo(()=>evaluateWeb4Microstructure({
    points:isZijinStock?minutePoints:[],
    historicalSessions:isZijinStock?(currentMarket?.intradaySessions??[]):[],
    liveL2:isZijinStock?liveL2Status:null,
    asOfDate:currentTrial?.sampleDate??currentMarket?.sampleDate??null,
    stale:!isZijinStock||liveL2Stale||!liveL2HasTicks,
  }),[isZijinStock,minutePoints,currentMarket?.intradaySessions,currentMarket?.sampleDate,currentTrial?.sampleDate,liveL2Status,liveL2Stale,liveL2HasTicks]);
  const web4L2Evidence=useMemo(()=>{
    if(secondLevelSignal&&secondLevelSignal.state!=="normal"){
      const direction=secondLevelSignal.direction;
      const state=secondLevelSignal.state==="trigger"
        ? direction==="buy"?"confirmed_buy":"confirmed_sell"
        :secondLevelSignal.state==="ready"
          ?direction==="buy"?"absorption_buy":"absorption_sell"
          :secondLevelSignal.state==="watch"
            ?"repair"
            :"waiting";
      return {state,score:secondLevelSignal.score,label:secondLevelSignal.label};
    }
    if(zijinRepair?.status==="candidate")return {
      state:"repair",
      score:Math.max(72,web4Microstructure.score),
      label:web4Microstructure.absorption.side==="buy"?"卖压被承接 · 修复候选":"资金承接修复",
    };
    if(web4Microstructure.state!=="waiting")return {
      state:web4Microstructure.state,
      score:web4Microstructure.score,
      label:web4Microstructure.label,
    };
    return {
      state:zijinFundResponse.state,
      score:Math.max(zijinFundResponse.score,web4Microstructure.score),
      label:web4Microstructure.available?`${zijinFundResponse.label} · 微观待持续`:zijinFundResponse.label,
    };
  },[secondLevelSignal,zijinRepair?.status,web4Microstructure.score,web4Microstructure.state,web4Microstructure.label,web4Microstructure.available,web4Microstructure.absorption.side,zijinFundResponse.state,zijinFundResponse.score,zijinFundResponse.label]);
  const zijinV29OpeningShadow=useMemo(()=>{
    const l2State=secondLevelSignal?.state;
    const l2Direction=secondLevelSignal?.direction;
    const l2Usable=Boolean(
      isZijinStock&&liveL2HasTicks&&!liveL2Stale&&
      l2Direction&&l2Direction!=="none"&&
      l2State&&!['normal','invalid','expired'].includes(l2State),
    );
    const formalAligned=Boolean(
      decisionActionSide&&l2Usable&&decisionActionSide===l2Direction,
    );
    const candidateDirection=decisionActionDirection??(
      signalMode==="正T"||signalMode==="反T"
        ?signalMode
        :l2Direction==="buy"
          ?"正T"
          :l2Direction==="sell"
            ?"反T"
            :null
    );
    const preopenGateActive=Boolean(
      zijinPreopenGate.asOfTime&&
      zijinPreopenGate.asOfTime>="0935"&&
      zijinPreopenGate.asOfTime<(zijinPreopenGate.expiresAt??"1501")&&
      ["confirmed","reversed"].includes(zijinPreopenGate.status),
    );
    const preopenDirectionVeto=Boolean(
      preopenGateActive&&candidateDirection&&
      !zijinPreopenGate.allowedDirections.includes(candidateDirection),
    );

    if(preopenDirectionVeto)return {
      tone:"warning",
      label:["confirmed","reversed"].includes(zijinPreopenGate.status)?"全天方向否决":"开盘未确认",
      advice:["confirmed","reversed"].includes(zijinPreopenGate.status)?`暂缓${candidateDirection}`:"降级观察",
      detail:["confirmed","reversed"].includes(zijinPreopenGate.status)
        ?`全天方向锚仅允许${zijinPreopenGate.allowedDirections.join("/")||"无方向"}，已阻止${candidateDirection}影子候选`
        :"开盘预判未获真实走势确认，不升级方向信号",
    };

    if(preopenGateActive&&!candidateDirection&&["confirmed","reversed"].includes(zijinPreopenGate.status))return {
      tone:"confirmed",
      label:zijinPreopenGate.status==="reversed"?"严格反转":"全天锚定",
      advice:`${zijinPreopenGate.allowedDirections.join("/")||"中性"}优先`,
      detail:zijinPreopenGate.reason,
    };

    if(decisionModel.status==="ready"&&formalAligned)return {
      tone:"confirmed",
      label:"影子确认",
      advice:"跟随正式",
      detail:`正式${decisionActionDirection}与秒级盘口方向一致`,
    };

    const buyContext=signalMode==="正T"||decisionActionDirection==="正T";
    if(positiveTBlockedByFlow||(buyContext&&l2Usable&&l2Direction==="sell"))return {
      tone:"warning",
      label:"影子警告",
      advice:"暂缓买入",
      detail:positiveTBlockedByFlow?"主动卖压尚未解除":"秒级盘口与正T方向相反",
    };

    const hasCandidate=Boolean(
      decisionModel.mode||
      decisionModel.confirmed>0||
      signalFunnel.currentObservations>0||
      secondLevelSignal&&secondLevelSignal.state!=="normal",
    );
    return {
      tone:"candidate",
      label:"影子候选",
      advice:"继续观察",
      detail:hasCandidate
        ?l2Usable
          ?"秒级证据正在形成，尚未通过正式门槛"
          :"已有分钟候选，等待连续秒级证据"
        :"等待开盘结构与连续秒级证据",
    };
  },[decisionActionDirection,decisionActionSide,decisionModel.confirmed,decisionModel.mode,decisionModel.status,isZijinStock,liveL2HasTicks,liveL2Stale,positiveTBlockedByFlow,secondLevelSignal,signalFunnel.currentObservations,signalMode,zijinPreopenGate]);
  const zijinRealtimeFactors=useMemo(()=>{
    const contextItems=currentContext?.items??[];
    const findContextItem=(labels:string[])=>labels
      .map(label=>contextItems.find(item=>item.label===label))
      .find(Boolean)??null;
    const contextValue=(item:(typeof contextItems)[number]|null)=>{
      const change=item?.changePercent;
      if(change==null||!Number.isFinite(change))return {value:"待数据",detail:item?.label??"数据源待接入",tone:"waiting"};
      return {
        value:`${change>0?"+":""}${change.toFixed(2)}%`,
        detail:item.label,
        tone:change>.1?"positive":change<-.1?"negative":"neutral",
      };
    };
    const latestMinute=minutePoints.at(-1)??null;
    const volumeBaseline=minutePoints.slice(-21,-1)
      .map(point=>Math.max(0,Number(point.volume)||0))
      .filter(volume=>volume>0);
    const averageVolume=volumeBaseline.length
      ?volumeBaseline.reduce((sum,volume)=>sum+volume,0)/volumeBaseline.length
      :0;
    const latestVolume=Math.max(0,Number(latestMinute?.volume)||0);
    const volumeRatio=averageVolume>0&&latestVolume>0?latestVolume/averageVolume:null;
    const price=Number(activeQuote?.price);
    const vwap=Number(chartModel?.lastVwap);
    const vwapBias=Number.isFinite(price)&&price>0&&Number.isFinite(vwap)&&vwap>0
      ?(price-vwap)/vwap*100
      :null;
    const gold=contextValue(findContextItem(["黄金ETF","沪金连续","纽约黄金"]));
    const copper=contextValue(findContextItem(["沪铜连续","伦铜"]));
    const hk=contextValue(findContextItem(["港股紫金矿业"]));
    const sector=contextValue(findContextItem(["有色金属ETF"]));
    const l2Ready=liveL2HasTicks&&!liveL2Stale;
    const flowReady=zijinMainForceIntent.available;
    const items=[
      {
        key:"vwap",label:"分时均价",ready:vwapBias!==null,
        value:vwapBias===null?"待数据":`${vwapBias>=0?"+":""}${vwapBias.toFixed(2)}%`,
        detail:vwapBias===null?"等待分时与 VWAP":`现价 ¥${price.toFixed(2)} · VWAP ¥${vwap.toFixed(2)}`,
        tone:vwapBias===null?"waiting":vwapBias>.2?"positive":vwapBias<-.2?"negative":"neutral",
      },
      {
        key:"volume",label:"成交量能",ready:volumeRatio!==null,
        value:volumeRatio===null?"待数据":`${volumeRatio.toFixed(2)}x`,
        detail:volumeRatio===null?"等待连续分钟量":"最新分钟 / 前20分钟均量",
        tone:volumeRatio===null?"waiting":volumeRatio>=1.5?"positive":volumeRatio<.65?"negative":"neutral",
      },
      {
        key:"l2",label:"盘口强度",ready:l2Ready,
        value:l2Ready?`${Math.round(web4L2Evidence.score)}/100`:"待数据",
        detail:l2Ready?web4L2Evidence.label:"L2 逐笔或盘口尚未就绪",
        tone:!l2Ready?"waiting":web4L2Evidence.score>=70?"positive":web4L2Evidence.score<45?"negative":"neutral",
      },
      {
        key:"flow",label:"主动资金",ready:flowReady,
        value:flowReady?formatMainForceAmount(zijinMainForceTrack.totals.netNotional):"待数据",
        detail:flowReady?zijinMainForceIntent.label:"等待有效大额主动成交",
        tone:!flowReady?"waiting":zijinMainForceTrack.totals.netNotional>0?"positive":zijinMainForceTrack.totals.netNotional<0?"negative":"neutral",
      },
      {key:"gold",label:"黄金联动",ready:gold.value!=="待数据",...gold},
      {key:"copper",label:"铜价联动",ready:copper.value!=="待数据",...copper},
      {
        key:"hk",label:"港股联动",ready:zijinAhLinkage.available||hk.value!=="待数据",
        value:hk.value,
        detail:zijinAhLinkage.available?zijinAhLinkage.label:hk.detail,
        tone:hk.tone,
      },
      {
        key:"market",label:"市场环境",ready:Boolean(currentContext),
        value:sector.value!=="待数据"?sector.value:(currentContext?.gate.label??"待数据"),
        detail:sector.value!=="待数据"?`${sector.detail} · ${currentContext?.gate.label??"环境加载中"}`:(currentContext?.gate.action??"大盘与板块数据待接入"),
        tone:currentContext?.gate.hardLock||currentContext?.gate.level==="restricted"?"negative":sector.tone,
      },
    ];
    return {items,readyCount:items.filter(item=>item.ready).length,total:items.length};
  },[activeQuote?.price,chartModel?.lastVwap,currentContext,liveL2HasTicks,liveL2Stale,minutePoints,web4L2Evidence.label,web4L2Evidence.score,zijinAhLinkage.available,zijinAhLinkage.label,zijinMainForceIntent.available,zijinMainForceIntent.label,zijinMainForceTrack.totals.netNotional]);
  const missingZijinFactors=zijinRealtimeFactors.items.filter(item=>!item.ready).map(item=>item.label);
  const zijinFactorSummary=missingZijinFactors.length
    ? `缺 ${missingZijinFactors.slice(0,2).join("、")}${missingZijinFactors.length>2?` +${missingZijinFactors.length-2}`:""}`
    : "全部确认";
  const zijinShadowV2Progress=useMemo(()=>{
    const shadow=liveL2Status?.forward?.multiFactorTShadow??liveL2Status?.forward?.reverseTShadow;
    const review=shadow?.manualReview;
    const gates=review?.gates;
    const gateValues=[
      gates?.tradingDays,
      gates?.resolvedCycles,
      gates?.candidatePromotionRate,
      gates?.afterCostWinRate,
      gates?.stress5BpsWinRate,
      gates?.profitFactor,
    ];
    const passed=gateValues.filter(Boolean).length;
    const ready=Boolean(review?.readyForManualReview&&passed===gateValues.length);
    const ratio=(value:number|null|undefined,target:number)=>Number.isFinite(value)&&Number(value)>=0?Math.min(1,Number(value)/target):0;
    const promotionRate=Number(review?.candidatePromotionRate);
    const promotionProgress=!Number.isFinite(promotionRate)||promotionRate<0
      ?0
      :promotionRate<=.4
        ?Math.min(1,promotionRate/.3)
        :Math.max(0,1-(promotionRate-.4)/.6);
    const tradingDays=Math.max(0,Number(review?.tradingDays)||0);
    const resolvedCycles=Math.max(0,Number(review?.resolvedCycles??shadow?.counts?.resolved)||0);
    const evidenceProgress=[
      ratio(tradingDays,60),
      ratio(resolvedCycles,100),
      promotionProgress,
      ratio(review?.afterCostWinRate,.55),
      ratio(review?.stress5BpsWinRate,.55),
      ratio(review?.profitFactor,1.2),
    ];
    const measured=Math.round(evidenceProgress.reduce((sum,value)=>sum+value,0)/evidenceProgress.length*100);
    return {
      available:Boolean(shadow),
      ready,
      passed,
      progress:ready?100:Math.min(99,measured),
      tradingDays,
      resolvedCycles,
    };
  },[liveL2Status?.forward?.multiFactorTShadow,liveL2Status?.forward?.reverseTShadow]);
  const web4Monitor=useMemo(()=>evaluateWeb4RealtimeMonitor({
    symbol:stock?.code,
    now:clockNow?.toISOString()??null,
    technical:{
      candidate:decisionModel.status==="ready"||Boolean(decisionModel.mode&&decisionModel.confirmed>=2),
      ready:decisionModel.status==="ready",
      direction:signalMode,
      confirmed:decisionModel.confirmed,
    },
    l2:{
      available:isZijinStock&&Boolean(liveL2Status),
      stale:!isZijinStock||liveL2Stale||!liveL2HasTicks,
      state:web4L2Evidence.state,
      score:web4L2Evidence.score,
      label:web4L2Evidence.label,
    },
    linkage:{
      available:isZijinStock&&zijinAhLinkage.available,
      bias:zijinAhLinkage.bias,
      weight:zijinAhLinkage.weight,
      label:isZijinStock?zijinAhLinkage.label:"关联品种待接入",
    },
    market:{
      level:currentContext?.gate.level??"degraded",
      hardLock:currentContext?.gate.hardLock??false,
      label:currentContext?.gate.label??"外部环境加载中",
    },
    events:{
      level:currentEvents?.gate.level??"normal",
      hardLock:currentEvents?.gate.hardLock??false,
      label:currentEvents?.gate.label??"事件正常",
    },
  }),[stock?.code,clockNow,decisionModel.status,decisionModel.mode,decisionModel.confirmed,signalMode,isZijinStock,liveL2Status,liveL2Stale,liveL2HasTicks,web4L2Evidence.state,web4L2Evidence.score,web4L2Evidence.label,zijinAhLinkage.available,zijinAhLinkage.bias,zijinAhLinkage.weight,zijinAhLinkage.label,currentContext?.gate.level,currentContext?.gate.hardLock,currentContext?.gate.label,currentEvents?.gate.level,currentEvents?.gate.hardLock,currentEvents?.gate.label]);
  const decisionConditions=useMemo(()=>{
    const reverse=signalMode==="反T";
    const l2Confirmed=decisionModel.status==="ready"
      || (reverse
        ? zijinFundResponse.score>=65
        : !positiveTBlockedByFlow&&Boolean(zijinRepair?.checks?.l2BuyRecovery));
    return [
      {label:"时段有效",met:decisionModel.inDecisionWindow},
      {label:reverse?"跌回均价":"站回均价",met:decisionModel.referenceConfirmed},
      {label:reverse?"动量转弱":"动量转强",met:decisionModel.trendConfirmed},
      {label:isZijinStock?(reverse?"L2卖压确认":positiveTBlockedByFlow?"主动净卖解除":"L2承接确认"):"量价确认",met:l2Confirmed},
    ];
  },[decisionModel.inDecisionWindow,decisionModel.referenceConfirmed,decisionModel.status,decisionModel.trendConfirmed,isZijinStock,positiveTBlockedByFlow,signalMode,zijinFundResponse.score,zijinRepair?.checks?.l2BuyRecovery]);
  const decisionConditionsConfirmed=decisionConditions.reduce((count,item)=>count+(item.met?1:0),0);
  const rabbitTrackerMode=rabbitTrackerSignal
    ?"signal"
    :marketSession.phase==="lunch"
      ?"rest"
      :["closing","afterhours","closed"].includes(marketSession.phase)
        ?"closed"
        :marketSession.live
          ?"tracking"
          :"waiting";
  const rabbitTrackerLabel=rabbitTrackerSignal?.label
    ??(rabbitTrackerMode==="rest"?"午间休市":rabbitTrackerMode==="closed"?"今日收盘":rabbitTrackerMode==="waiting"?"等待开盘":"");
  const chartHud=useMemo(()=>{
    const price=Number(activeQuote?.price);
    const plan=displayedZijinPricePlan;
    const focusRange=plan?.ready
      ? signalMode==="正T"
        ? plan.buyRange
        : plan.sellRange
      : null;
    const stop=plan?.ready&&"riskPlan" in plan
      ? signalMode==="正T"
        ? plan.riskPlan.positiveT.hardStop
        : plan.riskPlan.reverseT.hardStop
      : null;
    const distanceToRange=focusRange&&Number.isFinite(price)&&price>0
      ? price<focusRange[0]
        ? (focusRange[0]-price)/price*100
        : price>focusRange[1]
          ? (price-focusRange[1])/price*100
          : 0
      : null;
    const distanceToStop=stop&&Number.isFinite(price)&&price>0?Math.abs(price-stop)/price*100:null;
    const title=decisionModel.status==="locked"
      ? "风控锁定"
      : zijinRepair?.status==="candidate"
        ? "资金承接修复"
        : zijinRepair?.status==="watch"&&zijinRepair?.hardConditions?.deepVwapDiscount
          ? "磨底修复观察"
          : decisionModel.status==="ready"
            ? `${signalMode}已确认`
            : `等待${signalMode==="正T"?"承接":"衰竭"}确认`;
    return {
      title,
      tone:decisionModel.status==="locked"?"risk":zijinRepair?.status==="candidate"||decisionModel.status==="ready"?"ready":"watch",
      detail:distanceToRange===null
        ? `${decisionModel.confirmed}/4 条件确认`
        : distanceToRange===0
          ? `已进入${signalMode}关注区`
          : `距${signalMode}关注区 ${distanceToRange.toFixed(2)}%`,
      risk:distanceToStop===null
        ? `${signalMode}止损价待计算`
        : `${signalMode}止损 ¥${Number(stop).toFixed(2)}（${signalMode==="正T"?"下轨":"上轨"}） · 距 ${distanceToStop.toFixed(2)}%`,
    };
  },[activeQuote?.price,displayedZijinPricePlan,signalMode,decisionModel.status,decisionModel.confirmed,zijinRepair]);
  const completedCycleCount=Math.floor(tradeLedgerSummary.validCount/2);
  const maxDailyTrades=Math.max(1,Math.min(10,activePosition.maxDailyTrades??3));
  const cycleLimitReached=completedCycleCount>=maxDailyTrades;
  const configuredCycleQuantity=activePosition.tradeShares??Math.floor(Math.min(Math.max(0,effectiveLivePosition.openingShares),effectiveLivePosition.sellable)/3/100)*100;
  const cycleQuantity=cycleLimitReached?0:Math.floor(Math.min(configuredCycleQuantity,Math.max(0,effectiveLivePosition.openingShares),effectiveLivePosition.sellable)/100)*100;
  const displayedShares=cycleStage==='opened'
    ? effectiveLivePosition.openingShares+(openedCycleSide==="buy"?cycleQuantity:openedCycleSide==="sell"?-cycleQuantity:0)
    : effectiveLivePosition.openingShares;
  const tCalculator=useMemo(()=>{
    const entry=Number(tEntryPrice);
    const exit=Number(tExitPrice);
    const quantity=Math.max(0,Math.floor(Number(tQuantity)/100)*100);
    if(!Number.isFinite(entry)||!Number.isFinite(exit)||entry<=0||exit<=0||quantity<=0)return null;
    const gross=(exit-entry)*quantity;
    const entryTurnover=entry*quantity;
    const exitTurnover=exit*quantity;
    const turnover=entryTurnover+exitTurnover;
    const commission=Math.max(5,entryTurnover*.00025)+Math.max(5,exitTurnover*.00025);
    const stampDuty=exitTurnover*.0005;
    const transferFee=turnover*.00001;
    const calculatedFees=commission+stampDuty+transferFee;
    const estimatedFees=tUseConservativeFee?Math.max(calculatedFees,turnover*.001):calculatedFees;
    const net=gross-estimatedFees;
    const base=Math.max(1,effectiveLivePosition.openingShares);
    return {
      quantity,gross,estimatedFees,net,costChange:net/base,
      feeLabel:tUseConservativeFee?"保守综合费率 0.10%":"佣金、印花税及过户费",
    };
  },[tEntryPrice,tExitPrice,tQuantity,tUseConservativeFee,effectiveLivePosition.openingShares]);
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
    if(panel==="历史信号"){
      const observationRows=[...currentObservations].reverse().map(observation=>{
        const point=minutePoints.find(item=>item.time===observation.time);
        const time=`${observation.time.slice(0,2)}:${observation.time.slice(2)}`;
        const qualified=observation.stage!=="watch";
        return {time,direction:observationConfirmationLabel(observation),price:point?point.price.toFixed(2):"—",quantity:"未下单",spread:`预估 ${observation.edge.toFixed(2)}%`,status:`${observationDirectionNote(observation)}；${qualified?"候选门槛通过":observation.blockers[0]??"尚未达到候选门槛"}`,tone:"candidate" as const};
      });
      if(!visibleStockAgentEvaluation||visibleStockAgentEvaluation.status!=="candidate"||!visibleStockAgentEvaluation.asOfTime)return observationRows;
      const point=minutePoints.find(item=>item.time===visibleStockAgentEvaluation.asOfTime);
      const agentRow:DeskHistoryRow={
        time:`${visibleStockAgentEvaluation.asOfTime.slice(0,2)}:${visibleStockAgentEvaluation.asOfTime.slice(2)}`,
        direction:`${visibleStockAgentEvaluation.direction??"双向"}专属候选`,
        price:point?point.price.toFixed(2):"—",
        quantity:"未下单",
        spread:`评分 ${visibleStockAgentEvaluation.score}/100`,
        status:`${visibleStockAgentEvaluation.title}；研究观察版，不生成正式成交`,
        tone:"candidate",
      };
      return [agentRow,...observationRows].filter((row,index,rows)=>rows.findIndex(item=>item.time===row.time&&item.direction===row.direction)===index);
    }
    return [...liveEngine.actions].reverse().map(action=>({time:`${action.time.slice(0,2)}:${action.time.slice(2)}`,direction:`${action.direction??"T"}${action.side}`,price:action.price.toFixed(2),quantity:`${action.quantity.toLocaleString("zh-CN")}股`,spread:"引擎模拟",status:action.reason??"正式过滤通过",tone:action.side==="卖出"?"sell":"buy"}));
  },[panel,confirmedCycleRows,visibleStockAgentEvaluation,currentObservations,minutePoints,liveEngine.actions]);
  useEffect(() => {
    const update=()=>setClockNow(new Date());
    update();
    // Market-session boundaries only need a coarse clock. Live quotes have their
    // own one-second poll; updating this large view every second only causes
    // redundant chart and signal recalculation.
    const timer=window.setInterval(update,15_000);
    return()=>window.clearInterval(timer);
  },[]);
  const playAlertTone=useCallback((risk=false)=>{
    try{
      const AudioContextClass=window.AudioContext||(window as typeof window & {webkitAudioContext:typeof AudioContext}).webkitAudioContext;
      const context=new AudioContextClass();
      void context.resume?.();
      const notes=risk?[392,330,262]:[523.25,659.25,783.99];
      const duration=risk?.42:.34;
      for(const [index,frequency] of notes.entries()){
        const oscillator=context.createOscillator();const gain=context.createGain();const start=context.currentTime+index*.075;
        oscillator.type="sine";oscillator.frequency.setValueAtTime(frequency,start);
        gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(risk?.065:.045,start+.018);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
        oscillator.connect(gain);gain.connect(context.destination);oscillator.start(start);oscillator.stop(start+duration+.02);
      }
      window.setTimeout(()=>void context.close(),(notes.length-1)*75+duration*1000+80);
    }catch{}
  },[]);
  const drainAlertSpeech=useCallback(function drainAlertSpeech(){
    if(speechBusy.current||speechQueue.current.length===0)return;
    const next=speechQueue.current.shift()!;
    speechBusy.current=true;
    playAlertTone(next.risk);
    try{
      if(next.clip){
        const audio=new Audio(`/audio/trade-alerts/${next.clip}.wav`);
        const completed=()=>{speechBusy.current=false;window.setTimeout(drainAlertSpeech,120);};
        audio.onended=completed;
        audio.onerror=()=>{
          speechBusy.current=false;
          speechQueue.current.unshift({spoken:next.spoken,risk:next.risk});
          window.setTimeout(drainAlertSpeech,120);
        };
        void audio.play().catch(()=>audio.onerror?.(new Event("error")));
        return;
      }
      if(!("speechSynthesis" in window)){speechBusy.current=false;return;}
      const speech=new SpeechSynthesisUtterance(next.spoken);
      speech.lang="zh-CN";speech.rate=1.02;speech.pitch=next.risk?0.82:1.08;speech.volume=.92;
      const voices=window.speechSynthesis.getVoices();
      speech.voice=voices.find(voice=>voice.lang.toLowerCase().startsWith("zh-cn")&&/xiaoxiao|tingting|xiaochen|xiaoyi|natural/i.test(voice.name))
        ??voices.find(voice=>voice.lang.toLowerCase().startsWith("zh-cn"))
        ??null;
      const completed=()=>{speechBusy.current=false;window.setTimeout(drainAlertSpeech,120);};
      speech.onend=completed;speech.onerror=completed;
      window.speechSynthesis.speak(speech);
    }catch{speechBusy.current=false;window.setTimeout(drainAlertSpeech,120);}
  },[playAlertTone]);
  const speakAlert=useCallback((text:string,risk=false,level:TradeAlertToast["level"]="signal",direction:"buy"|"sell"|null=null)=>{
    const clip=risk||level==="risk"?"risk":level==="signal"&&direction?direction:undefined;
    speechQueue.current.push({spoken:conciseAlertSpeech({text,level,direction,risk}),risk,clip});
    drainAlertSpeech();
  },[drainAlertSpeech]);
  const queueAlert=useCallback((incoming:TradeAlertToast)=>{
    const now=Date.now();
    let alert:TradeAlertToast={...incoming,id:incoming.id??`alert-${now}-${++alertSequence.current}`,createdAt:incoming.createdAt??new Date(now).toISOString()};
    if(alert.eventKey&&queuedAlertEventKeys.current.has(alert.eventKey))return false;
    if(alert.code&&alert.rabbit!=="both"){
      const alertCode=alert.code;
      const delivery=resolveAlertDelivery({previous:deliveredAlertByCode.current[alertCode]??null,next:alert,nowMs:now});
      if(!delivery.deliver)return false;
      alert={...delivery.alert,id:alert.id,createdAt:alert.createdAt} as TradeAlertToast;
      deliveredAlertByCode.current[alertCode]=alert;
    }
    if(alert.eventKey){
      if(queuedAlertEventKeys.current.size>1000)queuedAlertEventKeys.current.clear();
      queuedAlertEventKeys.current.add(alert.eventKey);
    }
    setAlertQueue(current=>current.some(item=>alert.eventKey&&item.eventKey===alert.eventKey)?current:[...current,alert].slice(-12));
    if(alert.source!=="preview"&&alert.code){
      setAlertHistory(current=>{
        const normalized={...alert,id:String(alert.id??`history-${now}`),createdAt:alert.createdAt??new Date(now).toISOString()};
        const next=[
          normalized,
          ...current.filter(item=>alert.eventKey?item.eventKey!==alert.eventKey:item.id!==normalized.id),
        ].slice(0,200);
        try{localStorage.setItem(`rabbit-alert-history:${accountName.toLowerCase()}`,JSON.stringify(next))}catch{}
        return next;
      });
    }
    return true;
  },[accountName]);
  const persistAlertSettings=(next:AlertSettings)=>{
    setAlertSettings(next);
    try{localStorage.setItem('rabbit-alert-settings',JSON.stringify(next));}catch{}
  };
  const enableBackgroundPush=async()=>{
    if(!localAuth||demoMode){queueAlert({level:"candidate",rabbit:"both",title:"后台推送需要登录",message:"请先登录正式账号后再开启手机后台提醒。"});return;}
    if(!("serviceWorker" in navigator)||!("PushManager" in window)){setBackgroundPushState("unsupported");queueAlert({level:"candidate",rabbit:"both",title:"当前浏览器不支持后台推送",message:"请使用新版 Safari/Chrome，并将双兔助手添加到手机主屏幕后重试。"});return;}
    try{
      let permission=Notification.permission;
      if(permission!=="granted")permission=await Notification.requestPermission();
      if(permission!=="granted"){queueAlert({level:"candidate",rabbit:"both",title:"未获得通知权限",message:"请在手机系统设置中允许双兔助手发送通知。"});return;}
      const registration=await navigator.serviceWorker.register("/notifications-sw.js",{scope:"/"});
      await navigator.serviceWorker.ready;
      let subscription=await registration.pushManager.getSubscription();
      if(!subscription){
        const response=await fetch("/api/control/push/public-key",{credentials:"include",cache:"no-store"});
        if(!response.ok)throw new Error("无法获取推送密钥");
        const payload=await response.json();
        subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64UrlToUint8Array(payload.publicKey)});
      }
      const saved=await fetch("/api/control/push/subscriptions",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({subscription:subscription.toJSON()})});
      if(!saved.ok)throw new Error("服务器未保存推送订阅");
      persistAlertSettings({...alertSettings,background:true});setBackgroundPushState("ready");
      queueAlert({level:"signal",rabbit:"both",title:"后台推送已开启",message:"正式和候选提醒会推送到系统通知；iPhone 请将网站添加到主屏幕后使用。"});
    }catch{
      setBackgroundPushState("error");queueAlert({level:"risk",rabbit:"both",title:"后台推送连接失败",message:"订阅没有保存成功，请稍后重试；前台语音和弹窗不受影响。"});
    }
  };
  const disableBackgroundPush=async()=>{
    try{
      const registration=await navigator.serviceWorker?.getRegistration("/");
      const subscription=await registration?.pushManager.getSubscription();
      if(subscription){await fetch("/api/control/push/subscriptions",{method:"DELETE",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({endpoint:subscription.endpoint})});await subscription.unsubscribe();}
    }catch{}
    persistAlertSettings({...alertSettings,background:false});setBackgroundPushState("idle");
  };
  const testBackgroundPush=async()=>{
    if(backgroundPushTesting)return;
    setBackgroundPushTesting(true);
    try{
      const response=await fetch("/api/control/push/test",{method:"POST",credentials:"include"});
      if(!response.ok)throw new Error("test failed");
      queueAlert({level:"signal",rabbit:"both",title:"测试已发出",message:"请将网页切到后台，稍候查看系统通知。"});
    }catch{queueAlert({level:"risk",rabbit:"both",title:"测试发送失败",message:"当前设备尚未完成后台推送订阅。"});}
    finally{setBackgroundPushTesting(false);}
  };
  useEffect(()=>{
    if(!localAuth||demoMode)return;
    let cancelled=false;
    void (async()=>{
      if(!("serviceWorker" in navigator)||!("PushManager" in window)){if(!cancelled)setBackgroundPushState("unsupported");return;}
      try{
        const registration=await navigator.serviceWorker.register("/notifications-sw.js",{scope:"/"});
        const subscription=await registration.pushManager.getSubscription();
        if(cancelled)return;
        setBackgroundPushState(subscription?"ready":"idle");
        if(subscription&&!alertSettings.background)persistAlertSettings({...alertSettings,background:true});
      }catch{if(!cancelled)setBackgroundPushState("error");}
    })();
    return()=>{cancelled=true;};
  },[localAuth,demoMode,alertSettings]);
  const updateAlertSetting=async (kind:keyof AlertSettings)=>{
    if(kind==="background"){if(alertSettings.background)await disableBackgroundPush();else await enableBackgroundPush();return;}
    let enabled=!alertSettings[kind];
    if(kind==="system"&&enabled){
      if(!("Notification" in window))enabled=false;
      else enabled=(await Notification.requestPermission())==="granted";
    }
    const next={...alertSettings,[kind]:enabled};persistAlertSettings(next);
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
    queueAlert({code:stock.code,eventKey:`preview:${stock.code}:${rabbit}:${Date.now()}`,source:"preview",level:"signal",rabbit,title,message});
    if(alertSettings.sound)speakAlert(`${stock.name}，${isBuy?"买入或买回":"卖出"}提醒`,false,"signal",rabbit);
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
      const itemExperiment=resolveBacktestStrategyExperiment(item.code,"closure-first");
      const itemProfitOptions=smartTProfitModeOptions(item.code,preferences.profitMode) as ReplayProfitOptions;
      const replay=active?liveEngine:runSmartTReplay(points,{
        capital:200_000,baseShares:itemPosition.openingShares,sellable:itemPosition.sellable,feeRate:.025,slippage:.02,minCommission:true,slippageMode:"percent",forceCloseTime:"1450",profile:itemExperiment.profile??profile,previousClose:snapshot?.quote.previousClose??null,randomValue:0,
        ...itemProfitOptions,
        profileOverrides:{...(itemProfitOptions.profileOverrides??{}),...itemExperiment.profileOverrides},
        positionSizeMode:itemExperiment.positionSizeMode,
        volatilityMode:itemExperiment.volatilityMode,
        strategyVersion:itemExperiment.label,
      });
      const observations=(replay.observations??[]) as ReplayObservation[];
      const latest=replay.actions.at(-1);
      const latestObservation=selectLatestAlertableObservation(observations) as ReplayObservation|undefined;
      const lastTime=(points.at(-1)?.time??"").replace(/\D/g,"").slice(0,4);
      const agentEvaluation=active&&zijinResearchEnabled&&item.code===STOCK_AGENTS.zijin.code
        ? stockAgentEvaluation
        : null;
      const experimentalReminder=item.code===STOCK_AGENTS.zijin.code
        ? evaluateZijinExperimentalReminder(points)
        : null;
      const displacementReminder=item.code===STOCK_AGENTS.zijin.code
        ? evaluateZijinDisplacementWatch(points)
        : null;
      // A formal alert for the active chart must be visible on that chart first.
      // Other monitored stocks keep their background-alert behavior.
      const formalCharted=!active||Boolean(latest&&intradayMarkerLayout.actions.some(marker=>marker.action===latest));
      const formalFresh=Boolean(latest&&formalCharted&&isRecentCausalEvent(lastTime,latest.time,3));
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
      const experimentalFresh=Boolean(experimentalReminder&&isRecentCausalEvent(lastTime,experimentalReminder.asOfTime,2));
      const displacementFresh=Boolean(displacementReminder&&isRecentCausalEvent(lastTime,displacementReminder.time,2));
      const latestSide=formalFresh&&latest?formalActionSide(latest.side):null;
      const latestDirection=(latest?.direction??(latestSide==="sell"?"反T":"正T")) as "正T"|"反T";
      const latestExecutionLabel=formalFresh&&latestSide?formalExecutionLabel(latestDirection,latestSide):"";
      const activeCycleSameSide=Boolean(formalFresh&&active&&cycleStageRef.current==="opened"&&openedCycleSideRef.current===latestSide);
      if(activeCycleSameSide)continue;
      const formalSideKey=formalFresh&&latestSide?`${item.code}:${latestSide}`:"";
      const lastSameSideAt=formalSideKey?lastFormalAlertAtBySide.current[formalSideKey]??0:0;
      if(formalFresh&&formalSideKey&&Date.now()-lastSameSideAt<10*60_000)continue;
      const engineCandidateFresh=Boolean(candidateFresh&&latestObservation&&!latestObservation.executable);
      const selectedExperimental=experimentalFresh?experimentalReminder:null;
      const selectedDisplacement=displacementFresh?displacementReminder:null;
      const selectedAgent=agentCandidateFresh?agentEvaluation:null;
      const selectedEngineCandidate=engineCandidateFresh?latestObservation:null;
      const isCandidate=!isRisk&&!formalFresh&&Boolean(
        selectedExperimental
        || selectedDisplacement
        || selectedAgent
        || selectedEngineCandidate
      );
      const candidateDirection=selectedExperimental?.direction??selectedDisplacement?.direction??selectedAgent?.direction??selectedEngineCandidate?.direction;
      const candidateTime=String(selectedExperimental?.asOfTime??selectedDisplacement?.time??selectedAgent?.asOfTime??selectedEngineCandidate?.time??lastTime).replace(/\D/g,"").slice(-4);
      const candidateStageRank=selectedDisplacement?.stage==="displacement-l2-confirmation"||selectedExperimental?.stage==="experimental-exit"
        ?3
        :selectedDisplacement?.stage==="displacement-progress"||selectedAgent||selectedEngineCandidate?.stage==="candidate"
          ?2
          :1;
      const candidateSide=candidateDirection==="反T"?"sell":"buy";
      const candidateSideKey=isCandidate&&candidateDirection?`${item.code}:${candidateSide}`:"";
      const previousCandidate=candidateSideKey?lastCandidateAlertBySide.current[candidateSideKey]:null;
      const isZijinCandidate=isCandidate&&item.code===STOCK_AGENTS.zijin.code;
      const now=Date.now();
      if(isZijinCandidate&&candidateTime<"0935")continue;
      if(isZijinCandidate&&previousCandidate){
        const sameEpisode=now-previousCandidate.at<20*60_000;
        const delayedUpgrade=candidateStageRank>previousCandidate.rank&&now-previousCandidate.at>=10*60_000;
        if(previousCandidate.time===candidateTime||(sameEpisode&&!delayedUpgrade))continue;
      }
      if(!isRisk&&!formalFresh&&!isCandidate)continue;
      let key:string;
      if(isRisk)key=`${item.code}:risk:${riskSignature}`;
      else if(formalFresh)key=`${item.code}:${latest!.time}:${latest!.side}`;
      else if(isZijinCandidate&&candidateDirection&&/^\d{4}$/.test(candidateTime)){
        const episode=Math.floor((Number(candidateTime.slice(0,2))*60+Number(candidateTime.slice(2)))/20);
        key=`${item.code}:candidate:${candidateSide}:${candidateStageRank}:${episode}`;
      }else if(selectedExperimental)key=`${item.code}:experimental:${selectedExperimental.id}:${selectedExperimental.stage}:${selectedExperimental.asOfTime}`;
      else if(selectedDisplacement)key=`${item.code}:displacement:${selectedDisplacement.id}`;
      else if(selectedAgent)key=`${item.code}:agent:${selectedAgent.asOfTime}:${selectedAgent.direction}`;
      else key=`${item.code}:candidate:${selectedEngineCandidate!.time}:${selectedEngineCandidate!.direction}`;
      const eventDate=snapshot?.sampleDate??clockNow?.toLocaleDateString("sv-SE")??"unknown-date";
      const persistedKey=`rabbit-alerted:${accountName.toLowerCase()}:${eventDate}:${key}`;
      let alreadyAlerted=!isRisk&&alertedEventKeys.current.has(persistedKey);
      try{alreadyAlerted=alreadyAlerted||(!isRisk&&localStorage.getItem(persistedKey)==="1");}catch{}
      if(alreadyAlerted)continue;
      if(!isRisk){alertedEventKeys.current.add(persistedKey);try{localStorage.setItem(persistedKey,"1");}catch{}}
      const rabbit=isRisk?"both":formalFresh?latestSide!:(selectedExperimental?.stage==="experimental-exit"?(candidateDirection==="正T"?"sell":"buy"):(candidateDirection==="反T"?"sell":"buy"));
      const title=isRisk
        ? `${item.name} 风险锁定`
        : formalFresh
          ? `${item.name} ${latestExecutionLabel}`
          : selectedExperimental
            ? `${item.name} · ${selectedExperimental.title}`
            : selectedDisplacement
              ? `${item.name} · ${selectedDisplacement.label}`
            : selectedAgent
              ? `${item.name} · ${selectedAgent.title}`
              : `${item.name} ${selectedEngineCandidate!.direction}候选观察`;
      const message=isRisk
        ? riskMessage
        : formalFresh
          ? (latest!.reason??`正式执行信号已通过趋势、量价、成本与风控过滤`)
          : selectedExperimental
            ? `${selectedExperimental.reason}${selectedExperimental.plan} 这是实验观察，不是买卖指令。`
            : selectedDisplacement
              ? selectedDisplacement.reason
            : selectedAgent
              ? `${selectedAgent.reasons[0]}；紫金研究模型观察，不是买卖指令。`
              : `${selectedEngineCandidate!.reason}；${selectedEngineCandidate!.blockers.join("；")||"等待正式过滤确认"}`;
      const alertTime=formalFresh?latest!.time:candidateTime;
      const alertPrice=formalFresh?latest!.price:selectedExperimental?.price??selectedDisplacement?.price??selectedEngineCandidate?.price??points.find(point=>point.time===alertTime)?.price;
      const queued=queueAlert({code:item.code,eventKey:key,source:isRisk?"risk":formalFresh?"client-v4":"client-candidate",marketDate:eventDate,marketTime:alertTime,price:alertPrice,level:isRisk?"risk":formalFresh?"signal":"candidate",rabbit,title,message});
      if(queued&&formalFresh&&formalSideKey)lastFormalAlertAtBySide.current[formalSideKey]=Date.now();
      if(queued&&isZijinCandidate&&candidateSideKey)lastCandidateAlertBySide.current[candidateSideKey]={at:now,rank:candidateStageRank,time:candidateTime};
      const candidateSpeech=selectedExperimental
        ? selectedExperimental.stage==="experimental-exit"
          ? `${item.name}，${selectedExperimental.direction}实验观察结束，${selectedExperimental.reason}，不是买卖指令`
          : `${item.name}，${selectedExperimental.direction}实验观察，出现倍量、均价线偏离与实时拐头，不是买卖指令`
        : selectedDisplacement
        ? selectedDisplacement.stage==="displacement-candidate"
          ? `${item.name}，${selectedDisplacement.label}，等待确认，不是正式买卖点`
          : selectedDisplacement.stage==="displacement-l2-confirmation"
          ? `${item.name}，${selectedDisplacement.label}，订单流正在确认，不是正式买卖点`
          : selectedDisplacement.stage==="displacement-progress"
            ? `${item.name}，${selectedDisplacement.label}，继续观察，不是正式买卖点`
            : `${item.name}，${selectedDisplacement.label}，等待转弱或转强确认，不是买卖点`
        : selectedAgent
        ? `${item.name}，${selectedAgent.direction??"做T"}专属候选观察，不是买卖指令`
        : isVwapDisplacementObservation(selectedEngineCandidate)
        ? `${item.name}，${selectedEngineCandidate!.reason.split("；")[0]}，请观察确认，不是买卖指令`
        : `${item.name}，${selectedEngineCandidate?.direction??"做T"}候选观察，不是买卖指令`;
      if(queued&&alertSettings.sound&&(isRisk||formalFresh))speakAlert(isRisk?`${item.name}，风险锁定，暂停做T`:formalFresh?`${item.name}，${latestExecutionLabel}提醒`:candidateSpeech,isRisk,isRisk?"risk":formalFresh?"signal":"candidate",rabbit==="both"?null:rabbit);
      if(queued&&alertSettings.system&&"Notification" in window&&Notification.permission==="granted")new Notification(`双兔助手 · ${title}`,{body:message,tag:key,requireInteraction:isRisk});
    }
  },[autoDecision.status,autoDecision.reason,liveEngine,intradayMarkerLayout,minutePoints,marketSession.live,stockList,activeStock,currentTrial,currentMarket,marketSnapshots,effectiveLivePosition,stockPositions,preferences,profile,eventsByCode,alertSettings,clockNow,accountName,zijinResearchEnabled,stockAgentEvaluation,queueAlert,speakAlert]);
  useEffect(()=>{
    if(!localAuth||demoMode)return;
    let cancelled=false;
    let inFlight=false;
    const pull=async()=>{
      if(inFlight||!shouldRunClientPolling(document.visibilityState))return;
      inFlight=true;
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
          const actionSide=action?.side?formalActionSide(action.side):null;
          const activeFormalMarkerReady=item.level!=="formal"||item.code!==stockList[activeStock]?.code||Boolean(
            action&&intradayMarkerLayout.actions.some(marker=>marker.action.time===action.time&&formalActionSide(marker.action.side)===actionSide),
          );
          // Keep a server-pushed formal alert pending until its chart marker is
          // present, so speech, toast, and the visible buy/sell point agree.
          if(!activeFormalMarkerReady)continue;
          const sell=actionSide?actionSide==="sell":String(observation?.direction??item.title).includes('卖');
          const actionDirection=(action?.direction??observation?.direction??(sell?"反T":"正T")) as "正T"|"反T";
          const executionLabel=actionSide?formalExecutionLabel(actionDirection,actionSide):item.title;
          const sideKey=item.level==='formal'&&actionSide&&item.code?`${item.code}:${actionSide}`:"";
          if(item.level==='formal'&&actionSide&&item.code===stockList[activeStock]?.code&&cycleStageRef.current==="opened"&&openedCycleSideRef.current===actionSide)continue;
          if(sideKey&&Date.now()-(lastFormalAlertAtBySide.current[sideKey]??0)<10*60_000)continue;
          const level=item.level==='formal'?'signal':item.level==='risk'?'risk':'candidate';
          const rabbit=sell?'sell':'buy';
          const serverTitle=item.level==='formal'?`${item.name??item.code} ${executionLabel}`:item.title;
          const serverTime=String(item.marketTime??action?.time??observation?.time??"").replace(/\D/g,"").slice(-4);
          const serverPrice=Number(action?.price??observation?.price);
          const queued=queueAlert({code:item.code,eventKey:item.eventKey??`server:${item.id}`,source:"server",createdAt:item.createdAt,marketTime:serverTime||undefined,price:Number.isFinite(serverPrice)?serverPrice:undefined,level,rabbit,title:serverTitle,message:item.message});
          if(queued&&sideKey)lastFormalAlertAtBySide.current[sideKey]=Date.now();
          const shouldDeliver=serverAlertsInitialized.current&&item.level!=='watch';
          const deliveryChannels:string[]=[];
          if(queued&&shouldDeliver&&(item.level==='formal'||item.level==='risk')&&alertSettings.sound){speakAlert(`${item.title}，${item.level==='formal'?'正式信号':'风险提醒'}`,item.level==='risk',level,rabbit);deliveryChannels.push('speech')}
          if(queued&&shouldDeliver&&alertSettings.system&&'Notification' in window&&Notification.permission==='granted'){new Notification(`双兔助手 · ${item.title}`,{body:item.message,tag:`server-${item.id}`});deliveryChannels.push('system')}
          if(shouldDeliver)void fetch(`/api/control/alerts/${item.id}/delivery`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({status:deliveryChannels.length?'notified':'displayed',channel:deliveryChannels.length?deliveryChannels.join('+'):'in-app'})}).catch(()=>{});
          void fetch(`/api/control/alerts/${item.id}/ack`,{method:'POST',credentials:'include'}).catch(()=>{});
        }
        serverAlertsInitialized.current=true;
      }catch{}finally{inFlight=false}
    };
    void pull();const timer=window.setInterval(()=>void pull(),5000);
    const onVisibility=()=>{if(shouldRunClientPolling(document.visibilityState))void pull()};
    document.addEventListener('visibilitychange',onVisibility);
    return()=>{cancelled=true;window.clearInterval(timer);document.removeEventListener('visibilitychange',onVisibility)};
  },[localAuth,demoMode,alertSettings.sound,alertSettings.system,stockList,activeStock,intradayMarkerLayout,queueAlert,speakAlert]);
  useEffect(() => {
    if(initialAuth)return;
    const timer = window.setTimeout(() => {void (async()=>{
      try {
        const response=await fetch('/api/control/auth/session',{credentials:'include',cache:'no-store'});
        if(response.ok){
          const payload=await response.json();
          const session=payload.user?.displayName||payload.user?.username;
          if(session){setLocalAuth(true);setAccountName(session);setAccountRole(payload.user?.role||'member');setAccountMembership(payload.user?.membership??null);localStorage.setItem('rabbit-account-role',payload.user?.role||'member')}
        }
      } catch {}
      setAuthReady(true);
    })()}, 0);
    return () => window.clearTimeout(timer);
  }, [initialAuth]);
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
          if(data.preferences||data.strategyProfile){
            const restored=normalizeAccountPreferences({...data.preferences,strategyProfile:data.strategyProfile??data.preferences?.strategyProfile});
            setPreferences(restored);setProfile(restored.strategyProfile);setHasPersistedPreferences(true);
            localStorage.setItem(`rabbit-prefs:${accountName.toLowerCase()}`,JSON.stringify(restored));
          }
          if(data.alertSettings)setAlertSettings(current=>({...current,...data.alertSettings}));
          if(data.customStrategy)setCustomStrategy(data.customStrategy);
        }
        if(monitorResponse.ok){
          const remote=await monitorResponse.json();
          if(Array.isArray(remote.monitors)&&remote.monitors.length){
            const allowedMonitors=enforceWatchlistLimit(remote.monitors,accountRole,accountMembership?.active===true,accountMembership?.planId);
            const list=enforceWatchlistLimit(prepareWatchlistForCurrentEntry(allowedMonitors.map((item:{code:string;name:string})=>({code:item.code,name:item.name,price:'--',change:'0.00%'}))),accountRole,accountMembership?.active===true,accountMembership?.planId);
            const positions=Object.fromEntries(allowedMonitors.map((item:{code:string;position:StockPosition})=>[item.code,normalizeStockPosition(item.position??{},item.code)]));
            setStockList(list);setStockPositions(positions);
            localStorage.setItem(`rabbit-watchlist:${accountName.toLowerCase()}`,JSON.stringify(list));
            for(const item of allowedMonitors)saveStockPosition(localStorage,accountName,normalizeStockPosition(item.position??{},item.code));
          }
        }
      }catch{}finally{if(!cancelled){remoteSyncReady.current=true;setRemoteSyncEpoch(value=>value+1)}}
    })();
    return()=>{cancelled=true};
  },[localAuth,demoMode,accountName,accountRole,accountMembership]);
  useEffect(()=>{
    if(!remoteSyncReady.current||!localAuth||demoMode||!accountName||!stockList.length)return;
    const timer=window.setTimeout(()=>{void Promise.all([
      fetch('/api/control/profile',{method:'PUT',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({data:{preferences:{...preferences,strategyProfile:profile},strategyProfile:profile,alertSettings,customStrategy}})}),
      fetch('/api/control/monitors',{method:'PUT',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({monitors:stockList.map(item=>({code:item.code,name:item.name,enabled:true,profile,position:stockPositions[item.code]??{}}))})}),
    ]).catch(()=>{})},800);
    return()=>window.clearTimeout(timer);
  },[localAuth,demoMode,accountName,stockList,stockPositions,preferences,alertSettings,customStrategy,profile,remoteSyncEpoch]);
  useEffect(()=>{
    if(!localAuth||!accountName)return;
    const timer=window.setTimeout(()=>setPreferences(current=>current.strategyProfile===profile?current:{...current,strategyProfile:profile}),0);
    if(!demoMode){
      try{
        const key=`rabbit-prefs:${accountName.toLowerCase()}`;
        const saved=localStorage.getItem(key);
        const next=normalizeAccountPreferences(saved?JSON.parse(saved):preferences);
        localStorage.setItem(key,JSON.stringify({...next,strategyProfile:profile}));
      }catch{}
    }
    return()=>window.clearTimeout(timer);
  },[localAuth,demoMode,accountName,profile,preferences]);
  useEffect(() => {
    if (!localAuth || demoMode || !accountName || !stockList.length) return;
    const loaded:StockPositionMap=Object.fromEntries(stockList.map(item=>{
      const position=loadStockPosition(window.localStorage,accountName,item.code,preferences,hasPersistedPreferences);
      const persisted=position.updatedAt?position:saveStockPosition(window.localStorage,accountName,position);
      return [item.code,persisted];
    }));
    const timer=window.setTimeout(()=>{setStockPositions(loaded);if(Object.values(loaded).some(position=>position.needsConfirmation))setOnboardingOpen(true)},0);
    return()=>window.clearTimeout(timer);
  },[localAuth,demoMode,accountName,stockList,preferences,hasPersistedPreferences]);
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
    const timer=window.setTimeout(()=>{
      setCycleStage('ready');
      setOpenedCycleSide(null);
    },0);
    return()=>window.clearTimeout(timer);
  },[stock?.code]);
  useEffect(() => {
    if (!localAuth || !stock?.code || activeView!=="操盘台") return;
    let cancelled = false;
    let started = false;
    let stopPolling = () => {};
    const load = async () => {
      if (!shouldRunTradingDeskPolling(activeView,document.visibilityState)) return;
      try {
        const response = await fetch(`/api/market-data?code=${encodeURIComponent(stock.code)}`);
        if (!response.ok) throw new Error("行情服务暂不可用");
        const data = await response.json() as MarketData;
        if (!cancelled) { setMarketData(data); setMarketError(""); }
      } catch {
        if (!cancelled) { setMarketData(null); setMarketError("行情服务暂不可用，页面不会使用示例价格代替。"); }
      }
    };
    const start=()=>{
      if(cancelled||started)return;
      started=true;
      stopPolling = startClientPolling({
        key: "trading-desk-reference",
        intervalMs: clientPollingInterval("referenceData",marketDataActive),
        run: load,
        enabled: () => !cancelled && shouldRunTradingDeskPolling(activeView, document.visibilityState),
      });
    };
    const bootstrapTimer=window.setTimeout(start,REFERENCE_DATA_BOOTSTRAP_DELAY_MS);
    const onVisibility=()=>{if(!started&&shouldRunTradingDeskPolling(activeView,document.visibilityState))start()};
    document.addEventListener("visibilitychange",onVisibility);
    return () => {
      cancelled=true;
      window.clearTimeout(bootstrapTimer);
      stopPolling();
      document.removeEventListener("visibilitychange",onVisibility);
    };
  }, [localAuth, activeView, stock?.code, marketDataActive]);
  useEffect(() => {
    if (!localAuth || activeView!=="操盘台" || !stockList.length) return;
    let cancelled = false;
    const load=async()=>{
      if(!shouldRunTradingDeskPolling(activeView,document.visibilityState))return;
      const passiveStocks=passiveWatchlistItems(stockList,stock?.code) as typeof stockList;
      if(!passiveStocks.length)return;
      try{
        const results=await Promise.allSettled(passiveStocks.map(async item=>{
          const response=await fetch(`/api/market-data?code=${encodeURIComponent(item.code)}&mode=trial-realtime`,{cache:"no-store"});
          if(!response.ok)throw new Error("quote unavailable");
          return await response.json() as MarketData;
        }));
        const snapshots=fulfilledWatchlistSnapshots(results) as MarketData[];
        if(!cancelled&&snapshots.length){
          setMarketQuotes(current=>({...current,...Object.fromEntries(snapshots.map(snapshot=>[snapshot.quote.code,snapshot.quote]))}));
          setMarketSnapshots(current=>({...current,...Object.fromEntries(snapshots.map(snapshot=>[snapshot.quote.code,snapshot]))}));
        }
      }catch{}
    };
    // The control-plane keeps monitoring when the page is hidden or closed.
    // The browser only refreshes visible UI, avoiding redundant background work.
    const stopPolling = startClientPolling({
      key: "trading-desk-watchlist",
      intervalMs: clientPollingInterval("watchlist",marketDataActive),
      run: load,
      enabled: () => !cancelled && shouldRunTradingDeskPolling(activeView, document.visibilityState),
    });
    return () => { cancelled = true; stopPolling(); };
  }, [localAuth, activeView, stockList, stock?.code, marketDataActive]);
  useEffect(() => {
    if (!localAuth || activeView!=="操盘台" || !stock?.code || !stockList.length) return;
    let cancelled = false;
    const load = async () => {
      if (!shouldRunTradingDeskPolling(activeView,document.visibilityState)) return;
      try {
        const params = new URLSearchParams({
          code: stock.code,
          market: "0",
          codes: stockList.slice(0,10).map(item => item.code).join(","),
          names: stockList.slice(0,10).map(item => item.name).join(","),
        });
        const latestChange=latestActiveChange.current;
        if(latestChange!==null&&Number.isFinite(latestChange))params.set("change",String(latestChange));
        const response = await fetch(`/api/trading-desk-snapshot?${params.toString()}`, { cache:"no-store" });
        if (!response.ok) throw new Error("desk snapshot unavailable");
        const data = await response.json() as TradingDeskSnapshot;
        if (!cancelled) {
          if (data.market) {
            setTrialQuote(data.market);
            setMarketQuotes(current=>({...current,[data.market!.quote.code]:data.market!.quote}));
            setMarketSnapshots(current=>({...current,[data.market!.quote.code]:data.market!}));
          }
          setMarketContext(data.context);
          setZijinHkMarket(data.zijinHk);
          setEventRadar(data.eventRadar);
          setMarketContextError(data.context ? "" : "外部环境暂不可用，已降为个股保守模式");
          setEventRadarError(data.eventRadar ? "" : "事件雷达暂不可用，不使用旧消息改变信号");
        }
      } catch {
        if (!cancelled) {
          setMarketContext(null);
          setZijinHkMarket(null);
          setEventRadar(null);
          setMarketContextError("外部环境暂不可用，已降为个股保守模式");
          setEventRadarError("事件雷达暂不可用，不使用旧消息改变信号");
        }
      }
    };
    const stopPolling = startClientPolling({
      key: "trading-desk-snapshot",
      intervalMs: clientPollingInterval("deskSnapshot",marketDataActive),
      run: load,
      enabled: () => !cancelled && shouldRunTradingDeskPolling(activeView, document.visibilityState),
    });
    return () => { cancelled = true; stopPolling(); };
  }, [localAuth, activeView, stock?.code, stockList, marketDataActive]);
  useEffect(() => {
    if (!localAuth || activeView!=="操盘台" || !stock?.code) return;
    let cancelled = false;
    const load = async () => {
      if (!shouldRunTradingDeskPolling(activeView,document.visibilityState)) return;
      try {
        const response = await fetch(`/api/market-data?code=${encodeURIComponent(stock.code)}&mode=trial-realtime`, { cache: "no-store" });
        if (!response.ok) throw new Error("trial chart unavailable");
        const data = await response.json() as MarketData;
        if (!cancelled) {
          setTrialQuote(data);
          setMarketQuotes(current=>({...current,[data.quote.code]:data.quote}));
          setMarketSnapshots(current=>({...current,[data.quote.code]:data}));
          setTrialError("");
        }
      } catch {
        if (!cancelled) setTrialError("分时图暂时更新失败，已保留最后一次有效数据。");
      }
    };
    const stopPolling = startClientPolling({
      key: "trading-desk-chart",
      intervalMs: clientPollingInterval("activeChart",marketDataActive),
      run: load,
      enabled: () => !cancelled && shouldRunTradingDeskPolling(activeView, document.visibilityState),
    });
    return () => { cancelled = true; stopPolling(); };
  }, [localAuth, activeView, stock?.code, marketDataActive]);
  useEffect(() => {
    if (!localAuth || activeView!=="操盘台" || !stock?.code) return;
    let cancelled = false;
    const load = async () => {
      if (!shouldRunTradingDeskPolling(activeView,document.visibilityState)) return;
      try {
        const response = await fetch(`/api/market-data?code=${encodeURIComponent(stock.code)}&mode=trial-quote`, { cache: "no-store" });
        if (!response.ok) throw new Error("trial quote unavailable");
        const data = await response.json() as MarketData;
        if (!cancelled) {
          setTrialQuote(current => current?.quote.code === data.quote.code
            ? { ...current, ...data, minutes:current.minutes, bars:current.bars, intradaySessions:current.intradaySessions }
            : data);
          setMarketQuotes(current=>({...current,[data.quote.code]:data.quote}));
          setTrialError("");
        }
      } catch {
        if (!cancelled) setTrialError("1 秒报价暂时更新失败，已保留最后一次有效价格。");
      }
    };
    const stopPolling = startClientPolling({
      key: "trading-desk-quote",
      intervalMs: clientPollingInterval("activeQuote",marketDataActive),
      run: load,
      enabled: () => !cancelled && shouldRunTradingDeskPolling(activeView, document.visibilityState),
      runImmediately: false,
    });
    return () => { cancelled = true; stopPolling(); };
  }, [localAuth, activeView, stock?.code, marketDataActive]);
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

  const tShareFormalActions=(liveEngine.actions??[]) as ReplayAction[];
  const tShareObservationSignals=useMemo(()=>{
    const seen=new Set<string>();
    return [
      ...intradayMarkerLayout.observations.map(marker=>({
        time:marker.observation.time,
        price:marker.observation.coverageOnly&&Number.isFinite(marker.observation.pivotPrice)
          ? Number(marker.observation.pivotPrice)
          : Number(marker.observation.price),
        label:compactIntradayPrompt(marker.currentLabel,"候选观察"),
        isSell:marker.isSell,
        qualified:marker.qualified,
        reason:marker.observation.reason,
      })),
      ...intradayMarkerLayout.rabbitCandidates.map(marker=>({
        time:marker.time,
        price:Number(marker.price),
        label:compactIntradayPrompt(marker.label,"候选观察"),
        isSell:marker.isSell,
        qualified:false,
        reason:"",
      })),
    ].flatMap(signal=>{
      const minute=minutePoints.find(point=>point.time===signal.time);
      const price=Number.isFinite(signal.price)&&signal.price>0?signal.price:minute?.price;
      const key=`${signal.time}:${signal.isSell?"sell":"buy"}:${signal.label}`;
      if(!/^\d{4}$/.test(signal.time)||!Number.isFinite(price)||seen.has(key))return [];
      seen.add(key);
      return [{...signal,price:Number(price)}];
    });
  },[intradayMarkerLayout.observations,intradayMarkerLayout.rabbitCandidates,minutePoints]);
  const tShareHasClosedCycle=cycleStage==="closed"||tradeLedgerSummary.validCount>=2;
  const tShareTitle=tShareHasClosedCycle?"今日做T复盘":"今日观察";
  const tShareStatus=tShareHasClosedCycle
    ? "闭环完成"
    : cycleStage==="opened"
      ? "等待配对"
      : tShareFormalActions.length
        ? "正式信号已记录"
        : "暂无正式信号";
  const tSharePrice=Number(minutePoints.at(-1)?.price??activeQuote?.price);
  const tShareVwap=Number(chartModel?.lastVwap);
  const tShareVwapBias=Number.isFinite(tSharePrice)&&tSharePrice>0&&Number.isFinite(tShareVwap)&&tShareVwap>0
    ?(tSharePrice-tShareVwap)/tShareVwap*100
    :null;
  const tShareBuyObservations=tShareObservationSignals.filter(signal=>!signal.isSell).length;
  const tShareSellObservations=tShareObservationSignals.length-tShareBuyObservations;
  const tShareLatestFormal=tShareFormalActions.at(-1)??null;
  const tShareLatestObservation=[...tShareObservationSignals].sort((left,right)=>left.time.localeCompare(right.time)).at(-1)??null;
  const formatTShareTime=(time:string)=>/^\d{4}$/.test(time)?`${time.slice(0,2)}:${time.slice(2,4)}`:time;
  const tShareTechnicalLine=tShareVwapBias===null
    ? "技术结构：现价或 VWAP 数据不足，暂不判定分时位置。"
    : `技术结构：现价 ¥${tSharePrice.toFixed(2)}｜VWAP ¥${tShareVwap.toFixed(2)}｜偏离 ${tShareVwapBias>=0?"+":""}${tShareVwapBias.toFixed(2)}%`;
  const tShareLatestLine=tShareLatestFormal
    ? `最新确认：${formatTShareTime(tShareLatestFormal.time)} ${tShareLatestFormal.direction??"闭环"}${tShareLatestFormal.side}，¥${tShareLatestFormal.price.toFixed(2)}`
    : tShareLatestObservation
      ? `最新观察：${formatTShareTime(tShareLatestObservation.time)} ${tShareLatestObservation.label}，¥${tShareLatestObservation.price.toFixed(2)}`
      : "最新观察：今日暂无有效信号点。";
  const tShareEvidence=tShareLatestFormal?.reason||tShareLatestObservation?.reason||"候选尚未通过成本、趋势、量价与风控联合校验。";
  const tShareCopy=[
    `${activeQuote?.name||stock.name}（${stock.code}）· ${activeChartDate||"今日"}`,
    `${tShareTitle}｜${tShareStatus}`,
    tShareTechnicalLine,
    `信号分布：正T观察 ${tShareBuyObservations} 个｜反T观察 ${tShareSellObservations} 个｜正式动作 ${tShareFormalActions.length} 个`,
    tShareLatestLine,
    `${tShareLatestFormal?"确认依据":"复盘结论"}：${tShareEvidence}`,
    "仅作策略复盘，不构成投资建议；历史结果不代表未来表现。",
    "#做T复盘 #日内观察 #双兔助手",
  ].join("\n");
  const copyTShareText=async()=>{
    let copied=false;
    try{
      if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(tShareCopy);copied=true;}
    }catch{}
    if(!copied){
      const textarea=document.createElement("textarea");
      textarea.value=tShareCopy;
      textarea.setAttribute("readonly","");
      textarea.style.position="fixed";
      textarea.style.opacity="0";
      document.body.appendChild(textarea);
      textarea.select();
      try{copied=document.execCommand("copy");}catch{}
      textarea.remove();
    }
    setTShareMessage(copied?"分享文案已复制":"复制失败，请手动选择文案");
    return copied;
  };
  const downloadTShare=()=>{
    if(!tShareImage)return;
    const anchor=document.createElement("a");
    anchor.href=tShareImage;
    anchor.download=`${activeQuote?.name||stock.name}-${activeChartDate||"今日"}-做T复盘.png`;
    anchor.click();
    setTShareMessage("分享图已保存");
  };
  const generateTShareCard=async(qrEnabled=tShareQrEnabled)=>{
    setTShareBusy(true);
    setTShareMessage("");
    try{
      const canvas=document.createElement("canvas");
      canvas.width=1080;
      canvas.height=1440;
      const ctx=canvas.getContext("2d");
      if(!ctx)throw new Error("canvas unavailable");
      const wrapText=(text:string,x:number,y:number,maxWidth:number,lineHeight:number,maxLines=2)=>{
        let line="";
        let lineIndex=0;
        for(const char of text){
          const next=line+char;
          if(line&&ctx.measureText(next).width>maxWidth){
            ctx.fillText(line,x,y+lineIndex*lineHeight);
            line=char;
            lineIndex+=1;
            if(lineIndex>=maxLines)return;
          }else line=next;
        }
        if(lineIndex<maxLines)ctx.fillText(line,x,y+lineIndex*lineHeight);
      };
      const roundedRect=(x:number,y:number,width:number,height:number,radius:number)=>{
        const r=Math.min(radius,width/2,height/2);
        ctx.beginPath();
        ctx.moveTo(x+r,y);
        ctx.lineTo(x+width-r,y);ctx.quadraticCurveTo(x+width,y,x+width,y+r);
        ctx.lineTo(x+width,y+height-r);ctx.quadraticCurveTo(x+width,y+height,x+width-r,y+height);
        ctx.lineTo(x+r,y+height);ctx.quadraticCurveTo(x,y+height,x,y+height-r);
        ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);
        ctx.closePath();
      };
      const loadImage=(src:string)=>new Promise<HTMLImageElement>((resolve,reject)=>{
        const image=new window.Image();
        image.onload=()=>resolve(image);
        image.onerror=reject;
        image.src=src;
      });

      ctx.fillStyle="#07110f";
      ctx.fillRect(0,0,1080,1440);
      const glow=ctx.createRadialGradient(890,70,10,770,220,640);
      glow.addColorStop(0,"rgba(43,214,190,.18)");
      glow.addColorStop(1,"rgba(43,214,190,0)");
      ctx.fillStyle=glow;
      ctx.fillRect(0,0,1080,620);
      ctx.strokeStyle="rgba(211,178,103,.34)";
      ctx.lineWidth=2;
      ctx.strokeRect(42,42,996,1356);
      ctx.strokeStyle="rgba(211,178,103,.1)";
      ctx.strokeRect(58,58,964,1324);

      try{
        const logo=await loadImage(`${window.location.origin}/rabbit-logo-compact.png`);
        ctx.drawImage(logo,82,78,74,74);
      }catch{}
      ctx.fillStyle="#e8cf93";
      ctx.font='700 25px "Microsoft YaHei",sans-serif';
      ctx.fillText("双兔助手 · 做T神器",176,108);
      ctx.fillStyle="#668077";
      ctx.font='17px "Microsoft YaHei",sans-serif';
      ctx.fillText("RABBIT SMART-T · INTRADAY REVIEW",176,140);
      ctx.textAlign="right";
      ctx.fillStyle="#779087";
      ctx.font='20px "Microsoft YaHei",sans-serif';
      ctx.fillText(activeChartDate||"今日",988,110);
      ctx.textAlign="left";

      ctx.fillStyle="#f2f4ef";
      ctx.font='800 68px "Microsoft YaHei",sans-serif';
      ctx.fillText(tShareTitle,82,252);
      ctx.fillStyle="#9eb0aa";
      ctx.font='24px "Microsoft YaHei",sans-serif';
      ctx.fillText(`${activeQuote?.name||stock.name}  ${stock.code}`,84,302);
      ctx.fillStyle=tShareHasClosedCycle?"#28d7c4":tShareFormalActions.length?"#e5bd69":"#8b9994";
      ctx.font='700 24px "Microsoft YaHei",sans-serif';
      ctx.textAlign="right";
      ctx.fillText(tShareStatus,988,264);
      ctx.fillStyle="#667a73";
      ctx.font='17px "Microsoft YaHei",sans-serif';
      ctx.fillText(`${tShareFormalActions.length} 个正式动作 · ${tShareObservationSignals.length} 个观察信号`,988,297);
      ctx.textAlign="left";

      const chartLeft=84;
      const chartTop=356;
      const chartWidth=912;
      const chartHeight=430;
      ctx.fillStyle="rgba(255,255,255,.025)";
      ctx.fillRect(chartLeft,chartTop,chartWidth,chartHeight);
      ctx.strokeStyle="rgba(128,155,145,.2)";
      ctx.strokeRect(chartLeft,chartTop,chartWidth,chartHeight);
      ctx.setLineDash([5,9]);
      ctx.lineWidth=1;
      for(let index=1;index<4;index+=1){
        const y=chartTop+chartHeight*index/4;
        ctx.beginPath();ctx.moveTo(chartLeft,y);ctx.lineTo(chartLeft+chartWidth,y);ctx.stroke();
      }
      ctx.setLineDash([]);
      const prices=minutePoints.map(point=>Number(point.price)).filter(price=>Number.isFinite(price)&&price>0);
      const chartMin=prices.length?Math.min(...prices):0;
      const chartMax=prices.length?Math.max(...prices):1;
      const chartRange=Math.max(chartMax-chartMin,.01);
      const shareX=(time:string)=>chartLeft+(liveChartX(time)-LIVE_CHART.plotLeft)/(LIVE_CHART.plotRight-LIVE_CHART.plotLeft)*chartWidth;
      const shareY=(price:number)=>chartTop+34+(chartMax-price)/chartRange*(chartHeight-68);
      if(minutePoints.length>1){
        ctx.beginPath();
        minutePoints.forEach((point,index)=>{
          const x=shareX(point.time);
          const y=shareY(point.price);
          if(index===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
        });
        ctx.strokeStyle="#f3f4ee";
        ctx.lineWidth=4;
        ctx.lineJoin="round";
        ctx.lineCap="round";
        ctx.stroke();
      }
      ctx.fillStyle="#698078";
      ctx.font='16px "Microsoft YaHei",sans-serif';
      ctx.fillText(chartMax?`¥${chartMax.toFixed(2)}`:"--",chartLeft+12,chartTop+27);
      ctx.fillText(chartMin?`¥${chartMin.toFixed(2)}`:"--",chartLeft+12,chartTop+chartHeight-12);
      ctx.textAlign="right";
      ctx.fillText("09:30",chartLeft+52,chartTop+chartHeight-12);
      ctx.fillText("15:00",chartLeft+chartWidth-14,chartTop+chartHeight-12);
      ctx.textAlign="left";

      ctx.fillStyle="rgba(7,17,15,.82)";
      roundedRect(chartLeft+chartWidth-338,chartTop+14,320,34,8);
      ctx.fill();
      ctx.font='600 14px "Microsoft YaHei",sans-serif';
      ctx.beginPath();ctx.arc(chartLeft+chartWidth-318,chartTop+31,5,0,Math.PI*2);ctx.strokeStyle="#43dbc8";ctx.lineWidth=2;ctx.stroke();
      ctx.fillStyle="#91a39d";ctx.fillText("观察点",chartLeft+chartWidth-304,chartTop+36);
      ctx.beginPath();ctx.arc(chartLeft+chartWidth-226,chartTop+31,6,0,Math.PI*2);ctx.fillStyle="#2bd6be";ctx.fill();
      ctx.fillStyle="#91a39d";ctx.fillText("正式买",chartLeft+chartWidth-214,chartTop+36);
      ctx.beginPath();ctx.arc(chartLeft+chartWidth-132,chartTop+31,6,0,Math.PI*2);ctx.fillStyle="#ff6661";ctx.fill();
      ctx.fillStyle="#91a39d";ctx.fillText("正式卖",chartLeft+chartWidth-120,chartTop+36);

      const candidateLabelBoxes:{left:number;right:number;top:number;bottom:number}[]=[];
      tShareObservationSignals.forEach(signal=>{
        const x=shareX(signal.time);
        const y=shareY(signal.price);
        const tone=signal.isSell?"#ff807b":"#43dbc8";
        ctx.beginPath();ctx.arc(x,y,signal.qualified?6:5,0,Math.PI*2);
        ctx.fillStyle="#07110f";ctx.fill();ctx.strokeStyle=tone;ctx.lineWidth=signal.qualified?2.5:1.8;ctx.stroke();

        ctx.font='700 13px "Microsoft YaHei",sans-serif';
        const labelWidth=Math.max(58,ctx.measureText(signal.label).width+16);
        const offsets=signal.isSell?[-34,-56,28,50]:[28,50,-34,-56];
        const horizontalOffsets=[0,-34,34,-68,68];
        let placement:{x:number;y:number}|null=null;
        for(const yOffset of offsets){
          for(const xOffset of horizontalOffsets){
            const labelX=Math.max(chartLeft+labelWidth/2+8,Math.min(chartLeft+chartWidth-labelWidth/2-8,x+xOffset));
            const labelY=Math.max(chartTop+58,Math.min(chartTop+chartHeight-28,y+yOffset));
            const box={left:labelX-labelWidth/2,right:labelX+labelWidth/2,top:labelY-15,bottom:labelY+7};
            if(candidateLabelBoxes.some(other=>box.left<other.right+4&&box.right>other.left-4&&box.top<other.bottom+4&&box.bottom>other.top-4))continue;
            candidateLabelBoxes.push(box);placement={x:labelX,y:labelY};break;
          }
          if(placement)break;
        }
        if(!placement)return;
        ctx.beginPath();ctx.moveTo(x,y+(signal.isSell?-7:7));ctx.lineTo(placement.x,placement.y+(placement.y<y?8:-18));
        ctx.strokeStyle=signal.isSell?"rgba(255,128,123,.45)":"rgba(67,219,200,.42)";ctx.lineWidth=1;ctx.stroke();
        roundedRect(placement.x-labelWidth/2,placement.y-15,labelWidth,22,6);
        ctx.fillStyle="rgba(9,27,23,.94)";ctx.fill();ctx.strokeStyle=signal.isSell?"rgba(255,128,123,.5)":"rgba(67,219,200,.46)";ctx.stroke();
        ctx.fillStyle=tone;ctx.textAlign="center";ctx.fillText(signal.label,placement.x,placement.y+1);ctx.textAlign="left";
      });

      tShareFormalActions.forEach((action,index)=>{
        const x=shareX(action.time);
        const y=shareY(action.price);
        const sell=action.side==="卖出";
        const labelY=sell?Math.max(chartTop+28,y-58):Math.min(chartTop+chartHeight-32,y+58);
        ctx.setLineDash([8,8]);
        ctx.strokeStyle=sell?"rgba(255,102,97,.78)":"rgba(43,214,190,.78)";
        ctx.lineWidth=2;
        ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,labelY);ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);
        ctx.fillStyle=sell?"#ff6661":"#2bd6be";
        ctx.fill();
        ctx.fillStyle="#07110f";
        ctx.font='800 14px "Microsoft YaHei",sans-serif';
        ctx.textAlign="center";
        ctx.fillText(sell?"卖":"买",x,y+5);
        ctx.fillStyle=sell?"#ff8d89":"#69e6d5";
        ctx.font='700 16px "Microsoft YaHei",sans-serif';
        ctx.fillText(`${action.time.slice(0,2)}:${action.time.slice(2,4)} ¥${action.price.toFixed(2)}`,Math.max(chartLeft+82,Math.min(chartLeft+chartWidth-82,x)),labelY+(sell?-8:20));
        ctx.textAlign="left";
        void index;
      });

      ctx.fillStyle="#789087";
      ctx.font='18px "Microsoft YaHei",sans-serif';
      ctx.fillText(tShareFormalActions.length?"正式信号解释":"今日信号摘要",84,850);
      const explanations=tShareFormalActions.length?tShareFormalActions.slice(-4):[];
      if(explanations.length){
        explanations.forEach((action,index)=>{
          const y=900+index*72;
          const sell=action.side==="卖出";
          ctx.fillStyle=sell?"#ff7772":"#43dbc8";
          ctx.font='700 21px "Microsoft YaHei",sans-serif';
          ctx.fillText(`${action.side} · ${action.time.slice(0,2)}:${action.time.slice(2,4)} · ¥${action.price.toFixed(2)}`,84,y);
          ctx.fillStyle="#91a39d";
          ctx.font='17px "Microsoft YaHei",sans-serif';
          wrapText(action.reason||"正式闭环过滤已通过，等待人工核对价格与仓位。",84,y+30,740,26,1);
        });
      }else{
        ctx.fillStyle="#a4b1ac";
        ctx.font='24px "Microsoft YaHei",sans-serif';
        ctx.fillText(`今日 ${tShareObservationSignals.length} 个观察信号，尚未形成正式买卖点`,84,914);
        ctx.fillStyle="#6f817a";
        ctx.font='18px "Microsoft YaHei",sans-serif';
        ctx.fillText("候选提示仅用于观察，不作为本卡片的正式成交记录。",84,950);
      }

      const statusTop=1190;
      ctx.strokeStyle="rgba(128,155,145,.2)";
      ctx.beginPath();ctx.moveTo(84,statusTop-34);ctx.lineTo(996,statusTop-34);ctx.stroke();
      const statusItems=[
        ["闭环状态",tShareStatus],
        ["策略状态",`闭环策略 · ${profile}`],
        ["数据状态",`${minutePoints.length} 分钟点${isZijinStock?` · ${l2ConsoleStatus.label}`:""}`],
      ];
      statusItems.forEach(([label,value],index)=>{
        const y=statusTop+index*46;
        ctx.fillStyle="#60756d";ctx.font='17px "Microsoft YaHei",sans-serif';ctx.fillText(label,84,y);
        ctx.fillStyle="#d8dfda";ctx.font='700 19px "Microsoft YaHei",sans-serif';ctx.fillText(value,196,y);
      });

      if(qrEnabled){
        try{
          const {default:QRCode}=await import("qrcode/lib/browser.js");
          const qrSource=await QRCode.toDataURL(window.location.origin,{width:320,margin:2,errorCorrectionLevel:"H",color:{dark:"#10231d",light:"#f4f2e9"}});
          const qrImage=await loadImage(qrSource);
          ctx.fillStyle="#f4f2e9";ctx.fillRect(820,1190,150,150);ctx.drawImage(qrImage,830,1200,130,130);
          ctx.fillStyle="#70857d";ctx.font='15px "Microsoft YaHei",sans-serif';ctx.textAlign="center";ctx.fillText("扫码查看双兔助手",895,1361);ctx.textAlign="left";
        }catch{}
      }
      ctx.fillStyle="#5f746c";
      ctx.font='16px "Microsoft YaHei",sans-serif';
      ctx.fillText("策略研究记录，不构成投资建议；历史结果不代表未来表现。",84,1364);
      setTShareImage(canvas.toDataURL("image/png"));
    }catch{
      setTShareMessage("分享图生成失败，请刷新后重试");
    }finally{
      setTShareBusy(false);
    }
  };
  const openTShare=()=>{
    setTShareOpen(true);
    void generateTShareCard(tShareQrEnabled);
  };
  const systemTShare=async()=>{
    if(!tShareImage)return;
    try{
      const blob=await (await window.fetch(tShareImage)).blob();
      const file=new File([blob],`${activeQuote?.name||stock.name}-做T复盘.png`,{type:"image/png"});
      if(navigator.share&&navigator.canShare?.({files:[file]})){
        await navigator.share({title:`${activeQuote?.name||stock.name} ${tShareTitle}`,text:tShareCopy,files:[file]});
        setTShareMessage("已打开系统分享面板");
      }else{
        downloadTShare();
        await copyTShareText();
        setTShareMessage("浏览器不支持图片直分享，已保存图片并复制文案");
      }
    }catch(error){
      if((error as Error).name!=="AbortError")setTShareMessage("分享未完成，可先保存图片并复制文案");
    }
  };

  const handleCycleAction=()=>{
    if(cycleStage==="ready"){
      if(decisionModel.status!=="ready"||!decisionActionSide||!latestFormalActionMarked)return;
      setOpenedCycleSide(decisionActionSide);
      setCycleStage("opened");
      return;
    }
    if(cycleStage==="opened"){
      if(!openedCycleSide||!decisionActionSide||decisionActionSide===openedCycleSide)return;
      setOpenedCycleSide(null);
      setCycleStage("closed");
      return;
    }
    setOpenedCycleSide(null);
    setCycleStage("ready");
  };
  const primaryActionDisabled=
    !stockAgent.canExecute||cycleLimitReached||cycleQuantity<100||
    (cycleStage==="ready"&&(decisionModel.status!=="ready"||!decisionActionSide||!latestFormalActionMarked))||
    (cycleStage==="opened"&&!decisionMatchesCycle);

  const membershipExpiry=accountMembership?.expiresAt?new Date(accountMembership.expiresAt).toLocaleDateString('zh-CN',{year:'numeric',month:'short',day:'numeric'}):'--';
  const copyReferralLink=async()=>{
    const code=accountMembership?.referralCode;
    if(!code)return;
    const link=`${window.location.origin}/?ref=${encodeURIComponent(code)}`;
    try{await navigator.clipboard?.writeText(link);setInviteMessage('邀请链接已复制');}
    catch{setInviteMessage(`邀请码：${code}`);}
    window.setTimeout(()=>setInviteMessage(''),2600);
  };
  if(!authReady) return <main className="auth-loading"><Image src="/rabbit-logo-compact.png" alt="双兔助手 做T神器" width={48} height={48} priority/></main>;
  if(!localAuth){
    const enterDemo=()=>{setDemoMode(true);setAccountName('演示访客');setStockPositions({});setPreferences(DEFAULT_PREFERENCES);setProfile(DEFAULT_PREFERENCES.strategyProfile);setHasPersistedPreferences(false);const prepared=prepareWatchlistForCurrentEntry(initialStocks);setStockList(prepared);setActiveStock(isZijinExperimentDeepLink()?prepared.findIndex(item=>item.code==='601899'):0);setActiveView(isZijinExperimentDeepLink()?'单股智研':'首页');setLocalAuth(true)};
    if(authScreen==='landing')return <PublicLanding onDemo={enterDemo} onAccount={()=>setAuthScreen('account')} theme={uiTheme} onToggleTheme={toggleUiTheme}/>;
    return <AuthView theme={uiTheme} onToggleTheme={toggleUiTheme} onBack={()=>setAuthScreen('landing')} onDemo={enterDemo} onAuthenticated={(name,isNew,remember,membership)=>{setDemoMode(false);setAccountName(name);setAccountRole(localStorage.getItem('rabbit-account-role')||'member');setAccountMembership(membership);remoteSyncReady.current=false;setStockPositions({});setPreferences(DEFAULT_PREFERENCES);setProfile(DEFAULT_PREFERENCES.strategyProfile);setHasPersistedPreferences(false);const prepared=prepareWatchlistForCurrentEntry(initialStocks);setStockList(prepared);setActiveStock(isZijinExperimentDeepLink()?prepared.findIndex(item=>item.code==='601899'):0);setActiveView(isZijinExperimentDeepLink()?'单股智研':'首页');setLocalAuth(true);try{const persistent=isNew||remember;(persistent?localStorage:sessionStorage).setItem('rabbit-auth-session',name);(persistent?sessionStorage:localStorage).removeItem('rabbit-auth-session');const saved=localStorage.getItem(`rabbit-prefs:${name.toLowerCase()}`);if(saved){const restored=normalizeAccountPreferences(JSON.parse(saved));setPreferences(restored);setProfile(restored.strategyProfile);setHasPersistedPreferences(true)}else setOnboardingOpen(true);const watchlist=localStorage.getItem(`rabbit-watchlist:${name.toLowerCase()}`);if(watchlist){const list=JSON.parse(watchlist);if(Array.isArray(list)&&list.length){const normalized=prepareWatchlistForCurrentEntry(list);setStockList(normalized);localStorage.setItem(`rabbit-watchlist:${name.toLowerCase()}`,JSON.stringify(normalized));}}const savedStrategy=localStorage.getItem(`rabbit-custom-strategy:${name.toLowerCase()}`)||localStorage.getItem('rabbit-custom-strategy');if(savedStrategy)setCustomStrategy(savedStrategy)}catch{} if(isNew)setOnboardingOpen(true)}}/>;
  }

  return (
    <main className={`app-shell minimal-ui session-${marketSession.tone}`}>
      <header className="topbar">
        <div className="brand brand-lockup" aria-label="双兔助手 做T神器 Rabbit Smart-T">
          <Image className="brand-primary-logo" src="/double-rabbit-assistant-brand.png" alt="双兔助手双兔无限线品牌标志" width={280} height={72} priority/>
          <span className="brand-type brand-type-fallback"><strong aria-hidden="true"><span>双兔助手</span></strong><small>做<span className="brand-ascii-t">T</span>神器 · SMART-T</small></span>
        </div>
        <nav className="main-nav" aria-label="主导航">
          {['首页','操盘台','单股智研','AI量化研究院','量化工具','模拟回测','邀请中心'].map((item) => {
            const groupedToolViews=['量化工具','多股监控','策略市场','持仓对账','智能训练'];
            const active=item==='量化工具' ? groupedToolViews.includes(activeView) : activeView===item;
            return <button onClick={() => setActiveView(item)} className={active ? 'active' : ''} key={item}>{item}</button>;
          })}
          <button onClick={()=>window.location.assign('/fortune')}>股票占卜</button>
        </nav>
        <div className="top-actions">
          <span className={`market-open ${marketSession.tone}`} title={`${marketSession.label}：${marketSession.detail}；法定节假日以交易所公告为准`} aria-label={`${marketSession.label}：${marketSession.detail}`}><i /><span className="market-open-label">{marketSession.live?"监控中":marketSession.label}</span></span>
          <span className={`auto-off ${marketSession.live?"running":"paused"}`}><i />{marketSession.live?"自动判断运行中":"自动判断已暂停"} · 下单未连接</span>
          <span className="clock">{currentTrial ? new Date(currentTrial.sourceTimestamp || currentTrial.fetchedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : currentMarket ? new Date(currentMarket.fetchedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "--:--"}</span>
          <button className="profile-cycle" onClick={()=>setStrategyOpen(true)} aria-label={`内置闭环当前使用${profile}，点击查看策略档位`} title="操盘台与模拟回测共用此档位"><span>闭环 · {profile.replace('档','')}</span><i>⌄</i></button>
          <button className="strategy-help" onClick={()=>setStrategyOpen(true)}>策略说明</button>
          <button className="account-button" onClick={()=>setAccountOpen(true)} aria-label="打开账户中心"><span>{accountName.slice(0,1).toUpperCase()}</span><b>{accountName}</b><i>⌄</i></button>
          <button className="icon-button theme-toggle" type="button" onClick={toggleUiTheme} aria-label={uiTheme==='dark'?'切换到白天模式':'切换到黑夜模式'} title={uiTheme==='dark'?'白天模式':'黑夜模式'}><span aria-hidden="true">{uiTheme==='dark'?'☀':'☾'}</span></button>
          <button className="icon-button" onClick={()=>setOnboardingOpen(true)} aria-label="打开账户与监控设置" title="账户与监控设置">⚙</button>
        </div>
      </header>
      {demoMode&&<div className="demo-ribbon" role="status"><b>免注册演示</b><span>当前为本机临时体验，不代表正式账户；下单接口关闭，演示操作不会同步到其他设备。</span><button onClick={()=>{setDemoMode(false);setLocalAuth(false);setAuthScreen('account');onLogout?.()}}>创建测试账户</button></div>}

      {activeView === "首页" ? <HomeView onNavigate={setActiveView} onOpenZijin={openZijinExperiment} stockCount={stockList.length} canInvite={!demoMode&&accountRole!=='admin'&&Boolean(accountMembership?.referralCode)} referralCredits={accountMembership?.referralCredits??0} onCopyInvite={()=>void copyReferralLink()} inviteMessage={inviteMessage} /> : activeView === "邀请中心" ? <ReferralCenter canInvite={!demoMode&&accountRole!=='admin'&&Boolean(accountMembership?.referralCode)} demoMode={demoMode} referralCode={accountMembership?.referralCode??null} referralCredits={accountMembership?.referralCredits??0} referralReviews={accountMembership?.referralReviews??0} onCopyInvite={()=>void copyReferralLink()} inviteMessage={inviteMessage} onOpenAccount={()=>setAccountOpen(true)} /> : activeView === "量化工具" ? <QuantToolsView onNavigate={setActiveView} /> : activeView === "操盘台" ? <>
      <section className="ticker" aria-label="股票监控列表">
        {stockList.map((item, index) => (
          <div
            className={`ticker-item ${activeStock === index ? 'selected' : ''} ${draggedStockCode===item.code?'dragging':''} ${dragOverStockCode===item.code&&draggedStockCode!==item.code?'drag-over':''}`}
            key={item.code}
            onDragEnter={()=>setDragOverStockCode(item.code)}
            onDragLeave={(event)=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setDragOverStockCode(current=>current===item.code?null:current)}}
            onDragOver={(event)=>{event.preventDefault();event.dataTransfer.dropEffect='move'}}
            onDrop={(event)=>dropStock(event,item.code)}
          >{(()=>{
            const quote=item.code===stock?.code?(activeQuote??marketQuotes[item.code]):marketQuotes[item.code];
            const radar=eventsByCode[item.code];
            const quotePrice=Number(quote?.price);
            const quoteAvailable=Number.isFinite(quotePrice)&&quotePrice>0;
            const displayedPrice=quoteAvailable?quotePrice.toFixed(2):item.price;
            const change=quoteAvailable&&Number.isFinite(quote?.changePercent)
              ? `${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%`
              : displayedPrice==="--"?"--":item.change;
            const eventTag=radar?.counts.negative?<small className="ticker-event negative">利空 {radar.counts.negative}</small>
              :radar?.counts.positive?<small className="ticker-event positive">利好 {radar.counts.positive}</small>
              :radar?<small className="ticker-event quiet">暂无新增</small>
              :eventRadarError?<small className="ticker-event pending">雷达待更新</small>
              :<small className="ticker-event pending" title="资讯雷达尚未返回结果，不代表没有新闻或买卖信号">{marketSession.live?"资讯扫描中":"资讯待更新"}</small>;
            return <><span className="ticker-drag-handle" draggable onDragStart={(event)=>startStockDrag(event,item.code)} onDragEnd={finishStockDrag} title="按住手柄拖动排序" aria-label={`拖动${item.name}调整顺序`}>⋮⋮</span><button className="ticker-stock-button" onClick={() => selectActiveStock(index)} aria-pressed={activeStock===index}><span>{item.code} {quote?.name || item.name}</span><b>{displayedPrice}</b><em className={change.startsWith('-') ? 'down' : ''}>{change}</em>{eventTag}</button><span className="ticker-order-controls"><button className="ticker-order-button" onClick={()=>moveStock(index,index-1)} disabled={index===0} aria-label={`${item.name}左移`}>‹</button><button className="ticker-order-button" onClick={()=>moveStock(index,index+1)} disabled={index===stockList.length-1} aria-label={`${item.name}右移`}>›</button></span><button className="ticker-remove" onClick={()=>removeStock(index)} disabled={stockList.length<=1} aria-label={`删除${item.name}`}>×</button></>;
          })()}</div>
        ))}
        <div className={`session-inline ${marketSession.tone}`} role="status" aria-live="polite" title={marketSession.detail}>
          <i/><b>{marketSession.live ? "实时监控" : marketSession.label}</b><span>{marketSession.live ? marketSession.detail : marketSession.tone === "closed" ? "复盘模式" : marketSession.tone === "postclose" ? "盘后模式" : marketSession.tone === "paused" ? "午间休市" : "盘前准备"}</span>
        </div>
        <button className="ticker-add" onClick={()=>setOnboardingOpen(true)}>＋ 管理监控 · {stockList.length}/{monitorLimit}</button>
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
        <div className="quote-focus">
          <div className={`quote ${activeQuote?.changePercent != null && activeQuote.changePercent < 0 ? "down" : activeQuote?.changePercent === 0 ? "flat" : ""}`}><strong>{activeQuote?.price?.toFixed(2) ?? "--"}</strong><span>{activeQuote?.changePercent == null ? "--" : `${activeQuote.changePercent >= 0 ? "+" : ""}${activeQuote.changePercent.toFixed(2)}%`}</span></div>
          <div className="opening-assessment"><span>开盘结构</span><b>{openingAssessment.auction}</b><small>{openingAssessment.gapText} · {decisionConditionsConfirmed}/4 条件确认</small></div>
        </div>
        <div className="quote-metrics">
          <span>今开 <b>{activeQuote?.open?.toFixed(2) ?? "--"}</b></span><span>最高 <b>{activeQuote?.high?.toFixed(2) ?? "--"}</b></span><span>最低 <b>{activeQuote?.low?.toFixed(2) ?? "--"}</b></span><span>数据 <b className="teal">{isZijinStock&&liveL2PriceUsable ? "L2 主源" : currentTrial ? "1 秒试用" : currentMarket ? "公开兜底" : "切换中"}</b></span><span>分钟线 <b className="teal">{minutePoints.length ? isZijinStock ? `${minutePoints.length} 点 · 盘口 ${l2CalculationCoverage} · 资金 ${zijinMainForceTrack.bars.length}` : `${minutePoints.length} 点同步` : "等待数据"}</b></span>{afterHoursSummary&&<span>盘后 <b className="amber">{afterHoursSummary.price.toFixed(2)}</b></span>}
        </div>
        <div className={`next-session-header ${!nextSessionOutlook.ready?"pending":nextSessionOutlook.direction==="偏强"?"up":nextSessionOutlook.direction==="偏弱"?"down":"flat"}`} role="status" aria-label="下一交易日预判" title={nextSessionOutlook.ready?`${nextSessionOutlook.stage}：${nextSessionOutlook.failure}`:nextSessionOutlook.detail}>
          <span>明日预判</span>
          <b>{nextSessionOutlook.ready?nextSessionOutlook.direction:"待定"}<small>{nextSessionOutlook.ready?` · ${nextSessionOutlook.confidenceText}`:""}</small></b>
          <em>{nextSessionOutlook.ready?`¥${nextSessionOutlook.lower.toFixed(2)}–${nextSessionOutlook.upper.toFixed(2)}`:"收盘后生成"}</em>
        </div>
        <div className={`l2-console-status data-health-status ${web4Monitor.status} ${l2ConsoleStatus.tone}`} role="status" title={`${l2ConsoleStatus.detail} · ${web4Monitor.summary}`}>
          <i/><div><span>{web4Monitor.status==="degraded"?"数据降级":web4Monitor.status==="conflict"||web4Monitor.status==="risk"?"数据风险":"数据健康"}</span><b>{web4Monitor.confidence}<small>/100</small></b></div><em>{l2ConsoleStatus.label}</em>
        </div>
      </section>

      <section className="desk-core-strip" aria-label="做T核心指标">
        <div><span>持仓 / 可卖</span><b>{displayedShares.toLocaleString()}<small> / {effectiveLivePosition.sellable.toLocaleString()} 股</small></b></div>
        <div><span>本次做T</span><b>{cycleQuantity.toLocaleString()}<small> 股</small></b></div>
        <div><span>信号置信度</span><b className={decisionModel.status==="ready"?"ready":decisionModel.status==="locked"?"risk":""}>{decisionModel.confirmed}/4</b></div>
        <div className="desk-core-reason"><span>当前依据</span><b>{marketSession.live?decisionModel.reason:"复盘模式"}</b></div>
      </section>

      <section className={`workspace ${isZijinStock?'with-main-force':''} ${workspaceFullscreen?'workspace-fullscreen':''} ${decisionZoneMode==="focus"?"decision-focus":"decision-all"} ${signalLayerVisible?'':'hide-signal-layer'} ${pricePlanLayerVisible?'':'hide-price-plan-layer'} ${volumeLayerVisible?'':'hide-volume-layer'} ${rabbitTrackerVisible?'':'hide-rabbit-tracker'}`} ref={workspaceRef}>
        <div className="chart-zone">
          <div className="chart-tools">
            <div className="legend primary-chart-legend">
              <span className="latest-price-legend"><i className="coral-line"/>最新价 <b>{activeQuote?.price?.toFixed(2) ?? "--"}</b></span>
              {indicatorsVisible&&<span><i className="average-line"/>均价 <b>{chartModel?.lastVwap?.toFixed(2) ?? "--"}</b></span>}
              <details className="auxiliary-indicators">
                <summary>辅助指标</summary>
                <div>
                  {indicatorsVisible&&<span className={`bias-legend ${(chartModel?.latestBias??0)>=0?"up":"down"}`} title="BIAS：当前价格相对均价的偏离幅度"><i/>BIAS {(chartModel?.latestBias??0)>=0?"+":""}{(chartModel?.latestBias??0).toFixed(2)}%</span>}
                  {stock?.code==="601899"&&<span className={`hk-linkage-legend ${zijinAhLinkage.bias}`} title={zijinAhLinkage.reason}><i/>港股紫金 <b>{zijinAhLinkage.available?`${zijinAhLinkage.hkReturnPercent!>=0?"+":""}${zijinAhLinkage.hkReturnPercent!.toFixed(2)}%`:"--"}</b></span>}
                </div>
              </details>
            </div>
            <span className={`live-scan ${marketSession.live?"":"paused"}`} title={marketSession.live?(currentTrial?"1 秒轮询试用 · 实时行情源":trialError||(currentMarket?`公开行情 · ${currentMarket.delayed?"延迟数据":"已更新"}`:marketError||"连接行情中")):"当前为收盘复盘模式"}><i/>{marketSession.live?(currentTrial?"实时行情":currentMarket?currentMarket.delayed?"行情延迟":"行情已更新":"连接行情"):"复盘模式"}</span>
            <div className="intraday-only" title="操盘台当前仅使用当日 1 分钟分时数据">
              <i/>当日分时 <small>1分钟</small>
            </div>
             <div className="layer-switches" aria-label="图表图层开关"><button title="显示或隐藏均价与偏离指标" className={indicatorsVisible?"active":""} onClick={()=>setIndicatorsVisible(value=>!value)}>均价</button><button title="显示或隐藏中文信号提示" className={signalLayerVisible?"active":""} onClick={()=>setSignalLayerVisible(value=>!value)}>信号</button><button title="显示或隐藏正T、反T区间" className={pricePlanLayerVisible?"active":""} onClick={()=>setPricePlanLayerVisible(value=>!value)}>区间</button><button title="显示或隐藏成交量" className={volumeLayerVisible?"active":""} onClick={()=>setVolumeLayerVisible(value=>!value)}>量</button><button title="显示或隐藏跟线兔兔与背景水印" className={rabbitTrackerVisible?"active":""} onClick={()=>setRabbitTrackerVisible(value=>!value)}>小兔</button><button title="一键隐藏均价、信号、区间和成交量辅助层" className={!indicatorsVisible&&!signalLayerVisible&&!pricePlanLayerVisible&&!volumeLayerVisible?"active minimal-layer-toggle":"minimal-layer-toggle"} onClick={()=>{const restore=!indicatorsVisible&&!signalLayerVisible&&!pricePlanLayerVisible&&!volumeLayerVisible;setIndicatorsVisible(restore);setSignalLayerVisible(restore);setPricePlanLayerVisible(restore);setVolumeLayerVisible(restore)}}>简洁</button></div><button className="tool-button t-share-trigger" onClick={openTShare} title="生成不含账户隐私的今日信号与做T记录">分享今日记录</button><button className="tool-button" onClick={()=>void toggleWorkspaceFullscreen()} aria-pressed={workspaceFullscreen}>{workspaceFullscreen?"退出":"全屏"}</button>
          </div>
          <div className="chart-wrap">
            {uiTheme==="light"&&<div className="rabbit-chart-caption" aria-hidden="true">
              <span className="rabbit-chart-avatar"/>
              <div><b>兔兔分时花园</b><small>价格 · 均价 · 成交量</small></div>
            </div>}
            <div className={`intraday-hud ${chartHud.tone}`} aria-live="polite">
              <span>实时盯盘</span><b>{chartHud.title}</b><small>{chartHud.detail} · {chartHud.risk}</small>
              {zijinChartPriceOverlay?.hiddenCount>0&&<button onClick={()=>setShowAllPriceLevels(value=>!value)}>{showAllPriceLevels?"只看最近2条":`展开全部 +${zijinChartPriceOverlay.hiddenCount}`}</button>}
            </div>
            <svg ref={intradayChartRef} className="interactive-intraday-chart" viewBox={`0 0 ${LIVE_CHART.width} ${LIVE_CHART.height}`} preserveAspectRatio="none" role="img" aria-label={`${activeQuote?.name || stock.name}当日分时图；移动鼠标或拖动手指查看分钟详情`} tabIndex={0}
              onPointerEnter={handleIntradayPointer} onPointerMove={handleIntradayPointer} onPointerDown={handleIntradayPointerDown}
              onPointerLeave={event=>{if(event.pointerType==="mouse")setIntradayCursorTime(null)}} onKeyDown={handleIntradayKeyDown}>
              <defs><linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff655f" stopOpacity=".18"/><stop offset="1" stopColor="#ff655f" stopOpacity="0"/></linearGradient></defs>
              {(chartModel?.ticks??[20,72.5,125,177.5,230].map(y=>({value:null,percent:null,y}))).map((tick,index)=>{const centre=tick.percent!=null&&Math.abs(tick.percent)<1e-8;return <g key={tick.value??index}><line x1={LIVE_CHART.plotLeft} y1={tick.y} x2={LIVE_CHART.plotRight} y2={tick.y} className={`grid-line ${centre?"previous-close-line":""}`}/>{tick.value!=null&&<text x="5" y={tick.y+3.5} className="intraday-axis-label">{tick.value.toFixed(2)}</text>}{tick.percent!=null&&<text x="914" y={tick.y+3.5} textAnchor="end" className={`intraday-percent-label ${tick.percent>0?"up":tick.percent<0?"down":"flat"}`}>{tick.percent>0?"+":""}{tick.percent.toFixed(2)}%</text>}</g>})}
              {A_SHARE_INTRADAY_AXIS.map(tick => {const x=liveChartSlotX(tick.slot);return <g key={tick.label}><line x1={x} y1={LIVE_CHART.priceTop} x2={x} y2={LIVE_CHART.volumeBottom} className="grid-line vertical"/><text x={x} y="317" textAnchor={tick.slot===0?"start":tick.slot===240?"end":"middle"} className="intraday-axis-label intraday-time-label">{tick.label}</text></g>})}
              {zijinChartPriceOverlay&&<g className="zijin-chart-price-overlay" aria-label="紫金矿业实时预判区间与风控线；悬停显示具体价格">
                {zijinChartPriceOverlay.bands.map(band=><g key={band.kind} className={`price-plan-band ${band.kind}`}><rect x={LIVE_CHART.plotLeft} y={band.top} width={LIVE_CHART.plotRight-LIVE_CHART.plotLeft} height={band.height}/><text x={LIVE_CHART.plotLeft+5} y={Math.max(LIVE_CHART.priceTop+9,band.top+9)}>{band.label}</text></g>)}
                {zijinChartPriceOverlay.lines.map(line=><g key={`${line.kind}-${line.price}`} className={`price-plan-line ${line.kind}`}><line x1={showAllPriceLevels?LIVE_CHART.plotLeft:LIVE_CHART.plotRight-145} y1={line.y} x2={LIVE_CHART.plotRight} y2={line.y}/><text x={LIVE_CHART.plotRight-4} y={Math.max(LIVE_CHART.priceTop+8,Math.min(LIVE_CHART.priceBottom-3,line.y-3))} textAnchor="end">{line.label} {line.price.toFixed(2)}</text></g>)}
              </g>}
              {chartModel&&<>{uiTheme==="light"&&chartModel.lastX<LIVE_CHART.plotRight-4&&<line className="future-session-boundary" x1={chartModel.lastX+4} y1={LIVE_CHART.priceTop} x2={chartModel.lastX+4} y2={LIVE_CHART.volumeBottom}/>}<path d={`${chartModel.path} L${chartModel.lastX} 252 L${chartModel.firstX} 252 Z`} fill="url(#priceFill)" />
              {indicatorsVisible&&<path d={chartModel.vwapPath} className="vwap-path"/>}{zijinHkOverlay&&<path d={zijinHkOverlay.path} className={`hk-zijin-path ${zijinAhLinkage.bias}`}/>}<path d={chartModel.path} className="price-path"/>
              {indicatorsVisible&&chartModel.recentVwapCross&&<g className={`vwap-cross-marker ${chartModel.recentVwapCross.direction}`}><circle cx={chartModel.recentVwapCross.x} cy={chartModel.recentVwapCross.y} r="5"/><text x={chartModel.recentVwapCross.x+8} y={chartModel.recentVwapCross.y-7}>{chartModel.recentVwapCross.direction==="up"?"站上均价":"跌破均价"}</text></g>}
              {chartModel.closingAuctionJump&&<g className="closing-auction-marker"><circle cx={chartModel.closingAuctionJump.x} cy={chartModel.closingAuctionJump.y} r="5"/><text x={chartModel.closingAuctionJump.x-8} y={chartModel.closingAuctionJump.y-8} textAnchor="end">收盘竞价 {chartModel.closingAuctionJump.movePct>=0?"+":""}{chartModel.closingAuctionJump.movePct.toFixed(2)}%</text></g>}
              {intradayMarkerLayout.observations.map(marker=><g key={`candidate-${marker.observation.time}-${marker.index}`} className={`candidate-signal-marker ${marker.qualified?marker.sideClass:"watch"} ${marker.assessment} ${marker.labelRendered?"with-label":"dot-only"}`}><title>{`${marker.observation.time.slice(0,2)}:${marker.observation.time.slice(2,4)} · ${marker.currentLabel}`}</title>{marker.labelVisible&&marker.labelRendered&&<><line x1={marker.x} y1={marker.y} x2={marker.labelX} y2={marker.labelY<marker.y?marker.labelY+5:marker.labelY-12} className="marker-label-leader"/><rect x={marker.labelX-marker.labelWidth/2} y={marker.labelY-11} width={marker.labelWidth} height="16" rx={uiTheme==="light"?7:4}/><text x={marker.labelX} y={marker.labelY} textAnchor="middle">{marker.currentLabel}</text></>}<circle cx={marker.x} cy={marker.y} r={marker.labelRendered?4:3}/></g>)}
              {intradayMarkerLayout.rabbitCandidates.map(marker=><g key={marker.key} className={`candidate-signal-marker rabbit-candidate-marker ${marker.isSell?"sell":"buy"} dot-only`}><title>{marker.label}</title><circle cx={marker.x} cy={marker.y} r="3"/></g>)}
              {intradayMarkerLayout.actions.map(marker=><g className={`live-signal-marker ${marker.isSell?'sell':'buy'}`} key={`${marker.action.time}-${marker.action.side}-${marker.index}`}><line x1={marker.x} y1={marker.y} x2={marker.labelX} y2={marker.labelY<marker.y?marker.labelY+6:marker.labelY-13} className="marker-label-leader"/><circle cx={marker.x} cy={marker.y} r="6" className={marker.isSell?'sell':'buy'}/><rect x={marker.labelX-marker.labelWidth/2} y={marker.labelY-12} width={marker.labelWidth} height="18" rx={uiTheme==="light"?8:4}/><text x={marker.labelX} y={marker.labelY} textAnchor="middle" className={marker.isSell?'sell':'buy'}>{marker.label}</text></g>)}
              <g key={rabbitTrackerSignal?.key??`rabbit-${rabbitTrackerMode}`} className={`chart-rabbit-tracker ${rabbitTrackerMode} ${rabbitTrackerSignal?.tone??""}`} style={{transform:`translate(${Math.max(LIVE_CHART.plotLeft+18,Math.min(LIVE_CHART.plotRight-18,chartModel.lastX+16))}px, ${Math.max(LIVE_CHART.priceTop+18,Math.min(LIVE_CHART.priceBottom-18,chartModel.lastY-19))}px)`} as CSSProperties} aria-label={rabbitTrackerSignal?.label??"兔兔正在跟踪最新分时"}>
                <image className="rabbit-brand-reference" href="/rabbit-daylight-pair.webp" width="0" height="0" opacity="0" aria-hidden="true"/>
                <circle className="rabbit-tracker-halo" r="15"/>
                {rabbitTrackerMode==="signal"&&<g className="rabbit-signal-companion" transform="translate(-19 2)">
                  <ellipse className="rabbit-fur tan" cx="0" cy="4" rx="8" ry="6"/>
                  <circle className="rabbit-fur tan" cx="0" cy="-3" r="6.5"/>
                  <ellipse className="rabbit-ear tan" cx="-6" cy="-6" rx="2.5" ry="7" transform="rotate(24 -6 -6)"/>
                  <ellipse className="rabbit-ear tan" cx="6" cy="-6" rx="2.5" ry="7" transform="rotate(-24 6 -6)"/>
                  <circle className="rabbit-eye" cx="-2.4" cy="-3.5" r=".8"/><circle className="rabbit-eye" cx="2.4" cy="-3.5" r=".8"/>
                </g>}
                <g className="rabbit-tracker-body">
                  <ellipse className="rabbit-fur" cx="0" cy="4" rx="9" ry="7"/>
                  <circle className="rabbit-fur" cx="0" cy="-4" r="7.5"/>
                  <ellipse className="rabbit-ear" cx="-7" cy="-7" rx="2.8" ry="8" transform="rotate(24 -7 -7)"/>
                  <ellipse className="rabbit-ear" cx="7" cy="-7" rx="2.8" ry="8" transform="rotate(-24 7 -7)"/>
                  <circle className="rabbit-eye" cx="-2.7" cy="-4.3" r=".9"/><circle className="rabbit-eye" cx="2.7" cy="-4.3" r=".9"/>
                  <path className="rabbit-nose" d="M-1 -1.5 L0 -.6 L1 -1.5"/>
                </g>
                {rabbitTrackerMode==="signal"&&<g className={`rabbit-signal-flag ${rabbitTrackerSignal?.tone??"watch"}`} transform="translate(8 -19)"><line x1="0" y1="0" x2="0" y2="14"/><path d="M0 0 L10 3.5 L0 7 Z"/></g>}
                {rabbitTrackerMode==="rest"&&<text className="rabbit-rest-z" x="10" y="-14">Z</text>}
                {rabbitTrackerLabel&&(()=>{
                  const bubbleWidth=Math.max(38,rabbitTrackerLabel.length*7+14);
                  const bubbleX=chartModel.lastX>LIVE_CHART.plotRight-105?-bubbleWidth-20:20;
                  return <g className={`rabbit-tracker-bubble ${rabbitTrackerMode}`} transform={`translate(${bubbleX} -30)`}>
                    <rect width={bubbleWidth} height="18" rx="8"/>
                    <text x={bubbleWidth/2} y="12.5" textAnchor="middle">{rabbitTrackerLabel}</text>
                  </g>;
                })()}
              </g>
              <line x1={LIVE_CHART.plotLeft} y1={chartModel.lastY} x2={LIVE_CHART.plotRight} y2={chartModel.lastY} className="last-line"/><circle cx={chartModel.lastX} cy={chartModel.lastY} r="4" className="last-dot"/><g className="intraday-price-flag"><rect x="0" y={Math.max(6,Math.min(294,chartModel.lastY-12))} width="54" height="24" rx={uiTheme==="light"?7:0}/><text x="27" y={Math.max(6,Math.min(294,chartModel.lastY-12))+16} textAnchor="middle">{chartModel.last.price.toFixed(2)}</text></g></>}
              <line x1={LIVE_CHART.plotLeft} y1={LIVE_CHART.volumeTop} x2={LIVE_CHART.plotRight} y2={LIVE_CHART.volumeTop} className="volume-divider"/>
              {chartModel?.biasAlert&&<rect x={LIVE_CHART.plotLeft} y={LIVE_CHART.volumeTop} width={LIVE_CHART.plotRight-LIVE_CHART.plotLeft} height={LIVE_CHART.volumeBottom-LIVE_CHART.volumeTop} className={`bias-alert-band ${chartModel.latestBias>=0?"up":"down"}`}/>}
              {chartModel?.volumes.map((bar,index)=><rect key={index} x={bar.x-1.35} y={LIVE_CHART.volumeBottom-bar.height} width="2.7" height={bar.height} rx=".45" className={`${bar.up?'volume':'volume red'}${bar.abnormal?' abnormal':''}`}/>) }
              {indicatorsVisible&&chartModel&&<path d={chartModel.biasPath} className="bias-path"/>}
              {chartModel&&<g className={`peak-volume-marker ${chartModel.peakVolume.abnormal?"abnormal":""}`}><line x1={chartModel.peakVolume.x} y1={LIVE_CHART.volumeTop-3} x2={chartModel.peakVolume.x} y2={LIVE_CHART.volumeBottom}/><text x={Math.min(LIVE_CHART.plotRight-4,chartModel.peakVolume.x+4)} y={LIVE_CHART.volumeTop-6} textAnchor={chartModel.peakVolume.x>LIVE_CHART.plotRight-72?"end":"start"}>{chartModel.peakVolume.abnormal&&chartModel.peakVolume.ratio?`成交爆量 ${chartModel.peakVolume.ratio.toFixed(1)}×`:"峰值放量"} {chartModel.peakVolume.time.slice(0,2)}:{chartModel.peakVolume.time.slice(2)}</text></g>}
              {intradayCursor&&(()=>{
                const tooltipWidth=176;
                const tooltipHeight=isZijinStock?156:139;
                const chartMid=(LIVE_CHART.plotLeft+LIVE_CHART.plotRight)/2;
                const tooltipX=intradayCursor.x>chartMid
                  ? LIVE_CHART.plotLeft+6
                  : LIVE_CHART.plotRight-tooltipWidth-6;
                const tooltipY=LIVE_CHART.priceTop+6;
                const axisTimeX=Math.max(LIVE_CHART.plotLeft+24,Math.min(LIVE_CHART.plotRight-24,intradayCursor.x));
                const axisPriceY=Math.max(LIVE_CHART.priceTop+9,Math.min(LIVE_CHART.priceBottom-9,intradayCursor.y));
                const change=intradayCursor.changePercent;
                const directionClass=change!=null&&change>=0?"up":"down";
                return <g className="intraday-crosshair" aria-label={`${intradayCursor.time}，价格 ${intradayCursor.price.toFixed(2)}`}>
                  <line x1={intradayCursor.x} y1={LIVE_CHART.priceTop} x2={intradayCursor.x} y2={LIVE_CHART.volumeBottom} className="intraday-crosshair-line"/>
                  <line x1={LIVE_CHART.plotLeft} y1={intradayCursor.y} x2={LIVE_CHART.plotRight} y2={intradayCursor.y} className="intraday-crosshair-line"/>
                  <circle cx={intradayCursor.x} cy={intradayCursor.y} r="4" className="intraday-crosshair-dot"/>
                  <g className={`intraday-crosshair-axis-label price ${directionClass}`}>
                    <rect x="3" y={axisPriceY-9} width={LIVE_CHART.plotLeft-8} height="18" rx="3"/>
                    <text x={(LIVE_CHART.plotLeft-2)/2} y={axisPriceY+3.5} textAnchor="middle">{intradayCursor.price.toFixed(2)}</text>
                  </g>
                  <g className="intraday-crosshair-axis-label time">
                    <rect x={axisTimeX-24} y={LIVE_CHART.volumeBottom+3} width="48" height="17" rx="3"/>
                    <text x={axisTimeX} y={LIVE_CHART.volumeBottom+15} textAnchor="middle">{intradayCursor.time.slice(0,2)}:{intradayCursor.time.slice(2)}</text>
                  </g>
                  <g className="intraday-crosshair-card" transform={`translate(${tooltipX} ${tooltipY})`}>
                    <rect width={tooltipWidth} height={tooltipHeight} rx="7"/>
                    <text x="11" y="18" className="title">{intradayCursor.time.slice(0,2)}:{intradayCursor.time.slice(2)}</text>
                    <line x1="10" y1="27" x2={tooltipWidth-10} y2="27" className="tooltip-divider"/>
                    <text x="11" y="45">最新</text><text x={tooltipWidth-11} y="45" textAnchor="end" className={`primary ${directionClass}`}>{intradayCursor.price.toFixed(2)}</text>
                    <text x="11" y="62">涨跌幅</text><text x={tooltipWidth-11} y="62" textAnchor="end" className={`primary ${directionClass}`}>{change==null?"--":`${change>=0?"+":""}${change.toFixed(2)}%`}</text>
                    <text x="11" y="79">均价</text><text x={tooltipWidth-11} y="79" textAnchor="end">{intradayCursor.averagePrice.toFixed(2)}</text>
                    <text x="11" y="96">BIAS</text><text x={tooltipWidth-11} y="96" textAnchor="end" className={intradayCursor.biasPercent>=0?"up":"down"}>{intradayCursor.biasPercent>=0?"+":""}{intradayCursor.biasPercent.toFixed(2)}%</text>
                    <text x="11" y="113">成交量</text><text x={tooltipWidth-11} y="113" textAnchor="end">{formatIntradayVolume(intradayCursor.volume)}</text>
                    {isZijinStock&&<><text x="11" y="130">主力净额</text><text x={tooltipWidth-11} y="130" textAnchor="end" className={(intradayCursor.mainForce?.netNotional??0)>=0?"force-buy":"force-sell"}>{intradayCursor.mainForce?formatMainForceAmount(intradayCursor.mainForce.netNotional):"无大额成交"}</text></>}
                    <text x="11" y={isZijinStock?147:130}>提醒状态</text><text x={tooltipWidth-11} y={isZijinStock?147:130} textAnchor="end">{intradayCursorSignal}</text>
                  </g>
                </g>;
              })()}
            </svg>
          </div>
          {isZijinStock&&<section className="main-force-track" aria-label="紫金矿业全天 L2 大额主动净额追踪，非总成交量">
            <div className="main-force-track-head">
              <div><strong>主力追踪</strong><span>L2 大额主动净额 · 非总成交量 · 与主图按分钟对齐</span></div>
              <div className="main-force-track-legend"><span className="buy"><i/>大额主动净买</span><span className="sell"><i/>大额主动净卖</span><span className="cumulative"><i/>累计净额</span></div>
              <div className={`main-force-response ${zijinFundResponse.state}`} title={`${zijinFundResponse.message}；${zijinFundResponse.evidence}`}>
                <span>{zijinFundResponse.label}</span>
                <i><u style={{width:`${zijinFundResponse.score}%`}}/></i>
                <b>{zijinFundResponse.score}</b>
              </div>
              <div className={`main-force-track-summary ${zijinMainForceTrack.totals.netNotional>=0?'buy':'sell'}`}>
                <span>{zijinMainForceTrack.stance}</span><b>{formatMainForceAmount(zijinMainForceTrack.totals.netNotional)}</b>
              </div>
            </div>
            {zijinRepair?.ready&&<div className={`main-force-repair-state ${zijinRepair.status} ${zijinRepair.checks?.l2BuyRecovery?"confirmed":"waiting"}`}>
              <span>资金承接修复</span><b>{zijinRepair.title}</b><small>二次探底 {zijinRepair.checks?.secondBottom?"✓":"·"} · 动量 {zijinRepair.checks?.momentumPositive?"✓":"·"} · L2连续回流 {zijinRepair.checks?.l2BuyRecovery?"✓":"·"} · 局部突破 {zijinRepair.checks?.localBreakout?"✓":"·"}</small>
            </div>}
            <svg viewBox={`0 0 ${LIVE_CHART.width} 72`} preserveAspectRatio="none" role="img" aria-label={`主力追踪：${zijinMainForceTrack.stance}`}>
              <line x1={LIVE_CHART.plotLeft} y1="36" x2={LIVE_CHART.plotRight} y2="36" className="main-force-zero"/>
              {A_SHARE_INTRADAY_AXIS.map(tick=><line key={tick.label} x1={liveChartSlotX(tick.slot)} y1="6" x2={liveChartSlotX(tick.slot)} y2="66" className="main-force-grid"/>)}
              <text x={LIVE_CHART.plotLeft-5} y="10" textAnchor="end" className="main-force-bar-axis">{formatMainForceAmount(zijinMainForcePeak)}</text>
              <text x={LIVE_CHART.plotLeft-5} y="68" textAnchor="end" className="main-force-bar-axis">{formatMainForceAmount(-zijinMainForcePeak)}</text>
              {zijinMainForceTrack.bars.map(bar=>{
                const height=Math.max(bar.netNotional===0?0:2,Math.min(28,Math.abs(bar.netNotional)/zijinMainForcePeak*28));
                const y=bar.netNotional>=0?36-height:36;
                return <rect key={bar.time} x={liveChartX(bar.time)-1.45} y={y} width="2.9" height={height} rx=".7" className={bar.netNotional>=0?"main-force-buy":"main-force-sell"}/>;
              })}
              {zijinMainForceCumulative&&<><path d={zijinMainForceCumulative.path} className="main-force-cumulative"/>{zijinMainForceCumulative.ticks.map((tick,index)=><text key={index} x={LIVE_CHART.plotRight+54} y={tick.y+3} textAnchor="end" className="main-force-cumulative-axis">{formatMainForceAmount(tick.value)}</text>)}{zijinMainForceCumulative.last&&<circle cx={zijinMainForceCumulative.last.x} cy={zijinMainForceCumulative.last.y} r="2.4" className="main-force-cumulative-dot"/>}</>}
              {intradayCursor&&mainForceCursorX!==null&&<line x1={mainForceCursorX} y1="6" x2={mainForceCursorX} y2="66" className="main-force-crosshair"/>}
              {!zijinMainForceTrack.bars.some(bar=>bar.bigBuyNotional+bar.bigSellNotional>0)&&<text x="460" y="40" textAnchor="middle" className="main-force-empty">等待 L2 大额主动成交</text>}
            </svg>
            <div className="main-force-track-foot">
              <span>大额买入 {formatMainForceAmount(zijinMainForceTrack.totals.bigBuyNotional)}</span>
              <span>大额卖出 {formatMainForceAmount(zijinMainForceTrack.totals.bigSellNotional)}</span>
              <span className={`main-force-intent ${zijinMainForceIntent.state}`} title={`${zijinMainForceIntent.message}；${zijinMainForceIntent.evidence}。仅为大额成交统计观察，不识别具体资金主体，也不构成交易建议。`}><i>全天意图</i><b>{zijinMainForceIntent.label}</b><small>{zijinMainForceIntent.confidence}</small></span>
              <span className={`main-force-response-note ${zijinFundResponse.state}`}>{zijinFundResponse.message}</span>
              <em>{zijinFundResponse.evidence}</em>
            </div>
          </section>}
          {afterHoursSummary&&<div className="after-hours-strip" role="status" aria-label="盘后固定价格交易数据">
            <span><i/>盘后固定价</span><b>15:05–15:30</b><strong>¥{afterHoursSummary.price.toFixed(2)}</strong>
            <small>{afterHoursSummary.points} 个成交点 · 成交量 {afterHoursSummary.totalVolume.toLocaleString("zh-CN")} · 仅展示，不触发做 T 信号</small>
          </div>}
          <div className="signal-tape">
            <span className="tape-title">信号证据</span>
            <span><i className={openingAssessment.session==="低开"||openingAssessment.session==="高开"?"ok":"wait"}>{openingAssessment.session==="低开"||openingAssessment.session==="高开"?"✓":"·"}</i>{openingAssessment.gapText}</span>
            <span><i className={decisionModel.referenceConfirmed?"ok":"wait"}>{decisionModel.referenceConfirmed?"✓":"·"}</i>开盘价 + VWAP</span>
            <span><i className={decisionModel.trendConfirmed?"ok":"wait"}>{decisionModel.trendConfirmed?"✓":"·"}</i>连续走势确认</span>
            {stock?.code==="601899"&&<span title={zijinAhLinkage.reason}><i className={zijinAhLinkage.available&&zijinAhLinkage.state!=="neutral"?"ok":"wait"}>{zijinAhLinkage.available&&zijinAhLinkage.state!=="neutral"?"✓":"·"}</i>{zijinAhLinkage.label}</span>}
            <span><i className={decisionModel.inDecisionWindow?"ok":"wait"}>{decisionModel.inDecisionWindow?"✓":"·"}</i>{decisionModel.lastTime||"--:--"} 时间门控</span>
          </div>
        </div>

        <aside className={`decision-zone ${decisionZoneMode==="focus"?"focus-mode":"all-mode"}`}>
          <div className="decision-zone-tabs" role="tablist" aria-label="右侧信息视图">
            <button role="tab" aria-selected={decisionZoneMode==="focus"} className={decisionZoneMode==="focus"?"active":""} onClick={()=>setDecisionZoneMode("focus")}>盯盘重点</button>
            <button role="tab" aria-selected={decisionZoneMode==="all"} className={decisionZoneMode==="all"?"active":""} onClick={()=>setDecisionZoneMode("all")}>全部证据</button>
          </div>
          <section className={`decision-primary-card global-decision-card ${decisionModel.status} ${decisionActionSide==="sell"||(!decisionActionSide&&signalMode==="反T")?"reverse":"positive"}`} aria-label="全局决策状态">
            <header><span>全局决策 <small className="decision-engine-badge">闭环策略</small></span><em>{decisionConditionsConfirmed}/4 条件</em></header>
            <b className="global-decision-status">{decisionModel.status==="locked"
              ?"🔴 风控已锁定"
              :cycleStage==="opened"
                ?`🟡 已记录${openedCycleSide==="buy"?"买入":"卖出"}，等待${expectedClosingSide==="sell"?"卖出":"买回"}`
                :positiveTBlockedByFlow
                  ?"🟡 主动净卖中，正T已锁定"
                :formalActionMarkerPending
                  ?"🟡 正式信号写入分时图中"
                :decisionModel.status==="ready"&&decisionActionSide
                  ?`🟢 ${decisionExecutionLabel}已确认`
                  :freshReverseTObservation
                    ?`🟠 反T${freshReverseTObservation.stage==="candidate"?"候补":"观察"}`
                    :"🟡 等待信号"}</b>
            <div className={`global-decision-live-signal ${freshReverseTAction||freshReverseTObservation?"active":"idle"}`} aria-label="实时反T信号">
              <span>实时反T</span>
              <b>{reverseTSignalLabel}</b>
              <small>{reverseTSignalDetail}</small>
            </div>
            <details className="decision-audit-details" open={decisionAuditOpen} onToggle={event=>setDecisionAuditOpen(event.currentTarget.open)}>
              <summary>条件与依据 <b>{decisionConditionsConfirmed}/4</b></summary>
              <small className="global-decision-summary">{positiveTBlockedByFlow?"主动净卖与价格走弱同向，卖压解除前不提示正T买入。":signalMode === "反T" ? openingAssessment.negativeTitle : openingAssessment.positiveTitle}</small>
             <div className="decision-condition-grid" aria-label="全局决策条件进度" aria-valuemin={0} aria-valuemax={4} aria-valuenow={decisionConditionsConfirmed} role="progressbar">
               <div className="decision-condition-progress" aria-hidden="true"><i style={{width:`${decisionConditionsConfirmed/4*100}%`}}/></div>
               {decisionConditions.map(item=><span key={item.label} className={item.met?"met":""}><i>{item.met?"✓":"×"}</i>{item.label}</span>)}
             </div>
            </details>
            <div className="decision-primary-meta"><span>{positiveTBlockedByFlow?"正T已锁定":decisionModel.status==="ready"?(decisionModel.mode??signalMode):decisionModel.status==="locked"?"禁止开T":"等待条件补齐"}</span><strong>{stockAgent.canExecute?(positiveTBlockedByFlow?"等待卖压解除":decisionModel.status==="ready"?"可进入执行":decisionModel.status==="locked"?"风险优先":"实时监控"):"研究观察"}</strong></div>
          </section>
          <section className="decision-position-card" aria-label="持仓与本次做T">
            <header><span>持仓与试算</span><em>{marketSession.live?"实时":"复盘"}</em></header>
            <div className="decision-position-grid">
              <p><span>当前持仓</span><b>{displayedShares.toLocaleString()}<small> 股</small></b></p>
              <p><span>可卖数量</span><b>{effectiveLivePosition.sellable.toLocaleString()}<small> 股</small></b></p>
              <p className="accent"><span>本次做T</span><b>{cycleQuantity.toLocaleString()}<small> 股</small></b></p>
              <p><span>预估净收益</span><b className={(tCalculator?.net??0)>=0?"positive":"negative"}>{tCalculator?money(tCalculator.net):"--"}</b></p>
            </div>
          </section>
          {uiTheme==="light"&&<div className="rabbit-decision-header" aria-hidden="true">
            <span className="rabbit-decision-avatar"/>
            <div><b>双兔决策屋</b><small>低吸兔找机会 · 止盈兔守风险</small></div>
            <em>陪你盯盘</em>
          </div>}
          {alertQueue.length>0&&<div className="trade-alert-stack" aria-label="股票提醒列表">{alertQueue.slice(0,3).map((item,index)=><div key={item.id??`${item.title}-${index}`} className={`trade-alert-toast ${item.level} rabbit-${item.rabbit}`} role="alert"><span className={`rabbit-speaker ${item.rabbit}`} aria-hidden="true"/><div className="rabbit-speech"><small>{tradeAlertLabel(item)}</small><b>{item.title}</b><span>{tradeAlertGuide(item)}</span><details className="trade-alert-detail"><summary>查看依据</summary><p>{item.message}</p></details></div>{index===2&&alertQueue.length>3&&<em className="alert-queue-count">+{alertQueue.length-3}</em>}<button onClick={()=>setAlertQueue(current=>current.filter(alert=>alert.id!==item.id))} aria-label={`关闭${item.title}提醒`}>×</button></div>)}</div>}
          {isZijinStock&&<div className="stock-agent-switch experiment-active" aria-label="紫金矿业闭环策略状态">
            <div><span title="候选须经过趋势、成本、盘口和仓位校验；仅辅助人工决策，不自动下单。">紫金闭环策略 ⓘ</span><b>{liveStrategyExperiment.label}</b></div>
            <div className="stock-agent-switch-actions experiment-actions"><button className="active experimental" type="button" disabled aria-pressed>闭环已固定</button><button className={zijinResearchEnabled?"research active":"research"} onClick={()=>setZijinResearchEnabled(current=>!current)} aria-pressed={zijinResearchEnabled}>研究解释</button></div>
          </div>}
          {isZijinStock&&<details className={`zijin-shadow-v2 research-fold ${zijinShadowV2Progress.ready?"promotion-ready":zijinShadowV2Progress.available?"monitoring":"waiting"}`} aria-label="紫金影子 V3 学习与晋级进度">
            <summary><div><span title="进度综合前瞻天数、闭环样本和六项晋级门槛；不会自动替换正式策略。">紫金影子 V3 ⓘ</span><b>{zijinShadowV2Progress.ready?"等待评审":zijinShadowV2Progress.available?"监控中":"待接入"}</b></div><strong>{zijinShadowV2Progress.progress}<small>%</small></strong></summary>
            <div className="zijin-shadow-v2-meter" role="progressbar" aria-label={`紫金影子 V3 学习进度 ${zijinShadowV2Progress.progress}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={zijinShadowV2Progress.progress}><i style={{width:`${zijinShadowV2Progress.progress}%`}}/></div>
            <div className={`zijin-shadow-v29 ${zijinV29OpeningShadow.tone}`} aria-label={`V2.9 全天方向锚 ${zijinV29OpeningShadow.label}`}>
              <div><span>V2.9 全天方向锚</span><b>{zijinV29OpeningShadow.label}</b><em>{zijinV29OpeningShadow.advice}</em></div>
              <p>{zijinV29OpeningShadow.detail}</p>
              <small>前向样本 <b>0 / 100</b> · 仅作参考，不影响正式信号</small>
            </div>
            <footer><span>{zijinShadowV2Progress.ready?"六项门槛全部通过":`门槛 ${zijinShadowV2Progress.passed}/6 · 前瞻 ${zijinShadowV2Progress.tradingDays}/60日 · 闭环 ${zijinShadowV2Progress.resolvedCycles}/100`}</span><em>{zijinShadowV2Progress.ready?"等待人工评审":"满额后申请评审"}</em></footer>
          </details>}
          <div className="signal-funnel" aria-label="候选观察与正式执行信号">
            <div className="signal-layer candidate"><span>本股实时观察</span><b>{visibleStockAgentEvaluation?Number(visibleStockAgentEvaluation.status==="candidate"):signalFunnel.currentObservations}<small> 个</small></b><em>{visibleStockAgentEvaluation?`${STOCK_AGENTS.zijin.name} · ${visibleStockAgentEvaluation.title}`:`条件候补 ${signalFunnel.currentCandidates} · 全自选观察 ${signalFunnel.observations}`}</em></div>
            <i>→</i>
            <div className="signal-layer formal"><span>本股正式闭环</span><b>{stockAgent.canExecute?signalFunnel.currentFormal:0}<small> 个</small></b><em>{stockAgent.canExecute?`全部自选 ${signalFunnel.formal} · 闭环过滤后保留`:"研究观察版 · 尚未开放正式执行"}</em></div>
          </div>
          <div className="signal-funnel-note"><span>{isZijinStock&&zijinPreopenGate.phase!=="unavailable"?`盘前影子许可 · ${zijinPreopenGate.predictedDirection??"等待方向"} · ${zijinPreopenGate.confirmationCount}/${zijinPreopenGate.requiredConfirmations} 确认`:(visibleStockAgentEvaluation?(visibleStockAgentEvaluation.asOfTime?`专属评估 ${visibleStockAgentEvaluation.asOfTime.slice(0,2)}:${visibleStockAgentEvaluation.asOfTime.slice(2)} · ${visibleStockAgentEvaluation.direction??"等待方向"}`:"紫金研究层等待真实分钟数据"):(signalFunnel.currentLatest?`本股最新观察 ${signalFunnel.currentLatest.time.slice(0,2)}:${signalFunnel.currentLatest.time.slice(2)} · ${signalFunnel.currentLatest.direction}`:"本股当前尚无实时观察"))}</span><em>{isZijinStock&&zijinPreopenGate.phase!=="unavailable"?`${zijinPreopenGate.reason} 仅供影子审计，不影响正式 V4、账户或下单。`:(visibleStockAgentEvaluation?"紫金研究仅叠加解释；正式买卖点、风控和提醒均由内置闭环运行。":"均价线大偏离先预警；趋势、量价、成本和风控全部通过后才进入正式层")}</em></div>
          {isZijinStock&&<details className={`zijin-factor-engine research-fold ${zijinRealtimeFactors.readyCount>=6?"ready":zijinRealtimeFactors.readyCount>=4?"partial":"waiting"}`} aria-label="紫金矿业多因子T引擎实时确认面板">
            <summary><div><span>紫金多因子</span><b>实时确认</b><small className={missingZijinFactors.length?"waiting":"ready"}>{zijinFactorSummary}</small></div><strong>{zijinRealtimeFactors.readyCount}<small>/{zijinRealtimeFactors.total}</small></strong></summary>
            <div className="zijin-factor-engine-meter" role="meter" aria-label={`多因子数据完整度 ${zijinRealtimeFactors.readyCount}/${zijinRealtimeFactors.total}`} aria-valuemin={0} aria-valuemax={zijinRealtimeFactors.total} aria-valuenow={zijinRealtimeFactors.readyCount}><i style={{width:`${zijinRealtimeFactors.readyCount/zijinRealtimeFactors.total*100}%`}}/></div>
            <div className="zijin-factor-engine-grid">{zijinRealtimeFactors.items.map(item=><div key={item.key} className={item.tone} title={item.detail}><span>{item.label}</span><b>{item.value}</b><small>{item.detail}</small></div>)}</div>
          </details>}
          <details className={`next-session-outlook research-fold ${!nextSessionOutlook.ready?"pending":nextSessionOutlook.direction==="偏强"?"up":nextSessionOutlook.direction==="偏弱"?"down":"flat"}`} aria-label="下一交易日走势结构预判">
            <summary><span>明日预判 <small>{nextSessionOutlook.stage}</small></span><b>{nextSessionOutlook.ready?nextSessionOutlook.direction:"待定"}<em>{nextSessionOutlook.ready?nextSessionOutlook.confidenceText:""}</em></b></summary>
            <div className="next-session-outlook-body">
            {nextSessionOutlook.ready?<>
              <div className="next-session-outlook-main"><b>{nextSessionOutlook.direction}</b><strong>{nextSessionOutlook.confidenceText}</strong></div>
              <div className="next-session-outlook-range"><span>预计波动</span><b>¥{nextSessionOutlook.lower.toFixed(2)}–{nextSessionOutlook.upper.toFixed(2)}</b></div>
              <div className="next-session-outlook-levels"><span>支撑 ¥{nextSessionOutlook.support.toFixed(2)}</span><span>压力 ¥{nextSessionOutlook.resistance.toFixed(2)}</span></div>
              {isZijinStock&&<>
                <div className="next-session-factor-groups" aria-label="商品盘口资金市场事件五组因子">
                  {nextSessionOutlook.groups.map(group=><div key={group.key} className={!group.ready?"waiting":group.score>=15?"up":group.score<=-15?"down":"flat"} title={group.detail}>
                    <span>{group.label}</span><b>{group.direction}</b>
                    <i aria-hidden="true"><em style={{width:`${group.ready?(group.score+100)/2:50}%`}}/></i>
                  </div>)}
                </div>
                <div className="next-session-research-signals">
                  <div className={nextSessionOutlook.resonance.direction}><span>因子共振</span><b>{nextSessionOutlook.resonance.label}</b><small>{nextSessionOutlook.resonance.detail}</small></div>
                  <div className={nextSessionOutlook.expectationGap.direction}><span>预期差</span><b>{nextSessionOutlook.expectationGap.label}</b><small>{nextSessionOutlook.expectationGap.detail}</small></div>
                </div>
                <div className="next-session-horizons" aria-label="未来多周期结构">
                  {nextSessionOutlook.horizons.map(horizon=><div key={horizon.minutes} className={horizon.direction==="偏强"?"up":horizon.direction==="偏弱"?"down":"flat"}>
                    <span>{horizon.minutes}分钟</span><b>{horizon.direction}</b><i><em style={{width:`${(horizon.score+100)/2}%`}}/></i><small>数据 {horizon.coverage}%</small>
                  </div>)}
                </div>
                <div className="next-session-validation"><span>{nextSessionOutlook.validation.label}</span><small>{nextSessionOutlook.validation.detail}</small></div>
              </>}
              <details className="next-session-evidence"><summary>查看结构依据</summary><p>{nextSessionOutlook.factors.join(" · ")}</p><small>{nextSessionOutlook.failure}</small></details>
            </>:<p>{nextSessionOutlook.detail}</p>}
            </div>
          </details>
          {isZijinStock&&displayedZijinPricePlan&&<div className={`zijin-price-plan ${premiumEnabled?displayedZijinPricePlan.status:"locked"} ${premiumEnabled&&!displayedZijinPricePlan.ready?"compact-waiting":""}`} aria-label="紫金矿业预判买入卖出价区间">
            <div className="zijin-price-plan-head"><div><span>{isPreopenPlanPhase?"紫金会员 · 集合竞价":marketSession.live?"紫金会员 · 实时因果":"紫金会员 · 收盘复盘"}</span><b>{isPreopenPlanPhase?"9:25盘前预判":marketSession.live?"实时参考价区":"复盘参考价区"}</b></div><em>{premiumEnabled?(displayedZijinPricePlan.asOfTime?`${displayedZijinPricePlan.asOfTime.slice(0,2)}:${displayedZijinPricePlan.asOfTime.slice(2)}`:isPreopenPlanPhase?"等待竞价":marketSession.live?"等待分时":"已收盘"):"会员功能"}</em></div>
            {!premiumEnabled?<div className="premium-feature-lock"><p>精确买卖区间、9:25竞价预判与 L2 深度结论仅会员可查看。</p><button onClick={()=>setAccountOpen(true)}>查看会员权益</button></div>:!displayedZijinPricePlan.ready?<p>{displayedZijinPricePlan.reason}</p>:<>
              <div className="zijin-price-plan-grid">
                <div className={`buy ${positiveTBlockedByFlow?"locked":""}`}><small title="正T：先买入、后卖出等量旧仓，目标是降低持仓成本">{isPreopenPlanPhase?"开盘正T观察区":"正T关注区"} <sup>ⓘ</sup></small><b>¥{displayedZijinPricePlan.buyRange[0].toFixed(2)}–{displayedZijinPricePlan.buyRange[1].toFixed(2)}</b><span>{positiveTBlockedByFlow?"主动净卖中，暂不执行正T":"到区后等承接确认"}</span></div>
                <div className="sell"><small title="反T：先卖出旧仓、后低价买回等量股份">{isPreopenPlanPhase?"开盘反T观察区":"反T关注区"} <sup>ⓘ</sup></small><b>¥{displayedZijinPricePlan.sellRange[0].toFixed(2)}–{displayedZijinPricePlan.sellRange[1].toFixed(2)}</b><span>到区后等衰竭确认</span></div>
              </div>
              <div className="zijin-price-plan-quick-fill" role="group" aria-label="T calculator quick fill">
                <button className="buy" type="button" disabled={positiveTBlockedByFlow} title={positiveTBlockedByFlow?"主动净卖与价格走弱同向，正T已锁定":"填入正T关注区中位价"} onClick={()=>{setTEntryPrice(((displayedZijinPricePlan.buyRange[0]+displayedZijinPricePlan.buyRange[1])/2).toFixed(2));setTQuantity(String(cycleQuantity));setTCalculatorOpen(true)}}><span>{marketSession.live?"正T 买入":"正T参考"}</span><b>¥{((displayedZijinPricePlan.buyRange[0]+displayedZijinPricePlan.buyRange[1])/2).toFixed(2)}</b></button>
                <button className="sell" type="button" onClick={()=>{setTExitPrice(((displayedZijinPricePlan.sellRange[0]+displayedZijinPricePlan.sellRange[1])/2).toFixed(2));setTQuantity(String(cycleQuantity));setTCalculatorOpen(true)}}><span>{marketSession.live?"反T 卖出":"反T参考"}</span><b>¥{((displayedZijinPricePlan.sellRange[0]+displayedZijinPricePlan.sellRange[1])/2).toFixed(2)}</b></button>
              </div>
              <div className="zijin-price-plan-meta">
                <span title="毛价差：未扣除佣金、税费和滑点前的买卖价差">预期毛价差 <sup>ⓘ</sup> <b>¥{displayedZijinPricePlan.expectedGrossSpread.toFixed(2)}</b></span>
                {"confidenceBreakdown" in displayedZijinPricePlan
                  ? <details className="zijin-confidence-breakdown"><summary>置信度 <b>{displayedZijinPricePlan.confidence}%</b></summary><div>{displayedZijinPricePlan.confidenceBreakdown.map(item=><span key={item.label}>{item.label}<b className={item.value<0?"negative":""}>{item.value>=0?"+":""}{item.value}</b></span>)}</div></details>
                  : <span>置信度 <b>{displayedZijinPricePlan.confidence}%</b></span>}
                <span>{displayedZijinPricePlan.position}</span>
              </div>
              {"riskPlan" in displayedZijinPricePlan&&displayedZijinPricePlan.riskPlan&&<details className="zijin-risk-plan">
                <summary>风控价位 <span>按需查看</span></summary>
                {"bufferPct" in displayedZijinPricePlan.riskPlan&&<small className="zijin-risk-buffer">波动缓冲 {displayedZijinPricePlan.riskPlan.bufferPct.toFixed(2)}% · ¥{displayedZijinPricePlan.riskPlan.buffer.toFixed(2)}</small>}
                <div className="buy"><span>正T风控</span><b>止损 ¥{displayedZijinPricePlan.riskPlan.positiveT.hardStop.toFixed(2)}</b><small>止盈一 ¥{displayedZijinPricePlan.riskPlan.positiveT.takeProfit1.toFixed(2)} · 止盈二 ¥{displayedZijinPricePlan.riskPlan.positiveT.takeProfit2.toFixed(2)}</small></div>
                <div className="sell"><span>反T风控</span><b>止损 ¥{displayedZijinPricePlan.riskPlan.reverseT.hardStop.toFixed(2)}</b><small>买回一 ¥{displayedZijinPricePlan.riskPlan.reverseT.takeProfit1.toFixed(2)} · 买回二 ¥{displayedZijinPricePlan.riskPlan.reverseT.takeProfit2.toFixed(2)}</small></div>
              </details>}
              <p>{displayedZijinPricePlan.reason}</p>
              <details className="zijin-price-plan-note"><summary>区间说明 ⓘ</summary><span>{isPreopenPlanPhase?"仅使用当时已知的竞价价格与 L2 状态；09:30 自动失效并切换为真实分时因果区间。":"仅使用截至当前已出现的分时、均价线与 L2 覆盖；这是预警区间，不是挂单建议。"}</span></details>
            </>}
          </div>}
          {visibleStockAgentEvaluation&&<div className={`zijin-opening-card stock-agent-card ${visibleStockAgentEvaluation.status}`}>
            <div><span>手动叠加 · {STOCK_AGENTS.zijin.name}</span><b>{visibleStockAgentEvaluation.title}</b><em>{visibleStockAgentEvaluation.asOfTime?`${visibleStockAgentEvaluation.asOfTime.slice(0,2)}:${visibleStockAgentEvaluation.asOfTime.slice(2)}`:"--:--"} · {visibleStockAgentEvaluation.score}/100</em></div>
            <p>{visibleStockAgentEvaluation.reasons[0]}</p>
            <small>{visibleStockAgentEvaluation.phase==="opening"?"早盘专属层":"全天因子层"} · 振幅 {visibleStockAgentEvaluation.metrics.rangePct.toFixed(2)}% · 距VWAP {visibleStockAgentEvaluation.metrics.vwapBiasPct>=0?"+":""}{visibleStockAgentEvaluation.metrics.vwapBiasPct.toFixed(2)}% · 量比 {visibleStockAgentEvaluation.metrics.volumeRatio==null?"待数据":`${visibleStockAgentEvaluation.metrics.volumeRatio.toFixed(2)}×`}</small>
            {zijinStructure&&<small className="zijin-structure-summary">多周期 {zijinStructure.direction} {zijinStructure.directionScore>=0?"+":""}{zijinStructure.directionScore} · 缠论 {zijinStructure.chan.location} · 威科夫 {zijinStructure.wyckoff.phase} · 成交密集区 ¥{zijinStructure.volumeProfile.valueAreaLow.toFixed(2)}–{zijinStructure.volumeProfile.valueAreaHigh.toFixed(2)}</small>}
            <i>{STOCK_AGENTS.zijin.badge} · 与内置闭环隔离 · 只给候选和解释，不生成正式成交</i>
          </div>}
          <div className={`alert-channel ${marketSession.live?"market-live":""}`}><div><span>提醒</span><small>语音、弹窗与手机后台通知</small></div><div className="alert-channel-actions"><button className="utility" onClick={previewRabbitAlert} title="预览一条兔兔提醒">预览</button><button className="utility" onClick={()=>premiumEnabled?setAlertLogOpen(true):setAccountOpen(true)} disabled={demoMode} title={demoMode?'演示模式不保存提醒记录':premiumEnabled?'查看实际出现过的候选、正式与风险提醒':'提醒历史为会员功能'}>记录{premiumEnabled?"":"·会员"}</button><button className={`channel sound ${alertSettings.sound?"active":""}`} onClick={()=>void updateAlertSetting("sound")} aria-pressed={alertSettings.sound} title="网页打开时播放简短语音">🔊 {alertSettings.sound?"开":"关"}</button><button className={`channel system ${alertSettings.system?"active":""}`} onClick={()=>void updateAlertSetting("system")} aria-pressed={alertSettings.system} title="网页打开时显示提醒弹窗">🔔 {alertSettings.system?"开":"关"}</button><button className={`channel mobile ${alertSettings.background?"active":""}`} onClick={()=>void updateAlertSetting("background")} aria-pressed={alertSettings.background} title={backgroundPushState==="unsupported"?"当前浏览器不支持后台推送":backgroundPushState==="error"?"订阅失败，可重新开启":"锁屏或切到后台时使用手机系统通知"}>📱 {backgroundPushState==="unsupported"?"不支持":alertSettings.background?"开":"关"}</button>{alertSettings.background&&<button className="utility" disabled={backgroundPushTesting} onClick={()=>void testBackgroundPush()} title="向本机发送一条后台系统通知">{backgroundPushTesting?"发送中":"测试"}</button>}</div><details className="mobile-push-guide"><summary>ⓘ 帮助</summary><div><p><b>安卓 Chrome</b><span>菜单 → 添加到主屏幕 → 从桌面打开 → 开启手机后台并允许通知。</span></p><p><b>苹果 Safari</b><span>分享 → 添加到主屏幕 → 从桌面打开 → 开启手机后台并允许通知。</span></p><small>锁屏通知音由手机系统控制；详细说明可在设置中查看。</small></div></details></div>
          <div className="decision-label"><span>{stockAgent.name}</span><em>{stockAgent.canExecute?(decisionModel.status==="ready"?"信号已确认":decisionModel.status==="locked"?"禁止开T":"1秒监控中"):stockAgent.badge}</em></div>
          <details className="t-calculator" aria-label="日内做T试算" open={tCalculatorOpen} onToggle={event=>setTCalculatorOpen(event.currentTarget.open)}>
            <summary><span>日内做T试算</span><b>{tCalculatorOpen?"收起":"展开"}</b></summary>
            <div className="t-calculator-body">
            <header><div><span>日内做T试算</span><b>实时估算收益与成本变化</b></div><small>空格快速定位</small></header>
            <div className="t-calculator-inputs"><label>买入价<input inputMode="decimal" value={tEntryPrice} onChange={event=>setTEntryPrice(event.target.value)} placeholder={activeQuote?.price?.toFixed(2)??"0.00"}/></label><label>卖出价<input inputMode="decimal" value={tExitPrice} onChange={event=>setTExitPrice(event.target.value)} placeholder={activeQuote?.price?.toFixed(2)??"0.00"}/></label><label>数量<input inputMode="numeric" value={tQuantity} onChange={event=>setTQuantity(event.target.value)} placeholder="1000"/></label></div>
            <div className="t-calculator-presets" aria-label="T calculator quantity presets">
              <button type="button" onClick={()=>setTQuantity(String(Math.floor(Math.max(0,effectiveLivePosition.sellable*.2)/100)*100))}>20%</button>
              <button type="button" onClick={()=>setTQuantity(String(Math.floor(Math.max(0,effectiveLivePosition.sellable*.5)/100)*100))}>50%</button>
              <button type="button" onClick={()=>setTQuantity(String(Math.floor(Math.max(0,effectiveLivePosition.sellable)/100)*100))}>{"\u5168\u90e8\u53ef\u5356"}</button>
              <button type="button" onClick={()=>setTQuantity(String(Math.floor(Math.max(0,cycleQuantity)/100)*100))}>{"\u9ed8\u8ba4"} {cycleQuantity.toLocaleString()}</button>
            </div>
            <label className="t-calculator-fee"><input type="checkbox" checked={tUseConservativeFee} onChange={event=>setTUseConservativeFee(event.target.checked)}/><span>保守综合费率</span><b>0.10%</b><small>已覆盖佣金、卖出印花税与过户费</small></label>
            <div className="t-calculator-result"><span>预估净收益 <b className={(tCalculator?.net??0)>=0?"positive":"negative"}>{tCalculator?money(tCalculator.net):"待输入"}</b></span><span>摊薄成本 <b>{tCalculator?`${tCalculator.costChange>=0?"-":"+"}¥${Math.abs(tCalculator.costChange).toFixed(3)}/股`:"--"}</b></span><small>{tCalculator?`毛收益 ${money(tCalculator.gross)} · ${tCalculator.feeLabel} ¥${tCalculator.estimatedFees.toFixed(2)} · ${tCalculator.quantity.toLocaleString()} 股`:"输入计划买卖价与整手数量后自动计算"}</small></div>
            </div>
          </details>
          <details className={`stock-state stock-state-collapsible ${stockState.level}`}>
            <summary><span>状态判断</span><b>{stockState.label}</b><strong>{stockState.score}<small>/100</small></strong><i aria-hidden="true">⌄</i></summary>
            <div className="stock-state-details">
              <div className="stock-state-meter" role="meter" aria-label={`股票状态评分 ${stockState.score} 分`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={stockState.score}><i style={{width:`${stockState.score}%`}}/></div>
              <p>{stockState.summary}</p><ul>{stockState.details.map(detail=><li key={detail}>{detail}</li>)}</ul><em>{stockState.action}</em>
            </div>
          </details>
          <section className={`web4-monitor ${web4Monitor.status} ${web4Monitor.status==="degraded"?"compact":""} ${marketSession.live?"market-live":""}`} aria-label="WEB 4.0 多源实时监控">
            {marketSession.live&&<span className="market-live-status-dot" title={web4Monitor.summary} aria-label={`数据状态：${web4Monitor.label}`}/>}
            <header>
              <div><span>WEB 4.0 · 多源监控</span><b>{web4Monitor.label}</b></div>
              <strong>{web4Monitor.confidence}<small>/100</small></strong>
            </header>
            <div className="web4-monitor-meter" role="meter" aria-label={`WEB 4.0 多源置信度 ${web4Monitor.confidence} 分`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={web4Monitor.confidence}><i style={{width:`${web4Monitor.confidence}%`}}/></div>
            {web4Monitor.status!=="degraded"&&secondLevelSignal&&<div className={`second-level-state ${secondLevelSignal.state}`}>
              <span>秒级预警</span>
              <b>{secondLevelSignal.label}</b>
              <strong>{secondLevelSignal.direction==="buy"?"正T":secondLevelSignal.direction==="sell"?"反T":"扫描"} · {secondLevelSignal.score}/100</strong>
              <small>{secondLevelSignal.plan?.action??"仅作候选"}{secondLevelSignal.plan?.triggerPrice?` · 触发 ¥${secondLevelSignal.plan.triggerPrice.toFixed(2)}`:""}{secondLevelSignal.plan?.invalidPrice?` · 失效 ¥${secondLevelSignal.plan.invalidPrice.toFixed(2)}`:""} · 正式信号仍需闭环确认</small>
              {secondLevelSignal.timeline?.lastReason&&<small>{secondLevelSignal.timeline.lastReason}{secondLevelSignal.timeline.confirmationDelaySeconds!=null?` · 确认延迟 ${secondLevelSignal.timeline.confirmationDelaySeconds.toFixed(1)} 秒`:""} · {secondLevelSignal.timeline.confirmationPolicy}</small>}
            </div>}
            {web4Monitor.status!=="degraded"&&<div className="web4-monitor-votes">
              {web4Monitor.votes.map(vote=><span key={vote.id} className={vote.state} title={vote.detail}><i/>{vote.label}<small>{vote.detail}</small></span>)}
            </div>}
            {web4Monitor.status==="degraded"
              ?<p className="web4-monitor-compact-note" title={web4Monitor.summary}>{web4Monitor.summary}</p>
              :<footer><b>{web4Monitor.formalEligible?"多源已确认":"技术面不能单独升级正式信号"}</b><span>{web4Monitor.summary}</span></footer>}
          </section>
          <div className={`context-radar ${currentContext?.gate.level ?? "loading"} event-${currentEvents?.gate.level ?? "loading"}`}>
            <div className="context-radar-head"><span>全市场风险雷达 · {currentContext?.profile ?? "加载中"}</span><b>{Math.max(currentContext?.gate.score ?? 0,currentEvents?.gate.score ?? 0)||"--"}<small>/100</small></b></div>
            <div className="context-radar-meter" role="meter" aria-label={`全市场风险评分 ${Math.max(currentContext?.gate.score ?? 0,currentEvents?.gate.score ?? 0)} 分`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(currentContext?.gate.score ?? 0,currentEvents?.gate.score ?? 0)}><i style={{width:`${Math.max(currentContext?.gate.score ?? 0,currentEvents?.gate.score ?? 0)}%`}}/></div>
            <p><i/>{currentContext?.gate.label ?? "正在获取指数、行业与关联品种"}</p>
            <strong>{(currentContext?.gate.action ?? marketContextError) || "15 秒级异步风控，不阻塞 1 秒个股监控"}</strong>
            {Boolean(currentContext?.items.length)&&<div className="context-radar-grid">{currentContext!.items.slice(0,6).map(item=><span key={item.id}><small>{item.label}</small><b className={(item.changePercent??0)>0?"up":(item.changePercent??0)<0?"down":""}>{item.changePercent==null?"--":`${item.changePercent>0?"+":""}${item.changePercent.toFixed(2)}%`}</b></span>)}</div>}
            <div className="event-radar-summary"><span>事件雷达 · {eventRadar?.scanned ?? 0}/{Math.min(stockList.length,10)} 股</span><b className={currentEvents?.gate.level ?? "loading"}>{currentEvents?.gate.label ?? "正在扫描公告与公开资讯"}</b><small>{currentEvents?.gate.action ?? (eventRadarError || "盘中每 60 秒更新；来源发布时间可能存在延迟")}</small></div>
            {Boolean(currentEvents?.items.length)&&<div className="event-radar-list">{currentEvents!.items.slice(0,3).map(item=><a href={item.url} target="_blank" rel="noreferrer" key={item.id} className={item.sentiment}><i>{item.sentiment==="negative"?"利空":item.sentiment==="positive"?"利好":"中性"}</i><span><b>{item.title}</b><small>{item.relatedCount&&item.relatedCount>1?`合并 ${item.relatedCount} 个来源 · `:""}{item.source} · {new Date(item.publishedAt).toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})} · {item.reason}</small></span></a>)}</div>}
            <div className="context-radar-foot"><span>{currentContext?.gate.reasons.join(" · ") || "公开行情仅供人工研判"}</span><em>{eventRadar?.sources.join(" + ") || eventRadarError || "多源事件扫描加载中"}</em></div>
          </div>
          <div className="opening-causal"><span>09:30 起实时扫描</span><b>仅使用已出现数据 · 无需手动切换</b><small>最早 09:33 显示候选，09:36–09:44 经连续走势与 VWAP 确认后才允许小仓正式信号；09:45 后恢复完整过滤。</small></div>
          {decisionZoneMode==="all"&&<><h2>{signalMode === '反T' ? openingAssessment.negativeTitle : openingAssessment.positiveTitle}</h2><p className="decision-copy">{signalMode === '反T' ? openingAssessment.negativeCopy : openingAssessment.positiveCopy}</p></>}
          <button disabled={primaryActionDisabled} className={`primary-action ${cycleStage !== 'ready' ? 'confirmed' : ''}`} onClick={handleCycleAction}>
            <span>{!stockAgent.canExecute
              ?'紫金智能体观察中 · 未开放执行'
              :cycleLimitReached
                ?`今日已完成 ${completedCycleCount}/${maxDailyTrades} 次做T`
                :cycleQuantity<100
                  ?'先设置本股持仓与单次做T数量'
                  :cycleStage==='ready'
                    ?decisionModel.status==="locked"
                      ?'风控锁定 · 暂停做T'
                      :decisionModel.status!=="ready"
                        ?'条件未完成 · 暂不可执行'
                        :formalActionMarkerPending
                          ?'正式信号待写入分时图'
                        :!decisionActionSide
                          ?'等待引擎确认实际买卖方向'
                          :`${decisionExecutionLabel} · ${cycleQuantity.toLocaleString()} 股`
                    :cycleStage==='opened'
                      ?decisionMatchesCycle&&decisionActionSide
                        ?`${decisionExecutionLabel} · ${cycleQuantity.toLocaleString()} 股`
                        :`已记录${openedCycleSide==="buy"?"买入":"卖出"} · 等待${expectedClosingSide==="sell"?"卖出":"买回"}`
                      :'本次T已闭环'}</span>
            <small>{cycleStage==='ready'
              ?decisionModel.status==="ready"&&decisionActionSide?'记录首笔成交':'完成条件后解锁'
              :cycleStage==='opened'
                ?decisionMatchesCycle?'完成反向成交':'同方向信号已冻结'
                :'开始下一次循环'} →</small>
          </button>
          <div className={`closure-guard ${cycleStage}`}>
            <div><span>当日闭环控制</span><b><i/>{cycleStage === 'ready' ? '允许开T' : cycleStage === 'opened' ? '等待闭环' : '已恢复底仓'}</b></div>
            <div className="cycle-progress"><i className="done"/><span/><i className={cycleStage !== 'ready' ? 'done' : ''}/><span/><i className={cycleStage === 'closed' ? 'done' : ''}/></div>
            <div className="cycle-labels"><span>校验通过</span><span>首笔成交</span><span>等量闭环</span></div>
            <div className="closure-metrics" aria-label="闭环风控与绩效">
              <div><span>今日剩余可卖</span><b>{Math.max(0,effectiveLivePosition.sellable).toLocaleString()}<small> 股</small></b><em>账户可卖</em></div>
              <div><span>历史胜率</span><b>{personalStrategyStats.winRate===null?'—':`${(personalStrategyStats.winRate*100).toFixed(1)}%`}</b><em>{personalStrategyStats.wins}/{personalStrategyStats.cycles} 个闭环</em></div>
              <div><span>历史净收益</span><b className={personalStrategyStats.net>0?'positive':personalStrategyStats.net<0?'negative':''}>{personalStrategyStats.cycles?money(personalStrategyStats.net):'—'}</b><em>扣费后</em></div>
            </div>
            <small>{tradeLedgerSummary.oversold
              ?'本机流水显示卖出超过昨日可卖或当前持仓为负，请立即核对券商成交。'
              :cycleLimitReached
                ?`已达到你设置的每日 ${maxDailyTrades} 次上限，今天不再新增执行信号。`
                :cycleQuantity<100
                  ?'当前股票未设置足够的现有持仓与单次做T数量，请重新设置。'
                  :cycleStage==='ready'
                    ?decisionActionSide==='sell'
                      ?`当前实际动作是卖出；本股剩余可卖 ${effectiveLivePosition.sellable.toLocaleString()} 股，后续只接受等量买回。`
                      :decisionActionSide==='buy'
                        ?`当前实际动作是买入；后续只接受卖出等量旧仓。`
                        :'等待引擎给出真实买入或卖出动作。'
                    :cycleStage==='opened'
                      ?`尚有 ${cycleQuantity.toLocaleString()} 股未配对；同方向正式信号只更新证据，等待${expectedClosingSide==="sell"?"卖出":"买回"}闭环。`
                      :'买卖数量相等，实际持仓已恢复计划底仓。'}</small>
          </div>
          <div className="risk-box"><div><span>当前利润模式</span><b>{activeProfitSummary.label}</b></div><div><span>风险边界</span><b>-0.60%</b></div><p>{activeProfitSummary.id==="zijin-small-spread"?"每股毛价差至少 ¥0.10，并且扣除佣金、印花税和双向滑点后至少盈利 ¥30 才启动保护；继续上涨则持有，回吐后退出，0.30% 净收益直接锁定。":"扣费净收益达到 0.64% 后启动利润保护；走势继续有利则持有，出现连续反向动能或明显回吐才退出，达到 1.00% 上限直接锁定。"}</p></div>
          <button className="automation-reserved" disabled><span><i />自动交易接口</span><b>已预留 · 当前关闭</b></button>
          <div className="position-row"><span>计划仓位</span><div className="position-dots"><i className="on"/><i/><i/></div><b>1 / 3</b></div>
        </aside>
      </section>

      <section className="lower-panel">
        <div className={`history ${historyCollapsed?'collapsed':''}`}>
          <div className="lower-tabs">{['今日T循环','历史信号','模拟记录'].map(item=><button key={item} onClick={()=>{setPanel(item);setHistoryCollapsed(false)}} className={panel===item?'active':''}>{item}</button>)}<button type="button" className="history-collapse-toggle" onClick={()=>setHistoryCollapsed(current=>!current)} aria-expanded={!historyCollapsed}>{historyCollapsed?'展开':'收起'} <span aria-hidden="true">{historyCollapsed?'▾':'▴'}</span></button></div>
          {!historyCollapsed&&<><div className="history-head"><span>时间</span><span>方向</span><span>价格</span><span>数量</span><span>价差</span><span>状态</span></div>
          {deskHistoryRows.length?deskHistoryRows.map((row,index)=><div className="history-row" key={`${row.time}-${row.direction}-${index}`}><span>{row.time}</span><span className={row.tone??""}>{row.direction}</span><span>{row.price}</span><span>{row.quantity}</span><span className={row.spread.startsWith("+")?"accent":""}>{row.spread}</span><span>{row.status}</span></div>):<div className="history-empty"><b>{panel==="今日T循环"?"暂无已确认闭环":panel==="历史信号"?"当前尚无候选或正式信号":"当前尚无正式模拟动作"}</b><span>{panel==="今日T循环"?"真实成交等量配对后显示":panel==="历史信号"?"候选或正式信号出现后显示":"正式模拟动作出现后显示"}</span></div>}</>}
        </div>
        <div className={`agents ${agentOpen ? 'open' : ''}`}>
          <button className="agents-title" onClick={()=>setAgentOpen(!agentOpen)}><span>四兔研究证据</span><small>当前股票 · {personalStrategyStats.sessions} 日 / {personalStrategyStats.cycles} 闭环</small><b>{agentOpen?'收起':'详情'}⌃</b></button>
          {agentOpen && <div className="training-console">
            <div className="training-control"><div><span>当前股票 · {stockAgent.name}{stockAgent.canExecute?"":"（研究观察版）"}</span><b>真实证据覆盖度</b></div><button onClick={()=>setActiveView("智能训练")}>查看研究中心</button></div>
            <div className="training-progress"><div style={{width:`${localEvidenceCoverage}%`}}/><span>{localEvidenceCoverage.toFixed(0)}%</span></div>
            <div className="training-metrics"><p><span>完整样本</span><b>{personalStrategyStats.sessions} 日</b></p><p><span>{stockAgent.canExecute?"正式闭环":"研究对照闭环"}</span><b>{personalStrategyStats.cycles}</b></p><p><span>{stockAgent.canExecute?"扣费胜率":"研究对照胜率"}</span><b>{personalStrategyStats.winRate===null?'—':`${(personalStrategyStats.winRate*100).toFixed(1)}%`}</b></p><p><span>扣费净盈亏</span><b className={personalStrategyStats.net>=0?'teal':'negative'}>{personalStrategyStats.cycles?money(personalStrategyStats.net):'—'}</b></p><p><span>最差回撤</span><b>-{(personalStrategyStats.maxDrawdown*100).toFixed(2)}%</b></p></div>
            <div className="training-log"><span>本机证据</span><p>已读取 {personalStrategyStats.sessions} 个完整交易日并核对 {personalStrategyStats.cycles} 个扣费闭环；这不是服务器训练进度。</p><em>自动晋升关闭</em></div>
          </div>}
          {agentOpen&&<div className="agent-grid">{liveAgents.map((agent,i)=><button className="agent" key={agent.name} onClick={()=>setActiveView("智能训练")} aria-label={`查看${agent.name}训练详情`}><span className={`agent-icon a${i}`}><Image src={agent.avatar} alt={`${agent.name} AI头像`} width={40} height={40}/></span><span><b>{agent.name}</b><small>{agent.role}</small></span><em><i/>{agent.state}</em><strong>{agent.value}</strong></button>)}</div>}
        </div>
      </section>
      </> : activeView === "单股智研" ? <SingleStockResearchView key={`${accountName}:${stock.code}`} accountName={accountName} stock={stock} quote={activeQuote} marketData={marketData} profile={profile} profitMode={activeProfitMode} position={activePosition} manualCount={tradeLedgerSummary.validCount} onOpenConsole={()=>setActiveView('操盘台')} /> : activeView === "AI量化研究院" ? <AIQuantResearchInstituteView /> : activeView === "多股监控" ? <MultiWatchView stocks={stockList} onManage={()=>setOnboardingOpen(true)} onOpen={(index)=>{selectActiveStock(index);setActiveView('操盘台')}} /> : activeView === "策略市场" ? <StrategyMarketView key={accountName} accountName={accountName} /> : activeView === "持仓对账" ? <HoldingsView key={`${accountName}:${stock.code}:${tradingDate}`} position={activePosition} stock={stock} tradingDate={tradingDate} rows={tradeLedgerRows} onRowsChange={saveTradeLedgerRows} /> : activeView === "智能训练" ? <TrainingView evidence={personalStrategyStats} accountName={accountName} stock={stock} position={activePosition} premiumEnabled={premiumEnabled} onOpenAccount={()=>setAccountOpen(true)} /> : <BacktestView key={`${stock.code}:${activePosition.plannedBase}:${activePosition.sellable}`} profile={profile} setProfile={setProfile} profitMode={activeProfitMode} setProfitMode={setProfitMode} position={activePosition} stock={stock} stocks={stockList} activeStock={activeStock} onSelectStock={selectActiveStock} />}

      {strategyOpen && <div className="strategy-overlay" role="dialog" aria-modal="true" aria-label="策略选择与说明">
        <div className="strategy-dialog">
          <div className="strategy-dialog-head"><div><span>INTRADAY CLOSURE ENGINE</span><h2>内置闭环，三个清晰档位</h2><p>稳健、平衡、灵敏只调整内置闭环策略的确认门槛与信号频率，不是三套互不相干的策略；四兔训练只产生候选参数，不作为手动档位。</p></div><button onClick={()=>setStrategyOpen(false)} aria-label="关闭策略说明">×</button></div>
          <div className="strategy-cards">
            {STRATEGY_PROFILES.map(name=>({name,...STRATEGY_PROFILE_META[name]})).map(item=><button key={item.name} onClick={()=>setProfile(normalizeStrategyProfile(item.name) as StrategyProfile)} className={`strategy-card ${profile===item.name?'selected':''}`}><div><h3>{item.name}</h3><span>{profile===item.name?'当前使用':'选择'}</span></div><strong>{item.tag}</strong><p>{item.fit}</p><ul><li>确认分 ≥ {item.score} · 偏离 ≥ {item.deviationPct.toFixed(2)}%</li><li>候选净空间 ≥ {item.candidateNetPct.toFixed(2)}% · 盈亏比 ≥ {item.minRewardRisk.toFixed(2)}</li><li>买/卖量比 ≥ {item.minBuyVolumeRatio.toFixed(2)} / {item.minSellVolumeRatio.toFixed(2)}</li><li>最短持有 {item.minHoldMinutes} 分钟 · 冷却 {item.cooldownMinutes} 分钟</li><li>每日最多 {item.maxCycles} 个正式闭环</li></ul><em>{item.risk}</em></button>)}
          </div>
          <div className="profit-mode-panel">
            <div><span>利润模式</span><h3>{stock.code==="601899"?"紫金矿业可选择小价差":"当前股票使用标准价差"}</h3><p>只改变费用后的盈利门槛，不降低趋势、VWAP、量价、仓位和风控条件。</p></div>
            <div className="profit-mode-actions">
              <button className={activeProfitMode==="standard"?'selected':''} onClick={()=>setProfitMode("standard")}><b>标准价差</b><small>0.64% 保护 / 1.00% 锁定</small></button>
              <button disabled={stock.code!=="601899"} className={activeProfitMode==="zijin-small-spread"&&stock.code==="601899"?'selected':''} onClick={()=>setProfitMode("zijin-small-spread")}><b>紫金小价差</b><small>每股 ≥ ¥0.10 / 扣费净利 ≥ ¥30</small></button>
            </div>
          </div>
          <div className="custom-strategy"><div className="custom-head"><div><h3>自定义规则草稿</h3><p>用于记录你的研究想法。自然语言目前不会直接变成可执行参数，也不会冒充已运行策略。</p></div><span>仅保存备注</span></div><textarea value={customStrategy} onChange={e=>setCustomStrategy(e.target.value)} aria-label="自定义做T规则草稿"/><div className="hard-guards"><span>正式执行仍受：</span><b>可卖数量</b><b>费用与滑点</b><b>14:30开仓限制</b><b>尾盘仓位恢复</b><b>连续失败熔断</b></div></div>
          <div className="opening-rule"><span>开盘因果规则</span><p>09:30立即开始扫描；积累至少4个真实分钟点后即可出现候选。低开重新站上VWAP、高开跌破VWAP且确认后，分两次各 1/6；早盘累计不超过 1/3，所有判断只使用当时及此前数据。</p><button onClick={()=>{try{localStorage.setItem(`rabbit-custom-strategy:${accountName.toLowerCase()}`,customStrategy)}catch{}setStrategyOpen(false)}}>保存规则草稿</button></div>
        </div>
      </div>}

      {accountOpen && <div className="account-overlay" role="dialog" aria-modal="true" aria-label="账户中心" onMouseDown={e=>{if(e.target===e.currentTarget)setAccountOpen(false)}}><div className="account-dialog">
        <div className="account-head"><div className="account-avatar">{accountName.slice(0,1).toUpperCase()}</div><div><span>{demoMode?'免注册演示已进入':'服务器账户已登录'}</span><h2>{accountName}</h2><p>{demoMode?'临时演示会话':accountRole==='admin'?'管理员账户':'会员账户 · 跨设备同步'}</p></div><button onClick={()=>setAccountOpen(false)} aria-label="关闭账户中心">×</button></div>
        <div className="account-plan"><div><span>当前状态</span><b>{demoMode?'免注册演示':accountRole==='admin'?'运营管理员':accountMembership?.active?(accountMembership.planId==='yearly'?'年 V 会员':accountMembership.planId==='day'?'测试天卡':'月卡'):'内测权益已到期'}</b><small>{demoMode?'不跨设备同步，刷新后可能丢失':accountRole==='admin'?'管理员权益长期有效':accountMembership?.expiresAt?`有效至 ${membershipExpiry}`:'监控清单、持仓设置和提醒偏好已保存到服务器'}</small></div><em>{demoMode?'演示中':accountMembership?.active||accountRole==='admin'?'有效':'已到期'}</em></div>
        <div className={`account-premium-features ${premiumEnabled?"enabled":"locked"}`}><div><span>高级会员能力</span><b>{premiumEnabled?"已全部开启":"购买会员后开启"}</b></div><ul><li>9:25盘前预判</li><li>L2精确价区间</li><li>提醒历史复盘</li><li>个人回放训练</li></ul><a href="/pricing">查看方案与收费标准 →</a></div>
        {!demoMode&&accountRole!=='admin'&&<MembershipRedeem onRedeemed={setAccountMembership}/>}
        {!demoMode&&accountRole!=='admin'&&accountMembership?.referralCode&&<div className="account-referral"><div><span>邀请好友</span><b>有效注册 1 人，+7 天权益</b><small>邀请码 {accountMembership.referralCode} · 已奖励 {accountMembership.referralCredits} 人{accountMembership.referralReviews?` · 待审核 ${accountMembership.referralReviews} 人`:''}</small></div><button onClick={()=>void copyReferralLink()}>复制邀请链接</button>{inviteMessage&&<em>{inviteMessage}</em>}</div>}
        <div className="account-stats"><div><span>监控股票</span><b>{stockList.length} / {monitorLimit}</b></div><div><span>后台监控</span><b>{demoMode?'关闭':'已连接'}</b></div><div><span>策略版本</span><b>闭环</b></div></div>
        <div className="account-settings"><h3>账户偏好</h3><label><span>默认股票<small>进入操盘台后优先显示</small></span><b>{preferences.stock.split(' ')[0]}</b></label><label><span>当前股票计划底仓<small>{stock.code} · 用于当日闭环校验</small></span><b>{activePosition.plannedBase.toLocaleString()} 股</b></label><label><span>风险偏好<small>影响提醒强度，不绕过硬风控</small></span><b>{preferences.risk}</b></label><label><span>自动交易<small>券商接口尚未连接</small></span><b className="account-off">关闭</b></label></div>
        <div className="account-security"><i>✓</i><p><b>{demoMode?'演示边界':'密码与会话安全'}</b><span>{demoMode?'演示不连接券商、不执行下单，也不会冒充正式账户。':'密码使用 scrypt 加盐哈希保存；登录会话使用 HttpOnly Cookie，前端不会读取密码或会话令牌。'}</span></p></div>
        <div className="account-footer-actions"><button onClick={()=>setAccountOpen(false)}>完成</button><button onClick={()=>{setAccountOpen(false);setOnboardingOpen(true)}}>修改偏好</button>{accountRole==='admin'&&!demoMode&&<button onClick={()=>{setAccountOpen(false);setMemberAdminOpen(true)}}>会员后台</button>}<button onClick={()=>{void fetch('/api/control/auth/logout',{method:'POST',credentials:'include'}).catch(()=>{});try{localStorage.removeItem('rabbit-auth-session');localStorage.removeItem('rabbit-account-role');sessionStorage.removeItem('rabbit-auth-session')}catch{} remoteSyncReady.current=false;setAccountOpen(false);setDemoMode(false);setAuthScreen('landing');setLocalAuth(false);onLogout?.()}}>{demoMode?'退出演示':'退出登录'}</button></div>
      </div></div>}
      {memberAdminOpen&&<MemberAdminView onClose={()=>setMemberAdminOpen(false)}/>}
      {alertLogOpen&&premiumEnabled&&<AlertLogView stocks={stockList} activeCode={stock.code} localHistory={alertHistory} onClose={()=>setAlertLogOpen(false)}/>}
      {onboardingOpen&&<OnboardingView key={`${accountName}:${Object.keys(stockPositions).length}:${stockList.length}`} accountName={accountName} initial={preferences} initialList={stockList} initialPositions={stockPositions} maxStocks={monitorLimit} onSave={(next,list,positions)=>{const allowed=enforceWatchlistLimit(list,accountRole,accountMembership?.active===true,accountMembership?.planId);const allowedCodes=new Set(allowed.map(item=>item.code));const allowedPositions=Object.fromEntries(Object.entries(positions).filter(([code])=>allowedCodes.has(code)));setPreferences(next);setHasPersistedPreferences(true);setStockList(allowed);setStockPositions(allowedPositions);setActiveStock(current=>Math.min(current,allowed.length-1));try{localStorage.setItem(`rabbit-prefs:${accountName.toLowerCase()}`,JSON.stringify(next));localStorage.setItem(`rabbit-watchlist:${accountName.toLowerCase()}`,JSON.stringify(allowed))}catch{}setOnboardingOpen(false)}}/>}
      {tShareOpen&&<div className="t-share-overlay" role="dialog" aria-modal="true" aria-label="今日做T复盘分享" onMouseDown={event=>{if(event.target===event.currentTarget)setTShareOpen(false)}}>
        <section className="t-share-dialog">
          <header className="t-share-head"><div><span>RABBIT SMART-T · SHARE</span><h2>{tShareTitle}</h2><p>今日信号全部标记；实心点为正式动作，空心点为候选观察。</p></div><button type="button" onClick={()=>setTShareOpen(false)} aria-label="关闭分享卡">×</button></header>
          <div className="t-share-body">
            <div className={`t-share-preview ${tShareBusy?"loading":""}`}>{tShareImage?<Image src={tShareImage} alt={`${activeQuote?.name||stock.name}${tShareTitle}分享图预览`} width={540} height={720} unoptimized/>:<span>{tShareBusy?"正在生成分享图…":"暂无预览"}</span>}</div>
            <aside className="t-share-controls">
              <div className="t-share-summary"><span>{activeQuote?.name||stock.name} · {stock.code}</span><b>{tShareStatus}</b><small>{tShareFormalActions.length} 个正式动作 · {tShareObservationSignals.length} 个观察信号 · {minutePoints.length} 个有效分钟点</small></div>
              <label className="t-share-qr"><span><b>附带官网二维码</b><small>二维码只跳转公开官网，不包含账户信息</small></span><input type="checkbox" checked={tShareQrEnabled} onChange={event=>{const checked=event.target.checked;setTShareQrEnabled(checked);void generateTShareCard(checked)}}/></label>
              <textarea className="t-share-copy" value={tShareCopy} readOnly aria-label="分享文案"/>
              <div className="t-share-actions"><button type="button" className="primary" disabled={!tShareImage||tShareBusy} onClick={()=>void systemTShare()}>系统分享</button><button type="button" disabled={!tShareImage||tShareBusy} onClick={downloadTShare}>保存图片</button><button type="button" onClick={()=>void copyTShareText()}>复制文案</button></div>
              <p className="t-share-platform-note">抖音、小红书、雪球需在对应平台内自行发布；网页不会代替用户自动发帖。</p>
              {tShareMessage&&<output className="t-share-message">{tShareMessage}</output>}
            </aside>
          </div>
        </section>
      </div>}

      <footer className="trade-footer"><span><i className="online"/>策略研究工具 · 非交易级</span><ReleaseVersion/></footer>
    </main>
  );
}

export function AuthView({onAuthenticated,onBack,onDemo,theme,onToggleTheme}:{onAuthenticated:(name:string,isNew:boolean,remember:boolean,membership:Membership|null)=>void;onBack:()=>void;onDemo:()=>void;theme:UiTheme;onToggleTheme:()=>void}) {
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
  const [referralCode]=useState(()=>typeof window==='undefined'?'':(new URLSearchParams(window.location.search).get('ref')||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,16));
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
        body:JSON.stringify({username:name,password,displayName:name,remember:mode==='register'?true:remember,referralCode:mode==='register'?referralCode:undefined}),
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||'账号服务暂不可用');
      localStorage.setItem('rabbit-account-role',payload.user?.role||'member');
      onAuthenticated(payload.user?.displayName||payload.user?.username||name,mode==='register',remember,payload.user?.membership??null);
    }catch(error){setError(error instanceof Error?error.message:'账号服务暂不可用，请稍后重试');}finally{setBusy(false);}
  };
  return <main className="auth-page">
    <div className="auth-entry-floating">
      <button type="button" onClick={onBack}>← 产品首页</button>
      <span><a href="/terms" target="_blank" rel="noreferrer">用户协议</a><i/> <a href="/privacy" target="_blank" rel="noreferrer">隐私政策</a></span>
      <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label={theme==='dark'?'切换到白天模式':'切换到黑夜模式'} title={theme==='dark'?'白天模式':'黑夜模式'}><span aria-hidden="true">{theme==='dark'?'☀':'☾'}</span></button>
      <button type="button" onClick={onDemo}>免注册演示</button>
    </div>
    <section className="auth-brand-panel"><div className="auth-brand"><Image className="brand-primary-logo" src="/double-rabbit-assistant-brand.png" alt="双兔助手双兔无限线品牌标志" width={280} height={72} priority/><span><b aria-label="双兔助手 做T神器"><span aria-hidden="true">双兔助手</span></b><small>做T神器 · RABBIT QUANT</small></span></div><div className="auth-message"><span className="eyebrow">RABBIT SMART‑T</span><h1>把复杂的盘面，<br/><em>变成简单的操作。</em></h1><p>多股监控、正反T决策、当日仓位闭环与四兔持续训练。</p></div><div className="auth-points"><span><i/>市场雷达硬门控</span><span><i/>T+1可卖数量校验</span><span><i/>收盘恢复计划底仓</span></div><small className="auth-disclaimer">策略研究工具 · 不构成投资建议</small></section>
    <section className="auth-form-panel"><div className="auth-card"><div className="auth-card-head"><span>{resetMode?'RESET PASSWORD':mode==='login'?'WELCOME BACK':'CREATE ACCOUNT'}</span><h2>{resetMode?'使用一次性重置码':mode==='login'?'登录做T神器':'创建服务器账户'}</h2><p>{resetMode?'输入管理员提供的 30 分钟有效重置码，并设置新密码。':mode==='login'?'继续查看你的监控、回测和训练记录。':'注册后可在电脑和手机使用同一监控清单。'}</p></div><div className="auth-tabs"><button className={mode==='login'&&!resetMode?'active':''} onClick={()=>{setMode('login');setResetMode(false);setError('')}}>登录</button><button className={mode==='register'?'active':''} onClick={()=>{setMode('register');setResetMode(false);setError('')}}>注册</button></div>{mode==='register'&&!resetMode&&referralCode&&<div className="auth-referral"><b>已绑定邀请</b><span>{referralCode}</span><small>完成有效注册后，邀请人将获得 7 天内测权益。</small></div>}<label className="auth-field"><span>账号</span><input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" placeholder="用户名或邮箱"/></label>{resetMode&&<label className="auth-field"><span>一次性重置码</span><input value={resetToken} onChange={e=>setResetToken(e.target.value)} autoComplete="one-time-code" placeholder="粘贴管理员提供的重置码"/></label>}<label className="auth-field"><span>{resetMode?'新密码':'密码'}</span><div><input value={password} onChange={e=>setPassword(e.target.value)} type={showPassword?'text':'password'} autoComplete={mode==='login'&&!resetMode?'current-password':'new-password'} placeholder="至少 8 个字符"/><button onClick={()=>setShowPassword(!showPassword)} type="button">{showPassword?'隐藏':'显示'}</button></div></label>{mode==='register'&&!resetMode&&<><div className="password-strength"><span>密码强度</span><i className={strength>0?'on':''}/><i className={strength>1?'on':''}/><i className={strength>2?'on':''}/><i className={strength>3?'on':''}/><b>{strength<2?'较弱':strength<4?'可用':'较强'}</b></div><label className="auth-field"><span>确认密码</span><input value={confirm} onChange={e=>setConfirm(e.target.value)} type={showPassword?'text':'password'} autoComplete="new-password" placeholder="再次输入密码"/></label><label className="terms-check"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/><span>我已阅读并同意《用户协议》和《隐私政策》，理解本工具不构成投资建议。</span></label></>}{mode==='login'&&!resetMode&&<div className="auth-options"><label><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/><span>记住登录</span></label><button type="button" onClick={()=>void requestReset()}>忘记密码？</button></div>}{resetMode&&<div className="auth-options"><span>重置后旧设备会自动退出</span><button type="button" onClick={()=>{setResetMode(false);setError('')}}>返回登录</button></div>}{error&&<div className="auth-error"><i>!</i>{error}</div>}<button className="auth-submit" onClick={submit} disabled={busy}>{busy?'正在验证…':resetMode?'更新密码':mode==='login'?'登录':'注册并进入'}<span>→</span></button><div className="auth-local-note"><i>i</i><p><b>服务器账户</b><span>账号、监控股票和持仓设置保存在服务器，可跨设备同步；密码仅保存为不可逆哈希。</span></p></div></div><footer className="auth-footer">© 2026 Rabbit Quant · 用户协议 · 隐私政策</footer></section>
  </main>;
}

function AlertLogView({stocks,activeCode,localHistory,onClose}:{stocks:{code:string;name:string}[];activeCode:string;localHistory:TradeAlertToast[];onClose:()=>void}){
  type ServerAlertRecord = {
    id:string|number; code?:string; createdAt:string; marketTime?:string; level?:string;
    title?:string; message?:string; eventKey?:string|null; deliveryStatus?:MonitorScanLog["deliveryStatus"];
    deliveryChannel?:string|null; deliveredAt?:string|null; deliveryError?:string|null;
    payload?:{provider?:string;action?:{price?:number};observation?:{price?:number}};
  };
  const [code,setCode]=useState('');
  const [logs,setLogs]=useState<MonitorScanLog[]>([]);
  const [health,setHealth]=useState<{ok:boolean;tradingWindow:boolean;scanner:{running:boolean;lastCompletedAt:string|null;monitored:number;inserted:number;logged:number;marketErrors:number;error:string|null}}|null>(null);
  const [healthError,setHealthError]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [heartbeatNow,setHeartbeatNow]=useState<number|null>(null);
  const load=useCallback(async()=>{
    setLoading(true);setError('');setHealthError('');
    try{
      const query=new URLSearchParams({limit:'120'});if(code)query.set('code',code);
      const [response,alertsResponse,healthResponse]=await Promise.all([
        fetch(`/api/control/alert-log?${query}`,{credentials:'include',cache:'no-store'}),
        fetch('/api/control/alerts?afterId=0&limit=100',{credentials:'include',cache:'no-store'}).catch(()=>null),
        fetch('/api/control/health',{credentials:'include',cache:'no-store'}).catch(()=>null),
      ]);
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||'提醒日志接口暂不可用');
      const serverPayload=alertsResponse?.ok?await alertsResponse.json().catch(()=>({})):null;
      const stockNames=new Map(stocks.map(item=>[item.code,item.name]));
      const formatDate=(createdAt:string)=>{
        const value=new Date(createdAt);
        if(Number.isNaN(value.getTime()))return {date:'--',time:'----'};
        const parts=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(value);
        const part=(type:string)=>parts.find(item=>item.type===type)?.value??'';
        return {date:`${part('year')}${part('month')}${part('day')}`,time:`${part('hour')}${part('minute')}`};
      };
      const serverLogs:MonitorScanLog[]=(Array.isArray(serverPayload?.alerts)?serverPayload.alerts:[]).map((item:ServerAlertRecord)=>{
        const stamp=formatDate(item.createdAt);
        return {
          id:`server-${item.id}`,code:String(item.code??''),name:stockNames.get(String(item.code))??String(item.code??''),
          marketDate:stamp.date,marketTime:String(item.marketTime??stamp.time).replace(/\D/g,'').slice(0,4),
          price:Number(item.payload?.action?.price??item.payload?.observation?.price)||null,
          result:item.level==='formal'?'formal':item.level==='risk'?'risk':'candidate',
          reason:[item.title,item.message].filter(Boolean).join('：'),provider:item.payload?.provider??'服务端监控',
          eventKey:item.eventKey??null,createdAt:item.createdAt,deliveryStatus:item.deliveryStatus??'stored',
          deliveryChannel:item.deliveryChannel??null,deliveredAt:item.deliveredAt??null,deliveryError:item.deliveryError??null,
        };
      });
      const localLogs:MonitorScanLog[]=localHistory.map((item,index)=>{
        const stamp=formatDate(item.createdAt??new Date().toISOString());
        const itemCode=String(item.code??activeCode);
        return {
          id:`local-${item.id??index}`,code:itemCode,name:stockNames.get(itemCode)??itemCode,
          marketDate:stamp.date,marketTime:stamp.time,price:null,
          result:item.level==='signal'?'formal':item.level==='risk'?'risk':'candidate',
          reason:[item.title,item.message].filter(Boolean).join('：'),provider:item.source==='server'?'服务端监控':'操盘台实时引擎',
          eventKey:item.eventKey??null,createdAt:item.createdAt??new Date().toISOString(),
          deliveryStatus:'displayed',deliveryChannel:'操盘台前台',
        };
      });
      const auditLogs:MonitorScanLog[]=(Array.isArray(payload.logs)?payload.logs:[])
        .filter((item:MonitorScanLog)=>['formal','candidate','watch','risk'].includes(item.result));
      const merged=new Map<string,MonitorScanLog>();
      for(const item of [...localLogs,...auditLogs,...serverLogs]){
        if(code&&item.code!==code)continue;
        const key=item.eventKey||`${item.code}:${item.createdAt}:${item.result}:${item.reason}`;
        merged.set(key,{...(merged.get(key)??{}),...item});
      }
      setLogs([...merged.values()].sort((left,right)=>new Date(right.createdAt).getTime()-new Date(left.createdAt).getTime()).slice(0,200));
      if(healthResponse?.ok){
        const healthPayload=await healthResponse.json().catch(()=>null);
        if(healthPayload?.scanner)setHealth(healthPayload);
        else {setHealth(null);setHealthError('服务器未返回扫描器状态')}
      }else {setHealth(null);setHealthError('暂时无法读取后台心跳')}
    }catch(error){setLogs([]);setError(error instanceof Error?error.message:'无法读取提醒日志')}
    finally{setLoading(false);setHeartbeatNow(Date.now())}
  },[activeCode,code,localHistory,stocks]);
  useEffect(()=>{
    const timer=window.setTimeout(()=>void load(),0);
    return()=>window.clearTimeout(timer);
  },[load]);
  useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[onClose]);
  const isAlertResult=(result:string)=>result==='formal'||result==='candidate'||result==='risk'||result==='watch';
  const isErrorResult=(result:string)=>result==='market_error'||result==='no_data';
  const resultLabel=(result:string)=>result==='formal'?'正式信号':result==='candidate'?'候选提醒':result==='risk'?'风险提醒':result==='watch'?'观察记录':result==='market_error'?'行情异常':result==='no_data'?'暂无分时':'未触发';
  const alertCount=logs.filter(item=>isAlertResult(item.result)).length;
  const errorCount=logs.filter(item=>isErrorResult(item.result)).length;
  const lastCompletedAt=health?.scanner.lastCompletedAt?new Date(health.scanner.lastCompletedAt):null;
  const heartbeatAge=lastCompletedAt&&heartbeatNow!==null&&!Number.isNaN(lastCompletedAt.getTime())?heartbeatNow-lastCompletedAt.getTime():null;
  const heartbeatStale=Boolean(health?.tradingWindow&&(heartbeatAge===null||heartbeatAge>90_000));
  const healthTone=health?.scanner.error||heartbeatStale?'error':health?.scanner.running?'running':health?'healthy':'unknown';
  const healthLabel=health?.scanner.error?'扫描异常':heartbeatStale?'心跳超时':health?.scanner.running?'正在扫描':health?.tradingWindow?'后台正常':'休市待命';
  const deliveryText=(item:MonitorScanLog)=>{
    if(!isAlertResult(item.result))return {label:'无需发送',detail:'仅保留扫描证据',tone:'quiet'};
    if(!item.deliveryStatus)return {label:'等待入队',detail:'尚未生成提醒记录',tone:'pending'};
    if(item.deliveryStatus==='failed')return {label:'发送失败',detail:item.deliveryError||'未记录失败原因',tone:'error'};
    if(item.deliveryStatus==='notified')return {label:'通知已送达',detail:item.deliveryChannel||'浏览器通知',tone:'sent'};
    if(item.deliveryStatus==='displayed')return {label:'页面已显示',detail:item.deliveryChannel||'站内提醒',tone:'sent'};
    return {label:'等待浏览器领取',detail:'服务器已记录；关闭浏览器时无法播放语音或浏览器弹窗',tone:'pending'};
  };
  return <div className="account-overlay alert-log-overlay" role="dialog" aria-modal="true" aria-label="提醒历史记录" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <section className="alert-log-dialog">
      <header><div><span>ALERT HISTORY</span><h2>提醒历史记录</h2><p>只显示实际出现过的候选、正式、风险与观察提醒；合并操盘台前台和服务器后台记录。</p></div><button type="button" onClick={onClose} aria-label="关闭提醒历史记录">×</button></header>
      <div className="alert-log-toolbar"><label><span>查看股票</span><select value={code} onChange={event=>setCode(event.target.value)}><option value="">全部监控股票</option>{stocks.map(item=><option key={item.code} value={item.code}>{item.code} {item.name}{item.code===activeCode?'（当前）':''}</option>)}</select></label><button type="button" onClick={()=>void load()} disabled={loading}>{loading?'读取中…':'刷新记录'}</button></div>
      <div className={`alert-log-health ${healthTone}`}><i/><div><small>后台监控状态</small><b>{healthError||healthLabel}</b></div><p><span>最近完成</span><strong>{lastCompletedAt&&!Number.isNaN(lastCompletedAt.getTime())?lastCompletedAt.toLocaleString('zh-CN',{hour12:false}):'尚无记录'}</strong></p><p><span>本轮扫描</span><strong>{health?`${health.scanner.monitored} 只 · 记录 ${health.scanner.logged} 条`:'—'}</strong></p><p><span>行情异常</span><strong>{health?`${health.scanner.marketErrors} 次`:'—'}</strong></p></div>
      <div className="alert-log-summary"><p><small>历史记录</small><b>{logs.length}</b></p><p><small>实际提醒</small><b>{alertCount}</b></p><p><small>读取异常</small><b>{errorCount}</b></p><em>服务端记录保留最近 7 天；本机前台提醒最多保留 200 条，并按事件去重。</em></div>
      {error?<div className="alert-log-state error"><b>暂时无法读取</b><span>{error}</span><small>本机已出现的提醒仍会继续保存，恢复连接后会和服务器记录合并。</small></div>:loading?<div className="alert-log-state"><b>正在读取提醒历史…</b></div>:logs.length===0?<div className="alert-log-state"><b>尚无提醒记录</b><span>出现候选、正式买卖点或风险提醒后，这里会自动留下时间、原因和来源。</span></div>:<div className="alert-log-list"><div className="alert-log-row head"><span>股票</span><span>时间 / 价格</span><span>类型</span><span>提醒内容</span><span>送达结果</span><span>来源</span></div>{logs.map(item=>{const delivery=deliveryText(item);return <div className={`alert-log-row ${isAlertResult(item.result)?'alert':isErrorResult(item.result)?'error':item.result}`} key={item.id}><span><b>{item.code}</b><small>{item.name}</small></span><span><b>{item.marketTime?.length>=4?`${item.marketTime.slice(0,2)}:${item.marketTime.slice(2)}`:'--:--'}</b><small>{item.marketDate} · {item.price==null?'--':`¥${Number(item.price).toFixed(2)}`}</small></span><span><em>{resultLabel(item.result)}</em></span><span><b>{item.reason||'未记录提醒内容'}</b><small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small></span><span className={`delivery ${delivery.tone}`}><b>{delivery.label}</b><small>{delivery.detail}</small></span><span><small>{item.provider||'--'}</small></span></div>})}</div>}
    </section>
  </div>;
}

function MembershipRedeem({onRedeemed}:{onRedeemed:(membership:Membership)=>void}){
  const [code,setCode]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<{tone:'ok'|'error';text:string}|null>(null);
  const redeem=async()=>{
    const value=code.trim();
    if(!value){setMessage({tone:'error',text:'请输入购买或领取到的激活码'});return}
    setBusy(true);setMessage(null);
    try{
      const response=await fetch('/api/control/membership/redeem',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({code:value})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||'兑换失败，请核对激活码');
      if(payload.membership)onRedeemed(payload.membership);
      setCode('');
      setMessage({tone:'ok',text:`${payload.planLabel||'会员权益'}兑换成功，已增加 ${payload.days||''} 天`});
    }catch(error){setMessage({tone:'error',text:error instanceof Error?error.message:'兑换失败，请稍后重试'})}
    finally{setBusy(false)}
  };
  return <section className="account-redeem" aria-label="会员激活码兑换">
    <div className="account-redeem-head"><div><span>激活码兑换</span><b>购买后自行开通</b></div><a href="/pricing">购买说明</a></div>
    <div className="account-redeem-form"><input value={code} onChange={event=>setCode(event.target.value.toUpperCase())} onKeyDown={event=>{if(event.key==='Enter')void redeem()}} autoComplete="one-time-code" placeholder="输入 RQ- 开头的激活码" aria-label="会员激活码"/><button type="button" disabled={busy} onClick={()=>void redeem()}>{busy?'兑换中…':'立即兑换'}</button></div>
    <small>天卡、月卡和年卡均可兑换；未到期会员会在原到期日基础上顺延。</small>
    {message&&<em className={message.tone}>{message.text}</em>}
  </section>;
}

function MemberAdminView({onClose}:{onClose:()=>void}){
  const [members,setMembers]=useState<MemberRecord[]>([]);
  const [busyId,setBusyId]=useState('');
  const [error,setError]=useState('');
  const [resetInfo,setResetInfo]=useState<{username:string;token:string;expiresAt:string}|null>(null);
  const [codePlan,setCodePlan]=useState<MembershipPlanId>('monthly');
  const [codeCount,setCodeCount]=useState(1);
  const [codeBusy,setCodeBusy]=useState(false);
  const [generatedCodes,setGeneratedCodes]=useState<IssuedMembershipCode[]>([]);
  const [codeMessage,setCodeMessage]=useState('');
  const load=async()=>{setError('');try{const response=await fetch('/api/control/admin/members',{credentials:'include',cache:'no-store'});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'无法读取会员');setMembers(payload.members??[])}catch(error){setError(error instanceof Error?error.message:'无法读取会员')}};
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[]);
  const updateStatus=async(member:MemberRecord)=>{setBusyId(member.id);setError('');try{const response=await fetch(`/api/control/admin/members/${member.id}`,{method:'PATCH',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({status:member.status==='active'?'paused':'active'})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'状态更新失败');await load()}catch(error){setError(error instanceof Error?error.message:'状态更新失败')}finally{setBusyId('')}};
  const issueReset=async(member:MemberRecord)=>{setBusyId(member.id);setError('');try{const response=await fetch(`/api/control/admin/members/${member.id}/reset`,{method:'POST',credentials:'include'});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'无法生成重置码');setResetInfo(payload)}catch(error){setError(error instanceof Error?error.message:'无法生成重置码')}finally{setBusyId('')}};
  const grantMembership=async(member:MemberRecord,days:number,planId?:MembershipPlanId)=>{setBusyId(member.id);setError('');try{const response=await fetch(`/api/control/admin/members/${member.id}/membership`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({days,planId})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'权益发放失败');await load()}catch(error){setError(error instanceof Error?error.message:'权益发放失败')}finally{setBusyId('')}};
  const createCodes=async()=>{
    setCodeBusy(true);setError('');setCodeMessage('');setGeneratedCodes([]);
    try{
      const response=await fetch('/api/control/admin/membership-codes',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({planId:codePlan,count:codeCount,validForDays:180})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||'激活码生成失败');
      setGeneratedCodes(Array.isArray(payload.codes)?payload.codes:[]);
      setCodeMessage('激活码已生成；请立即复制并交付，关闭后后台不再显示明文。');
    }catch(error){setError(error instanceof Error?error.message:'激活码生成失败')}finally{setCodeBusy(false)}
  };
  const copyCodes=async()=>{const value=generatedCodes.map(item=>item.code).join('\n');if(!value)return;try{await navigator.clipboard.writeText(value);setCodeMessage(`已复制 ${generatedCodes.length} 个激活码`)}catch{setCodeMessage('浏览器未允许复制，请手动选中激活码')}};
  return <div className="member-admin-overlay" role="dialog" aria-modal="true" aria-label="会员后台" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><section className="member-admin-panel"><header><div><span>MEMBER CONTROL</span><h2>会员与后台监控</h2><p>天卡 1 天、月卡 31 天、年卡 366 天；未到期会员会从原到期日继续顺延。</p></div><button onClick={onClose} aria-label="关闭会员后台">×</button></header>{error&&<div className="member-admin-error">{error}</div>}{resetInfo&&<div className="member-reset-token"><span>{resetInfo.username} 的一次性重置码</span><code>{resetInfo.token}</code><small>{new Date(resetInfo.expiresAt).toLocaleString('zh-CN')} 前有效；发送给会员后请勿再次公开。</small><button onClick={()=>void navigator.clipboard?.writeText(resetInfo.token)}>复制重置码</button></div>}
    <section className="member-code-issuer"><div className="member-code-issuer-head"><div><span>ACTIVATION CODES</span><h3>生成会员激活码</h3><p>激活码只在本次生成时明文显示，后台只保存不可逆摘要。</p></div><button type="button" disabled={codeBusy} onClick={()=>void createCodes()}>{codeBusy?'生成中…':'生成激活码'}</button></div><div className="member-code-controls"><label><span>套餐</span><select value={codePlan} onChange={event=>setCodePlan(event.target.value as MembershipPlanId)}><option value="day">测试天卡 · ¥4.9</option><option value="monthly">月卡 · ¥99</option><option value="yearly">年卡 · ¥298</option></select></label><label><span>数量</span><input type="number" min="1" max="20" value={codeCount} onChange={event=>setCodeCount(Math.max(1,Math.min(20,Number(event.target.value)||1)))}/></label><small>每批最多 20 个，未兑换码 180 天后失效。</small></div>{generatedCodes.length>0&&<div className="member-code-result"><div><b>本批激活码</b><button type="button" onClick={()=>void copyCodes()}>复制全部</button></div><ul>{generatedCodes.map(item=><li key={item.code}><code>{item.code}</code><span>{item.planLabel} · {item.days} 天</span></li>)}</ul></div>}{codeMessage&&<em className="member-code-message">{codeMessage}</em>}</section>
    <div className="member-admin-summary"><span>正式会员 <b>{members.filter(item=>item.role==='member').length}</b></span><span>正在监控 <b>{members.reduce((sum,item)=>sum+Number(item.monitorCount||0),0)} 只</b></span><span>后台告警 <b>{members.reduce((sum,item)=>sum+Number(item.alertCount||0),0)} 条</b></span><button onClick={()=>void load()}>刷新</button></div><div className="member-table"><div className="member-row member-head"><span>会员</span><span>状态 / 权益</span><span>监控 / 告警</span><span>最近登录</span><span>操作</span></div>{members.map(member=><div className="member-row" key={member.id}><span><b>{member.displayName}</b><small>{member.username} · {member.role==='admin'?'管理员':'会员'}</small></span><span><em className={member.status}>{member.status==='active'?'正常':'已暂停'}</em><small>{member.role==='admin'?'管理员 · 30 只监控':member.membership?.active?`${member.membership.planId==='yearly'?'年 V 会员':member.membership.planId==='day'?'测试天卡':'月卡'} · ${member.membership.planId==='yearly'?30:5} 只监控 · 至 ${new Date(member.membership.expiresAt!).toLocaleDateString('zh-CN')}`:member.membership?.expiresAt?`已到期 · 至 ${new Date(member.membership.expiresAt).toLocaleDateString('zh-CN')}`:'未开通'}</small></span><span><b>{member.monitorCount} / {member.alertCount}</b></span><span><small>{member.lastLoginAt?new Date(member.lastLoginAt).toLocaleString('zh-CN'):'从未登录'}</small></span><span>{member.role==='admin'?<small>系统管理员</small>:<><button disabled={busyId===member.id} onClick={()=>void updateStatus(member)}>{member.status==='active'?'暂停':'恢复'}</button><button disabled={busyId===member.id} onClick={()=>void grantMembership(member,1)}>+1 天</button><button disabled={busyId===member.id} onClick={()=>void grantMembership(member,31)}>+31 天</button><button disabled={busyId===member.id} onClick={()=>void grantMembership(member,366,"yearly")}>设为年 V · 30 只</button><button disabled={busyId===member.id} onClick={()=>void issueReset(member)}>重置码</button></>}</span></div>)}</div></section></div>;
}

function HomeView({onNavigate,onOpenZijin,stockCount,canInvite,referralCredits,onCopyInvite,inviteMessage}:{onNavigate:(view:string)=>void;onOpenZijin:()=>void;stockCount:number;canInvite:boolean;referralCredits:number;onCopyInvite:()=>void;inviteMessage:string}) {
  const timeParts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());
  const readPart=(type:string)=>timeParts.find(part=>part.type===type)?.value??'';
  const marketMinute=(Number(readPart('hour'))||0)*60+(Number(readPart('minute'))||0);
  const isTradingDay=['Mon','Tue','Wed','Thu','Fri'].includes(readPart('weekday'));
  const isMarketSession=isTradingDay&&((marketMinute>=555&&marketMinute<=690)||(marketMinute>=780&&marketMinute<=900));
  return <section className="product-home">
    <div className="home-hero">
      <div className="home-copy"><span className="eyebrow">RABBIT SMART‑T WORKSPACE</span><h1>做T神器</h1><p className="home-promise">看清买卖点，完成日内闭环。</p><p className="home-intro">集合竞价研判、市场雷达、正反T决策和仓位闭环集中在同一个交易工作台。</p><div className="home-actions"><div><button onClick={()=>onNavigate('操盘台')}>{isMarketSession?'进入盘中操盘台':'进入今日操盘台'} <span>→</span></button><small><i className={isMarketSession?'live':''}/>{isMarketSession?'当前为盘中监控时段':'当前为盘后复盘时段'}</small></div><button onClick={()=>onNavigate('模拟回测')}>模拟回测</button></div><div className="home-trust"><span><i/>不自动下单</span><span><i/>T+1仓位校验</span><span><i/>收盘恢复底仓</span><em>持续扫描 {stockCount} 只自选股</em></div></div>
      <div className="home-terminal"><div className="terminal-head"><span>601899 紫金矿业</span><em><i/>策略示例 · 非实时</em></div><div className="terminal-price"><strong>闭环决策台</strong><span>进入操盘台查看</span><small>买点 · 卖点 · 风控</small></div><svg viewBox="0 0 600 180" preserveAspectRatio="none"><defs><linearGradient id="homeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#28d7c4" stopOpacity=".18"/><stop offset="1" stopColor="#28d7c4" stopOpacity="0"/></linearGradient></defs><path d="M0 145 C45 132 70 151 105 116 S170 127 205 88 S270 99 310 69 S370 91 410 58 S485 74 525 40 S570 52 600 20 L600 180 L0 180Z" fill="url(#homeFill)"/><path d="M0 145 C45 132 70 151 105 116 S170 127 205 88 S270 99 310 69 S370 91 410 58 S485 74 525 40 S570 52 600 20" className="home-line"/></svg><div className="terminal-signal"><span><i className="rabbit-dot-home">兔</i><b>研究提示</b></span><p>实时行情与回测请进入操盘台。</p><em>不构成投资建议</em></div></div>
    </div>
    <div className="home-strip"><button className="home-widget" onClick={()=>onNavigate('持仓对账')}><span>今日闭环</span><b>查看账本</b><small>只统计已录入且完成配对的成交 →</small></button><button className="home-widget" onClick={()=>onNavigate('多股监控')}><span>监控股票</span><b>{stockCount} 只</b><small>盘中持续扫描 · 打开看板 →</small></button><button className="home-widget profit-widget" onClick={()=>onNavigate('持仓对账')}><span>已确认净收益</span><b>按流水计算</b><small>没有真实成交记录时不展示演示收益 →</small></button><button className="home-widget" onClick={()=>onNavigate('智能训练')}><span>四兔研究</span><b>查看证据</b><small>真实样本覆盖 · 不显示假训练进度 →</small></button></div>
    <div className="home-workflow"><div className="workflow-head"><div><span className="eyebrow">DAILY WORKFLOW</span><h2>每天只看四件事</h2></div><p>减少指标堆叠，把操作顺序固定下来。</p></div><div className="workflow-grid">{[{n:'01',title:'先看市场',copy:'集合竞价与市场雷达先决定今天能不能做、优先正T还是反T。',action:'多股监控',icon:'⌁'},{n:'02',title:'再等信号',copy:'价格、VWAP、量能和确认分同时满足，才显示可执行机会。',action:'操盘台',icon:'⌗'},{n:'03',title:'当天闭环',copy:'首笔成交后冻结同向信号，等量反向成交并恢复原底仓。',action:'持仓对账',icon:'⇄'},{n:'04',title:'收盘复盘',copy:'使用真实费用和可卖数量回放，训练参数只进入候选区。',action:'智能训练',icon:'◇'}].map(item=><button key={item.n} onClick={()=>onNavigate(item.action)}><span>{item.n}</span><i>{item.icon}</i><h3>{item.title}</h3><p>{item.copy}</p><em>{item.action} →</em></button>)}</div></div>
    <div className="home-activity-grid">
      <button className="home-zijin-entry" onClick={onOpenZijin} aria-label="打开紫金矿业实验室训练进度">
        <span><i/>601899 · 研究模型（未毕业）</span>
        <div><b>紫金矿业实验室</b><small>查看五年分钟样本训练、样本外验证与当前通过状态；独立研究，不自动写入 Smart-T V4。</small></div>
        <em>查看训练进度 →</em>
      </button>
      <section className="home-referral-ad" aria-label="邀请得会员">
        <div className="home-referral-mark">7<span>天</span></div>
        <div><span>会员邀请奖励</span><h2>邀请好友，双方一起研究做T</h2><p>{canInvite?`每有效注册 1 人，会员权益自动增加 7 天。你已获得 ${referralCredits} 次奖励。`:'有效注册 1 人即可获得 7 天会员权益；登录会员账户后可生成专属邀请链接。'}</p></div>
        <div className="home-referral-actions">{canInvite?<button onClick={onCopyInvite}>复制邀请链接</button>:<button onClick={()=>onNavigate('邀请中心')}>查看邀请规则</button>}<button className="home-referral-link" onClick={()=>onNavigate('邀请中心')}>进入邀请中心 →</button>{inviteMessage&&<em>{inviteMessage}</em>}</div>
      </section>
    </div>
    <section className="home-pricing" aria-label="会员收费">
      <header><div><span>MEMBERSHIP</span><h2>先免费使用，需要时再升级</h2></div><a href="/pricing">查看完整权益 →</a></header>
      <div>
        <article><span>免费版</span><b>¥0</b><small>长期使用 · 基础行情与候选观察</small></article>
        <article className="recommended"><em>推荐</em><span>Smart-T 会员</span><b>¥99<small>/月</small></b><small>年卡 ¥298 · 购买激活码后自行兑换</small></article>
        <article><span>24小时体验票</span><b>¥4.9</b><small>完整体验一个交易日 · 不自动续费</small></article>
      </div>
    </section>
    <div className="home-risk"><span>重要提示</span><p>做T不保证盈利。所有信号仅用于策略研究和提醒；自动交易接口保持关闭，候选策略必须人工晋升。</p><button onClick={()=>onNavigate('模拟回测')}>查看可信回测</button></div>
  </section>;
}

function OnboardingView({accountName,initial,initialList,initialPositions,maxStocks,onSave}:{accountName:string;initial:AccountPreferences;initialList:typeof initialStocks;initialPositions:StockPositionMap;maxStocks:number;onSave:(value:AccountPreferences,list:typeof initialStocks,positions:StockPositionMap)=>void}){
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
  const selectedTradeShares=selectedPosition.tradeShares??Math.floor(Math.min(selectedPosition.openingShares,selectedPosition.sellable)/3/100)*100;
  const selectedMaxDailyTrades=selectedPosition.maxDailyTrades??3;
  const updatePosition=(field:"currentShares"|"tradeShares"|"maxDailyTrades",value:number)=>setPositions(current=>{
    const existing=current[selectedCode]??migrateLegacyPosition(initial,selectedCode);
    const safeValue=Math.max(0,Math.floor(value));
    const next=field==="currentShares"
      ? {...existing,plannedBase:safeValue,openingShares:safeValue,sellable:safeValue}
      : {...existing,[field]:safeValue};
    return {...current,[selectedCode]:normalizeStockPosition(next,selectedCode)};
  });
  const add=()=>{const code=newCode.replace(/\D/g,'').slice(0,6);const name=newName.trim();if(list.length>=maxStocks){setListError(`当前会员最多同时监控 ${maxStocks} 只股票；删除一只后可继续添加`);return}if(code.length!==6||!name){setListError('请输入6位股票代码和股票名称');return}if(list.some(item=>item.code===code)){setListError('该股票已经在监控列表中');return}const next=[...list,{code,name,price:'--',change:'0.00%'}];setList(next);setPositions(current=>({...current,[code]:normalizeStockPosition({},code)}));setStock(`${code} ${name}`);setNewCode('');setNewName('');setListError('')};
  const remove=(code:string)=>{if(list.length<=1){setListError('至少需要保留一只监控股票');return}const next=list.filter(item=>item.code!==code);setList(next);setPositions(current=>{const updated={...current};delete updated[code];return updated});if(stock.startsWith(code))setStock(`${next[0].code} ${next[0].name}`);setListError('')};
  const save=()=>{
    const savedPositions:StockPositionMap=Object.fromEntries(list.map(item=>{
      const position=positions[item.code]??migrateLegacyPosition(initial,item.code);
      const normalized=normalizeStockPosition({
        ...position,
        tradeShares:position.tradeShares??Math.floor(Math.min(position.openingShares,position.sellable)/3/100)*100,
        maxDailyTrades:position.maxDailyTrades??3,
      },item.code);
      return [item.code,confirmStockPosition(window.localStorage,accountName,normalized)];
    }));
    const defaultPosition=savedPositions[selectedCode]??normalizeStockPosition({},selectedCode);
    onSave({stock,baseShares:defaultPosition.plannedBase,risk,strategyProfile:initial.strategyProfile,profitMode:initial.profitMode},list,savedPositions);
  };
  return <div className="onboarding-overlay"><div className="onboarding-card"><div className="onboarding-head"><span>ACCOUNT SETUP</span><h2>设置你的交易工作台</h2><p>每只股票独立保存持仓和做T额度，切换股票不会串用。</p></div><div className="onboarding-step watchlist-step"><b>01</b><div><span>监控股票与默认股票 · {list.length}/{maxStocks}</span><div className="preference-watchlist">{list.map(item=><div className={stock.startsWith(item.code)?'active':''} key={item.code}><button onClick={()=>setStock(`${item.code} ${item.name}`)}><b>{item.name}</b><small>{item.code}</small></button><button onClick={()=>remove(item.code)} aria-label={`删除${item.name}`}>×</button></div>)}</div><div className="stock-add-row"><input value={newCode} onChange={e=>setNewCode(e.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" autoComplete="off" placeholder="6位代码" disabled={list.length>=maxStocks}/><input value={newName} onChange={e=>setNewName(e.target.value)} autoComplete="off" placeholder="股票名称" disabled={list.length>=maxStocks}/><button onClick={add} disabled={list.length>=maxStocks}>{list.length>=maxStocks?`已达 ${maxStocks} 只上限`:'＋ 添加'}</button></div>{listError&&<small className="list-error">{listError}</small>}<small>当前会员最多同时监控 {maxStocks} 只股票；先点击一只股票，再单独填写它的持仓。</small></div></div><div className="onboarding-step"><b>02</b><div><span>{selectedStock?`${selectedStock.name}（${selectedCode}）持仓与做T额度`:'当前股票持仓'}</span><div className="position-setup-grid"><label><span>现有持仓数</span><div><input type="text" inputMode="numeric" value={selectedPosition.openingShares||''} onChange={event=>updatePosition('currentShares',Number(event.target.value.replace(/\D/g,''))||0)}/><em>股</em></div><small>默认视为开盘前可卖旧仓</small></label><label><span>每次可做T数目</span><div><input type="text" inputMode="numeric" value={selectedTradeShares||''} onChange={event=>updatePosition('tradeShares',Number(event.target.value.replace(/\D/g,''))||0)}/><em>股</em></div><small>按100股取整且不超过持仓</small></label><label><span>每天最大做T次数</span><div><input type="text" inputMode="numeric" value={selectedMaxDailyTrades} onChange={event=>updatePosition('maxDailyTrades',Number(event.target.value.replace(/\D/g,''))||1)}/><em>次</em></div><small>允许1～10次，达到后停止新增</small></label></div><small>系统仍会执行 T+1、成本和风控检查；当日新买股份不会被误计为可卖旧仓。</small></div></div><div className="onboarding-step"><b>03</b><div><span>风险偏好</span><div className="risk-options">{['稳健','平衡','积极'].map(item=><button className={risk===item?'active':''} onClick={()=>setRisk(item)} key={item}>{item}</button>)}</div><small>仅调整信号频率，不能绕过可卖数量和当日闭环规则。</small></div></div><button className="onboarding-save" onClick={save}>保存全部股票持仓 <span>→</span></button></div></div>;
}

function QuantToolsView({onNavigate}:{onNavigate:(view:string)=>void}) {
  const tools=[
    {view:'多股监控',title:'多股持仓',copy:'自选监控与持仓概览',icon:'▦'},
    {view:'策略市场',title:'策略市场',copy:'查看内置研究策略',icon:'◇'},
    {view:'持仓对账',title:'持仓对账',copy:'核对可卖与做T流水',icon:'⇄'},
    {view:'智能训练',title:'智能训练',copy:'个人回放与样本研究',icon:'◎'},
  ];
  return <section className="module-view quant-tools-page">
    <div className="module-head quant-tools-head">
      <div><span className="eyebrow">QUANT TOOLS</span><h1>量化工具</h1><p>持仓、策略、对账与训练集中在一个入口。</p></div>
    </div>
    <div className="quant-tools-grid">
      {tools.map(tool=><button key={tool.view} onClick={()=>onNavigate(tool.view)}>
        <i aria-hidden="true">{tool.icon}</i>
        <span><b>{tool.title}</b><small>{tool.copy}</small></span>
        <em>进入 →</em>
      </button>)}
    </div>
  </section>;
}

function MultiWatchView({stocks,onOpen,onManage}:{stocks:typeof initialStocks;onOpen:(index:number)=>void;onManage:()=>void}) {
  const [quotes,setQuotes]=useState<Record<string,MarketData['quote']>>({});
  const [quoteStatus,setQuoteStatus]=useState<'loading'|'updated'|'partial'|'error'>('loading');
  const [updatedAt,setUpdatedAt]=useState<string>('');
  useEffect(()=>{
    let cancelled=false;
    const refresh=async()=>{
      if(document.visibilityState!=='visible')return;
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
    };
    const stopPolling = startClientPolling({
      key: "multi-watch",
      intervalMs: 5_000,
      run: refresh,
      enabled: () => !cancelled && document.visibilityState === "visible",
    });
    return ()=>{cancelled=true;stopPolling();};
  },[stocks]);
  const allRows=stocks.map(item=>{
    const quote=quotes[item.code];
    const change=quote?.changePercent;
    const amplitude=quote?.high!=null&&quote?.low!=null&&quote?.price ? (quote.high-quote.low)/quote.price*100 : null;
    const position=quote?.high!=null&&quote?.low!=null&&quote?.price&&quote.high>quote.low ? (quote.price-quote.low)/(quote.high-quote.low)*100 : null;
    return {code:item.code,name:quote?.name||item.name,price:quote?.price?.toFixed(2)||'--',change:change==null?'--':`${change>=0?'+':''}${change.toFixed(2)}%`,changeValue:change,amplitude,position};
  });
  return <section className="module-view watch-view">
    <div className="module-head"><div><span className="eyebrow">MULTI-ASSET POSITION</span><h1>多股持仓</h1><p>集中查看自选行情与持仓状态；仅用于观察，不会自动生成买卖指令或下单。</p></div><div className="module-status"><i/>{quoteStatus==='updated'?'公开行情正常':quoteStatus==='partial'?'部分行情可用':quoteStatus==='error'?'行情暂不可用':'正在连接行情'} · {stocks.length}只监控中</div></div>
    <div className="watch-summary"><div><span>监控股票</span><b>{stocks.length}</b><small>服务器持续后台扫描</small></div><div><span>已取得报价</span><b className="teal">{Object.keys(quotes).filter(code=>stocks.some(stock=>stock.code===code)).length}</b><small>当前列表可用数量</small></div><div><span>刷新频率</span><b>5 秒</b><small>公开试用行情</small></div><div><span>最近更新</span><b>{updatedAt||'--:--:--'}</b><small>{quoteStatus==='partial'?'部分来源暂不可用':'前台页面刷新'}</small></div><div><span>交易执行</span><b>关闭</b><small>不连接券商账户</small></div></div>
    <div className="watch-toolbar"><div><span>公开行情试用 · 数据时效不保证为交易级</span></div><button className="watch-add" onClick={onManage}>＋ 管理监控股票</button></div>
    <div className="watch-table"><div className="watch-row watch-title"><span>股票</span><span>最新价</span><span>涨跌幅</span><span>日内振幅</span><span>日内位置</span><span>状态</span><span/></div>{allRows.map(row=><div className="watch-row" key={row.code}><span className="watch-stock"><b>{row.name}</b><small>{row.code}</small></span><span className="watch-price"><b>{row.price}</b><small>公开行情</small></span><span><b className={row.changeValue!=null&&row.changeValue<0?'negative':row.changeValue!=null&&row.changeValue>0?'positive':'neutral'}>{row.change}</b><small>{row.change==='--'?'等待更新':'当日涨跌幅'}</small></span><span><b>{row.amplitude==null?'--':`${row.amplitude.toFixed(2)}%`}</b><small>高低波动</small></span><span className="day-position"><i><em style={{width:`${row.position??0}%`}}/></i><b>{row.position==null?'--':`${row.position.toFixed(0)}%`}</b></span><em className="watch-pill watch">仅监控</em><button onClick={()=>onOpen(stocks.findIndex(item=>item.code===row.code))}>进入操盘台 →</button></div>)}</div>
    <div className="watch-rule"><b>使用说明</b><span>多股页为 5 秒公开行情试用</span><span>操盘台为当前选股 1 秒轮询试用</span><span>页面隐藏时仅暂停前端报价刷新；服务器继续扫描并记录</span><span>报价不构成交易建议，也不触发自动下单</span></div>
  </section>;
}

function ReferralCenter({canInvite,demoMode,referralCode,referralCredits,referralReviews,onCopyInvite,inviteMessage,onOpenAccount}:{canInvite:boolean;demoMode:boolean;referralCode:string|null;referralCredits:number;referralReviews:number;onCopyInvite:()=>void;inviteMessage:string;onOpenAccount:()=>void}){
  const [leaders,setLeaders]=useState<{rank:number;displayName:string;credits:number}[]>([]);
  const [leadersReady,setLeadersReady]=useState(false);
  useEffect(()=>{
    let active=true;
    fetch('/api/control/referrals/leaderboard?limit=5',{cache:'no-store'})
      .then(response=>response.ok?response.json():Promise.reject(new Error('leaderboard unavailable')))
      .then((payload:{leaderboard?:{rank:number;displayName:string;credits:number}[]})=>{
        if(active)setLeaders(Array.isArray(payload.leaderboard)?payload.leaderboard:[]);
      })
      .catch(()=>{ if(active)setLeaders([]); })
      .finally(()=>{ if(active)setLeadersReady(true); });
    return()=>{active=false};
  },[]);
  return <section className="referral-center module-view">
    <header className="referral-center-head"><span>MEMBERSHIP REWARDS</span><h1>邀请得会员</h1><p>邀请一位好友完成有效注册，你的会员权益自动增加 7 天。</p></header>
    <div className="referral-hero-card">
      <div className="referral-reward"><b>+7</b><span>天会员权益</span></div>
      <div className="referral-hero-copy"><span>你的专属邀请</span><h2>{canInvite?'分享链接，好友注册后自动计入奖励':'登录会员账户后，生成专属邀请链接'}</h2><p>{canInvite?`邀请码：${referralCode} · 已成功奖励 ${referralCredits} 人${referralReviews?` · 待审核 ${referralReviews} 人`:''}`:demoMode?'演示模式不会生成邀请码。':'管理员账户不参与会员邀请奖励。'}</p></div>
      {canInvite?<div className="referral-actions"><button onClick={onCopyInvite}>复制邀请链接</button><small>{inviteMessage||'链接可直接发送给好友'}</small></div>:<button className="referral-login" onClick={onOpenAccount}>{demoMode?'登录 / 注册会员':'查看账户中心'}</button>}
    </div>
    <div className="referral-steps"><article><b>01</b><h3>复制链接</h3><p>把专属邀请链接发送给好友。</p></article><article><b>02</b><h3>完成注册</h3><p>好友通过该链接注册正式账户。</p></article><article><b>03</b><h3>奖励到账</h3><p>有效注册后自动增加 7 天会员权益。</p></article></div>
    <section className="referral-leaderboard" aria-label="邀请排行榜">
      <header><div><span>INVITE LEADERBOARD</span><h2>邀请榜</h2></div><small>按已确认的有效邀请人数排序</small></header>
      {!leadersReady?<p className="referral-leaderboard-empty">正在加载邀请榜…</p>:leaders.length?<ol>{leaders.map(item=><li key={`${item.rank}:${item.displayName}`} className={item.rank===1?'leader-first':''}><b>{item.rank===1?'冠军':`TOP ${item.rank}`}</b><span>{item.displayName}</span><em>{item.credits} 人</em></li>)}</ol>:<p className="referral-leaderboard-empty">邀请榜等待第一位会员上榜。</p>}
    </section>
    <div className="referral-note"><b>奖励说明</b><span>同一来源的重复注册不会重复计奖；邀请奖励仅增加会员权益，不兑换现金，也不改变策略、行情或交易权限。</span></div>
  </section>;
}

type StockResearchNote = { id:string; date:string; mode:string; outcome:string; note:string };
const EXTERNAL_FACTOR_PLAIN_COPY:Record<string,string>={
  internationalGold:"看黄金价格是否支持紫金的黄金业务走势",
  internationalCopper:"看铜价变化是否支持紫金的铜业务走势",
  marketIndex:"分辨紫金的涨跌是自身变化，还是跟随大盘",
  hkZijin:"比较 A 股与港股紫金是否同步、谁先发生变化",
  eventClock:"确认公告和新闻何时公开，避免回测提前知道消息",
};
type AutoResearchSample = { date:string; cycles:number; wins:number; net:number; status:string };
type ZijinResearchBundle = typeof import("@/lib/zijin-research-bundle")["zijinResearchBundle"];
type ZijinShadowProgressStatus = {
  strategyId?:string;displayName?:string;mode?:string;affectsProduction?:boolean;automaticPromotion?:boolean;
  counts?:{candidates?:number;entries?:number;resolved?:number;wins?:number;rejected?:number};
  manualReview?:{
    tradingDays?:number;resolvedCycles?:number;candidatePromotionRate?:number|null;afterCostWinRate?:number|null;stress5BpsWinRate?:number|null;profitFactor?:number|null;
    gates?:{tradingDays?:boolean;resolvedCycles?:boolean;candidatePromotionRate?:boolean;afterCostWinRate?:boolean;stress5BpsWinRate?:boolean;profitFactor?:boolean};
    readyForManualReview?:boolean;automaticPromotion?:boolean;affectsProduction?:boolean;
  };
};
type ZijinL2State = {
  node?:string; error?:string; lastExchangeTime?:string;
  status?:{connected?:boolean;transportConnected?:boolean;authorized?:boolean;collectorAlive?:boolean;collectorStale?:boolean;heartbeatAgeSeconds?:number|null;feedAgeSeconds?:number|null;stale?:boolean;ageSeconds?:number};
  meta?:{collectorAlive?:boolean;collectorStale?:boolean;heartbeatAgeSeconds?:number|null;stale?:boolean;servedAt?:string};
  flow?:{activeBuyRatio60s?:number|null;netActiveNotional60s?:number;bigOrderNetNotional60s?:number;activeBuyVolume60s?:number;activeSellVolume60s?:number;tradeVolume60s?:number;activeBuyNotional60s?:number;activeSellNotional60s?:number;bigBuyNotional60s?:number;bigSellNotional60s?:number;bigBuyVolume60s?:number;bigSellVolume60s?:number};
  book?:{lastPrice?:number|null;nearTouchImbalance?:number|null;spreadBps?:number|null;microprice?:number|null;micropriceEdgeBps?:number|null};
  session?:{previousClose?:number|null;open?:number|null;high?:number|null;low?:number|null;volume?:number|null;amount?:number|null;trades?:number|null};
  recentMinutes?:{time:string;exchangeMinute?:string;price:number;open?:number;high?:number;low?:number;volume?:number;amount?:number;averagePrice?:number|null;activeBuyNotional?:number;activeSellNotional?:number;activeBuyVolume?:number;activeSellVolume?:number;activeBuyRatio?:number|null;netActiveNotional?:number;bigBuyNotional?:number;bigSellNotional?:number;bigOrderNetNotional?:number;bigBuyVolume?:number;bigSellVolume?:number;bigBuyCount?:number;bigSellCount?:number}[];
  l2Bar?:{time:string;exchangeMinute?:string;price:number;open?:number;high?:number;low?:number;volume?:number;amount?:number;averagePrice?:number|null;activeBuyNotional?:number;activeSellNotional?:number;activeBuyVolume?:number;activeSellVolume?:number;activeBuyRatio?:number|null;netActiveNotional?:number;bigBuyNotional?:number;bigSellNotional?:number;bigOrderNetNotional?:number;bigBuyVolume?:number;bigSellVolume?:number;bigBuyCount?:number;bigSellCount?:number};
  messages?:{snapshot?:number;transaction?:number;order?:number};
  volatility?:{source?:string;period?:number;samples?:number;ready?:boolean;atr14?:number|null;atrPct14?:number|null};
  secondState?:{
    schemaVersion?:number;
    state:"normal"|"watch"|"ready"|"trigger"|"cooldown"|"invalid"|"expired";
    direction:"buy"|"sell"|"none";
    label:string;
    score:number;
    formalSignal?:boolean;
    autoOrderAuthorized?:boolean;
    tradePermission?:string;
    marketMode?:"continuous"|"closing-auction"|"closed";
    sequence?:number;
    stateAgeSeconds?:number;
    cooldownRemainingSeconds?:number;
    validForSeconds?:number;
    timeline?:{warningAtEpoch?:number|null;candidateAtEpoch?:number|null;confirmedAtEpoch?:number|null;confirmationDelaySeconds?:number|null;validUntilEpoch?:number|null;lastTransitionAtEpoch?:number|null;lastReason?:string;confirmationPolicy?:string};
    plan?:{action?:string;triggerPrice?:number|null;executableReferencePrice?:number|null;invalidPrice?:number|null;targetPrice?:number|null;suggestedSize?:string;executionModel?:string};
    position?:{biasPct?:number|null;thresholdPct?:number|null;nearSessionLow?:boolean;nearSessionHigh?:boolean};
    evidence?:{count?:number;requiredForReady?:number;fastVolumeOk?:boolean;absorption?:boolean;flowReversal?:boolean;bookAligned?:boolean;priceConclusion?:string;flowConclusion?:string;bookConclusion?:string};
    windows?:Record<string,{seconds?:number;transactions?:number;buyNotional?:number;sellNotional?:number;grossNotional?:number;netNotional?:number;tfi?:number|null}>;
  };
  forward?:{
    samples?:number;tradingDays?:number;trainingReady?:boolean;reason?:string;
    reverseTShadow?:ZijinShadowProgressStatus;
    multiFactorTShadow?:ZijinShadowProgressStatus;
  };
};

const AI_RESEARCH_AGENTS=[
  {name:"探因兔",role:"量化研究",task:"发现与解释做T因子",tone:"teal",disabled:false},
  {name:"净源兔",role:"数据治理",task:"核验样本、时序与质量",tone:"blue",disabled:false},
  {name:"组策兔",role:"策略组合",task:"组合因子与候选参数",tone:"amber",disabled:false},
  {name:"验真兔",role:"离线回测",task:"滚动样本外验证",tone:"purple",disabled:false},
  {name:"守界兔",role:"风险审核",task:"检查回撤、成本与泄漏",tone:"coral",disabled:false},
  {name:"铸码兔",role:"开发执行",task:"等待人工授权，当前关闭",tone:"muted",disabled:true},
  {name:"质检兔",role:"质量验收",task:"测试结果与版本证据",tone:"green",disabled:false},
] as const;

const AI_FACTOR_CATEGORIES=[
  {name:"VWAP",count:7,tone:"teal"},
  {name:"动量",count:5,tone:"coral"},
  {name:"成交量",count:5,tone:"amber"},
  {name:"波动率",count:5,tone:"purple"},
  {name:"技术指标",count:5,tone:"blue"},
  {name:"分时结构",count:5,tone:"green"},
  {name:"价格",count:4,tone:"red"},
  {name:"市场环境",count:4,tone:"cyan"},
  {name:"订单流",count:4,tone:"orange"},
  {name:"时间",count:4,tone:"gray"},
] as const;

const AI_RESEARCH_FLOW=["数据核验","因子研究","组合策略","离线回测","风险审核","QA验收","人工批准"] as const;

type PaperclipRuntimeStatus={
  status:"running"|"degraded"|"stopped";
  services:{paperclip:"healthy"|"unavailable";bridge:"healthy"|"unavailable"};
  checkedAt:string|null;
  message:string;
};

function AIQuantResearchInstituteView(){
  const [runtime,setRuntime]=useState<PaperclipRuntimeStatus|null>(null);
  useEffect(()=>{
    let active=true;
    let timer:number|undefined;
    const load=async()=>{
      if(document.visibilityState!=="visible"){
        if(active)timer=window.setTimeout(()=>void load(),30_000);
        return;
      }
      try{
        const response=await fetch(`/api/research/paperclip-status?t=${Date.now()}`,{cache:"no-store"});
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const payload=await response.json() as PaperclipRuntimeStatus;
        if(active)setRuntime(payload);
      }catch{
        if(active)setRuntime({status:"degraded",services:{paperclip:"unavailable",bridge:"unavailable"},checkedAt:null,message:"状态连接暂不可用"});
      }
      if(active)timer=window.setTimeout(()=>void load(),15_000);
    };
    void load();
    const onVisibility=()=>{if(document.visibilityState==="visible"){if(timer!==undefined)window.clearTimeout(timer);void load();}};
    document.addEventListener("visibilitychange",onVisibility);
    return()=>{active=false;if(timer!==undefined)window.clearTimeout(timer);document.removeEventListener("visibilitychange",onVisibility);};
  },[]);
  const running=runtime?.status==="running"&&runtime.services.paperclip==="healthy"&&runtime.services.bridge==="healthy";
  const runtimeTitle=running?"控制面运行中":runtime?.status==="degraded"?"控制面异常":"离线研究就绪";
  const runtimeDetail=running?"Paperclip / 研究桥均健康":runtime?.message??"正在读取服务器状态";
  const checkedTime=runtime?.checkedAt?new Date(runtime.checkedAt).toLocaleTimeString("zh-CN",{hour12:false}):null;
  return <main className="ai-institute-view">
    <header className="ai-institute-head">
      <div><span>AI QUANT RESEARCH INSTITUTE</span><h1>AI量化研究院</h1><p>把做T因子研究、样本外验证与人工审批放进同一条可审计流程。</p></div>
      <div className="ai-institute-status"><i/><span>研究状态</span><b>{runtimeTitle}</b><small>{runtimeDetail}</small></div>
    </header>

    <section className="ai-institute-metrics" aria-label="研究院概况">
      <article><span>研究角色</span><b>7</b><small>职责独立</small></article>
      <article><span>基础因子</span><b>48</b><small>不可变 V1</small></article>
      <article><span>验证测试</span><b>25/25</b><small>因子 18 · 安全 7</small></article>
      <article className="safe"><span>自动生产权限</span><b>0</b><small>必须人工批准</small></article>
    </section>

    <section className="ai-institute-flow" aria-labelledby="ai-research-flow-title">
      <div className="ai-institute-section-head"><div><span>RESEARCH PIPELINE</span><h2 id="ai-research-flow-title">研究闭环</h2></div><small>Paperclip 仅负责任务编排，不进入交易链路</small></div>
      <ol>{AI_RESEARCH_FLOW.map((step,index)=><li key={step} className={index===AI_RESEARCH_FLOW.length-1?"approval":"ready"}><i>{String(index+1).padStart(2,"0")}</i><b>{step}</b><span>{index===AI_RESEARCH_FLOW.length-1?"人工闸门":"可复现"}</span></li>)}</ol>
    </section>

    <div className="ai-institute-grid">
      <section className="ai-institute-agents" aria-labelledby="ai-agent-title">
        <div className="ai-institute-section-head"><div><span>AGENT TEAM</span><h2 id="ai-agent-title">七兔研究团队</h2></div><small>{running?"控制面在线":"离线待命"}</small></div>
        <div className="ai-agent-grid">{AI_RESEARCH_AGENTS.map((agent,index)=><article key={agent.name} className={`${agent.tone}${agent.disabled?" disabled":""}`}>
          <div className="ai-agent-avatar"><span>{index+1}</span><i/><i/></div>
          <div><h3>{agent.name}</h3><b>{agent.role}</b><p>{agent.task}</p></div>
          <em>{agent.disabled?"权限关闭":"研究就绪"}</em>
        </article>)}</div>
      </section>

      <aside className="ai-factor-panel" aria-labelledby="ai-factor-title">
        <div className="ai-institute-section-head"><div><span>FACTOR LIBRARY</span><h2 id="ai-factor-title">因子构成</h2></div><b>48</b></div>
        <div className="ai-factor-total" aria-hidden="true">{AI_FACTOR_CATEGORIES.map(item=><i key={item.name} className={item.tone} style={{width:`${item.count/48*100}%`}}/>)}</div>
        <div className="ai-factor-list">{AI_FACTOR_CATEGORIES.map(item=><div key={item.name}><span><i className={item.tone}/>{item.name}</span><b>{item.count}</b><em><i className={item.tone} style={{width:`${item.count/7*100}%`}}/></em></div>)}</div>
      </aside>
    </div>

    <section className="ai-safety-panel" aria-labelledby="ai-safety-title">
      <div><span>SAFETY BOUNDARY</span><h2 id="ai-safety-title">安全边界</h2><p>研究成果只能成为候选，无法自行进入正式策略。</p></div>
      <ul><li><i/>不连接真实交易</li><li><i/>不写生产数据库</li><li><i/>不自动修改正式策略</li><li><i/>不自动部署</li></ul>
      <aside><span>当前控制面</span><b>{running?"运行中":runtime?.status==="degraded"?"状态异常":"尚未启动"}</b><small>{running?`双服务健康${checkedTime?` · ${checkedTime} 检查`:""}`:runtimeDetail}</small></aside>
    </section>
  </main>;
}

function SingleStockResearchView({accountName,stock,quote,marketData,profile,profitMode,position,manualCount,onOpenConsole}:{accountName:string;stock:{code:string;name:string;price:string;change:string};quote:MarketData['quote']|undefined;marketData:MarketData|null;profile:string;profitMode:ProfitMode;position:StockPosition;manualCount:number;onOpenConsole:()=>void}) {
  const [zijinResearchBundle,setZijinResearchBundle]=useState<ZijinResearchBundle|null>(null);
  const [zijinResearchBundleError,setZijinResearchBundleError]=useState(false);
  const [zijinTrainingProgress,setZijinTrainingProgress]=useState<ZijinTrainingProgress|null>(null);
  const [zijinTrainingConnection,setZijinTrainingConnection]=useState<"loading"|"ok"|"error">("loading");
  const [zijinTrainingFetchedAt,setZijinTrainingFetchedAt]=useState<string|null>(null);
  const [zijinShadow,setZijinShadow]=useState<ZijinShadowAB|null>(null);
  const [zijinShadowConnection,setZijinShadowConnection]=useState<"loading"|"ok"|"error">("loading");
  const [zijinFactorLifecycle,setZijinFactorLifecycle]=useState<ZijinFactorLifecycle|null>(null);
  const [zijinFactorLifecycleConnection,setZijinFactorLifecycleConnection]=useState<"loading"|"ok"|"error">("loading");
  const [zijinL2,setZijinL2]=useState<ZijinL2State|null>(null);
  const [researchExpanded,setResearchExpanded]=useState(false);
  useEffect(()=>{
    let active=true;
    void import("@/lib/zijin-research-bundle")
      .then(module=>{if(active){setZijinResearchBundle(module.zijinResearchBundle);setZijinResearchBundleError(false)}})
      .catch(()=>{if(active)setZijinResearchBundleError(true)});
    return()=>{active=false};
  },[]);
  useEffect(()=>{
    if(stock.code!=="601899"){
      const resetTimer=window.setTimeout(()=>{setZijinTrainingProgress(null);setZijinTrainingConnection("loading");setZijinTrainingFetchedAt(null);},0);
      return()=>window.clearTimeout(resetTimer);
    }
    let active=true;
    let timer:number|undefined;
    const load=async()=>{
      if(document.visibilityState!=='visible'){
        if(active)timer=window.setTimeout(()=>void load(),30_000);
        return;
      }
      try{
        const response=await fetch(`/api/research/zijin-training-progress?t=${Date.now()}`,{cache:"no-store"});
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const payload=await response.json() as ZijinTrainingProgress;
        if(active&&payload.stock?.code==="601899"){
          setZijinTrainingProgress(payload);
          setZijinTrainingConnection("ok");
          setZijinTrainingFetchedAt(payload.meta?.servedAt??new Date().toISOString());
          timer=window.setTimeout(()=>void load(),payload.status==="running"?2000:30000);
        }
      }catch{
        /* 保留上一份真实状态；连接失败时低频重试，不伪造训练进度。 */
        if(active){setZijinTrainingConnection("error");timer=window.setTimeout(()=>void load(),10000);}
      }
    };
    void load();
    const onVisibility=()=>{if(document.visibilityState==='visible'){if(timer!==undefined)window.clearTimeout(timer);void load()}};
    document.addEventListener('visibilitychange',onVisibility);
    return()=>{active=false;if(timer!==undefined)window.clearTimeout(timer);document.removeEventListener('visibilitychange',onVisibility)};
  },[stock.code]);
  const zijinL2HasTicks=Boolean((zijinL2?.messages?.transaction??0)>0||(zijinL2?.messages?.order??0)>0);
  const zijinL2LastPrice=Number(zijinL2?.book?.lastPrice);
  const zijinL2Microprice=Number(zijinL2?.book?.microprice);
  const zijinL2PriceText=Number.isFinite(zijinL2LastPrice)&&zijinL2LastPrice>0
    ? `最新价 ${zijinL2LastPrice.toFixed(2)}`
    : Number.isFinite(zijinL2Microprice)&&zijinL2Microprice>0
      ? `盘口中间价 ${zijinL2Microprice.toFixed(2)}`
      : "等待有效价格";
  useEffect(()=>{
    if(stock.code!=="601899"){
      const resetTimer=window.setTimeout(()=>{setZijinShadow(null);setZijinShadowConnection("loading");},0);
      return()=>window.clearTimeout(resetTimer);
    }
    if(!researchExpanded)return;
    let active=true;
    let timer:number|undefined;
    const load=async()=>{
      if(document.visibilityState!=="visible"){
        if(active)timer=window.setTimeout(()=>void load(),30_000);
        return;
      }
      try{
        const response=await fetch(`/api/research/zijin-shadow-ab?t=${Date.now()}`,{cache:"no-store"});
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const payload=await response.json() as ZijinShadowAB;
        if(active&&payload.stock?.code==="601899"){
          setZijinShadow(payload);
          setZijinShadowConnection("ok");
        }
      }catch{
        if(active)setZijinShadowConnection("error");
      }
      if(active)timer=window.setTimeout(()=>void load(),30_000);
    };
    void load();
    return()=>{active=false;if(timer!==undefined)window.clearTimeout(timer)};
  },[stock.code,researchExpanded]);
  useEffect(()=>{
    if(stock.code!=="601899"){
      const resetTimer=window.setTimeout(()=>{setZijinFactorLifecycle(null);setZijinFactorLifecycleConnection("loading");},0);
      return()=>window.clearTimeout(resetTimer);
    }
    if(!researchExpanded)return;
    let active=true;
    let timer:number|undefined;
    const load=async()=>{
      if(document.visibilityState!=="visible"){
        if(active)timer=window.setTimeout(()=>void load(),30_000);
        return;
      }
      try{
        const response=await fetch("/api/research/zijin-factor-lifecycle?t="+Date.now(),{cache:"no-store"});
        if(!response.ok)throw new Error("HTTP "+response.status);
        const payload=await response.json() as ZijinFactorLifecycle;
        if(active&&payload.stock?.code==="601899"){
          setZijinFactorLifecycle(payload);
          setZijinFactorLifecycleConnection("ok");
        }
      }catch{
        if(active)setZijinFactorLifecycleConnection("error");
      }
      if(active)timer=window.setTimeout(()=>void load(),30_000);
    };
    void load();
    return()=>{active=false;if(timer!==undefined)window.clearTimeout(timer)};
  },[stock.code,researchExpanded]);
  useEffect(()=>{
    if(stock.code!=="601899")return;
    let active=true;
    let timer:number|undefined;
    const load=async()=>{
      try{
        const response=await fetch(`/api/research/zijin-l2-orderflow?t=${Date.now()}`,{cache:"no-store"});
        const payload=await response.json() as ZijinL2State;
        if(active)setZijinL2(payload);
      }catch{if(active)setZijinL2({error:"L2 状态接口暂不可用"});}
      if(active)timer=window.setTimeout(()=>void load(),5000);
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
  const researchSessions=useMemo(()=>[...(relevantData?.intradaySessions??[])]
    .filter(session=>session.minutes.length>=180)
    .sort((left,right)=>right.date.localeCompare(left.date))
    .slice(0,20),[relevantData?.intradaySessions]);
  const autoSampleDayCount=researchSessions.length;
  const autoSamples=useMemo<AutoResearchSample[]>(()=>researchExpanded?researchSessions
    .map(session=>{
      const experiment=resolveBacktestStrategyExperiment(stock.code,"closure-first");
      const profitOptions=smartTProfitModeOptions(stock.code,profitMode) as ReplayProfitOptions;
      const result=runSmartTReplay(session.minutes,{capital:200_000,baseShares:position.plannedBase,sellable:position.sellable,feeRate:.025,slippage:.02,minCommission:true,slippageMode:"percent",forceCloseTime:"1450",profile:experiment.profile??profile,previousClose:session.previousClose,randomValue:0,...profitOptions,profileOverrides:{...(profitOptions.profileOverrides??{}),...experiment.profileOverrides},positionSizeMode:experiment.positionSizeMode,volatilityMode:experiment.volatilityMode,strategyVersion:experiment.label});
      return {date:session.date,cycles:result.trades,wins:result.wins,net:result.net,status:result.trades?`${result.trades} 个闭环 · ${money(result.net)}`:"无正式信号"};
    }):[],[researchExpanded,researchSessions,position.plannedBase,position.sellable,profile,stock.code,profitMode]);
  const autoCycles=autoSamples.reduce((sum,item)=>sum+item.cycles,0);
  const autoWins=autoSamples.reduce((sum,item)=>sum+item.wins,0);
  const autoNet=autoSamples.reduce((sum,item)=>sum+item.net,0);
  const zijinOpeningEvidence=useMemo(()=>{
    if(!researchExpanded||stock.code!=="601899")return null;
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
  },[researchExpanded,stock.code,relevantData?.intradaySessions]);
  const zijinFactorResearch=useMemo(()=>researchExpanded&&stock.code==="601899"?analyzeZijinFactorResearch({
    sessions:relevantData?.intradaySessions??[],
    liveMinutes:relevantData?.minutes??[],
    previousClose:relevantData?.quote.previousClose??null,
  }):null,[researchExpanded,stock.code,relevantData?.intradaySessions,relevantData?.minutes,relevantData?.quote]);
  const samples=autoSampleDayCount+notes.length+manualCount;
  const maturity=samples<10?'样本不足':samples<30?'观察中':'候选验证';
  const candidate=stats.range===0?'等待数据形成候选':stats.range<3.5?'低波动回踩观察':'高波动分批观察';
  const saveNote=()=>{const note=feedback.trim();if(!note)return;const next=[{id:`${Date.now()}`,date:new Date().toLocaleDateString('zh-CN'),mode,outcome,note},...notes];setNotes(next);try{localStorage.setItem(storageKey,JSON.stringify(next));}catch{}setFeedback('');setOutcome('待验证');setSaveMessage(`已保存：${mode} · ${outcome}`);window.setTimeout(()=>setSaveMessage(''),2500);};
  const quoteDirection=quote?.changePercent==null?'neutral':quote.changePercent>0?'positive':quote.changePercent<0?'negative':'neutral';
  const validationFinished=zijinTrainingProgress?.stage==="blind-test"||zijinTrainingProgress?.stage==="completed";
  const blindFinished=zijinTrainingProgress?.stage==="completed";
  const validationRan=zijinTrainingProgress?.latest.validationRan??Boolean(validationFinished&&zijinTrainingProgress?.latest.validationTrades);
  const blindRan=zijinTrainingProgress?.latest.blindRan??Boolean(blindFinished&&zijinTrainingProgress?.latest.blindTrades);
  if(!zijinResearchBundle)return <section className="zijin-research-lazy-state" role="status"><b>{zijinResearchBundleError?"研究报告加载失败":"正在加载单股研究资料"}</b><span>{zijinResearchBundleError?"请检查网络后刷新页面；操盘台与后台监控不受影响。":"历史报告仅在进入本页后加载，减少操盘台首屏体积。"}</span></section>;
  const {
    historicalEvidence:zijinHistoricalEvidence,
    patternDiscovery:zijinPatternDiscovery,
    peerPatternDiscovery:zijinPeerPatternDiscovery,
    externalFactorReadiness:zijinExternalFactorReadiness,
    round2RegimeAudit:zijinRound2RegimeAudit,
    round2WalkForward:zijinRound2WalkForward,
    round3Nested:zijinRound3Nested,
    round4Report:zijinRound4Report,
    round4Protocol:zijinRound4Protocol,
    round5Report:zijinRound5Report,
    round5Protocol:zijinRound5Protocol,
    round6Report:zijinRound6Report,
    round6Protocol:zijinRound6Protocol,
    round9Report:zijinRound9Report,
  }=zijinResearchBundle;
  const historicalPassed=zijinHistoricalEvidence.selectedModel.passedValidationGate;
  const trainingStale=Boolean(zijinTrainingProgress?.status==="running"&&zijinTrainingProgress.meta?.stale);
  const schedulerOffline=zijinTrainingProgress?.meta?.automationHealth?.status==="offline";
  const externalSourcesReady=zijinExternalFactorReadiness.requiredSources.filter(source=>source.status==="ready").length;
  const externalLiveSourcesReady=zijinExternalFactorReadiness.requiredSources.filter(source=>source.liveStatus==="reachable").length;
  const externalSourcesTotal=zijinExternalFactorReadiness.requiredSources.length;
  const round2BestRegime=zijinRound2RegimeAudit.regimes[0];
  const round2Walk=zijinRound2WalkForward.overallOutOfSample;
  const round2Passed=zijinRound2WalkForward.conclusion.passed;
  const round3Walk=zijinRound3Nested.overallOutOfSample;
  const round3Passed=zijinRound3Nested.conclusion.passed;
  const round4FactorCount=zijinRound4Protocol.hypotheses.map(item=>item.features.length);
  const round4Qualified=zijinRound4Report.qualifiedHypothesisIds.length;
  const round4Baselines=zijinRound4Report.hypotheses[0]?.baselines??[];
  const round5Qualified=zijinRound5Report.qualifiedHypothesisIds.length;
  const round5FactorCount=zijinRound5Protocol.hypotheses.map(item=>item.features.length);
  const round6Qualified=zijinRound6Report.qualifiedHypothesisIds.length;
  const round6FactorCount=zijinRound6Protocol.hypotheses.map(item=>item.features.length);
  const round9Qualified=zijinRound9Report.qualifiedHypothesisIds.length;
  const round9Trades=zijinRound9Report.hypotheses.reduce((total,item)=>total+item.outerQuarters.reduce((sum,fold)=>sum+fold.trades,0),0);
  const currentExperiment=zijinTrainingProgress?.currentExperiment??null;
  const currentHypotheses=currentExperiment?.hypotheses??[];
  const currentExperimentTrades=currentHypotheses.reduce((total,item)=>total+item.outerQuarters.reduce((sum,quarter)=>sum+quarter.trades,0),0);
  const currentBestHypothesis=currentHypotheses.reduce<(typeof currentHypotheses)[number]|null>((best,item)=>!best||item.outOfSampleWinRate>best.outOfSampleWinRate?item:best,null);
  const currentQualified=currentExperiment?.qualifiedHypothesisIds.length??0;
  const trainingRejectionSummary=explainTrainingRejection(currentExperiment,zijinTrainingProgress?.latest);
  const formationDiagnostic=currentExperiment?.sampleFormationDiagnostic??null;
  const formationStageLabels:Record<string,string>={
    "causal-anchor":"因果拐点候选","session":"进入指定时段","observable-regime":"符合震荡状态",
    "vwap-location":"达到 VWAP 偏离","turn-confirmation":"出现转向确认","peer-coverage":"板块数据完整",
    "observable-trend":"形成可见趋势","vwap-distance":"回踩距离合适","continuation-confirmation":"趋势延续确认",
    "volume":"量能达标","independent-limit":"去除同日重复",
  };
  const activeResearchStage=zijinTrainingProgress?.automation?.run.stage??zijinTrainingProgress?.stage??"loading";
  const activeResearchStageLabel=({
    loading:"核验训练文件", "loading-source":"读取封存分钟库", "building-samples":"生成因果样本", "caching-samples":"保存因果样本",
    "loading-cache":"核验因果样本缓存", baselines:"计算三组对照", "rolling-oos":"滚动样本外验证", "risk-audit":"风险与过拟合审计",
    "ledger-audit":"验证试验账本", completed:"本轮已经结束", waiting:"在线等待新实验", failed:"训练需要检查",
  } as Record<string,string>)[activeResearchStage]??"因果实验运行中";
  return <section className="stock-research-view">
    <div className="research-head"><div><span className="eyebrow">SINGLE STOCK RESEARCH</span><h1>单股智研</h1></div><button onClick={onOpenConsole}>今日信号 →</button></div>
    <div className="research-status"><div className="research-asset"><span><small>{stock.code}</small><strong>{stock.name}</strong></span><b>{quote?.price?.toFixed(2)??'--'}</b><em className={quoteDirection}>{quote?.changePercent==null?'行情等待中':`${quote.changePercent>=0?'+':''}${quote.changePercent.toFixed(2)}%`}</em></div><div className="research-maturity" title={`自动分时 ${autoSampleDayCount} 日 · 人工复盘 ${notes.length} 条 · 本机成交 ${manualCount} 笔`}><p><i/>档案成熟度：<strong>{maturity}</strong></p><span>样本 {samples} / 30</span><b className="maturity-progress"><em style={{width:`${Math.min(100,samples/30*100)}%`}}/></b></div></div>
    <div className="research-overview-actions"><b>研究详情</b><button type="button" aria-expanded={researchExpanded} onClick={()=>setResearchExpanded(value=>!value)}>{researchExpanded?'收起':'展开'}</button></div>
    {stock.code==="601899"&&<details className={`research-compact-training ${trainingStale||schedulerOffline||zijinTrainingConnection==='error'?'stale':zijinTrainingProgress?.status??'loading'}`}><summary><div><span>紫金研究模型</span><b>{zijinTrainingConnection==='error'?'状态异常':!zijinTrainingProgress?'读取中':trainingStale?'心跳超时':schedulerOffline?'等待调度':zijinTrainingProgress.status==='running'?activeResearchStageLabel:currentQualified?'等待评审':'继续观察'}</b></div><strong>{zijinTrainingProgress?`审计 ${zijinTrainingProgress.progress}%`:'--'}</strong></summary><small>{zijinTrainingFetchedAt?`最近核对 ${new Date(zijinTrainingFetchedAt).toLocaleString('zh-CN',{hour12:false})}`:'仅展示真实研究结果，不会自动修改 V4。'}</small></details>}
    {stock.code==="601899"&&<details className={`research-compact-training ${zijinL2?.status?.connected&&!zijinL2.status.stale?"completed":"stale"}`}><summary><div><span>L2 实时监控</span><b>{zijinL2?.status?.authorized===false?"暂无权限":zijinL2?.status?.connected?(zijinL2.status.stale?"等待盘口":`${zijinL2HasTicks?"逐笔正常":"逐笔待数"} · ${zijinL2PriceText}`):"连接中"}</b></div><strong>{zijinL2?.status?.stale?"等待":"L2"}</strong></summary><small>主动买 {zijinL2?.flow?.activeBuyRatio60s==null?"--":`${(zijinL2.flow.activeBuyRatio60s*100).toFixed(1)}%`} · 五档 {zijinL2?.book?.nearTouchImbalance==null?"--":zijinL2.book.nearTouchImbalance.toFixed(3)} · ATR14 {zijinL2?.volatility?.ready&&zijinL2.volatility.atr14!=null&&zijinL2.volatility.atr14>0?zijinL2.volatility.atr14.toFixed(3):"预热中"} · 前瞻记录 {zijinL2?.forward?.samples??0}</small></details>}
    {stock.code==="601899"&&researchExpanded&&<div id="zijin-experiment-progress" className={`zijin-training-live zijin-training-prominent ${trainingStale?'stale':zijinTrainingProgress?.status??'loading'}`}>
      <RabbitProgressMeter
        label="紫金矿业 · 本轮研究审计"
        detail={zijinTrainingConnection==='error'?'页面暂时无法连接训练状态接口｜保留最后一次真实记录':!zijinTrainingProgress?'正在连接服务器训练记录…':trainingStale?'运行中的训练超过 10 分钟没有更新｜请检查训练进程':schedulerOffline?'最近一轮已经结束｜自动调度服务目前离线':zijinTrainingProgress.status==="running"?zijinTrainingProgress.message:currentQualified?'本轮因果审计完成｜发现候选，等待人工评审':'本轮因果审计完成｜没有可晋级参数'}
        progress={zijinTrainingProgress?.progress??null}
        status={trainingStale||schedulerOffline||zijinTrainingConnection==='error'?'error':zijinTrainingProgress?.status==='running'?'running':zijinTrainingProgress?.status==='completed'?'completed':'paused'}
        stages={['整理数据','因果训练','样本外验证','最终盲测','人工评审']}
      />
      <div className="research-core-metrics" aria-label="紫金研究核心指标">
        <p><span>当前状态</span><b>{zijinTrainingProgress?.status==='running'?'审计运行中':currentQualified?'等待评审':'继续观察'}</b><small>{activeResearchStageLabel}</small></p>
        <p><span>样本外交易</span><b>{currentExperiment?`${currentExperimentTrades} 笔`:'--'}</b><small>{currentHypotheses.length} 个独立假设</small></p>
        <p><span>最高胜率</span><b>{currentBestHypothesis?`${(currentBestHypothesis.outOfSampleWinRate*100).toFixed(1)}%`:'--'}</b><small>只统计样本外结果</small></p>
        <p><span>晋级状态</span><b className={currentQualified?'positive':'neutral'}>{currentQualified?`${currentQualified} 组待评审`:'未达门槛'}</b><small>不会自动进入 V4</small></p>
      </div>
      <ZijinFactorLifecyclePanel lifecycle={zijinFactorLifecycle} connection={zijinFactorLifecycleConnection}/>
      <details className="research-archive">
        <summary><span><b>完整研究档案</b><small>四兔调度、前瞻观察、历史轮次与参数审计</small></span><em>按需展开</em></summary>
        <div className="research-archive-body">
      {zijinTrainingProgress&&<FourRabbitAutomationDashboard progress={zijinTrainingProgress}/>}
      <details className={`zijin-shadow-ab ${zijinShadow?.status??"loading"}`} open>
        <summary><span><b>第10–18轮 · 紫金 V3 影子观察</b><small>新增动态 ATR、盘口容量和连续 3–5 分钟 L2/OFI 共振；I/J 正反T独立退出，只累计登记后的新样本，不回填历史、不影响 V4</small></span><em>{zijinShadowConnection==="error"?"状态连接失败":zijinShadow?.meta?.stale?"观察器心跳超时":zijinShadow?.status==="observing"?"盘中观察中":zijinShadow?.status==="degraded"?"行情源异常":"等待新样本"}</em></summary>
        {zijinShadow?<div className="zijin-shadow-body">
          <header><div><span>这张看板看什么</span><b>先积累 50 笔真实前瞻闭环，再看扣费胜率和净收益；65% 可保留研究，70% 才能申请人工评审</b></div><p><span>真实前瞻事件</span><b>{zijinShadow.integrity.eventCount} 条</b><small>只追加，不覆盖</small></p><p><span>费用口径</span><b>{zijinShadow.costPolicy.baseRoundTripPct.toFixed(2)}%</b><small>压力成本 {zijinShadow.costPolicy.stressRoundTripPct.toFixed(2)}%</small></p></header>
          <div className="zijin-shadow-models">{(["A","B","C","D","E","F","G","H","I","J"] as const).map(key=>{
            const model=zijinShadow.models[key];
            if(!model)return null;
            const reason=Object.entries(model.rejectionReasons).sort((left,right)=>right[1]-left[1])[0];
            const minimum=Math.max(50,zijinShadow.prospectiveGate?.minimumResolvedTrades??0);
            const researchWinRate=Math.max(.65,zijinShadow.prospectiveGate?.minimumResearchCandidateWinRate??0);
            const requiredWinRate=Math.max(.70,zijinShadow.prospectiveGate?.minimumWinRate??0);
            const observeOnly=model.executionMode==="observe-only";
            const evidenceCount=observeOnly?model.total.candidates:model.total.resolvedTrades;
            const evidenceReady=!observeOnly&&model.total.resolvedTrades>=minimum;
            const evidenceProgress=Math.min(100,evidenceCount/minimum*100);
            const positiveAfterCosts=model.total.netPct>0&&model.total.stressNetPct>0;
            const reviewReady=evidenceReady&&model.total.winRate!==null&&model.total.winRate>=requiredWinRate&&positiveAfterCosts;
            const researchReady=evidenceReady&&model.total.winRate!==null&&model.total.winRate>=researchWinRate&&positiveAfterCosts;
            const plainStatus=observeOnly?"反T仅观察":!evidenceReady?"积累新样本":reviewReady?"达到评审线":researchReady?"保留研究":"未达到候选线";
            return <article key={key} className={key==="E"||key==="F"||key==="G"?"focus":""}>
              <div><span>{model.label}</span><em>第{model.sourceRound}轮 · {model.side==="short"?"反T":"正T"} · {observeOnly?"只观察":"影子闭环"} · {model.sessionStart.slice(0,2)}:{model.sessionStart.slice(2)}–{model.sessionEnd.slice(0,2)}:{model.sessionEnd.slice(2)}</em></div>
              <p><span>{observeOnly?"候选观察":"新样本证据"}</span><b>{evidenceCount}/{minimum} 笔</b></p>
              <p><span>当前结论</span><b className={reviewReady?"positive":researchReady?"candidate":evidenceReady?"negative":"neutral"}>{plainStatus}</b></p>
              <p><span>{observeOnly?"执行方式":"累计净收益"}</span><b className={observeOnly?"neutral":model.total.netPct>0?"positive":model.total.netPct<0?"negative":"neutral"}>{observeOnly?"不生成成交":`${model.total.netPct>=0?"+":""}${model.total.netPct.toFixed(3)}%`}</b></p>
              <i className="zijin-shadow-evidence" aria-label={`前瞻证据 ${evidenceCount}/${minimum}`}><span style={{width:`${evidenceProgress}%`}}/></i>
              <p><span>{observeOnly?"今日观察状态":"胜率与今日状态"}</span><b>{observeOnly?model.today.lastDecision:evidenceReady&&model.total.winRate!==null?`${(model.total.winRate*100).toFixed(1)}% · ${model.today.lastDecision}`:`样本不足 · ${model.today.lastDecision}`}</b></p>
              <small>{observeOnly?"反T仅为研究证据，不参与紫金专属策略收益和晋级判断":reason?`最常见未触发原因：${reason[0]}（${reason[1]}次）`:evidenceReady?"已达到最低样本数，仍需费用、稳定性与人工评审":"只累计上线后的新交易日；不会用旧回测补足样本"}</small>
            </article>;
          })}</div>
          <footer><span>{zijinShadow.marketDate?`交易日 ${zijinShadow.marketDate}`:"等待首个交易日"} · 数据源 {zijinShadow.source.provider??"等待连接"} · 外部因子 {zijinShadow.source.externalCoverage?`${zijinShadow.source.externalCoverage.ready}/${zijinShadow.source.externalCoverage.total}`:"等待快照"}</span><b>正T：65% 保留研究 · 70% 申请评审 · 扣费后必须为正</b></footer>
        </div>:<div className="zijin-shadow-loading">正在读取服务器前瞻观察记录；没有记录时不会显示虚构胜率。</div>}
      </details>
      {zijinTrainingProgress?<>
        <div className={`zijin-training-state-note ${trainingStale||schedulerOffline||zijinTrainingConnection==='error'?'warning':zijinTrainingProgress.status}`}><b>{zijinTrainingConnection==='error'?'状态接口连接失败':trainingStale?'训练任务可能中断':schedulerOffline?'自动调度器离线':zijinTrainingProgress.status==="running"?'服务器正在计算':'本轮已结束'}</b><span>{zijinTrainingConnection==='error'?'页面保留最后一次真实结果并自动重试，不会伪造心跳。':trainingStale?'页面保留最后一次真实进度，不会自动补数。':schedulerOffline?'第 4 轮已经真实完成，但后台没有按计划继续检查新数据；需要恢复服务器自动训练服务。':zijinTrainingProgress.status==="running"?'页面每 2 秒读取服务器状态；切换页面不会影响后台训练。':'100% 表示本轮审计流程完成，不代表系统仍在持续训练。页面每 30 秒检查是否有新任务。'}</span></div>
        <div className="zijin-training-stats"><p><span>服务器当前步骤</span><b>{activeResearchStageLabel}</b><small>{zijinTrainingProgress.status==='running'?`${zijinTrainingProgress.progress}% · ${zijinTrainingProgress.automation?.run.elapsedSeconds??0} 秒`:`最近任务 ${zijinTrainingProgress.runId}`}</small></p><p><span>最近样本外交易</span><b>{currentExperiment?`${currentExperimentTrades} 笔`:'--'}</b><small>{currentHypotheses.length} 个独立假设 · 不读取未来分钟</small></p><p><span>表现最好的一组</span><b>{currentBestHypothesis?`${(currentBestHypothesis.outOfSampleWinRate*100).toFixed(1)}%`:'--'}</b><small>{currentBestHypothesis?.name??'等待实验报告'} · 仅为样本外胜率</small></p><p><span>获准进入下一步</span><b>{currentExperiment?`${currentQualified}/${currentHypotheses.length}`:'--'}</b><small>{currentExperiment?`账本 ${currentExperiment.ledger.runRecords} 条 · ${currentExperiment.reads2026?'已读取':'2026 未读取'}`:'等待报告落盘'}</small></p></div>
        {!currentQualified&&<div className="zijin-rejection-plain"><header><span>为什么未通过</span><b>{trainingRejectionSummary.headline}</b></header><ul>{trainingRejectionSummary.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul><footer><b>下一步</b><span>{trainingRejectionSummary.next}</span></footer></div>}
        {formationDiagnostic&&<details className="zijin-sample-diagnostic">
          <summary><span><b>为什么有的实验是 0 笔？</b><small>逐层查看候选在哪个门槛被过滤；本区只解释结果，不参与选参</small></span><em>净目标 {formationDiagnostic.outcomeLabel.netTargetPct[0].toFixed(2)}%–{formationDiagnostic.outcomeLabel.netTargetPct[1].toFixed(2)}%</em></summary>
          <div className="zijin-sample-diagnostic-grid">{formationDiagnostic.hypotheses.map(item=>{
            const first=item.stages[0]?.count??0;
            const final=item.stages.at(-1)?.count??0;
            return <article key={item.hypothesisId}><header><span><b>{item.name}</b><small>{item.session} · 2024–2025 样本</small></span><em>{final} 笔</em></header><div>{item.stages.map(stage=><p key={stage.id}><span>{formationStageLabels[stage.id]??stage.id}</span><b>{stage.count}</b><i style={{width:`${first?Math.max(2,stage.count/first*100):0}%`}}/></p>)}</div><footer><span>主要卡在：<b>{formationStageLabels[item.primaryBottleneck.stage]??item.primaryBottleneck.stage}</b></span><small>{item.targetTouchRate==null?'无样本可评估':`其中 ${(item.targetTouchRate*100).toFixed(1)}% 曾达到净目标区间`} · 下一分钟开盘成交 · 最长 {formationDiagnostic.outcomeLabel.maximumHoldMinutes} 分钟</small></footer></article>})}</div>
          <p className="zijin-sample-diagnostic-note">2026 继续封存；未来分钟只用于事后收益标签，不用于当时选点，也不会因为这张诊断表自动放宽参数。</p>
        </details>}
        <div className="zijin-implementation-steps" aria-label="紫金矿业实验实施进度">
          <p className="done"><i>1</i><span><b>历史数据隔离</b><small>只加载 2025-12-31 及以前分钟数据</small></span><em>已完成</em></p>
          <p className={zijinTrainingProgress.status==='running'&&['loading','loading-source','building-samples','caching-samples','loading-cache','baselines','rolling-oos'].includes(activeResearchStage)?'pending':'done'}><i>2</i><span><b>独立假设实验</b><small>{currentHypotheses.length||2} 个假设分别运行，不混在一起调参</small></span><em>{zijinTrainingProgress.status==='running'?'运行中':'已完成'}</em></p>
          <p className={zijinTrainingProgress.status==='running'&&activeResearchStage==='rolling-oos'?'pending':zijinTrainingProgress.status==='running'?'sealed':'done'}><i>3</i><span><b>滚动样本外验证</b><small>每个季度只使用此前数据选择参数</small></span><em>{zijinTrainingProgress.status==='running'?'按阶段执行':'已完成'}</em></p>
          <p className={zijinTrainingProgress.status==='running'&&['risk-audit','ledger-audit'].includes(activeResearchStage)?'pending':zijinTrainingProgress.status==='running'?'sealed':'done'}><i>4</i><span><b>费用与过拟合审计</b><small>核查压力成本、PBO、DSR 和试验账本</small></span><em>{zijinTrainingProgress.status==='running'?'等待/运行中':'已完成'}</em></p>
          <p className={currentQualified?'pending':'failed'}><i>5</i><span><b>2026 与影子观察</b><small>只有前四步全部通过，才允许开启一次</small></span><em>{currentQualified?'待人工批准':'未晋级 · 继续封存'}</em></p>
        </div>
        <div className="zijin-training-verdict"><b>本轮真实结论</b><span>{zijinTrainingProgress.latest.passedValidationGate?'候选通过训练与样本外门槛，但仍只允许人工评审和模拟观察。':validationRan||blindRan?'旧轮次四阶段均已执行，但训练集和样本外净期望为负；结果只保留为失败证据，后续不重复使用 2026 盲测调参。':'训练集没有合格候选，2025 与 2026 数据继续封存；下一轮须先补充真实外部因子。'}</span><em>{zijinTrainingProgress.latest.nextAction??'补充真实外部因子后再开启新一轮因果训练'}</em></div>
        {!zijinTrainingProgress.latest.passedValidationGate&&<div className="zijin-next-round"><div><span>下一轮还缺什么</span><b>实时参考 {externalLiveSourcesReady}/{externalSourcesTotal} · 训练历史 {externalSourcesReady}/{externalSourcesTotal}</b><small>第二轮已完成；若继续研究，国际金价、铜价、大盘、港股紫金和公告事件仍须按真实发布时间对齐后再训练。</small></div><em>与 V4 隔离</em></div>}
        <div className="zijin-regime-audit">
          <div><span>不同市场状态都测过了吗</span><b>{zijinRound2RegimeAudit.qualifiedRegimes} 类通过 / {zijinRound2RegimeAudit.regimes.length} 类</b><small>用 2022–2024 找规则，再换 2025 检查；2026 不参与调参</small></div>
          <div><span>目前表现最好的情况</span><b>{round2BestRegime.label}</b><small>换到 2025 后：胜率 {round2BestRegime.validation.winRate==null?'--':`${(round2BestRegime.validation.winRate*100).toFixed(1)}%`} · 每笔平均净收益 {round2BestRegime.validation.averageNetPct>=0?'+':''}{round2BestRegime.validation.averageNetPct.toFixed(4)}%</small></div>
          <div className="blocked"><span>为什么还不能使用</span><b>扣掉费用后，长期平均仍会亏</b><small>{round2BestRegime.blockers.slice(-2).join('；')}</small></div>
        </div>
        <div className="zijin-regime-audit zijin-walkforward-audit">
          <div><span>第二轮是怎么测的</span><b>8 个季度逐季滚动验证</b><small>每一季只用此前数据选规则；2026 载入 {zijinRound2WalkForward.dataset.loaded2026Rows} 行</small></div>
          <div><span>换到陌生季度后的成绩</span><b>{round2Walk.trades} 次 · 胜率 {round2Walk.winRate==null?'--':`${(round2Walk.winRate*100).toFixed(1)}%`}</b><small>扣除近似往返成本后，每次平均 {round2Walk.averageNetPct>=0?'+':''}{round2Walk.averageNetPct.toFixed(4)}%</small></div>
          <div className={round2Passed?'':'blocked'}><span>现在能否用于正式信号</span><b>{round2Passed?'仅可进入影子观察':'不能，第二轮未通过'}</b><small>{zijinRound2WalkForward.positiveFoldCount}/8 个季度为正；不降低 65% 门槛，也不修改 V4</small></div>
        </div>
        <div className="zijin-regime-audit zijin-walkforward-audit">
          <div><span>第三轮做了什么修正</span><b>内层选参，再到外层盲测</b><small>每个季度都先用更早数据选候选，再用未参与选参的季度检验；2026 读取 {zijinRound3Nested.dataset.loaded2026Rows} 行</small></div>
          <div className={round3Passed?'':'blocked'}><span>第三轮样本外成绩</span><b>{round3Walk.trades} 次 · 胜率 {round3Walk.winRate==null?'--':`${(round3Walk.winRate*100).toFixed(1)}%`}</b><small>扣费后每次平均 {round3Walk.averageNetPct>=0?'+':''}{round3Walk.averageNetPct.toFixed(4)}%；压力成本下 {zijinRound3Nested.stressAverageNetPct>=0?'+':''}{zijinRound3Nested.stressAverageNetPct.toFixed(4)}%</small></div>
          <div className="blocked"><span>现在的真实结论</span><b>{round3Passed?'通过研究门槛，仍待人工评审':'第三轮未通过，继续与 V4 隔离'}</b><small>{zijinRound3Nested.positiveFoldCount}/8 个季度为正；内层达标季度 {zijinRound3Nested.gates.innerEligibleFolds.actual}/8，不能把训练内好看当成可用规律</small></div>
        </div>
        <details className="zijin-round4-standard" open>
          <summary><span><b>第九轮 · 四类独立规律复核</b><small>真实运行完成 · 共 {round9Trades} 笔样本外交易 · {zijinRound9Report.ledger.runRecords} 条不可覆盖试验记录</small></span><em>{round9Qualified?'发现合格候选':'样本已够 · 规则未通过'}</em></summary>
          <div className={`zijin-round4-result ${round9Qualified?'qualified':'rejected'}`}><header><div><span>本轮回答什么</span><b>{round9Qualified?'发现可申请最终盲测的独立规律':'不是缺少样本，而是现有入场规则质量不足'}</b><small>只使用 {zijinRound9Report.dataset.firstDate}–{zijinRound9Report.dataset.lastDate}；2026 读取：{zijinRound9Report.reads2026?'是':'否'}；V4 未修改</small></div><em>{zijinRound9Report.ledger.verified?'试验账本已校验':'账本校验失败'}</em></header><div className="zijin-round4-models">{zijinRound9Report.hypotheses.map(item=>{const trades=item.outerQuarters.reduce((sum,fold)=>sum+fold.trades,0);const metrics=item.evaluation.metrics;return <article className={item.evaluation.passedRollingOutOfSample?'passed':'failed'} key={item.hypothesisId}><div><b>{item.name}</b><em>{item.evaluation.passedRollingOutOfSample?'通过':'淘汰'}</em></div><p><span>样本外交易</span><strong>{trades} 笔</strong></p><p><span>样本外胜率</span><strong>{(item.outOfSampleWinRate*100).toFixed(1)}%</strong></p><p><span>扣费后平均</span><strong className={metrics.meanNetPct>=0?'positive':'negative'}>{metrics.meanNetPct>=0?'+':''}{metrics.meanNetPct.toFixed(4)}%</strong></p><p><span>压力成本后</span><strong className={metrics.meanStressNetPct>=0?'positive':'negative'}>{metrics.meanStressNetPct>=0?'+':''}{metrics.meanStressNetPct.toFixed(4)}%</strong></p><p><span>盈利季度</span><strong>{(metrics.positiveQuarterRatio*100).toFixed(0)}%</strong></p><p><span>过拟合风险 PBO</span><strong>{(metrics.pbo*100).toFixed(1)}%</strong></p></article>})}</div><div className="zijin-round4-plain"><p><span>最接近有效</span><b>开盘缺口修复</b><small>136 笔、胜率 41.9%；基础成本后每笔 +0.0165%，但压力成本后 -0.0435%，跨季度也不稳定。</small></p><p><span>明确无效</span><b>VWAP 回归、冲高衰竭、板块背离</b><small>三类都有 300 笔以上样本，扣费后仍为负，不再以“样本不足”为理由重复调参。</small></p><p><span>下一步</span><b>补充真正独立的新证据</b><small>优先验证集合竞价、主动买卖量或真实盘口；在新数据到来前停止用同一批数据硬调胜率。</small></p><p><span>安全边界</span><b>2026 继续封存</b><small>四类规律均未晋级，不打开最终盲测，不接入 V4。</small></p></div></div>
        </details>
        <details className="zijin-round4-standard">
          <summary><span><b>第六轮 · 衰竭确认</b><small>真实运行完成 · {round6Qualified}/2 个假设通过 · 本轮 {zijinRound6Report.ledger.runRecords} 条试验记录</small></span><em>{round6Qualified?'可申请最终盲测':'未通过 · 2026 继续封存'}</em></summary>
          <div className={`zijin-round4-result ${round6Qualified?'qualified':'rejected'}`}><header><div><span>这轮回答什么</span><b>急跌转强与冲高转弱，能否在实时可见后仍有利润</b><small>只使用 {zijinRound6Report.dataset.firstDate}–{zijinRound6Report.dataset.lastDate}；不读取 2026，不修改 V4</small></div><em>不标记事后最高低点</em></header><div className="zijin-round4-models">{zijinRound6Report.hypotheses.map(item=>{const trades=item.outerQuarters.reduce((sum,fold)=>sum+fold.trades,0);const metrics=item.evaluation.metrics;return <article className={item.evaluation.passedRollingOutOfSample?'passed':'failed'} key={item.hypothesisId}><div><b>{item.name}</b><em>{item.evaluation.passedRollingOutOfSample?'通过':'淘汰'}</em></div><p><span>样本外交易</span><strong>{trades} 笔</strong></p><p><span>样本外胜率</span><strong>{(item.outOfSampleWinRate*100).toFixed(1)}%</strong></p><p><span>扣费后季度均值</span><strong className={metrics.meanNetPct>=0?'positive':'negative'}>{metrics.meanNetPct>=0?'+':''}{metrics.meanNetPct.toFixed(4)}%</strong></p><p><span>盈利季度</span><strong>{(metrics.positiveQuarterRatio*100).toFixed(0)}%</strong></p><p><span>过拟合风险 PBO</span><strong>{(metrics.pbo*100).toFixed(1)}%</strong></p><p><span>结论</span><strong>{item.hypothesisId==='drop-exhaustion-confirmation'?'急跌后仍常继续下探':'冲高回落更接近有效，但尚未正期望'}</strong></p></article>})}</div></div>
          <div className="zijin-round4-plain"><p><span>研究结论</span><b>两套衰竭规则均不晋级</b><small>仅靠 VWAP 偏离、量比和三分钟转向，不能确认真正反转。</small></p><p><span>控制复杂度</span><b>{Math.min(...round6FactorCount)}–{Math.max(...round6FactorCount)} 个因子</b><small>每个阈值在运行前冻结，结果出来后没有重新调参。</small></p><p><span>下一轮证据</span><b>需要微型结构与主动成交</b><small>后续应验证不再创新低/高、突破确认和真实盘口主动买卖量，而不是继续放宽阈值。</small></p><p><span>安全边界</span><b>V4 保持不变</b><small>没有合格模型，不打开 2026，也不进入影子观察。</small></p></div>
        </details>
        <details className="zijin-round4-standard">
          <summary><span><b>第五轮 · 先分环境再选点</b><small>真实运行完成 · {round5Qualified}/2 个假设通过 · 本轮 {zijinRound5Report.ledger.runRecords} 条试验记录</small></span><em>{round5Qualified?'可申请最终盲测':'未通过 · 2026 继续封存'}</em></summary>
          <div className={`zijin-round4-result ${round5Qualified?'qualified':'rejected'}`}><header><div><span>这轮回答什么</span><b>震荡日与趋势日不能混用一套买卖逻辑</b><small>只使用 {zijinRound5Report.dataset.firstDate}–{zijinRound5Report.dataset.lastDate}；不读取 2026，不修改 V4</small></div><em>真实失败也保留</em></header><div className="zijin-round4-models">{zijinRound5Report.hypotheses.map(item=>{const trades=item.outerQuarters.reduce((sum,fold)=>sum+fold.trades,0);const metrics=item.evaluation.metrics;const insufficient=trades<40;return <article className={item.evaluation.passedRollingOutOfSample?'passed':'failed'} key={item.hypothesisId}><div><b>{item.name}</b><em>{item.evaluation.passedRollingOutOfSample?'通过':insufficient?'样本不足':'淘汰'}</em></div><p><span>样本外交易</span><strong>{trades} 笔</strong></p><p><span>样本外胜率</span><strong>{insufficient?'不可下结论':`${(item.outOfSampleWinRate*100).toFixed(1)}%`}</strong></p><p><span>扣费后平均</span><strong className={metrics.meanNetPct>=0?'positive':'negative'}>{metrics.meanNetPct>=0?'+':''}{metrics.meanNetPct.toFixed(4)}%</strong></p><p><span>盈利季度</span><strong>{(metrics.positiveQuarterRatio*100).toFixed(0)}%</strong></p><p><span>过拟合风险 PBO</span><strong>{(metrics.pbo*100).toFixed(1)}%</strong></p><p><span>结论</span><strong>{insufficient?'触发过窄，不能宣传胜率':metrics.meanNetPct<0?'仍会接到下落过程':'等待更多稳定季度'}</strong></p></article>})}</div></div>
          <div className="zijin-round4-plain"><p><span>研究结论</span><b>两套规则均不晋级</b><small>震荡回归长期为负；趋势回踩只有 1 笔，统计上无效。</small></p><p><span>控制复杂度</span><b>{Math.min(...round5FactorCount)}–{Math.max(...round5FactorCount)} 个因子</b><small>每个阈值运行前冻结，不看验证答案再改。</small></p><p><span>下一轮方向</span><b>研究“衰竭确认”</b><small>重点验证急跌减速、放量不再创新低和回到微型结构高点。</small></p><p><span>安全边界</span><b>V4 保持不变</b><small>没有合格模型，不打开 2026，也不进入影子观察。</small></p></div>
        </details>
        <details className="zijin-round4-standard">
          <summary><span><b>第四轮 · 标准量化实验</b><small>真实运行完成 · {round4Qualified}/4 个假设通过 · {zijinRound4Report.ledger.runRecords} 条试验记录</small></span><em>{round4Qualified?'可申请最终盲测':'未通过 · 2026 封存'}</em></summary>
          <div className={`zijin-round4-result ${round4Qualified?'qualified':'rejected'}`}><header><div><span>滚动样本外真实结论</span><b>{round4Qualified?'发现合格候选，仍须人工批准一次最终盲测':'四个假设均未达到研究门槛'}</b><small>只使用 {zijinRound4Report.dataset.firstDate}–{zijinRound4Report.dataset.lastDate}；2026 读取：{zijinRound4Report.reads2026?'是':'否'}</small></div><em>{zijinRound4Report.finalBlind.opened?'最终盲测已打开':'最终盲测未打开'}</em></header><div className="zijin-round4-models">{zijinRound4Report.hypotheses.map(item=>{const trades=item.outerQuarters.reduce((sum,fold)=>sum+fold.trades,0);const metrics=item.evaluation.metrics;return <article className={item.evaluation.passedRollingOutOfSample?'passed':'failed'} key={item.hypothesisId}><div><b>{item.name}</b><em>{item.evaluation.passedRollingOutOfSample?'通过':'淘汰'}</em></div><p><span>样本外交易</span><strong>{trades} 笔</strong></p><p><span>样本外胜率</span><strong>{(item.outOfSampleWinRate*100).toFixed(1)}%</strong></p><p><span>扣费后平均</span><strong className={metrics.meanNetPct>=0?'positive':'negative'}>{metrics.meanNetPct>=0?'+':''}{metrics.meanNetPct.toFixed(4)}%</strong></p><p><span>盈利季度</span><strong>{(metrics.positiveQuarterRatio*100).toFixed(0)}%</strong></p><p><span>过拟合风险 PBO</span><strong>{(metrics.pbo*100).toFixed(1)}%</strong></p><p><span>多次试验后可信度 DSR</span><strong>{(metrics.deflatedSharpeProbability*100).toFixed(1)}%</strong></p></article>})}</div><div className="zijin-round4-baselines"><b>三组对照</b>{round4Baselines.map(item=><p key={item.id}><span>{item.id==='no-trade'?'不交易':item.id==='simple-vwap'?'简单 VWAP 规则':'当前 Smart‑T V4'}</span><strong className={item.netPct>=0?'positive':'negative'}>{item.netPct>=0?'+':''}{item.netPct.toFixed(4)}%</strong></p>)}<small>账本哈希链已验证 · 任何历史记录被改写都会导致校验失败</small></div></div>
          <div className="zijin-round4-plain"><p><span>2026 数据</span><b>完全封存</b><small>滚动样本外全部通过后，才允许进行一次最终盲测。</small></p><p><span>独立研究</span><b>{zijinRound4Protocol.hypotheses.length} 个假设</b><small>{zijinRound4Protocol.hypotheses.map(item=>item.name).join('、')}</small></p><p><span>控制复杂度</span><b>{Math.min(...round4FactorCount)}–{Math.max(...round4FactorCount)} 个因子</b><small>每个模型只使用预先登记的核心因子，不边测边增加。</small></p><p><span>对照基准</span><b>{zijinRound4Protocol.baselines.length} 组</b><small>{zijinRound4Protocol.baselines.map(item=>item.name).join('、')}</small></p></div>
          <div className="zijin-round4-gates"><b>怎样才算通过</b><span>扣费后正期望 · 压力成本不亏 · 跨季度稳定 · 胜率至少 {(zijinRound4Protocol.promotionGates.minimumOutOfSampleWinRate*100).toFixed(0)}% · PBO ≤ {(zijinRound4Protocol.multipleTesting.probabilityOfBacktestOverfitting.maximum*100).toFixed(0)}% · Deflated Sharpe ≥ {(zijinRound4Protocol.multipleTesting.deflatedSharpe.minimumProbability*100).toFixed(0)}% · 同时战胜三个基准</span></div>
          <div className="zijin-round4-ledger"><p><span>试验次数账本</span><b>逐次追加，不允许改写</b><small>每次参数、代码版本、训练区间、验证区间和结果都会生成哈希记录。</small></p><p><span>最终去向</span><b>仅影子观察</b><small>通过盲测后仍需人工评审；不会自动修改 V4，也不会直接实盘。</small></p><p><span>模拟盘核对</span><b>理论与成交逐笔对账</b><small>漏单、拒单、费用和滑点全部记录；无法配对的信号按失败处理。</small></p></div>
        </details>
        <footer><span>任务 {zijinTrainingProgress.runId} · 更新 {new Date(zijinTrainingProgress.updatedAt.replace(/([+-]\d{2})(\d{2})$/,'$1:$2')).toLocaleString('zh-CN')} · {zijinTrainingProgress.meta?.source==='runtime'?'服务器实时状态':'内置审计快照'}</span><b>{trainingStale?"需检查训练进程":zijinTrainingProgress.status==="running"?"训练中":zijinTrainingProgress.latest.passedValidationGate?"通过验证，等待人工评审":"未通过门槛，不进入 V4"}</b></footer>
      </>:<footer><span>训练数据仍在服务器保留，页面会自动重试</span><b>连接中</b></footer>}
        </div>
      </details>
    </div>}
    <div className="research-grid">
      <div className="research-column research-primary"><article className="research-card research-summary"><span>当前结论</span><h2>{candidate}</h2><p>{stats.trend} · 20日振幅 {stats.range?`${stats.range.toFixed(2)}%`:'待计算'}{researchExpanded?` · ${autoCycles} 个闭环 · 扣费后 ${autoSamples.length?money(autoNet):'待样本'}`:''}</p><div><b title="研究结论仅作参考；正式买卖点仍由操盘台 V4 过滤。">研究参考 ⓘ</b></div></article>{researchExpanded&&<article className="research-card feedback-card"><span>人工确认</span><p>如需纠正系统结论，选择标签并写一句原因。</p><div className="feedback-control"><small>判断类型</small><div>{['观察','正T','反T'].map(item=><button key={item} className={mode===item?'active':''} onClick={()=>{setMode(item);setSaveMessage('')}}>{item}{mode===item?' ✓':''}</button>)}</div></div><div className="feedback-control"><small>实际结果</small><div>{['待验证','有效','无效'].map(item=><button key={item} className={outcome===item?'active':''} onClick={()=>{setOutcome(item);setSaveMessage('')}}>{item}{outcome===item?' ✓':''}</button>)}</div></div><textarea value={feedback} onChange={event=>{setFeedback(event.target.value);setSaveMessage('')}} placeholder="例如：量能未跟上，因此没有执行。"/><button onClick={saveNote} disabled={!feedback.trim()}>{saveMessage||'保存人工确认'}</button></article>}</div>
      <div className="research-column research-secondary"><article className="research-card"><span>股性速览</span><div className="fingerprint"><p><small>平均振幅</small><b>{stats.range?`${stats.range.toFixed(2)}%`:'--'}</b></p><p><small>阳线天数</small><b>{bars.length?`${stats.upDays}/20`:'--'}</b></p><p><small>20日均价</small><b>{stats.ma20?stats.ma20.toFixed(2):'--'}</b></p><p><small>量能比</small><b>{stats.volumeRatio?`${stats.volumeRatio.toFixed(2)}×`:'--'}</b></p></div></article>{researchExpanded&&<article className="research-card"><span>待验证规律</span><ul className="candidate-list">{zijinOpeningEvidence&&<li><b>紫金早盘高波动观察</b><small>09:30–10:30 只用当时已出现的振幅、VWAP、三分钟动量与量比；近 {zijinOpeningEvidence.sessions} 个完整样本中 {zijinOpeningEvidence.candidateDays} 日形成候选（正T {zijinOpeningEvidence.positiveDays} / 反T {zijinOpeningEvidence.reverseDays}），尚不直接执行。</small><em>{zijinOpeningEvidence.sessions>=10?'验证中':'收集中'}</em></li>}<li><b>{candidate}</b><small>{stats.range<3.5?'振幅偏小时，提高确认门槛。':'波动偏大时，缩小单次仓位。'}</small><em>{autoSamples.length>=10?'验证中':'收集中'}</em></li><li><b>{stats.trend.includes('上方')?'趋势内回撤观察':'均值回归观察'}</b><small>{autoCycles?`已形成 ${autoCycles} 个闭环，盈利 ${autoWins} 个。`:'还没有足够正式闭环。'}</small><em>{autoCycles>=20?'可评审':'待样本'}</em></li></ul></article>}</div>
    </div>
    {zijinFactorResearch&&researchExpanded&&<section className="zijin-factor-lab">
      <div className="zijin-factor-head"><div><span>ZIJIN FACTOR RESEARCH · 独立实验区</span><h2>紫金矿业专属因子研究</h2><p>只研究 VWAP 偏离、三分钟动量、量比和日内振幅；历史未来数据仅用于完整交易日的结果标签，盘中快照只读取当前分钟及之前的数据。</p></div><em>{zijinFactorResearch.live.status==="candidate"?"出现待验证组合":zijinFactorResearch.live.status==="watch"?"因子监控中（非训练）":"等待分钟样本"}</em></div>
      <div className="zijin-factor-grid"><div><span>离当天均价多远</span><b>{zijinFactorResearch.live.vwap===null?'--':`${zijinFactorResearch.live.vwapBiasPct>=0?'+':''}${zijinFactorResearch.live.vwapBiasPct.toFixed(2)}%`}</b><small>{zijinFactorResearch.live.vwap===null?'等待数据':`当天均价 ${zijinFactorResearch.live.vwap.toFixed(2)}`}</small></div><div><span>最近 3 分钟方向</span><b>{zijinFactorResearch.live.points?`${zijinFactorResearch.live.momentum3Pct>=0?'+':''}${zijinFactorResearch.live.momentum3Pct.toFixed(2)}%`:'--'}</b><small>只使用已经出现的分钟</small></div><div><span>成交量有没有放大</span><b>{zijinFactorResearch.live.volumeRatio===null?'--':`${zijinFactorResearch.live.volumeRatio.toFixed(2)}×`}</b><small>最近 3 分钟与此前平均相比</small></div><div><span>当前研究判断</span><b>{zijinFactorResearch.live.directionLabel??'等待'}</b><small>{zijinFactorResearch.live.label} · 可信度 {zijinFactorResearch.live.score}/100</small></div></div>
      <details className="research-archive research-factor-archive">
        <summary><span><b>因子历史与数据口径</b><small>历史审计、规律扫描、外部参考和专业词解释</small></span><em>按需展开</em></summary>
        <div className="research-archive-body">
      <div className="zijin-plain-guide"><div><span>今天能不能直接用</span><b>不能直接下单</b><small>这里负责研究和解释；正式提醒仍由操盘台 V4 给出。</small></div><div><span>历史规则是否合格</span><b>{historicalPassed?'已通过，待人工评审':'还没有通过'}</b><small>换到没见过的数据仍需赚钱，才算真正有效。</small></div><div><span>外部参考准备情况</span><b>实时 {externalLiveSourcesReady}/{externalSourcesTotal} · 历史 {externalSourcesReady}/{externalSourcesTotal}</b><small>实时用于解释今天；历史用于重新训练多年规律。</small></div><div><span>接下来做什么</span><b>{externalSourcesReady===externalSourcesTotal?'重新训练并复核':'补齐 5 类历史数据'}</b><small>结果不合格就继续淘汰，不为了好看放宽标准。</small></div></div>
      <details className="zijin-term-help"><summary>这些专业词是什么意思？</summary><div><p><b>VWAP 偏离</b><span>当前价格离当天平均成交成本有多远。</span></p><p><b>3 分钟动量</b><span>最近三分钟是在加速上涨，还是加速下跌。</span></p><p><b>量比</b><span>最近成交量是否明显放大。</span></p><p><b>样本外验证</b><span>换一段没参与训练的数据重新考试，防止只会背历史答案。</span></p></div></details>
      <div className="zijin-history-audit">
        <div className="zijin-history-head"><div><span>四兔历史审计 · 4.3 年 1 分钟库</span><h3>{historicalPassed?'全量因子组合已通过样本外门槛':'全量因子组合未通过研究门槛'}</h3><p>训练兔只看 2022–2024，挑战兔只看 2025，风控兔最后盲审 2026；最早按下一分钟开盘价成交，同一分钟同时触发止盈止损时按止损优先。</p></div><em>{historicalPassed?'等待人工评审':'未进入 V4'}</em></div>
        <div className="zijin-history-metrics"><p><span>一共学习了多少天</span><b>{zijinHistoricalEvidence.dataset.tradingDays.toLocaleString()}</b><small>{zijinHistoricalEvidence.dataset.firstDate}—{zijinHistoricalEvidence.dataset.lastDate}</small></p><p><span>旧数据上的胜率</span><b className={zijinHistoricalEvidence.results.training.averageNetPct>=0?'positive':'negative'}>{(zijinHistoricalEvidence.results.training.winRate*100).toFixed(1)}%</b><small>{zijinHistoricalEvidence.results.training.trades} 次 · 每次平均 {zijinHistoricalEvidence.results.training.averageNetPct.toFixed(3)}%</small></p><p><span>换到 2025 后的胜率</span><b className={zijinHistoricalEvidence.results.validation.averageNetPct>=0?'positive':'negative'}>{(zijinHistoricalEvidence.results.validation.winRate*100).toFixed(1)}%</b><small>{zijinHistoricalEvidence.results.validation.trades} 次 · 每次平均 {zijinHistoricalEvidence.results.validation.averageNetPct.toFixed(3)}%</small></p><p><span>最后保密测试的胜率</span><b className={zijinHistoricalEvidence.results.blindTest.averageNetPct>=0?'positive':'negative'}>{(zijinHistoricalEvidence.results.blindTest.winRate*100).toFixed(1)}%</b><small>{zijinHistoricalEvidence.results.blindTest.trades} 次 · 每次平均 {zijinHistoricalEvidence.results.blindTest.averageNetPct.toFixed(3)}%</small></p></div>
        <div className="zijin-history-verdict"><b>{historicalPassed?'下一步':'为什么拒绝'}</b><span>{historicalPassed?'通过样本外门槛只代表可以人工评审；该实验仍与 V4 隔离，必须先进入模拟观察，不能自动修改正式策略。':`扣除 ${zijinHistoricalEvidence.methodology.roundTripCostPct.toFixed(2)}% 往返成本后，训练或验证仍未达到正期望与胜率门槛。该组合只保留为失败证据，后续研究会加入开盘阶段、板块相对强弱和量价衰竭因子，不会为了显示高胜率放宽结果标签。`}</span></div>
      </div>
      <div className={`zijin-pattern-result ${zijinPeerPatternDiscovery.conclusion.status}`}>
        <div className="zijin-pattern-title"><div><span>紫金规律扫描 · 阶段二已完成</span><h3>{zijinPeerPatternDiscovery.conclusion.message}</h3><p>阶段一已检验 {zijinPatternDiscovery.dataset.labeledScenarios.toLocaleString()} 个仅靠紫金自身价量形成的候选场景；阶段二加入 6 只黄金、铜和有色同业的同分钟强弱，以及只来自前一交易日和前 5/20 日的历史结构。</p></div><em>{zijinPeerPatternDiscovery.conclusion.deployment}</em></div>
        <div className="zijin-pattern-metrics"><p><span>发现了多少种可能情况</span><b>{zijinPeerPatternDiscovery.dataset.labeledScenarios.toLocaleString()}</b><small>信号后下一分钟成交，不读取未来</small></p><p><span>用了多少个交易日</span><b>{zijinPeerPatternDiscovery.dataset.tradingDays.toLocaleString()}</b><small>{zijinPeerPatternDiscovery.dataset.firstDate}—{zijinPeerPatternDiscovery.dataset.lastDate}</small></p><p><span>同时对比了多少只股票</span><b>{zijinPeerPatternDiscovery.dataset.stockCount} 股</b><small>{zijinPeerPatternDiscovery.dataset.minuteRows.toLocaleString()} 条分钟记录 · 数据覆盖 {(zijinPeerPatternDiscovery.dataset.meanPeerCoverage*100).toFixed(0)}%</small></p><p><span>真正稳定的规律</span><b>{zijinPeerPatternDiscovery.stableRuleCount}</b><small>先通过 2025，才有资格看 2026</small></p></div>
        <div className="zijin-pattern-next"><b>胜率不能靠回看最高低点制造</b><span>{zijinPeerPatternDiscovery.stableRuleCount?`已发现 ${zijinPeerPatternDiscovery.stableRuleCount} 组通过盲测的候选，下一步仍需模拟观察和人工评审。`:`同业与历史结构仍未形成可部署规则。后续需要补入 ${zijinPeerPatternDiscovery.conclusion.nextRequiredFactors.join('、')}；未达到 65% 样本外门槛的规律继续淘汰。`}</span></div>
      </div>
      <div className={`zijin-pattern-result zijin-external-stage ${zijinExternalFactorReadiness.status}`}>
        <div className="zijin-pattern-title"><div><span>紫金规律扫描 · 外部参考</span><h3>盘中参考已经可用，长期训练还缺历史数据</h3><p>先看结论即可：现在能辅助判断紫金为什么涨跌，但还不能拿这些外部数据训练 4.3 年专属策略，也不会直接修改 V4 买卖点。</p></div><em>研究参考 · 不自动交易</em></div>
        <div className="zijin-external-summary"><div className="available"><span>盘中现在能看</span><b>{externalLiveSourcesReady}/{externalSourcesTotal} 已连通</b><small>金价、铜价、大盘、港股紫金、公告事件</small></div><div className="waiting"><span>长期训练还缺</span><b>{externalSourcesReady}/{externalSourcesTotal} 有历史库</b><small>需要覆盖 2022—2026 的带时间戳历史数据</small></div></div>
        <div className="zijin-external-conclusion"><b>一句话理解</b><span>实时数据用来帮助解释“今天为什么这样走”；历史数据才用来验证“过去几年这个规律是否真的有效”。</span></div>
        <div className="zijin-external-sources">{zijinExternalFactorReadiness.requiredSources.map(source=><article key={source.id} className={source.status}><span>{source.label}</span><b>{source.liveStatus==='reachable'?'实时能看':'暂不可用'}</b><strong>{EXTERNAL_FACTOR_PLAIN_COPY[source.id]??source.role}</strong><small>历史训练：{source.status==='ready'?'已准备':'尚未准备'}</small><details><summary>查看数据口径</summary><p>{source.role} · {source.resolution} · 来源 {source.liveProvider}</p></details></article>)}</div>
        <div className="zijin-pattern-next"><b>下一步要做什么</b><span>把 5 类历史数据按真实发布时间导入，再重新训练和样本外验证。未导入前不显示虚假胜率。最近接口检查：{new Date(zijinExternalFactorReadiness.liveProbe.checkedAt).toLocaleString('zh-CN')}。</span></div>
      </div>
        </div>
      </details>
      <div className="zijin-evidence"><p><span>已经学习的完整天数</span><b>{zijinFactorResearch.evidence.sessions} 日</b></p><p><span>找到的候选机会</span><b>{zijinFactorResearch.evidence.samples} 条</b></p><p><span>拿新数据复核的次数</span><b>{zijinFactorResearch.evidence.validationSamples} 条</b></p><p><span>新数据复核胜率</span><b>{zijinFactorResearch.evidence.ready&&zijinFactorResearch.evidence.validationWinRate!==null?`${(zijinFactorResearch.evidence.validationWinRate*100).toFixed(1)}%`:'样本不足，暂不展示'}</b></p><strong>{zijinFactorResearch.evidence.label}；这里展示最近一次离线训练结果。数据更新后需要重新训练，盘中判断不会读取未来分钟。</strong></div>
      <footer><b>与 Smart‑T V4 隔离</b><span>不会修改档位、买卖点或风控阈值；通过样本外验证和人工评审后，才允许进入模拟观察。</span></footer>
    </section>}
    {researchExpanded&&<div className="research-bottom"><div><span>自动分时研究</span><b>{autoSamples.length} 个完整交易日</b>{autoSamples.length?<div className="auto-sample-list">{autoSamples.slice(0,3).map(item=><p key={item.date}><b>{item.date}</b><em className={item.net>=0?'valid':'invalid'}>{item.status}</em></p>)}</div>:<small>公开源尚未提供可用的完整历史分时，系统不会伪造样本。</small>}</div><div><span>最近人工确认</span>{notes.length?notes.slice(0,3).map(note=><p key={note.id}><b>{note.date} · {note.mode}</b><em className={note.outcome==='有效'?'valid':note.outcome==='无效'?'invalid':''}>{note.outcome}</em><small>{note.note}</small></p>):<p className="empty-note">尚无人工确认。</p>}</div><aside><span>升级规则</span><b>自动收集 → 样本外验证 → 人工评审</b><small>达到 30 条只代表可以评审，不代表自动启用。</small></aside></div>}
  </section>;
}

const builtInStrategies = [
  {id:'steady-pullback',name:'稳健回踩观察',tag:'低频 · 低回撤优先',fit:'适合先建立纪律：仅在趋势背景与回踩确认同时满足时观察。',rules:['09:30 开始扫描，09:33 前只积累样本','价格结构与量能同时确认','单日最多 2 次候选'],risk:'连续两次无效后，当日暂停'},
  {id:'opening-reversal',name:'开盘反转确认',tag:'开盘 · 正反T候选',fit:'观察高开转弱或低开转强，不用第一根波动直接下结论。',rules:['09:30 起扫描，09:33 最早确认','回抽失败/站回需二次确认','不追逐快速拉升或跳水'],risk:'09:45 前仅用 1/6 底仓试单'},
  {id:'afternoon-vwap',name:'午后均值回归',tag:'午后 · VWAP参考',fit:'用于震荡日午后偏离后的收敛观察，先处理未闭环仓位。',rules:['仅在 13:30–14:30 观察','量价收敛后才形成候选','已有未闭环时不新增'],risk:'14:50 前停止新候选'},
  {id:'position-guard',name:'底仓闭环卫士',tag:'风控 · 始终生效',fit:'不是交易策略，而是每个策略都应遵守的仓位与尾盘检查。',rules:['T+1 可卖数量检查','未配对时冻结新候选','收盘前核对计划底仓'],risk:'不满足闭环条件即转人工核对'},
];

function readMarketStorage(accountName:string){
  if(typeof window==='undefined')return {name:'',summary:''};
  try{
    const storageKey=`rabbit-market:${accountName.toLowerCase()}`;
    const draft=JSON.parse(localStorage.getItem(`${storageKey}:draft`)||'{}');
    return {
      name:typeof draft.name==='string'?draft.name:'',
      summary:typeof draft.summary==='string'?draft.summary:'',
    };
  }catch{return {name:'',summary:''};}
}

function StrategyMarketView({accountName}:{accountName:string}){
  const [publishing,setPublishing]=useState(false);
  const [draftName,setDraftName]=useState(()=>readMarketStorage(accountName).name);
  const [draftSummary,setDraftSummary]=useState(()=>readMarketStorage(accountName).summary);
  const [draftMessage,setDraftMessage]=useState('');
  const storageKey=`rabbit-market:${accountName.toLowerCase()}`;
  const [enabledBuiltIns,setEnabledBuiltIns]=useState<string[]>(()=>{try{const saved=JSON.parse(localStorage.getItem(`${storageKey}:builtins`)||'[]');return Array.isArray(saved)?saved:[]}catch{return [];}});
  const toggleBuiltIn=(id:string)=>setEnabledBuiltIns(items=>{const next=items.includes(id)?items.filter(item=>item!==id):[...items,id];try{localStorage.setItem(`${storageKey}:builtins`,JSON.stringify(next));}catch{}return next;});
  const saveDraft=()=>{
    const name=draftName.trim();
    const summary=draftSummary.trim();
    if(!name||!summary){setDraftMessage('请填写策略名称和策略说明后再保存。');return;}
    try{localStorage.setItem(`${storageKey}:draft`,JSON.stringify({name,summary,savedAt:new Date().toISOString()}));setDraftMessage('研究草稿已保存；当前不会公开、收费或自动执行。');}catch{setDraftMessage('草稿保存失败，请检查浏览器存储权限。');}
  };
  return <section className="market-view">
    <div className="market-hero"><div><span className="eyebrow">RABBIT RESEARCH PLAYBOOKS</span><h1>策略研究与观察库</h1><p>选择透明规则进入本机模拟观察，或保存自己的研究草稿。当前不展示未经审计的用户策略排行、虚拟业绩或跟单订阅。</p></div></div>
    <div className="market-guard"><b>公开测试边界</b><span>内置规则仅用于模拟观察</span><span>用户策略发布与排行榜尚未开放</span><span>策略跟单收费和真实资金交易保持关闭</span></div>
    <section className="builtin-strategies"><div className="builtin-head"><div><span className="eyebrow">BUILT-IN PLAYBOOKS</span><h2>内置策略库</h2><p>这些是透明的研究规则，不是收益承诺。启用后只进入模拟观察和记录，不会自动下单。</p></div><b>已启用 {enabledBuiltIns.length} / {builtInStrategies.length}</b></div><div className="builtin-grid">{builtInStrategies.map(item=>{const enabled=enabledBuiltIns.includes(item.id);return <article className={enabled?'enabled':'disabled'} key={item.id}><div><span>{item.tag}</span><em>{enabled?'运行中':'未启用'}</em></div><h3>{item.name}</h3><p>{item.fit}</p><ul>{item.rules.map(rule=><li key={rule}>{rule}</li>)}</ul><small>风控：{item.risk}</small><button onClick={()=>toggleBuiltIn(item.id)}>{enabled?'取消观察 · 运行中':'启用模拟观察'}</button></article>})}</div></section>
    <div className="market-stats"><div><span>透明研究规则</span><b>{builtInStrategies.length}</b><small>全部公开触发与风控条件</small></div><div><span>当前启用观察</span><b>{enabledBuiltIns.length}</b><small>只记录模拟观察结果</small></div><div><span>用户公开排行</span><b>未开放</b><small>完成真实性审计后再上线</small></div><div><span>策略跟单订阅</span><b className="amber-text">关闭</b><small>会员仅解锁平台研究工具</small></div></div>
    <div className="market-toolbar"><div><span>研究草稿仅保存在当前账户，不会冒充已验证策略。</span></div><div className="market-toolbar-actions"><button className="market-publish" onClick={()=>setPublishing(true)}>＋ 新建研究草稿</button></div></div>
    {draftName&&<div className="market-list"><div className="market-row market-title"><span>我的研究草稿</span><span>状态</span><span/><span/><span/><span/><span/><span/></div><div className="market-row"><span className="market-name"><i>DRAFT</i><b>{draftName}</b><small>{draftSummary||'尚未填写说明'}</small></span><span><em className="backtested">仅草稿</em><small>未回测 · 未发布</small></span><span/><span/><span/><span/><span/><button onClick={()=>setPublishing(true)}>继续编辑 →</button></div></div>}
    {publishing&&<div className="market-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setPublishing(false)}}><div className="publish-card"><button className="detail-close" onClick={()=>setPublishing(false)}>×</button><span className="eyebrow">PRIVATE RESEARCH DRAFT</span><h2>记录我的策略想法</h2><p>这里只保存研究草稿，不会公开发布、生成收费订阅或连接真实交易。</p><label>策略名称<input value={draftName} onChange={e=>{setDraftName(e.target.value);setDraftMessage('')}} placeholder="例如：我的稳健反T观察"/></label><label>策略说明<textarea value={draftSummary} onChange={e=>{setDraftSummary(e.target.value);setDraftMessage('')}} placeholder="用直白语言说明买入、卖出、仓位和停止条件"/></label><div><label>当前阶段<select disabled><option>研究草稿</option></select></label><label>执行权限<select disabled><option>不可执行</option></select></label></div><button onClick={saveDraft}>保存研究草稿</button><small>{draftMessage||'后续只有通过真实回测、样本外验证和人工审核，才考虑开放分享。'}</small></div></div>}
  </section>;
}

function personalTrainingStorageKey(accountName:string) {
  return `rabbit-personal-training:${accountName.trim().toLowerCase() || "guest"}`;
}

function PersonalReplayTraining({accountName,stock,position}:{accountName:string;stock:{code:string;name:string};position:StockPosition}) {
  const [sessions,setSessions]=useState<IntradaySession[]>([]);
  const [selectedDate,setSelectedDate]=useState("");
  const [archiveCoverage,setArchiveCoverage]=useState<PersonalReplayArchive["coverage"]|null>(null);
  const [session,setSession]=useState<IntradaySession|null>(null);
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState("先加载一个完整历史交易日，再开始逐分钟训练。");
  const [capital,setCapital]=useState(200000);
  const [baseShares,setBaseShares]=useState(Math.max(100,Math.floor((position.plannedBase || 1000)/100)*100));
  const [quantity,setQuantity]=useState(100);
  const [revealIndex,setRevealIndex]=useState(-1);
  const [cash,setCash]=useState(0);
  const [shares,setShares]=useState(0);
  const [initialCash,setInitialCash]=useState(0);
  const [initialShares,setInitialShares]=useState(0);
  const [actions,setActions]=useState<PersonalTrainingAction[]>([]);
  const [finished,setFinished]=useState(false);
  const [history,setHistory]=useState<PersonalTrainingRecord[]>([]);
  const storageKey=personalTrainingStorageKey(accountName);

  useEffect(()=>{
    const timer=window.setTimeout(()=>{
      try {
        const saved=JSON.parse(localStorage.getItem(storageKey)||"[]");
        const migrated=Array.isArray(saved)?saved.slice(0,20).map((record:PersonalTrainingRecord)=>{
          const cycle=summarizeTrainingCycles(record.actions ?? []);
          return {...record,totalNet:record.totalNet ?? record.net,net:cycle.closedQuantity>0?cycle.net:record.net,closedQuantity:record.closedQuantity ?? cycle.closedQuantity};
        }):[];
        setHistory(migrated);
      } catch { setHistory([]); }
    },0);
    return ()=>window.clearTimeout(timer);
  },[storageKey]);

  const selectedSession=useMemo(()=>sessions.find(item=>item.date===selectedDate) ?? null,[sessions,selectedDate]);
  const minutes=useMemo(()=>session?.minutes ?? [],[session]);
  const current=minutes[revealIndex] ?? null;
  const revealed=useMemo(()=>revealIndex>=0?minutes.slice(0,revealIndex+1):[],[minutes,revealIndex]);
  const chartRange=useMemo(()=>{
    const values=revealed.map(item=>item.price);
    const low=values.length?Math.min(...values):0;
    const high=values.length?Math.max(...values):1;
    const padding=Math.max(.01,(high-low)*.16);
    return {low:low-padding,high:high+padding};
  },[revealed]);
  const chartSeries=useMemo(()=>{
    const xFor=(index:number)=>liveChartX(revealed[index]?.time);
    const priceY=(price:number)=>liveChartPriceY(price,chartRange.low,chartRange.high);
    const maxVolume=Math.max(1,...revealed.map(item=>Math.max(0,item.volume||0)));
    const averageSeries=cumulativeIntradayAverage(revealed);
    const vwap=averageSeries.map((price,index)=>`${xFor(index)},${priceY(price)}`).join(" ");
    const vwapValue=averageSeries.at(-1) ?? null;
    const actionMarkers=actions.filter(action=>action.minuteIndex>=0&&action.minuteIndex<revealed.length).map(action=>({
      ...action,x:liveChartX(action.time),y:priceY(action.marketPrice)
    }));
    const ticks=[0,.25,.5,.75,1].map(ratio=>({value:chartRange.high-(chartRange.high-chartRange.low)*ratio,y:LIVE_CHART.priceTop+(LIVE_CHART.priceBottom-LIVE_CHART.priceTop)*ratio}));
    return {
      price:revealed.length>1?revealed.map((item,index)=>`${xFor(index)},${priceY(item.price)}`).join(" "):"",
      vwap:revealed.length>1?vwap:"",
      volumes:revealed.map((item,index)=>({x:xFor(index),height:Math.max(2,Math.max(0,item.volume||0)/maxVolume*(LIVE_CHART.volumeBottom-LIVE_CHART.volumeTop-3)),index,up:index===0||item.price>=revealed[index-1].price})),
      actionMarkers,
      vwapValue,ticks,
       lastX:revealed.length?xFor(revealed.length-1):LIVE_CHART.plotLeft,lastY:priceY(revealed.at(-1)?.price??0)
    };
  },[revealed,chartRange,actions]);
  const summary=current? summarizePersonalTraining({initialCash,initialShares,initialPrice:minutes[0]?.price,cash,shares,markPrice:current.price,actions:actions as unknown as []}):null;
  const setQuantityFraction=(fraction:number)=>{
    const next=Math.max(100,Math.floor(baseShares*fraction/100)*100);
    setQuantity(next);
  };

  const resetTraining=()=>{
    setSession(null); setRevealIndex(-1); setActions([]); setFinished(false);
  };
  const loadZijinRandomSession=async(exclude?:string)=>{
    const suffix=exclude?`&exclude=${encodeURIComponent(exclude)}`:"";
    const response=await fetch(`/api/personal-replay-sessions?code=601899${suffix}`,{cache:"no-store"});
    if(!response.ok){
      const body=await response.json().catch(()=>null) as {error?:string}|null;
      throw new Error(body?.error||"紫金近五年历史库暂不可用");
    }
    const data=await response.json() as PersonalReplayArchive;
    if(!data.session?.minutes?.length) throw new Error("紫金近五年历史库没有可训练交易日");
    setSessions([data.session]); setSelectedDate(data.session.date); setArchiveCoverage(data.coverage); resetTraining();
    return data;
  };
  const loadSessions=async()=>{
    setLoading(true); setMessage(`正在加载 ${stock.code} 的历史分时…`);
    try {
      if(stock.code==="601899"){
        const data=await loadZijinRandomSession();
        setMessage(`已从近五年 ${data.coverage.sessions.toLocaleString()} 个紫金完整交易日中随机抽取 ${data.session.date}；开始后仍只逐分钟揭示。`);
        return;
      }
      const response=await fetch(`/api/market-data?code=${encodeURIComponent(stock.code)}`,{cache:"no-store"});
      if(!response.ok) throw new Error("历史行情暂不可用");
      const data=await response.json() as MarketData;
      const next=[...(data.intradaySessions ?? [])].filter(item=>item.minutes.length>=100).sort((a,b)=>b.date.localeCompare(a.date));
      if(!next.length) throw new Error("没有可用于逐分钟训练的完整交易日");
      setSessions(next); setSelectedDate(next[0].date); setArchiveCoverage(null); resetTraining();
      setMessage(`已找到 ${next.length} 个完整交易日，选择日期后即可开始训练。`);
    }catch(error){setMessage(error instanceof Error?error.message:"历史行情加载失败");}
    finally{setLoading(false);}
  };
  const randomizeZijinSession=async()=>{
    if(stock.code!=="601899") return;
    if(revealIndex>=0&&!finished){setMessage("请先结算本局后再随机换日，避免中途跳转破坏训练记录。");return;}
    setLoading(true); setMessage("正在从紫金近五年完整交易日中随机抽取…");
    try{
      const data=await loadZijinRandomSession(selectedDate);
      setMessage(`已随机换为 ${data.session.date}；样本来自近五年 ${data.coverage.sessions.toLocaleString()} 个完整交易日。`);
    }catch(error){setMessage(error instanceof Error?error.message:"随机训练日加载失败");}
    finally{setLoading(false);}
  };
  const startTraining=()=>{
    if(!selectedSession){setMessage("请先加载并选择一个完整交易日。");return;}
    const initial=Math.max(100,Math.floor(baseShares/100)*100);
    const startCash=Math.max(0,capital);
    setSession(selectedSession); setRevealIndex(Math.min(3,selectedSession.minutes.length-1)); setInitialCash(startCash); setInitialShares(initial); setCash(startCash); setShares(initial); setActions([]); setFinished(false);
    setMessage("训练已开始：图表只揭示到当前分钟；下一段行情需要你主动推进。");
  };
  const advance=(step:number)=>{
    if(!session||finished)return;
    setRevealIndex(value=>Math.min(session.minutes.length-1,Math.max(0,value+step)));
  };
  const trade=(side:"buy"|"sell")=>{
    if(!current||finished){setMessage("请先开始训练，且在揭示到收盘前操作。");return;}
    const result=executePersonalTrainingOrder({side,quantity,marketPrice:current.price,cash,shares,feeRate:.025,slippage:.02,minCommission:true}) as PersonalTrainingExecution;
    if(!result.ok){setMessage(result.error);return;}
    const action:PersonalTrainingAction={id:globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`,time:current.time,minuteIndex:revealIndex,...result.action};
    setCash(result.cash); setShares(result.shares); setActions(items=>[...items,action]);
    setMessage(`${side==="buy"?"买入":"卖出"}已记录：${action.quantity.toLocaleString()} 股，按当前揭示分钟成交；费用 ¥${action.fee.toFixed(2)}。`);
  };
  const settle=()=>{
    if(!session||!minutes.length)return;
    const finalPrice=minutes.at(-1)?.price ?? 0;
    const finalSummary=summarizePersonalTraining({initialCash,initialShares,initialPrice:minutes[0]?.price,cash,shares,markPrice:finalPrice,actions:actions as unknown as []});
    const scored=scorePersonalTrainingActions(actions as unknown as [],minutes,10) as Array<{evaluated:boolean;directionCorrect:boolean|null}>;
    const evaluated=scored.filter(item=>item.evaluated);
    const accuracy=evaluated.length?evaluated.filter(item=>item.directionCorrect).length/evaluated.length:null;
    const record:PersonalTrainingRecord={id:globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`,completedAt:new Date().toISOString(),code:stock.code,name:stock.name,date:session.date,actions,net:finalSummary.tradeNet,totalNet:finalSummary.net,closedQuantity:finalSummary.closedQuantity,fees:finalSummary.fees,accuracy};
    const next=[record,...history].slice(0,20);
    setHistory(next); try{localStorage.setItem(storageKey,JSON.stringify(next));}catch{}
    setRevealIndex(minutes.length-1); setFinished(true);
    setMessage(`本次训练已结算：${evaluated.length?`10分钟方向正确率 ${(accuracy!*100).toFixed(0)}%`:'操作不足 10 分钟，暂无方向评分'}；结果已仅保存到当前账号的本机。`);
  };

  return <section className="personal-training" aria-label="个人手动回测训练">
    <header className="personal-training-head"><div><span className="eyebrow">PERSONAL CAUSAL REPLAY</span><h2>个人手动回测训练</h2><p>自己决定买卖，逐分钟揭示历史行情；记录只用于个人复盘，不改变 V4、L2 或任何实盘信号。</p></div><b>本机私有 · 非实盘</b></header>
    <div className="personal-training-setup">
      <div className="personal-training-symbol"><label>训练标的</label><strong>{stock.code} {stock.name}</strong><small>从顶部切换股票后可训练其他自选股。</small></div>
      <div className="personal-training-load"><button onClick={()=>void loadSessions()} disabled={loading||(revealIndex>=0&&!finished)}>{loading?"加载中…":stock.code==="601899"?"随机抽取近五年":"加载历史交易日"}</button></div>
      <details className="personal-training-config"><summary>初始配置 <small>资金 ¥{capital.toLocaleString()} · 底仓 {baseShares.toLocaleString()} 股</small></summary><div><label>模拟资金<input type="number" min="1000" step="1000" value={capital} onChange={event=>setCapital(Math.max(1000,Number(event.target.value)||1000))}/></label><label>模拟底仓<input type="number" min="100" step="100" value={baseShares} onChange={event=>setBaseShares(Math.max(100,Math.floor((Number(event.target.value)||100)/100)*100))}/></label></div></details>
    </div>
    {sessions.length>0&&<div className="personal-training-session">{stock.code==="601899"?<><span className="personal-training-random-date">随机训练日 <b>{`${selectedDate.slice(0,4)}-${selectedDate.slice(4,6)}-${selectedDate.slice(6,8)}`}</b> · {selectedSession?.minutes.length??0} 分钟</span><button onClick={()=>void randomizeZijinSession()} disabled={loading||(revealIndex>=0&&!finished)}>近五年换一日</button><small>近五年 {archiveCoverage?.sessions.toLocaleString()??"--"} 个完整交易日；每次随机抽取，开始后只逐分钟揭示。</small></>:<><label>训练日期<select value={selectedDate} onChange={event=>setSelectedDate(event.target.value)} disabled={revealIndex>=0&&!finished}>{sessions.map(item=><option key={item.date} value={item.date}>{item.date} · {item.minutes.length} 分钟</option>)}</select></label><small>开始后无法回退或查看未来分钟；结算后才会揭示收盘结果。</small></>}<button onClick={startTraining}>{session&&!finished?"重新开始本日":"开始逐分钟训练"}</button></div>}
    {session&&current&&<div className="personal-training-stage">
      <div className="personal-training-status"><span>当前仅揭示至 <b>{formatTime(current.time)}</b></span><span>{revealIndex+1}/{minutes.length} 分钟</span><span>当前价 <b>¥{current.price.toFixed(2)}</b></span><span>模拟持仓 <b>{shares.toLocaleString()} 股</b></span><span>可用资金 <b>¥{cash.toFixed(2)}</b></span></div>
      <div className="personal-training-chart-shell">
        <div className="personal-training-chart-tools"><div className="legend personal-training-indicators" aria-label="当前已揭示指标"><span><i className="coral-line"/>最新价 <b>{current.price.toFixed(2)}</b></span><span><i className="teal-line"/>均价参考 ¥{chartSeries.vwapValue?.toFixed(2)??"--"}</span><span><i className="volume"/>成交量（仅已揭示）</span><span><i className="trade"/>你的买卖</span></div><span className="intraday-only personal-training-intraday"><i/>当日分时 <small>训练回放</small></span></div>
        <div className="personal-training-chart-wrap"><svg className="personal-training-chart" viewBox={`0 0 ${LIVE_CHART.width} ${LIVE_CHART.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="个人训练当日分时图，仅显示已揭示数据"><defs><linearGradient id="personalReplayPriceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff655f" stopOpacity=".18"/><stop offset="1" stopColor="#ff655f" stopOpacity="0"/></linearGradient></defs>{chartSeries.ticks.map(tick=><g key={tick.value}><line x1={LIVE_CHART.plotLeft} y1={tick.y} x2={LIVE_CHART.plotRight} y2={tick.y} className="grid-line"/><text x="5" y={tick.y+3.5} className="intraday-axis-label">{tick.value.toFixed(2)}</text></g>)}{A_SHARE_INTRADAY_AXIS.map(tick=>{const x=liveChartSlotX(tick.slot);return <g key={tick.label}><line x1={x} y1={LIVE_CHART.priceTop} x2={x} y2={LIVE_CHART.volumeBottom} className="grid-line vertical"/><text x={x} y="317" textAnchor={tick.slot===0?"start":tick.slot===240?"end":"middle"} className="intraday-axis-label intraday-time-label">{tick.label}</text></g>})}<path d={`${chartSeries.price} L${chartSeries.lastX} ${LIVE_CHART.volumeTop} L${LIVE_CHART.plotLeft} ${LIVE_CHART.volumeTop} Z`} fill="url(#personalReplayPriceFill)"/>{chartSeries.vwap&&<polyline className="vwap-path" points={chartSeries.vwap}/>}<polyline className="price-path" points={chartSeries.price}/>{chartSeries.actionMarkers.map(action=><g className={`personal-training-trade ${action.side}`} key={action.id}><line x1={action.x} y1={action.y} x2={action.x} y2={action.side==="buy"?action.y+10:action.y-10}/><circle cx={action.x} cy={action.y} r="6"/><text x={action.x} y={action.side==="buy"?Math.min(294,action.y+23):Math.max(13,action.y-13)} textAnchor="middle">{action.side==="buy"?"买入":"卖出"}</text></g>)}<line x1={LIVE_CHART.plotLeft} y1={chartSeries.lastY} x2={LIVE_CHART.plotRight} y2={chartSeries.lastY} className="last-line"/><circle cx={chartSeries.lastX} cy={chartSeries.lastY} r="4" className="last-dot"/><g className="intraday-price-flag"><rect x="0" y={Math.max(6,Math.min(294,chartSeries.lastY-12))} width="54" height="24"/><text x="27" y={Math.max(6,Math.min(294,chartSeries.lastY-12))+16} textAnchor="middle">{current.price.toFixed(2)}</text></g><line x1={LIVE_CHART.plotLeft} y1={LIVE_CHART.volumeTop} x2={LIVE_CHART.plotRight} y2={LIVE_CHART.volumeTop} className="volume-divider"/>{chartSeries.volumes.map(bar=><rect key={bar.index} x={bar.x-1.35} y={LIVE_CHART.volumeBottom-bar.height} width="2.7" height={bar.height} rx=".45" className={bar.up?"volume":"volume red"}/>)}</svg></div>
      </div>
      <div className="personal-training-controller">
        <div className="training-advance"><span>回放控制</span><button className="replay-next" onClick={()=>advance(1)} disabled={finished||revealIndex>=minutes.length-1}>▶ 下一分</button><button onClick={()=>advance(5)} disabled={finished||revealIndex>=minutes.length-1}>快进 5 分</button><button className="settle" onClick={settle} disabled={finished}>揭示收盘并结算</button></div>
        <div className="training-order"><span>模拟下单</span><div className="training-quantity-presets" aria-label="常用做T数量"><button onClick={()=>setQuantityFraction(.25)} disabled={finished}>1/4</button><button onClick={()=>setQuantityFraction(.5)} disabled={finished}>1/2</button><button onClick={()=>setQuantityFraction(1)} disabled={finished}>全T</button></div><label>数量<input type="number" min="100" step="100" value={quantity} onChange={event=>setQuantity(Math.max(100,Math.floor((Number(event.target.value)||100)/100)*100))}/></label><button className="manual-buy" onClick={()=>trade("buy")} disabled={finished}>买入</button><button className="manual-sell" onClick={()=>trade("sell")} disabled={finished}>卖出</button></div>
      </div>
      <p className="personal-training-message">{message}</p>
      <div className="personal-training-summary"><span className="training-net">本次做T净收益 <b className={(summary?.tradeNet??0)>=0?"positive":"negative"}>{(summary?.tradeNet??0)>=0?"+":""}¥{summary?.tradeNet.toFixed(2)}</b><small>{summary?.closedQuantity?`已闭环 ${summary.closedQuantity.toLocaleString()} 股，已扣匹配交易费用`:"尚未形成买卖闭环"}</small></span><span>持仓总权益变化 <b className={(summary?.net??0)>=0?"positive":"negative"}>{(summary?.net??0)>=0?"+":""}¥{summary?.net.toFixed(2)}</b><small>含原有底仓随收盘价的浮盈亏</small></span><span>全部已计费用 <b>¥{summary?.fees.toFixed(2)}</b></span><span>手动操作 <b>{actions.length} 笔</b></span></div>
      <div className="personal-training-ledger"><b>本局操作</b>{actions.length?actions.map(action=><span key={action.id}><em className={action.side}>{action.side==="buy"?"买入":"卖出"}</em>{formatTime(action.time)} · ¥{action.executionPrice.toFixed(3)} · {action.quantity.toLocaleString()} 股 · 费 ¥{action.fee.toFixed(2)}</span>):<small>尚未操作。请基于当前已揭示价格自行判断。</small>}</div>
    </div>}
    {history.length>0&&<div className="personal-training-history"><div><b>最近个人训练</b><small>仅本机保存，最多保留 20 局。</small></div><p className="personal-training-history-head"><span>交易日 / 标的</span><span>操作</span><span>做T净收益</span><span>10分钟方向</span></p>{history.slice(0,5).map(record=><p key={record.id}><span>{record.date} · {record.code} {record.name}</span><span>{record.actions.length} 笔</span><span className={record.net>=0?"positive":"negative"}>{record.net>=0?"+":""}¥{record.net.toFixed(2)}</span><span>{record.accuracy===null?"待评":`${(record.accuracy*100).toFixed(0)}%`}</span></p>)}</div>}
  </section>;
}

function TrainingView({evidence,accountName,stock,position,premiumEnabled,onOpenAccount}:{evidence:{sessions:number;cycles:number;wins:number;net:number;maxDrawdown:number;confidence:string;winRate:number|null};accountName:string;stock:{code:string;name:string};position:StockPosition;premiumEnabled:boolean;onOpenAccount:()=>void}) {
  const sampleCoverage=Math.min(100,evidence.sessions/20*100);
  const validationCoverage=Math.min(100,evidence.cycles/20*100);
  const evidenceCoverage=Math.min(sampleCoverage,validationCoverage);
  const winRatePercent=evidence.winRate===null?null:evidence.winRate*100;
  const winRateCoverage=winRatePercent===null?0:Math.min(100,winRatePercent/52*100);
  const drawdownPercent=evidence.maxDrawdown*100;
  const drawdownCoverage=evidence.cycles===0?0:Math.max(0,Math.min(100,(3-drawdownPercent)/3*100));
  const canReview=evidence.sessions>=20&&evidence.cycles>=20;
  const primaryAction=()=>document.getElementById('promotion-review')?.scrollIntoView({behavior:'smooth',block:'center'});
  const researchGates=[
    {label:'交易日',value:`${evidence.sessions}/20`,progress:sampleCoverage,passed:evidence.sessions>=20,title:'至少 20 个完整交易日'},
    {label:'有效闭环',value:`${evidence.cycles}/20`,progress:validationCoverage,passed:evidence.cycles>=20,title:'至少 20 个扣费后有效闭环'},
    {label:'扣费胜率',value:winRatePercent===null?'待验证':`${winRatePercent.toFixed(1)}%`,progress:winRateCoverage,passed:winRatePercent!==null&&winRatePercent>=52,title:'研究观察线为扣费后胜率 52%'},
    {label:'最大回撤',value:evidence.cycles===0?'待验证':`${drawdownPercent.toFixed(2)}%`,progress:drawdownCoverage,passed:evidence.cycles>0&&drawdownPercent<=3,title:'研究观察线为最大回撤不超过 3%'},
  ];
  return <section className="module-view training-view">
    <div className="module-head"><div><span className="eyebrow">SMART-T FUSION V4 · RESEARCH PIPELINE</span><h1>通用 V4 四兔研究中心</h1><p>研究 → 盲测 → 风控 → 人工评审</p></div><button className="lab-run" onClick={primaryAction}>查看研究门<span>↓</span></button></div>
    <div className="training-scope-strip" aria-label="通用四兔研究范围"><p title="使用历史全市场数据提出候选，不局限于当前自选股"><i>01</i><span>样本</span><b>全市场历史</b></p><p title="当前监控股票只进行影子逐笔核对，不改变正式信号"><i>02</i><span>验证</span><b>影子核对</b></p><p title="任何候选进入正式版本前都必须由人工批准"><i>03</i><span>上线</span><b>人工审批</b></p></div>
    <div className="training-purpose"><div className="training-purpose-hero"><span>训练目标</span><h2>扣费后更稳</h2><div className="training-targets" aria-label="研究目标"><b><i>≥</i>52%<small>扣费胜率</small></b><b><i>≤</i>3%<small>最大回撤</small></b><b><i>×</i>0<small>自动上线</small></b></div></div><div className="training-role-grid" aria-label="四兔研究流程"><p title="从历史样本中提出候选参数"><i>1</i><b>训练兔</b><span>提出候选</span></p><p title="使用未见股票与日期进行盲测"><i>2</i><b>挑战兔</b><span>样本外盲测</span></p><p title="检查成本、滑点、回撤与过拟合"><i>3</i><b>风控兔</b><span>风险否决</span></p><p title="仅管理人工评审资格，不会自动上线"><i>4</i><b>正式兔</b><span>人工评审</span></p></div><details className="lab-method"><summary>查看研究规则</summary><p>候选参数会检查 VWAP 偏离、连续确认、净价差、仓位、费用、滑点和回撤；必须通过未见样本与过拟合检查，才可进入影子观察。</p></details></div>
    {premiumEnabled?<PersonalReplayTraining key={stock.code} accountName={accountName} stock={stock} position={position}/>:<div className="personal-training-lock"><div><span>会员专属 · 个人训练</span><h2>手动回放训练已锁定</h2><p>会员可随机抽取近五年交易日，逐分钟手动买卖，并保存个人训练结果。</p></div><button onClick={onOpenAccount}>查看会员权益</button></div>}
    <section className="research-overview" aria-label="当前股票研究证据">
      <div className="research-progress-ring" style={{'--research-progress':`${evidenceCoverage*3.6}deg`} as CSSProperties}><span><strong>{Math.round(evidenceCoverage)}%</strong><small>证据覆盖</small></span></div>
      <div className="research-overview-main"><div><span>当前研究</span><h2>{stock.code} {stock.name}</h2></div><em className={canReview?'ready':'collecting'}>{canReview?'可人工评审':'样本积累中'}</em><div className="research-gates">{researchGates.map(gate=><div className={gate.passed?'passed':''} title={gate.title} key={gate.label}><p><span>{gate.label}</span><b>{gate.value}</b></p><i><span style={{width:`${gate.progress}%`}}/></i><small>{gate.passed?'✓':'·'}</small></div>)}</div></div>
    </section>
    <div className="lab-grid">{agents.map((agent,index)=>{const isTraining=agent.id==="training";const isChallenger=agent.id==="challenger";const isRisk=agent.id==="risk";const value=isTraining?sampleCoverage:isChallenger?validationCoverage:isRisk?drawdownCoverage:(canReview?100:0);const label=isTraining?`${evidence.sessions}/20 日`:isChallenger?`${evidence.cycles}/20 闭环`:isRisk?(evidence.cycles?`${drawdownPercent.toFixed(2)}%`:'待验证'):(canReview?'可评审':'已锁定');const explanation=isTraining?'从历史数据提出候选参数':isChallenger?'使用未见样本验证稳定性':isRisk?'费用、滑点或回撤异常时否决':'所有结果必须经过人工批准';return <article className={`lab-agent ${isRisk&&evidence.maxDrawdown<.03?'risk-safe':''}`} title={explanation} key={agent.name}><div><span className={`agent-icon a${index}`}><Image src={agent.avatar} alt={`${agent.name} AI头像`} width={40} height={40}/></span><p><b>{agent.name}</b><small>{isTraining?'候选研究':isChallenger?'盲测验证':isRisk?'风险审计':'版本门控'}</small></p><em>{isTraining?'已读取':isChallenger?'待盲测':isRisk?(evidence.cycles===0?'待验证':evidence.maxDrawdown<.03?'通过':'关注'):'人工批准'}</em></div><strong>{label}<small>{isTraining?'交易日':isChallenger?'扣费闭环':isRisk?'最大回撤':'自动上线关闭'}</small></strong><i><span style={{width:`${value}%`}}/></i></article>})}</div>
    <div className="lab-results"><div className="lab-metrics"><h2>研究结果</h2><div className="lab-visual-metrics"><article><span>扣费胜率</span><div className="metric-dial" style={{'--metric-progress':`${(winRatePercent??0)*3.6}deg`} as CSSProperties}><b>{winRatePercent===null?'—':`${winRatePercent.toFixed(1)}%`}</b></div><small>观察线 52%</small></article><article><span>闭环构成</span><div className="cycle-composition"><i style={{width:`${evidence.cycles?evidence.wins/evidence.cycles*100:0}%`}}/><b>{evidence.wins}<small>盈利</small></b><b>{Math.max(0,evidence.cycles-evidence.wins)}<small>亏损</small></b></div><small>共 {evidence.cycles} 个闭环</small></article><article><span>扣费净盈亏</span><div className={`net-direction ${evidence.net>=0?'positive':'negative'}`}><i>{evidence.net>=0?'↗':'↘'}</i><b>{evidence.cycles?money(evidence.net):'—'}</b></div><small>{evidence.cycles?'已扣费用':'等待有效闭环'}</small></article><article><span>最大回撤</span><div className="drawdown-scale"><i><span style={{width:`${Math.min(100,drawdownPercent/3*100)}%`}}/></i><b>{evidence.cycles?`${drawdownPercent.toFixed(2)}%`:'—'}</b></div><small>上限 3%</small></article></div></div><div className="promotion-card" id="promotion-review"><span>研究门</span><div className={`promotion-lock ${canReview?'ready':''}`} aria-hidden="true"><i>{canReview?'✓':'⌁'}</i></div><h2>{canReview?'可人工评审':'证据未齐'}</h2><div className="promotion-checks">{researchGates.map(gate=><span className={gate.passed?'passed':''} key={`review-${gate.label}`}>{gate.passed?'✓':'·'} {gate.label}</span>)}</div><button disabled>{canReview?'等待人工评审':'继续积累'}</button><small>不会自动修改正式版本</small></div></div>
    <details className="lab-log"><summary>查看核对明细</summary>{[['本机','训练兔',`读取 ${evidence.sessions} 个完整交易日；不等于已完成全市场选参`],['本机','挑战兔',evidence.cycles?`本股核对 ${evidence.cycles} 个扣费闭环，盈利 ${evidence.wins} 个`:'本股当前没有足够正式闭环'],['本机','风控兔',`本股最差历史回撤 ${drawdownPercent.toFixed(2)}%；通用候选仍需独立 PBO/DSR 审计`],['本机','正式兔',canReview?'本股达到基础样本数量，通用 V4 仍保持锁定':'样本不足，不生成可晋升版本']].map(row=><div className={`log-${row[1]}`} key={`${row[1]}-${row[2]}`}><time>{row[0]}</time><i/><b>{row[1]}</b><span>{row[2]}</span></div>)}</details>
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

function BacktestView({ profile, setProfile, profitMode, setProfitMode, position, stock, stocks, activeStock, onSelectStock }: { profile: StrategyProfile; setProfile: (value: StrategyProfile) => void; profitMode:ProfitMode; setProfitMode:(value:ProfitMode)=>void; position:StockPosition; stock:{code:string;name:string;price:string;change:string}; stocks:{code:string;name:string;price:string;change:string}[]; activeStock:number; onSelectStock:(index:number)=>void }) {
  const [capital, setCapital] = useState(200000);
  const [baseShares, setBaseShares] = useState(position.plannedBase);
  const [sellable, setSellable] = useState(position.sellable);
  const [feeRate, setFeeRate] = useState(0.025);
  const [slippage, setSlippage] = useState(0.02);
  const [minCommission, setMinCommission] = useState(true);
  const [slippageMode, setSlippageMode] = useState<"percent"|"tick">("percent");
  const [forceCloseTime, setForceCloseTime] = useState("1450");
  const [replayEngine,setReplayEngine]=useState<BacktestReplayEngine>("closure-first");
  const [exitTarget,setExitTarget]=useState<ReplayExitTarget>(1);
  const [running, setRunning] = useState(false);
  const [runMode, setRunMode] = useState<"single"|"multi"|"batch"|null>(null);
  const [singleRunCount, setSingleRunCount] = useState(0);
  const [singleRunDate, setSingleRunDate] = useState("");
  const [requestedSessionDate, setRequestedSessionDate] = useState("");
  const [availableSessionDates, setAvailableSessionDates] = useState<string[]>([]);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [batch, setBatch] = useState<BatchBacktestResult | null>(null);
  const [multiDay, setMultiDay] = useState<MultiDayBacktestResult | null>(null);
  const [multiDayCount, setMultiDayCount] = useState(20);
  const [multiDayRunKind, setMultiDayRunKind] = useState<MultiDayRunKind>("recent");
  const [source, setSource] = useState<MarketData | null>(null);
  const [l2Replay, setL2Replay] = useState<L2ReplayState>({available:false,source:"idle",minuteCount:0,observations:[],reason:"等待紫金矿业回放"});
  const [error, setError] = useState("");
  const [runStatus, setRunStatus] = useState("等待运行");
  const [accountNotice, setAccountNotice] = useState("");
  const [batchFetchProgress, setBatchFetchProgress] = useState({ready:0,attempted:0});
  const [replayProgress, setReplayProgress] = useState({value:0,detail:"等待选择测试"});
  const [lastAction, setLastAction] = useState<"idle"|"single"|"multi"|"batch">("idle");
  const [backtestConfigCollapsed,setBacktestConfigCollapsed]=useState(()=>typeof window!=="undefined"&&window.matchMedia("(max-width: 1000px)").matches);
  const [trainingMode,setTrainingMode]=useState(false);
  const [trainingIndex,setTrainingIndex]=useState(0);
  const [trainingChoices,setTrainingChoices]=useState<Array<{choice:"buy"|"sell"|"wait";expected:"buy"|"sell";time:string}>>([]);
  const batchRunSequence = useRef(0);
  const recentBatchCodes = useRef<string[]>([]);
  const selectBacktestStock=(index:number)=>{
    if(stocks[index]?.code!=="601899"&&replayEngine==="zijin-v29-shadow")setReplayEngine("closure-first");
    setRequestedSessionDate("");
    setAvailableSessionDates([]);
    setSingleRunDate("");
    setResult(null);
    setBatch(null);
    setMultiDay(null);
    setSource(null);
    setL2Replay({available:false,source:"idle",minuteCount:0,observations:[],reason:"等待紫金矿业回放"});
    setError("");
    setRunStatus("等待运行");
    setReplayProgress({value:0,detail:"等待选择测试"});
    setLastAction("idle");
    setTrainingMode(false);
    setTrainingIndex(0);
    setTrainingChoices([]);
    onSelectStock(index);
  };
  const replayWithEngine=(data:MarketData,account:{capital:number;baseShares:number;sellable:number}|undefined,engine:BacktestReplayEngine):BacktestResult=>{
    const shadowOptions={
      capital:account?.capital??capital,
      baseShares:account?.baseShares??baseShares,
      sellable:account?.sellable??sellable,
      feeRate,slippage,minCommission,slippageMode,forceCloseTime,
      maximumCycles:STRATEGY_PROFILE_META[profile].maxCycles,
      targetNetPct:exitTarget,
    };
    if(engine==="zuot-v1-reconstructed-shadow"||engine==="zijin-v29-shadow"){
      const shadowSession={
        code:data.quote.code??stock.code,
        date:data.sampleDate??"",
        previousClose:data.quote.previousClose??null,
        minutes:data.minutes??[],
      };
      return (engine==="zijin-v29-shadow"
        ? runZijinV29ShadowReplay(shadowSession,shadowOptions)
        : runZuoTV1ReconstructedReplay(shadowSession,shadowOptions)) as BacktestResult;
    }
    const code=data.quote.code??stock.code;
    const experiment=resolveBacktestStrategyExperiment(code,"closure-first");
    const profitOptions=smartTProfitModeOptions(code,profitMode) as ReplayProfitOptions;
    const similarityArchive=buildHistoricalSimilarityArchive(data.intradaySessions ?? [],{asOfDate:data.sampleDate ?? null});
    return runSmartTReplay(data.minutes ?? [],{
      capital:account?.capital ?? capital,baseShares:account?.baseShares ?? baseShares,sellable:account?.sellable ?? sellable,feeRate,slippage,minCommission,slippageMode,forceCloseTime,
      profile:experiment.profile ?? profile,
      previousClose:data.quote.previousClose ?? null,
      similarityArchive,
      randomValue:0,
      ...profitOptions,
      profileOverrides:{
        ...(profitOptions.profileOverrides??{}),
        ...experiment.profileOverrides,
        targetNetPct:exitTarget,
        maxTargetNetPct:exitTarget,
        trailActivationPct:exitTarget,
        maxCycles:STRATEGY_PROFILE_META[profile].maxCycles,
      },
      positionSizeMode:experiment.positionSizeMode,
      volatilityMode:experiment.volatilityMode,
      strategyVersion:"closure-first",
    });
  };
  const replay=(data:MarketData,account?:{capital:number;baseShares:number;sellable:number}):BacktestResult=>replayWithEngine(data,account,replayEngine);
  const fetchStock=async (code:string,historyDays=6) => {
    const response=await fetch(`/api/market-data?code=${encodeURIComponent(code)}&historyDays=${historyDays}`, { cache:"no-store" });
    if(!response.ok) throw new Error("market unavailable");
    return await response.json() as MarketData;
  };
  const sessionData=(data:MarketData,session:IntradaySession):MarketData=>{
    const enriched=addHistoricalTimeVolumeBaseline(data,session);
    const prices=enriched.minutes.map(point=>point.price);
    const open=prices[0] ?? null; const price=prices.at(-1) ?? null;
    const previousClose=resolveHistoricalPreviousClose(session,data.bars);
    return {...data,sampleDate:session.date,minutes:enriched.minutes,intradaySessions:data.intradaySessions,quote:{...data.quote,price,previousClose,open,high:prices.length?Math.max(...prices):null,low:prices.length?Math.min(...prices):null,change:price!==null&&previousClose!==null?price-previousClose:null,changePercent:price!==null&&previousClose?((price-previousClose)/previousClose)*100:null}};
  };
  const runSingle = async () => {
    const attempt=singleRunCount+1;
    setSingleRunCount(attempt); setSingleRunDate("");
    setLastAction("single");
    setAccountNotice("");
    setRunning(true); setRunMode("single"); setError(""); setResult(null); setBatch(null); setMultiDay(null); setSource(null);
    setTrainingMode(false); setTrainingIndex(0); setTrainingChoices([]);
    setL2Replay({available:false,source:"loading",minuteCount:0,observations:[],reason:"正在读取历史L2分钟快照"});
    setReplayProgress({value:6,detail:`正在连接 ${stock.code} 公开分时数据`});
    setRunStatus(`第 ${attempt} 次：正在获取 ${stock.code} ${stock.name} 最新完整分时…`);
    try {
      const fetched=await fetchStock(stock.code);
      setReplayProgress({value:28,detail:"行情已返回，正在核验完整交易日"});
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
      setReplayProgress({value:46,detail:`已锁定 ${selected.date}，准备逐分钟因果回放`});
      setSingleRunDate(selected.date);
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
      setReplayProgress({value:68,detail:"逐分钟推进策略，不读取未来高低点"});
      let strictL2:L2ReplayState={available:false,source:"not-applicable",minuteCount:0,observations:[],reason:"仅紫金矿业启用L2严格回放"};
      let replayMinutes=data.minutes??[];
      if(data.quote.code==="601899"){
        try{
          const l2Response=await fetch(`/api/research/zijin-l2-replay?date=${encodeURIComponent(selected.date)}&t=${Date.now()}`,{cache:"no-store"});
          const l2Payload=await l2Response.json() as {available?:boolean;source?:string;minutes?:Record<string,unknown>[];reason?:string};
          const merged=mergeZijinL2ReplayMinutes(data.minutes??[],l2Payload.minutes??[],selected.date);
          if(l2Payload.available)replayMinutes=merged;
          const observations=l2Payload.available?buildZijinL2CausalReplayObservations(merged) as ReplayObservation[]:[];
          strictL2={
            available:Boolean(l2Payload.available),
            source:l2Payload.source??"unavailable",
            minuteCount:l2Payload.minutes?.length??0,
            observations,
            reason:l2Payload.available
              ? observations.length?`L2已进入正式过滤，并复现 ${observations.length} 个独立资金修复阶段`:"L2已进入正式过滤，本日没有通过持续资金确认的修复候选"
              : l2Payload.reason??"本交易日没有历史L2快照",
          };
        }catch{
          strictL2={available:false,source:"error",minuteCount:0,observations:[],reason:"历史L2读取失败，未参与本次回放"};
        }
      }
      const replayData={...data,minutes:replayMinutes};
      setSource(replayData);
      const calculated=replay(replayData,replayAccount);
      setL2Replay(strictL2);
      setReplayProgress({value:88,detail:"正在扣除佣金、印花税与双向滑点"});
      setResult(calculated);
      setBatch(null);
      const candidateCount=calculated.diagnostics?.candidates ?? 0;
      const observationCount=buildReplayChartObservations(data.quote.code,data.minutes ?? [],calculated.observations ?? [],strictL2.observations).length;
      setRunStatus(calculated.trades
        ? `全日回放完成：形成 ${calculated.trades} 个闭环，净收益 ${money(calculated.net)}`
        : `全日回放完成：展示 ${observationCount} 个候补观察点，出现 ${candidateCount} 次候选判定，0 个通过正式过滤`);
      setReplayProgress({value:100,detail:calculated.trades?`报告完成 · ${calculated.trades} 个闭环`:`报告完成 · ${candidateCount} 次候选判定`});
      setTimeout(()=>document.getElementById("single-backtest-result")?.scrollIntoView({behavior:"smooth",block:"start"}),0);
    } catch {
      setResult(null); setBatch(null); setSource(null);
      setL2Replay({available:false,source:"error",minuteCount:0,observations:[],reason:"回放失败，未读取L2"});
      setError("公开行情源暂不可用，未生成测试结果。请稍后重试。");
      setRunStatus("行情获取失败");
      setReplayProgress({value:0,detail:"行情获取失败，本次没有生成结果"});
    } finally { setRunning(false); setRunMode(null); }
  };
  const runMultiDay = async (kind:MultiDayRunKind="recent") => {
    const isZijinArchiveRun=stock.code==="601899"&&kind!=="recent";
    const requiresHistoricalL2=stock.code==="601899"&&replayEngine==="zijin-v29-shadow";
    const requestedDays=kind==="random-10"?10:kind==="recent"?multiDayCount:0;
    const scopeLabel=kind==="random-10"?"2025 至今随机 10 日":kind==="since-2025"?"2025 至今全量":"最近连续交易日";
    setMultiDayRunKind(kind);
    setLastAction("multi");
    setSingleRunDate("");
    setAccountNotice(requiresHistoricalL2
      ? "V2.9 多日回放逐日读取历史 L2；缺失 L2 的日期会跳过并单独统计，不会降级补值。"
      : "连续回放使用当前账户参数，逐日独立复位；每个交易日只读取当时及此前数据。");
    setRunning(true); setRunMode("multi"); setError(""); setResult(null); setBatch(null); setMultiDay(null); setSource(null);
    setL2Replay({available:false,source:"multi-day",minuteCount:0,observations:[],reason:requiresHistoricalL2?"正在逐日校验历史 L2":"多日汇总按逐分钟因果数据运行"});
    setReplayProgress({value:5,detail:`正在获取 ${stock.code} ${scopeLabel}`});
    setRunStatus(`正在读取 ${stock.code} 多日真实分时…`);
    try {
      let fetched=await fetchStock(stock.code,kind==="recent"?multiDayCount:6);
      if(stock.code==="601899"){
        const archiveQuery=kind==="random-10"
          ? "startDate=20250101&sample=10"
          : kind==="since-2025"
            ? "startDate=20250101&scope=all"
            : `limit=${multiDayCount+20}`;
        const archiveResponse=await fetch(`/api/personal-replay-sessions?code=601899&${archiveQuery}`,{cache:"no-store"});
        if(!archiveResponse.ok)throw new Error("Zijin archive unavailable");
        const archivePayload=await archiveResponse.json() as {sessions?:IntradaySession[];coverage?:{sessions:number;firstDate:string;lastDate:string|null}};
        if(!archivePayload.sessions?.length)throw new Error("Zijin archive is empty");
        fetched={...fetched,intradaySessions:archivePayload.sessions};
      }
      const sessions=[...(fetched.intradaySessions??[])]
        .sort((left,right)=>right.date.localeCompare(left.date))
        .slice(0,kind==="since-2025"?undefined:requestedDays);
      if(!sessions.length)throw new Error("no intraday sessions");
      setAvailableSessionDates(sessions.map(session=>session.date));
      setReplayProgress({value:28,detail:`已取得 ${sessions.length} 个完整交易日，开始逐日回放`});
      const configuredQuantity=Math.min(baseShares,sellable);
      const replayCapital=capital>0?capital:200_000;
      const preparedSessions=[] as {date:string;data:MarketData;l2State?:L2ReplayState}[];
      let l2MinuteCount=0;
      if(requiresHistoricalL2){
        const batchSize=8;
        for(let offset=0;offset<sessions.length;offset+=batchSize){
          const batch=sessions.slice(offset,offset+batchSize);
          const loaded=await Promise.all(batch.map(async session=>{
            try{
              const data=sessionData(fetched,session);
              const l2Response=await fetch(`/api/research/zijin-l2-replay?date=${encodeURIComponent(session.date)}&t=${Date.now()}`,{cache:"no-store"});
              if(!l2Response.ok)return null;
              const l2Payload=await l2Response.json() as {available?:boolean;source?:string;minutes?:Record<string,unknown>[];reason?:string};
              const l2Minutes=l2Payload.minutes??[];
              if(!l2Payload.available||!l2Minutes.length)return null;
              const merged=mergeZijinL2ReplayMinutes(data.minutes??[],l2Minutes,session.date);
              const observations=buildZijinL2CausalReplayObservations(merged) as ReplayObservation[];
              return {
                date:session.date,
                data:{...data,minutes:merged},
                l2State:{available:true,source:l2Payload.source??"archive",minuteCount:l2Minutes.length,observations,reason:observations.length?`L2已进入正式过滤，并复现 ${observations.length} 个独立资金修复阶段`:"L2已进入正式过滤，本日没有通过持续资金确认的修复候选"} as L2ReplayState,
              };
            }catch{return null;}
          }));
          loaded.forEach(item=>{if(item){preparedSessions.push(item);l2MinuteCount+=item.l2State?.minuteCount??0;}});
          const checked=Math.min(offset+batch.length,sessions.length);
          setReplayProgress({value:28+Math.round(checked/sessions.length*28),detail:`历史 L2 已校验 ${checked} / ${sessions.length} 日 · 有效 ${preparedSessions.length} 日`});
          await new Promise(resolve=>setTimeout(resolve,0));
        }
        if(!preparedSessions.length)throw new Error("V2.9_NO_HISTORICAL_L2");
      }else{
        sessions.forEach(session=>preparedSessions.push({date:session.date,data:sessionData(fetched,session)}));
      }
      const results=[] as {date:string;data:MarketData;result:BacktestResult;l2State?:L2ReplayState}[];
      for(const [index,prepared] of preparedSessions.entries()){
        const data=prepared.data;
        const fallbackShares=standardBacktestShares(data,replayCapital);
        const account=configuredQuantity>=300
          ? {capital:replayCapital,baseShares,sellable}
          : {capital:replayCapital,baseShares:fallbackShares,sellable:fallbackShares};
        const calculated=replay(data,account);
        if(index===0){setSource(data);setResult(calculated);if(prepared.l2State)setL2Replay(prepared.l2State);}
        results.push({...prepared,result:calculated});
        if((isZijinArchiveRun||requiresHistoricalL2)&&((index+1)%10===0||index===preparedSessions.length-1)){
          const progressStart=requiresHistoricalL2?56:28;
          const progressRange=requiresHistoricalL2?20:48;
          setReplayProgress({value:progressStart+Math.round((index+1)/preparedSessions.length*progressRange),detail:`已回放 ${index+1} / ${preparedSessions.length} ${requiresHistoricalL2?"个 L2 有效交易日":"个交易日"}`});
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }
      setReplayProgress({value:78,detail:"逐日回放完成，正在汇总扣费后结果"});
      const cycleNets=results.flatMap(item=>item.result.cycleNets);
      const dayNets=results.map(item=>item.result.net);
      const positive=cycleNets.filter(value=>value>0).reduce((sum,value)=>sum+value,0);
      const negative=Math.abs(cycleNets.filter(value=>value<0).reduce((sum,value)=>sum+value,0));
      const net=dayNets.reduce((sum,value)=>sum+value,0);
      const recentResults=results.slice(0,20);
      const recentCycleNets=recentResults.flatMap(item=>item.result.cycleNets);
      const recentPositive=recentCycleNets.filter(value=>value>0).reduce((sum,value)=>sum+value,0);
      const recentNegative=Math.abs(recentCycleNets.filter(value=>value<0).reduce((sum,value)=>sum+value,0));
      const recentNet=recentResults.reduce((sum,item)=>sum+item.result.net,0);
      const recentProfitFactor=recentNegative?recentPositive/recentNegative:recentPositive>0?Number.POSITIVE_INFINITY:null;
      const l2AvailableDays=requiresHistoricalL2?preparedSessions.length:0;
      const l2MissingDays=requiresHistoricalL2?Math.max(0,sessions.length-preparedSessions.length):0;
      const winRate=cycleNets.length?cycleNets.filter(value=>value>0).length/cycleNets.length:0;
      const profitFactor=negative?positive/negative:positive>0?Number.POSITIVE_INFINITY:null;
      const healthStatus=recentCycleNets.length<20?"样本积累中":recentNet>0&&(recentProfitFactor??0)>=1?"近期稳定":"近期转弱";
      const approvalStatus=results.length>=60&&cycleNets.length>=100&&winRate>=0.52&&(profitFactor??0)>=1.2&&net>0?"待5bp压力测试":"继续影子";
      const report:MultiDayBacktestResult={
        code:stock.code,name:stock.name,modeLabel:BACKTEST_REPLAY_ENGINE_META[replayEngine].label,scopeLabel,requestedDays:requestedDays||sessions.length,testedDays:results.length,
        firstDate:results.at(-1)?.date??"",lastDate:results[0]?.date??"",noTrade:results.filter(item=>item.result.trades===0).length,
        averageNet:net/Math.max(1,results.length),samples:results.length,completed:cycleNets.length,wins:cycleNets.filter(value=>value>0).length,
        gross:results.reduce((sum,item)=>sum+item.result.gross,0),fees:results.reduce((sum,item)=>sum+item.result.fees,0),
        executionCost:results.reduce((sum,item)=>sum+item.result.executionCost,0),net,
        tradingRounds:results.filter(item=>item.result.trades>0).length,profitableRounds:dayNets.filter(value=>value>0).length,
        losingRounds:dayNets.filter(value=>value<0).length,profitFactor,
        maxDrawdown:Math.max(0,...results.map(item=>item.result.maxDrawdown)),
        l2Required:requiresHistoricalL2,l2AvailableDays,l2MissingDays,l2MinuteCount,
        recentDays:recentResults.length,recentCompleted:recentCycleNets.length,recentWins:recentCycleNets.filter(value=>value>0).length,recentNet,recentProfitFactor,healthStatus,approvalStatus,
        outcomes:results.map(item=>({date:item.date,trades:item.result.trades,wins:item.result.wins,net:item.result.net,candidates:item.result.diagnostics?.candidates??0})),
      };
      setMultiDay(report);
      setRunStatus(`${scopeLabel}完成：${report.completed} 个闭环，扣费后胜率 ${report.completed?(report.wins/report.completed*100).toFixed(1):"0.0"}%`);
      setReplayProgress({value:100,detail:`多日报告完成 · ${report.completed} 个闭环 · ${report.tradingRounds}/${report.testedDays} 日有交易`});
      setTimeout(()=>document.getElementById("single-backtest-result")?.scrollIntoView({behavior:"smooth",block:"start"}),0);
    } catch (caught) {
      setResult(null);setBatch(null);setMultiDay(null);setSource(null);
      const missingHistoricalL2=caught instanceof Error&&caught.message==="V2.9_NO_HISTORICAL_L2";
      setError(missingHistoricalL2?"所选日期没有可用的历史 L2 快照，V2.9 未降级生成结果。":"未取得足够的多日完整 1 分钟分时，本次没有生成结果。");
      setRunStatus("多日回放未完成");
      setReplayProgress({value:0,detail:missingHistoricalL2?"历史 L2 覆盖不足":"多日行情获取失败"});
    } finally { setRunning(false);setRunMode(null); }
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
    setRunning(true); setRunMode("batch"); setError(""); setMultiDay(null); setRunStatus("正在读取全 A 股股票池…");
    setReplayProgress({value:4,detail:"正在读取全 A 股股票池"});
    try {
      let universeResponse:StockUniverseResponse={provider:"representative-fallback",total:representativeBacktestItems.length,fallback:true,stocks:representativeBacktestItems};
      try {
        const response=await fetch("/api/stock-universe?pool=full-a-v1",{cache:"force-cache"});
        if(!response.ok)throw new Error("stock universe unavailable");
        const payload=await response.json() as StockUniverseResponse;
        const valid=(payload.stocks??[]).filter(item=>/^\d{6}$/.test(item.code)&&item.name);
        if(valid.length<30)throw new Error("stock universe incomplete");
        universeResponse={...payload,total:valid.length,stocks:valid};
      } catch {
        universeResponse={provider:"representative-fallback",total:representativeBacktestItems.length,fallback:true,stocks:representativeBacktestItems};
      }
      setReplayProgress({value:12,detail:`股票池已就绪 · ${universeResponse.total.toLocaleString("zh-CN")} 只`});
      let recentCodes=recentBatchCodes.current;
      if(!recentCodes.length && typeof window!=="undefined"){
        try {
          const stored=JSON.parse(window.sessionStorage.getItem("smart-t-recent-random-batch-codes")??"[]") as unknown;
          if(Array.isArray(stored))recentCodes=stored.filter(value=>typeof value==="string"&&/^\d{6}$/.test(value)).slice(0,60);
        } catch { recentCodes=[]; }
      }
      const previousBatchCodes=recentCodes.slice(0,10);
      const queue=diversifyStockUniverse(universeResponse.stocks,`${seed}:market`,recentCodes);
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
        setReplayProgress({value:12+Math.round(Math.min(10,available.length)/10*48),detail:`正在取得真实完整分时 · ${available.length}/10`});
        setRunStatus(`真实分时已取得 ${available.length}/10 · 已尝试 ${attempted} 只${available.length<10?"，正在自动补抽":"，开始逐股因果回放"}`);
      }
      if(!available.length) throw new Error("no random batch minute data");
      setReplayProgress({value:64,detail:`真实分时已就绪 · 开始回放 ${available.length} 只股票`});
      const comparisonEngine:BacktestReplayEngine=replayEngine==="closure-first"?"zuot-v1-reconstructed-shadow":"closure-first";
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
        return [{selected:{...selected,data},result:replayWithEngine(data,account,replayEngine),legacy:replayWithEngine(data,account,comparisonEngine)}];
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
      setReplayProgress({value:86,detail:"逐股回放完成 · 正在核算费用与稳定性"});
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
        const gross=stockResults.reduce((sum,item)=>sum+item.gross,0);
        const totalCost=stockResults.reduce((sum,item)=>sum+item.fees+item.executionCost,0);
        const primaryTrial=stockTrials[0];
        const referenceObservations=primaryTrial
          ? buildCausalReferencePoints(primaryTrial.selected.data.minutes ?? [],primaryTrial.result.observations ?? []) as ReplayObservation[]
          : [];
        const keyObservations=referenceObservations.length;
        const feedback=completed
          ? net>0
            ? `形成 ${completed} 个闭环，扣费后盈利`
            : net<0
              ? `形成 ${completed} 个闭环但扣费后亏损：${gross<=0?"价格未走出预期价差":"毛收益被费用与滑点吞噬"}（毛收益 ${money(gross)}，成本+滑点 ${money(-totalCost)}）`
              : `形成 ${completed} 个闭环，扣费后持平`
          : rawCandidates===0
            ? "已有买卖观察参考，但未形成条件候补"
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
      const completedBatchCodes=available.map(item=>item.item.code);
      const previousSet=new Set(previousBatchCodes);
      const overlapWithPrevious=completedBatchCodes.filter(code=>previousSet.has(code)).length;
      const updatedRecentCodes=[...completedBatchCodes,...recentCodes.filter(code=>!completedBatchCodes.includes(code))].slice(0,60);
      recentBatchCodes.current=updatedRecentCodes;
      if(typeof window!=="undefined")window.sessionStorage.setItem("smart-t-recent-random-batch-codes",JSON.stringify(updatedRecentCodes));
      setBatch({...metrics,seed,rounds:trials.length,stocks:available.length,attemptedStocks:attempted,replacementStocks,overlapWithPrevious,uniqueSessions,noTrade:results.filter(item=>item.trades===0).length,referenceStocks,candidateStocks,candidateDecisions,keyObservations,averageNet:metrics.net/Math.max(1,trials.length),medianNet,providers:[...new Set(available.map(item=>item.data.provider))],universeSize:universeResponse.total,universeProvider:universeResponse.provider,fallbackUniverse:universeResponse.fallback,industries,engineLabel:BACKTEST_REPLAY_ENGINE_META[replayEngine].label,comparisonLabel:BACKTEST_REPLAY_ENGINE_META[comparisonEngine].label,legacy,stockFeedback});
      setRunStatus(`随机${available.length}股测试完成：观察参考 ${referenceStocks}/${available.length} 股，条件候补 ${candidateStocks}/${available.length} 股，正式触发 ${metrics.tradingRounds}/${available.length} 股`);
      setReplayProgress({value:100,detail:`批次报告完成 · ${metrics.tradingRounds}/${available.length} 只形成正式交易`});
    } catch {
      setResult(null); setBatch(null); setSource(null);
      setError("公开行情池当前没有取得任何可用的完整 1 分钟分时；本次没有伪造或补齐数据，请稍后重试。");
      setRunStatus("随机10股测试未完成");
      setReplayProgress({value:0,detail:"未取得可用完整分时，本次测试已停止"});
    } finally { setRunning(false); setRunMode(null); }
  };
  const fullDayMinutes=source?.minutes ?? [];
  const fullDayPrices=fullDayMinutes.map(point=>point.price);
  const fullDayRangePrices=fullDayMinutes.flatMap(point=>[
    point.price,
    Number.isFinite(point.high)&&Number(point.high)>0?Number(point.high):point.price,
    Number.isFinite(point.low)&&Number(point.low)>0?Number(point.low):point.price,
  ]);
  const coverageReferencePrices=(result?.observations??[]).flatMap(observation=>
    observation.coverageOnly&&Number.isFinite(observation.pivotPrice)&&Number(observation.pivotPrice)>0
      ? [Number(observation.pivotPrice)]
      : [],
  );
  const chartRangePrices=[...fullDayRangePrices,...coverageReferencePrices];
  const observedMin=chartRangePrices.length?Math.min(...chartRangePrices):0;
  const observedMax=chartRangePrices.length?Math.max(...chartRangePrices):1;
  const pricePadding=Math.max(.01,(observedMax-observedMin)*.12);
  const chartMin=Math.max(.01,observedMin-pricePadding),chartMax=observedMax+pricePadding;
  const chartTicks=Array.from({length:5},(_,index)=>chartMax-(chartMax-chartMin)*index/4);
  const chartPoint = (value:number,index:number) => ({ x:65+(index/Math.max(1,fullDayMinutes.length-1))*755, y:18+((chartMax-value)/Math.max(.01,chartMax-chartMin))*184 });
  const points = fullDayPrices.length > 1 ? fullDayPrices.map((value,index)=>{ const point=chartPoint(value,index); return `${point.x},${point.y}`; }).join(" ") : "";
  const previousClose=source?.quote.previousClose ?? null;
  const previousCloseY=previousClose && previousClose>=chartMin && previousClose<=chartMax ? chartPoint(previousClose,0).y : null;
  const formatTime=(value:string|undefined)=>value && value.length>=4 ? `${value.slice(0,2)}:${value.slice(2,4)}` : "--:--";
  const formatDate=(value:string|undefined)=>value && value.length===8 ? `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}` : value ?? "—";
  const visibleL2ReplayMarkers=compactRepairChartMarkers(l2Replay.observations,40) as ReplayObservation[];
  const visibleBacktestObservations=result
    ? [
        ...compactChartObservations(buildReplayChartObservations(source?.quote.code,fullDayMinutes,result.observations ?? [],l2Replay.observations),30) as ReplayObservation[],
      ]
    : [];
  const trainingObservations=visibleBacktestObservations.filter(observation=>!observation.coverageOnly);
  const trainingCurrent=trainingObservations[trainingIndex] ?? null;
  const trainingCorrect=trainingChoices.filter(item=>item.choice===item.expected).length;
  const trainingLabel=(value:"buy"|"sell"|"wait")=>value==="buy"?"正T":value==="sell"?"反T":"观望";
  const submitTrainingChoice=(choice:"buy"|"sell"|"wait")=>{
    if(!trainingCurrent)return;
    const expected=trainingCurrent.direction==="正T"?"buy":"sell";
    setTrainingChoices(current=>[...current,{choice,expected,time:trainingCurrent.time}]);
    setTrainingIndex(current=>Math.min(trainingObservations.length,current+1));
  };
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
  const replayFunnel=useMemo(()=>{
    const diagnostics=result?.diagnostics??{};
    const candidates=Math.max(0,diagnostics.candidates??0);
    const trend=Math.max(0,diagnostics.regimeBlocked??0);
    const cost=Math.max(0,diagnostics.costBlocked??0);
    const final=Math.max(0,result?.trades??0);
    const max=Math.max(1,candidates,trend,cost,final);
    return [
      {label:"候选触发",value:candidates,tone:"candidate",width:100},
      {label:"趋势过滤",value:trend,tone:"trend",width:Math.max(28,trend/max*100)},
      {label:"成本过滤",value:cost,tone:"cost",width:Math.max(20,cost/max*100)},
      {label:"最终闭环",value:final,tone:"final",width:Math.max(14,final/max*100)},
    ];
  },[result]);
  return <section className="backtest-view">
    <div className="backtest-head">
      <div><span className="eyebrow">FULL-DAY CAUSAL REPLAY</span><h1>完整交易日分时盲测</h1><p>从开盘到收盘逐分钟推进，策略在每一分钟只能读取当时及此前数据；回放完成后显示整日分时并标注真实决策点。</p></div>
      <div className="integrity-badges"><span><i/>真实分时数据</span><span><i/>无未来函数</span><span><i/>真实可卖数量</span></div>
    </div>
    <div className="backtest-grid">
      <aside className={`backtest-config ${backtestConfigCollapsed?"collapsed":""}`}>
        <div className="config-title"><h2>回测参数</h2><span>{running ? "计算中" : runStatus}</span><button type="button" className="config-collapse-toggle" onClick={()=>setBacktestConfigCollapsed(current=>!current)} aria-expanded={!backtestConfigCollapsed}>{backtestConfigCollapsed?"展开":"收起"}</button></div>
        <div className="config-compact-summary" aria-hidden={!backtestConfigCollapsed}><b>{profile}</b><span>{capital.toLocaleString("zh-CN")} 现金</span><span>万{feeRate.toFixed(3)} 费率</span></div>
        <label>回测股票<select className="backtest-stock-select" value={activeStock} onChange={event=>selectBacktestStock(Number(event.target.value))} aria-label="选择回测股票">{stocks.map((item,index)=><option key={item.code} value={index}>{item.code} {item.name}</option>)}</select></label>
        <label>买卖逻辑<div className="field static-field"><b>{BACKTEST_REPLAY_ENGINE_META[replayEngine].label}</b><span>{BACKTEST_REPLAY_ENGINE_META[replayEngine].logic}</span></div></label>
        <div className="field-pair"><label>样本来源<div className="field static-field date-display"><b>{source ? "公开真实分时" : "运行后显示"}</b><span>{batch ? `${batch.uniqueSessions} 个不重复股票日` : source?.sampleDate ?? "完整交易日"}</span></div></label><label>决策方式<div className="field static-field date-display"><b>全日逐分钟因果判断</b><span>不读未来高低点/收盘价</span></div></label></div>
        <label>回放交易日
          <select value={requestedSessionDate} onChange={event=>setRequestedSessionDate(event.target.value)} disabled={!availableSessionDates.length}>
            <option value="">最新完整交易日{availableSessionDates[0]?`（${formatDate(availableSessionDates[0])}）`:"（首次运行后列出）"}</option>
            {availableSessionDates.slice(1).map(date=><option key={date} value={date}>{formatDate(date)}</option>)}
          </select>
          <small className="config-inline-help">首次运行会读取可用的完整交易日；随后可选择历史日期重新逐分钟回放。</small>
        </label>
        <label>闭环灵敏度<div className="profile-picker">{strategyProfiles.map(item=><button type="button" className={profile===item?'active':''} onClick={()=>setProfile(item as StrategyProfile)} key={item}>{item.replace('档','')}</button>)}</div><small className="config-inline-help">与操盘台共用当前档位；仅调整闭环确认门槛与信号频率。</small></label>
        <label>回放引擎<div className="profile-picker experiment-picker"><button type="button" className={replayEngine==="closure-first"?'active':''} onClick={()=>setReplayEngine("closure-first")}>内置闭环</button><button type="button" className={replayEngine==="zuot-v1-reconstructed-shadow"?'active experimental':''} onClick={()=>setReplayEngine("zuot-v1-reconstructed-shadow")}>V1 重建影子</button>{stock.code==="601899"&&<button type="button" className={replayEngine==="zijin-v29-shadow"?'active experimental':''} onClick={()=>setReplayEngine("zijin-v29-shadow")}>V2.9 紫金影子</button>}</div><small className="config-inline-help experiment-warning active">{BACKTEST_REPLAY_ENGINE_META[replayEngine].logic}；{BACKTEST_REPLAY_ENGINE_META[replayEngine].note}。</small></label>
        <label>扣费后离场目标<div className="profile-picker profit-picker">{([0.5,1,2,2.5] as ReplayExitTarget[]).map(value=><button type="button" key={value} className={exitTarget===value?'active':''} onClick={()=>setExitTarget(value)}>{value}%</button>)}</div><small className="config-inline-help">单次闭环扣除佣金、印花税与双向滑点后达到目标即离场；仅影响模拟回测。</small></label>
        {stock.code==="601899"&&<label>紫金利润模式<div className="profile-picker profit-picker"><button type="button" className={profitMode==="standard"?'active':''} onClick={()=>setProfitMode("standard")}>标准价差</button><button type="button" className={profitMode==="zijin-small-spread"?'active':''} onClick={()=>setProfitMode("zijin-small-spread")}>小价差</button></div><small className="config-inline-help">小价差档要求每股至少 ¥0.10、扣费净利至少 ¥30；趋势、VWAP、量价和硬风控不放宽。</small></label>}
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
        <div className="multi-day-controls"><label>连续交易日<select value={multiDayCount} onChange={event=>setMultiDayCount(Number(event.target.value))} disabled={running}>{[10,20,60,100].map(value=><option value={value} key={value}>最近 {value} 日</option>)}</select></label><button type="button" onClick={()=>void runMultiDay("recent")} disabled={running}>{runMode==='multi'&&multiDayRunKind==='recent'?`正在连续回放 ${multiDayCount} 日…`:`连续回放最近 ${multiDayCount} 日`}</button></div>
        {stock.code==="601899"&&<div className="replay-secondary-actions"><button type="button" onClick={()=>void runMultiDay("random-10")} disabled={running}>{runMode==='multi'&&multiDayRunKind==='random-10'?"正在随机回放 10 日…":"紫金随机 10 个交易日"}</button><button type="button" onClick={()=>void runMultiDay("since-2025")} disabled={running}>{runMode==='multi'&&multiDayRunKind==='since-2025'?"正在回放 2025 至今…":"紫金 2025 至今全量回放"}</button></div>}
        <div className="replay-secondary-actions"><button type="button" onClick={()=>void runBatch()} disabled={running||replayEngine==="zijin-v29-shadow"}>{runMode==='batch'?`全A股抽取/回放 ${batchFetchProgress.ready}/10（已尝试 ${batchFetchProgress.attempted}）`:`全A股随机10股 · ${BACKTEST_REPLAY_ENGINE_META[replayEngine].label}审计`}</button></div>
        {replayEngine==="zijin-v29-shadow"&&<p className="config-inline-help">V2.9 多日回放会逐日读取历史 L2；缺失日期跳过并计入覆盖审核，不会降级补值。</p>}
        <RabbitProgressMeter
          label={runMode==='batch'?'全 A 股随机批次测试':runMode==='multi'?(multiDayRunKind==='random-10'?"紫金随机 10 日回测":multiDayRunKind==='since-2025'?"紫金 2025 至今全量回测":`单股连续 ${multiDayCount} 日回测`):'单股完整交易日回测'}
          detail={replayProgress.detail}
          progress={replayProgress.value}
          status={running?'running':error?'error':replayProgress.value===100?'completed':'paused'}
          stages={runMode==='batch'?['读取股票池','获取真实分时','逐股因果回放','成本核算','生成报告']:runMode==='multi'?['获取多日行情','构建历史基线','逐日因果回放','费用核算','生成报告']:['获取行情','校验交易日','逐分钟回放','费用核算','生成报告']}
          compact
        />
        <div className={`single-run-status ${running?'running':error?'error':result||batch||multiDay?'done':'idle'}`} role="status" aria-live="polite"><i/><span><b>{running?(runMode==='batch'?'正在测试全A股随机10股批次…':runMode==='multi'?(multiDayRunKind==='random-10'?"正在随机回放紫金 10 个交易日…":multiDayRunKind==='since-2025'?"正在回放紫金 2025 至今全部可用交易日…":`正在连续回放 ${stock.code} 最近 ${multiDayCount} 日…`):`正在全日回放 ${stock.code}…`):error?'运行失败':lastAction==='batch'&&batch?`${batch.fallbackUniverse?'代表池回退':'全A股'}随机10股完成 · 正式触发 ${batch.tradingRounds}/${batch.stocks} 股`:lastAction==='multi'&&multiDay?`${multiDay.scopeLabel}完成 · ${multiDay.completed} 个闭环`:lastAction==='single'&&result?(result.trades?`全日回放完成：触发 ${result.trades} 个做T闭环`:`全日回放完成：${result.diagnostics?.candidates ?? 0} 次候选判定，0 个正式闭环`):'等待选择测试'}</b><small>{runStatus}{singleRunDate?` · ${formatDate(singleRunDate)} 完整交易日`:''}</small></span></div>
        <p className="seed-note">紫金随机测试固定股票为 601899，每次从 2025 年以来的可用历史中无放回抽取 10 个交易日；可反复运行观察稳定性。全量回放用于最终统计，实际日期范围以报告为准。全 A 股随机 10 股仍是另一项独立审计。</p>
        <p className="config-note">连续失败 2 次当日停止；14:30 后不新开 T；{forceCloseTime.slice(0,2)}:{forceCloseTime.slice(2)} 前强制恢复计划底仓，避免尾盘流动性恶化。</p>
        <p className="config-note">状态：{runStatus}</p>
        {error&&<p className="config-note">{error}</p>}
      </aside>
      <div className={`backtest-results ${trainingMode?"training-active":""}`} id="single-backtest-result">
        {result&&<section className="backtest-training" aria-label="逐分钟训练模式">
          <div className="backtest-training-head">
            <div><span className="eyebrow">CAUSAL DECISION PRACTICE</span><h2>逐分钟训练模式</h2><p>隐藏完整曲线，只在每个候选时刻让你先做判断，再揭示闭环引擎的方向。</p></div>
            <button type="button" className={trainingMode?"active":""} onClick={()=>{setTrainingMode(current=>!current);setTrainingIndex(0);setTrainingChoices([])}}>{trainingMode?"退出训练":"开始训练"}</button>
          </div>
          {trainingMode&&<div className="backtest-training-body">
            <div className="training-progress"><span>训练进度</span><b>{Math.min(trainingIndex,trainingObservations.length)} / {trainingObservations.length}</b><i><em style={{width:`${trainingObservations.length?Math.min(100,trainingIndex/trainingObservations.length*100):0}%`}}/></i><small>当前结果仅展示因果候选点，不提前显示未来价格和触发原因。</small></div>
            {trainingCurrent?<>
              <div className="training-prompt"><span>{formatTime(trainingCurrent.time)} · 当前价格 ¥{trainingCurrent.price?.toFixed(2) ?? "--"}</span><b>你会怎么做？</b><small>先选择动作，再查看引擎方向。</small></div>
              <div className="training-choice-grid"><button type="button" onClick={()=>submitTrainingChoice("buy")}>正T<small>低位买入</small></button><button type="button" onClick={()=>submitTrainingChoice("sell")}>反T<small>高位卖出</small></button><button type="button" onClick={()=>submitTrainingChoice("wait")}>观望<small>等待确认</small></button></div>
            </>:<div className="training-complete"><b>本次训练完成</b><span>答对 {trainingCorrect} / {trainingChoices.length} 个候选点</span><button type="button" onClick={()=>{setTrainingIndex(0);setTrainingChoices([])}}>重新开始</button></div>}
            {trainingChoices.at(-1)&&<div className={`training-feedback ${trainingChoices.at(-1)?.choice===trainingChoices.at(-1)?.expected?"correct":"wrong"}`}><b>{trainingChoices.at(-1)?.choice===trainingChoices.at(-1)?.expected?"判断正确":"判断偏离"}</b><span>{formatTime(trainingChoices.at(-1)?.time)} · 引擎方向：{trainingLabel(trainingChoices.at(-1)?.expected ?? "wait")} · 你的选择：{trainingLabel(trainingChoices.at(-1)?.choice ?? "wait")}</span></div>}
          </div>}
        </section>}
        {batch&&<BatchReport batch={batch} representativeCode={source?.quote.code}/>}
        {multiDay&&<section className="multi-day-report"><div><span>{multiDay.scopeLabel}</span><strong>{multiDay.testedDays}<small> / {multiDay.requestedDays} 日</small></strong><em>{formatDate(multiDay.firstDate)} — {formatDate(multiDay.lastDate)}</em></div><div><span>正式闭环 / 扣费后胜率</span><strong>{multiDay.completed}<small> / {multiDay.completed?(multiDay.wins/multiDay.completed*100).toFixed(1):"0.0"}%</small></strong><em>{multiDay.modeLabel}</em></div><div><span>有交易日 / 空白日</span><strong>{multiDay.tradingRounds}<small> / {multiDay.noTrade}</small></strong><em>逐日独立复位</em></div><div><span>扣费后合计</span><strong className={pnlClass(multiDay.net)}>{money(multiDay.net)}</strong><em>日均 {money(multiDay.averageNet)}</em></div></section>}
        {multiDay?.l2Required&&<details className="candidate-audit">
          <summary><span><b>V2.9 影子审核摘要</b><small>复用现有市场状态、风险约束和近期失效监控</small></span><em>{multiDay.approvalStatus}</em></summary>
          <div className="candidate-audit-metrics">
            <span><small>历史 L2 覆盖 · {multiDay.l2MinuteCount.toLocaleString()} 分钟点</small><b>{multiDay.l2AvailableDays} / {multiDay.requestedDays} 日</b></span>
            <span><small>L2 缺失跳过</small><b>{multiDay.l2MissingDays} 日</b></span>
            <span><small>近期 {multiDay.recentDays} 日</small><b>{multiDay.healthStatus}</b></span>
            <span><small>近期闭环 / 胜率</small><b>{multiDay.recentCompleted} / {multiDay.recentCompleted?(multiDay.recentWins/multiDay.recentCompleted*100).toFixed(1):"0.0"}%</b></span>
            <span><small>近期盈利因子</small><b>{multiDay.recentProfitFactor===null?"—":Number.isFinite(multiDay.recentProfitFactor)?multiDay.recentProfitFactor.toFixed(2):"∞"}</b></span>
            <span><small>近期扣费净收益</small><b className={pnlClass(multiDay.recentNet)}>{money(multiDay.recentNet)}</b></span>
          </div>
          <p className="candidate-audit-foot">市场状态继续使用开盘方向锚、大盘/板块、VWAP 与 L2/OFI 联合确认；风险预算继续执行费用、滑点、仓位、连续失败和尾盘复位约束。摘要只用于人工审核，不会自动升级正式策略。</p>
        </details>}
        <div className="result-summary">
          <div className="result-primary"><span>{batch?"批次样本净收益":"净收益"}</span><strong className={result?pnlClass(result.net):""}>{result ? money(result.net) : "—"}</strong><em className={result?pnlClass(result.net):""}>{result ? `${(result.net/capital*100).toFixed(3)}%` : "运行后显示"}</em></div>
          <div><span>理论毛收益</span><b className={result?pnlClass(result.gross):""}>{result ? money(result.gross) : "—"}</b><small>未扣费用与滑点</small></div><div><span>费用与滑点</span><b className={result?"pnl-loss":""}>{result ? money(-(result.fees+result.executionCost)) : "—"}</b><small>佣金、印花税及双向滑点</small></div><div><span>最大回撤</span><b className={result&&result.maxDrawdown>0?"pnl-loss":""}>{result ? `-${(result.maxDrawdown*100).toFixed(3)}%` : "—"}</b><small>{source ? "费用进入逐点资金曲线" : "运行后显示"}</small></div>
        </div>
        <div className="equity-panel">
          <div className="panel-heading">
            <div><h2>{source?`完整交易日真实分时 · ${source.quote.code} ${source.quote.name}`:"完整交易日真实分时"}</h2><span>{result ? `${formatDate(source?.sampleDate)} · ${formatTime(fullDayMinutes[0]?.time)} 至 ${formatTime(fullDayMinutes.at(-1)?.time)} · 策略从 ${formatTime(result.startTime)} 起逐分钟判断` : "运行后显示"}</span></div>
            <div className="curve-legend"><span><i/>真实分时价格</span><span className="base-legend"><i/>昨收</span><span className="sell-marker">● 卖出</span><span className="buy-marker">● 买入 / 买回</span>{visibleBacktestObservations.length>0&&<span className="candidate-marker">○ 候补观察</span>}{l2Replay.observations.length>0&&<span className="l2-marker">◎ 资金承接修复</span>}</div>
          </div>
          {result&&source?.quote.code==="601899"&&<div className={`l2-replay-audit ${l2Replay.available?"available":"unavailable"}`}><span><i/>L2严格因果回放</span><b>{l2Replay.reason}</b><em>{l2Replay.available?`${l2Replay.minuteCount} 个L2分钟点 · 图上合并为 ${visibleL2ReplayMarkers.length} 个关键波段 · ${l2Replay.source==="archive"?"交易日归档":"当日实时快照"}`:"未使用L2补值"}</em></div>}
          <svg viewBox="0 0 840 230" preserveAspectRatio="none" aria-label="完整交易日真实分时及做T买卖点">
            <defs><linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#28d7c4" stopOpacity=".16"/><stop offset="1" stopColor="#28d7c4" stopOpacity="0"/></linearGradient></defs>
            {result&&source&&chartTicks.map((value,index)=>{const y=18+index*46;return <g key={value}><line x1="65" x2="820" y1={y} y2={y} className="equity-grid"/><text x="57" y={y+3} textAnchor="end" className="equity-axis-label">¥{value.toFixed(2)}</text></g>})}
            {(!result||!source)&&<text x="420" y="114" textAnchor="middle" className="equity-axis-label">运行一次全日回放后显示真实分时与买卖点</text>}
            {previousCloseY!==null&&<line x1="65" x2="820" y1={previousCloseY} y2={previousCloseY} className="equity-base-line"/>}
            {points&&<>
              <polyline points={`${points} 820,202 65,202`} fill="url(#equityFill)"/>
              <polyline points={points} className="equity-line" fill="none"/>
              {visibleBacktestObservations.map((observation,index)=>{
                const minuteIndex=fullDayMinutes.findIndex(point=>point.time===observation.time);
                if(minuteIndex<0)return null;
                const price=observation.coverageOnly&&Number.isFinite(observation.pivotPrice)
                  ? observation.pivotPrice
                  : observation.price ?? fullDayMinutes[minuteIndex].price;
                const point=chartPoint(price,minuteIndex);
                const isSell=observation.direction==="反T";
                const label=observationConfirmationLabel(observation);
                const labelWidth=Math.max(52,label.length*10+18);
                const placeAbove=isSell||point.y>166;
                const labelY=placeAbove?Math.max(17,point.y-19-(index%2)*8):Math.min(191,point.y+25+(index%2)*8);
                const labelX=Math.max(65+labelWidth/2,Math.min(820-labelWidth/2,point.x+((index%3)-1)*4));
                const labelTop=labelY-13;
                return <g className={`backtest-candidate-marker ${isSell?"is-high":"is-low"} ${observation.l2Strict?"is-l2-strict":""}`} key={`${observation.direction}-${observation.time}-${index}`}>
                  <title>{`${label}；${observationDirectionNote(observation)}；${observation.reason}${observation.blockers.length?`；未通过：${observation.blockers.join("；")}`:""}`}</title>
                  <line className="candidate-leader" x1={point.x} y1={point.y} x2={labelX} y2={placeAbove?labelTop+22:labelTop}/>
                  <rect className="candidate-label-bg" x={labelX-labelWidth/2} y={labelTop} width={labelWidth} height="22" rx="11"/>
                  <circle className="candidate-anchor" cx={point.x} cy={point.y} r="5.5"/>
                  <circle className="candidate-anchor-core" cx={point.x} cy={point.y} r="2"/>
                  <text x={labelX} y={labelY+1.75} textAnchor="middle">{label}</text>
                </g>;
              })}
              {result?.actions.map((action,index)=>{
                const minuteIndex=fullDayMinutes.findIndex(point=>point.time===action.time);
                if(minuteIndex<0)return null;
                const point=chartPoint(action.price,minuteIndex);
                const isSell=action.side==="卖出";
                const label=formalExecutionLabel(action.direction,isSell?"sell":"buy");
                const labelWidth=Math.max(54,label.length*10+18);
                const placeAbove=isSell||point.y>166;
                const labelY=placeAbove?Math.max(17,point.y-21-(index%2)*8):Math.min(191,point.y+27+(index%2)*8);
                const labelX=Math.max(65+labelWidth/2,Math.min(820-labelWidth/2,point.x+((index%3)-1)*4));
                const labelTop=labelY-13;
                return <g className={`backtest-action-marker ${isSell?"is-sell":"is-buy"}`} key={`${action.side}-${action.time}-${index}`}>
                  <title>{action.reason ?? label}</title>
                  <line className="action-leader" x1={point.x} y1={point.y} x2={labelX} y2={placeAbove?labelTop+22:labelTop}/>
                  <rect className="action-label-bg" x={labelX-labelWidth/2} y={labelTop} width={labelWidth} height="22" rx="11"/>
                  <circle className="action-anchor" cx={point.x} cy={point.y} r="5.5"/>
                  <circle className="action-anchor-core" cx={point.x} cy={point.y} r="2"/>
                  <text x={labelX} y={labelY+1.75} textAnchor="middle">{label}</text>
                </g>;
              })}
              <text x="65" y="222" className="equity-time-label">{formatTime(fullDayMinutes[0]?.time)}</text>
              <text x="442" y="222" textAnchor="middle" className="equity-time-label">{formatTime(fullDayMinutes[Math.floor(fullDayMinutes.length/2)]?.time)}</text>
              <text x="820" y="222" textAnchor="end" className="equity-time-label">{formatTime(fullDayMinutes.at(-1)?.time)}</text>
            </>}
          </svg>
          {result&&source?<div className="chart-truth-note"><span>曲线展示整日真实 1 分钟价格；悬停标记可查看触发或拦截原因，决策不读取未来数据</span><b>开 {fullDayPrices[0]?.toFixed(2) ?? "—"} · 高 {observedMax.toFixed(2)} · 低 {observedMin.toFixed(2)} · 收 {fullDayPrices.at(-1)?.toFixed(2) ?? "—"}</b></div>:<div className="chart-truth-note"><span>尚未运行回放，不展示空白价格坐标或伪造行情摘要。</span></div>}
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
          <div className="candidate-funnel" aria-label="信号过滤漏斗">
            <div className="candidate-funnel-head"><b>信号过滤漏斗</b><small>从候选到正式闭环的损耗路径</small></div>
            <div className="candidate-funnel-track">{replayFunnel.map(item=><div className={`candidate-funnel-step ${item.tone}`} key={item.label} style={{width:`${item.width}%`}}><span>{item.label}</span><b>{item.value}</b></div>)}</div>
          </div>
          <div className="candidate-cycle-summary">
            <div className="candidate-cycle-heading"><span><b>候补观察闭环</b><small>只复盘方向是否接续，不计入正式胜率与收益</small></span><em>{result.candidateCycles?.length ?? 0} 个已闭环{result.openCandidate?" · 1 个未闭环":""}</em></div>
            {result.candidateCycles?.length?<div className="candidate-cycle-list">{result.candidateCycles.map(cycle=><article className={cycle.favorable?"favorable":"unfavorable"} key={`${cycle.id}-${cycle.entryTime}-${cycle.exitTime}`}>
              <span><b>{cycle.direction} 候补 #{cycle.id}</b><small>{formatTime(cycle.entryTime)} {cycle.entryLabel} ¥{cycle.entryPrice.toFixed(2)} → {formatTime(cycle.exitTime)} {cycle.exitLabel} ¥{cycle.exitPrice.toFixed(2)}</small><small>持有 {cycle.holdingMinutes} 分钟 · MFE {cycle.mfePct>=0?"+":""}{cycle.mfePct.toFixed(2)}%（{formatTime(cycle.bestTime)}） · MAE {cycle.maePct.toFixed(2)}%（{formatTime(cycle.worstTime)}）</small></span>
              <em>{cycle.status} · 闭环 {cycle.grossPct>=0?"+":""}{cycle.grossPct.toFixed(2)}%</em>
            </article>)}</div>:<p className="candidate-cycle-empty">尚未出现方向相反、可配对的后续候补点。</p>}
            {result.openCandidate&&<div className="candidate-cycle-open"><span><b>{result.openCandidate.status}</b><small>{formatTime(result.openCandidate.time)} · {result.openCandidate.label} · ¥{result.openCandidate.price.toFixed(2)}</small></span><em>等待后续独立候补点，不用收盘价补造结果</em></div>}
          </div>
          {visibleBacktestObservations.length>0?<div className="candidate-audit-list">{visibleBacktestObservations.map((observation,index)=>{
            const pivotState=observation.pivotAssessment==="strong"?"强确认":observation.pivotAssessment==="confirmed"?"已确认":"未确认";
            const fixedOutcome=result.candidateOutcomes?.find(item=>item.time===observation.time&&item.direction===observation.direction);
            const closedHorizons=fixedOutcome?.horizons.filter(item=>item.complete)??[];
            return <article key={`${observation.direction}-${observation.time}-${index}`} className={observation.executable?"passed":observation.stage==="candidate"?"candidate":"watch"}>
              <header><span><i>{observation.l2Strict?"L2严格":observation.coverageOnly&&source?.quote.code==="601899"?"紫金候选":observation.coverageOnly?"覆盖":observation.stage==="candidate"?"候选":"观察"}</i><b>{formatTime(observation.time)} · {observationConfirmationLabel(observation)}</b></span><em>{observation.l2Strict?`${observation.score}/${observation.threshold} 分 · 历史L2因果确认`:observation.coverageOnly?"研究候选 · 不计胜率":`${observation.score}/${observation.threshold} 分 · 预估价差 ${observation.edge.toFixed(2)}%`}</em></header>
              <p>{observationDirectionNote(observation)}；{observation.reason}</p>
              {observation.scoreBreakdown&&<small>三分离证据：方向 {observation.scoreBreakdown.direction}/{observation.scoreBreakdown.thresholds.direction} · 位置 {observation.scoreBreakdown.location}/{observation.scoreBreakdown.thresholds.location} · 触发 {observation.scoreBreakdown.trigger}/{observation.scoreBreakdown.thresholds.trigger}</small>}
              {observation.similarity&&<small>历史相似：{observation.similarity.ready?`${observation.similarity.samples} 个已完成样本 · 10分钟达标 ${(observation.similarity.hitRate??0).toFixed(0)}% · 平均有利 ${(observation.similarity.averageFavorablePct??0).toFixed(2)}%`:`样本 ${observation.similarity.samples} 个，未达最小样本量，仅作观察`}</small>}
              {observation.pivotTime&&<small>此前参考：{formatTime(observation.pivotTime)} ¥{observation.pivotPrice?.toFixed(2) ?? "—"} · {observation.pivotLabel ?? pivotState}；提示只在 {formatTime(observation.time)} 确认</small>}
              {closedHorizons.length>0&&<small>研究闭环（未扣费）：{closedHorizons.map(item=>`${item.minutes}分 ${Number(item.returnPct??0)>=0?"+":""}${Number(item.returnPct??0).toFixed(2)}%（MFE +${Number(item.mfePct??0).toFixed(2)}% / MAE ${Number(item.maePct??0).toFixed(2)}%）`).join(" · ")}</small>}
              {fixedOutcome&&closedHorizons.length<fixedOutcome.horizons.length&&<small>尾盘未满时窗保留为“未闭环”，不使用收盘价补结果。</small>}
              <div className="candidate-audit-blockers">{observation.executable?<span className="passed">已通过正式过滤</span>:observation.blockers.map((blocker,blockerIndex)=><span key={`${blocker}-${blockerIndex}`}>{blocker}</span>)}</div>
            </article>;
          })}</div>:<p className="candidate-audit-empty">本交易日没有形成达到展示门槛的观察点；不是按钮失效，也不会虚构信号。</p>}
          <p className="candidate-audit-foot">“候选判定次数”按触发条件的分钟累计，不等于独立信号。闭环、MFE 与 MAE 只在后续独立反向候补出现后做事后复盘，不参与信号生成，也不会回写或移动原提示点。</p>
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
