/**
 * Causal intraday Smart-T replay engine.
 *
 * Every decision only receives points at or before the current minute. The
 * engine never reads the session close, final high/low or a future indicator.
 */

import { evaluateQmtOrderFlow, normalizeQmtOrderFlow } from "./qmt-orderflow-confirmation.mjs";
import { evaluateIntradayDivergence } from "./intraday-divergence.mjs";
import { closeTCycle, createTCycleState, openTCycle, refreshTCycleState } from "./t-cycle-state-machine.mjs";

const BASE_PROFILE = {
  targetNetPct: 0.64,
  maxTargetNetPct: 1.00,
  hardStopPct: 0.75,
  catastrophicStopPct: 1.35,
  stopBreakBufferPct: 0.10,
  softStopPct: 0.40,
  softStopMinutes: 16,
  timeExitMinutes: 32,
  trailActivationPct: 0.64,
  trailRetracePct: 0.10,
  trailMinNetPct: 0.48,
  maxOpeningChasePct: 0.70,
  maxOpeningRepairPremiumPct: 0.15,
  minOpeningRepairSessionMove: 0.60,
  maxOpeningRepairPremiumPivotAge: 1,
  maxOpeningRepairPivotAge: 4,
  requireOpeningFadeVwapCross: true,
  strongBuySessionMove: 0.60,
  strongBuyVwap30: 0.30,
  strongSellSessionMove: 0.90,
  strongSellVwap30: 0.30,
  counterTrendVwap30: 0.18,
  counterTrendSessionMove: 0.25,
  counterTrendMinVolumeRatio: 0.85,
  candidateFlipMinutes: 30,
  fallingKnifeVwap30: 0.30,
  fallingKnifeSessionMove: 1.00,
  fallingKnifePrePivot10: 0.75,
  fallingKnifeMinPivotAge: 4,
  fallingKnifePrice60: 0.35,
  fallingKnifePrice90: 0.45,
  fallingKnifeLongMeanBias: 0.00,
  earlyPathMeanBias: 0.35,
  earlyPathMove10: 1.50,
  earlyPathMinPivotAge: 8,
  midPathMeanBias: 0.25,
  midPathPrice30: 0.80,
  midPathMaxPivotReversal: 0.30,
  latePathVwap30: 0.05,
  latePathDeviation: 0.90,
  lateRecoveryVwap30: 0.03,
  lateRecoveryDeviation: 0.75,
  lateRecoveryLongMeanBias: 0.15,
  lateRecoveryPrice90: 0.45,
  lateSellPrice60: 0.35,
  lateSellPrice90: 0.45,
  lateSellLongMeanBias: 0.15,
  weakSessionSellMove: 1.00,
  weakSessionSellMeanPremium: 0.15,
  weakSessionSellPrice60Rise: 0.15,
  risingKnifeVwap30: 0.30,
  risingKnifeSessionMove: 1.00,
  risingKnifePrePivot10: 0.75,
  risingKnifeMinPivotAge: 4,
};

const PROFILES = {
  // candidateNetPct controls the wider observation layer. targetNetPct arms
  // after-cost profit protection; maxTargetNetPct closes immediately. Between
  // those levels the engine follows the already-observed move and exits only
  // after a causal reversal/pullback, never after looking ahead to a peak.
  "稳健档": { ...BASE_PROFILE, score: 6, cooldown: 10, minHoldMinutes: 5, candidateNetPct: 0.55, maxCycles: 1, deviation: 0.90, reversal: 0.32, maxSellPullback: 0.34, minBuyVolumeRatio: 0.85, minSellVolumeRatio: 0.95, minMomentum3: 0.14, minRewardRisk: 1.55, hardStopPct: 0.70, softStopPct: 0.36, softStopMinutes: 14, timeExitMinutes: 28, maxOpeningChasePct: 0.55, strongBuySessionMove: 0.50, strongBuyVwap30: 0.24, strongSellSessionMove: 0.75, strongSellVwap30: 0.24, counterTrendVwap30: 0.14, counterTrendSessionMove: 0.20, counterTrendMinVolumeRatio: 0.95 },
  // Keep execution quality stable: benchmarked wider gates raised frequency
  // but turned the same real-minute sample negative after costs.
  "平衡档": { ...BASE_PROFILE, score: 4, cooldown: 8, minHoldMinutes: 4, candidateNetPct: 0.42, maxCycles: 1, deviation: 0.70, reversal: 0.22, maxSellPullback: 0.36, minBuyVolumeRatio: 0.80, minSellVolumeRatio: 0.90, minMomentum3: 0.12, minRewardRisk: 1.50 },
  // The sensitive gates create useful early candidates, but repeated entries
  // on the same stock-day were unstable after costs. Keep the wider
  // observation layer while allowing only the first formal cycle; later
  // setups remain visible as non-executable observations.
  "灵敏档": { ...BASE_PROFILE, score: 4, cooldown: 5, minHoldMinutes: 3, candidateNetPct: 0.32, maxCycles: 1, deviation: 0.65, reversal: 0.22, maxSellPullback: 0.40, minBuyVolumeRatio: 0.75, minSellVolumeRatio: 0.85, minMomentum3: 0.10, minRewardRisk: 1.40, hardStopPct: 0.82, softStopPct: 0.46, softStopMinutes: 18, timeExitMinutes: 36, trailMinNetPct: 0.46, maxOpeningChasePct: 0.82, strongBuySessionMove: 0.72, strongBuyVwap30: 0.38, strongSellSessionMove: 1.05, strongSellVwap30: 0.38, counterTrendVwap30: 0.24, counterTrendSessionMove: 0.32, counterTrendMinVolumeRatio: 0.75 },
  "量化学习": { ...BASE_PROFILE, score: 5, cooldown: 8, minHoldMinutes: 4, candidateNetPct: 0.42, maxCycles: 1, deviation: 0.74, reversal: 0.24, maxSellPullback: 0.36, minBuyVolumeRatio: 0.80, minSellVolumeRatio: 0.90, minMomentum3: 0.12, minRewardRisk: 1.50 },
};

// Keep the chart readable without letting the opening swings consume the
// whole day's observation budget. Reserve half of the markers for the
// afternoon so a full-day causal replay can still explain later VWAP
// displacements. This is a display/alert budget only; it never changes the
// execution threshold.
const MAX_DAILY_OBSERVATIONS = 6;
const MAX_SESSION_OBSERVATIONS = 3;

const minutesFromOpen = (time) => {
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  const wallClockMinute = hour * 60 + minute;
  // A-share trading time is discontinuous. 11:30 -> 13:00 advances by one
  // tradable minute, not ninety wall-clock minutes. This keeps cooldowns and
  // time exits causal without falsely closing a position during lunch.
  if (wallClockMinute <= 11 * 60 + 30) return wallClockMinute - (9 * 60 + 30);
  return 120 + wallClockMinute - 13 * 60;
};

const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const pct = (value, base) => base > 0 ? (value - base) / base * 100 : 0;

/**
 * Causal realised-volatility estimate built only from completed one-minute
 * prices.  The input has no high/low fields, so this deliberately uses RMS
 * close-to-close returns instead of pretending that a close is an ATR candle.
 */
export function causalVolatilityScale(points, index, {
  window = 30,
  referencePct = 0.12,
  minScale = 0.80,
  maxScale = 1.30,
  minSamples = 10,
} = {}) {
  const end = Math.min(Math.max(0, index), Math.max(0, points.length - 1));
  const start = Math.max(1, end - Math.max(2, window) + 1);
  const returns = [];
  for (let cursor = start; cursor <= end; cursor += 1) {
    const current = Number(points[cursor]?.price);
    const previous = Number(points[cursor - 1]?.price);
    if (Number.isFinite(current) && Number.isFinite(previous) && previous > 0) {
      returns.push(pct(current, previous));
    }
  }
  if (returns.length < Math.max(2, minSamples)) {
    return { scale: 1, realisedPct: 0, samples: returns.length };
  }
  const realisedPct = Math.sqrt(mean(returns.map((value) => value * value)));
  const safeReference = Math.max(0.01, Number(referencePct) || 0.12);
  const lower = Math.max(0.25, Number(minScale) || 0.80);
  const upper = Math.max(lower, Number(maxScale) || 1.30);
  const scale = Math.min(upper, Math.max(lower, realisedPct / safeReference));
  return { scale, realisedPct, samples: returns.length };
}

export function describeVwapConfirmation({ direction, pivotDeviation, currentDeviation, volumeRatio }) {
  const isBuyFirst = direction === "BUY_FIRST";
  const pivotName = isBuyFirst ? "此前低点" : "此前高点";
  const pivotSide = pivotDeviation >= 0 ? "上方" : "下方";
  const currentSide = currentDeviation >= 0 ? "上方" : "下方";
  const transition = currentSide === pivotSide
    ? `当前仍在 VWAP ${currentSide} ${Math.abs(currentDeviation).toFixed(2)}%`
    : `当前已${currentSide === "上方" ? "站回" : "跌回"} VWAP ${currentSide} ${Math.abs(currentDeviation).toFixed(2)}%`;

  return `${pivotName}位于 VWAP ${pivotSide} ${Math.abs(pivotDeviation).toFixed(2)}%，${transition}；${volumeRatio >= 1.8 ? "倍量" : "量比"} ${volumeRatio.toFixed(2)}×`;
}

export function crossedVwapCausally({ direction, pivotDeviation, currentDeviation }) {
  return direction === "SELL_FIRST"
    ? pivotDeviation > 0 && currentDeviation <= 0
    : pivotDeviation < 0 && currentDeviation >= 0;
}
const roundLot = (shares) => Math.max(0, Math.floor(shares / 100) * 100);

function confirmCandidateDirectionFlip({
  oppositeCandidate,
  pairEconomicallyDistinct,
  nowMinute,
  cooldown,
  minimumFlipMinutes = 30,
  structuralConfirmation,
  executionMomentumConfirmed,
}) {
  if (!oppositeCandidate) return true;
  return pairEconomicallyDistinct
    && nowMinute - oppositeCandidate.minute >= Math.max(cooldown, minimumFlipMinutes)
    && structuralConfirmation
    && executionMomentumConfirmed;
}

// A short rebound does not, by itself, end a decline. This guard is evaluated
// only with data fixed at the current minute and keeps buy-first setups in the
// observation layer until the falling structure has genuinely stabilised.
// It deliberately uses three independent failure modes:
// 1) a materially falling 30-minute VWAP;
// 2) a weak session whose VWAP is still falling;
// 3) a sharp ten-minute fall with fewer than three completed recovery minutes.
export function detectFallingKnifeConflict({
  direction,
  currentDeviation,
  crossedVwap,
  vwapMomentum15,
  vwapMomentum30,
  sessionMove,
  prePivotMove10,
  pivotAge,
  pivotReversal = 0,
  priceMomentum30 = 0,
  priceMomentum60 = 0,
  priceMomentum90 = 0,
  longPriceMeanBias = 0,
  broadPricePoints = 0,
  profile = BASE_PROFILE,
}) {
  if (direction !== "BUY_FIRST" || crossedVwap || currentDeviation >= 0) {
    return {
      blocked: false,
      reason: null,
      broadVwapDecline: false,
      weakSessionDecline: false,
      rapidDeclineUnconfirmed: false,
      persistentPriceDecline: false,
      earlyPersistentDecline: false,
      midPersistentDecline: false,
      latePersistentDecline: false,
      lateRecoveryDecline: false,
    };
  }

  const broadVwapDecline = vwapMomentum30 <= -(profile.fallingKnifeVwap30 ?? 0.30);
  const weakSessionDecline = sessionMove <= -(profile.fallingKnifeSessionMove ?? 1.00)
    && vwapMomentum15 <= -0.04;
  const rapidDeclineUnconfirmed = prePivotMove10 <= -(profile.fallingKnifePrePivot10 ?? 0.75)
    && pivotAge < (profile.fallingKnifeMinPivotAge ?? 4);
  // Opening volume can make cumulative VWAP look flat after a long decline.
  // The independent price-path gate stays causal and prevents a tiny rebound
  // from being treated as a completed reversal.
  const persistentPriceDecline = broadPricePoints >= 60
    && longPriceMeanBias <= -(profile.fallingKnifeLongMeanBias ?? 0.05)
    && (
      priceMomentum60 <= -(profile.fallingKnifePrice60 ?? 0.45)
      || priceMomentum90 <= -(profile.fallingKnifePrice90 ?? 0.80)
    );
  // Before sixty minutes exist, the long-window momentum fields are not yet
  // available. Use the already-observed mean displacement plus the ten-minute
  // fall and require a longer base before allowing a buy-first order.
  const earlyPersistentDecline = broadPricePoints >= 30
    && broadPricePoints <= 60
    && longPriceMeanBias <= -(profile.earlyPathMeanBias ?? 0.35)
    && prePivotMove10 <= -(profile.earlyPathMove10 ?? 1.50)
    && pivotAge <= (profile.earlyPathMinPivotAge ?? 8);
  // Between the opening-only and full 60/90-minute guards there used to be a
  // blind spot: a stock could fall for 30 minutes, make a tiny two-minute
  // bounce and still open a buy-first cycle. This gate only reads the path
  // already seen and requires a materially stronger reversal before buying.
  const midPersistentDecline = broadPricePoints >= 45
    && currentDeviation <= -0.65
    && (
      (
        longPriceMeanBias <= -(profile.midPathMeanBias ?? 0.25)
        && priceMomentum30 <= -(profile.midPathPrice30 ?? 0.80)
      )
      || (
        vwapMomentum30 <= -(profile.latePathVwap30 ?? 0.05)
        && longPriceMeanBias <= -0.20
      )
    )
    && pivotReversal < (profile.midPathMaxPivotReversal ?? 0.30);
  const latePersistentDecline = broadPricePoints >= 90
    && currentDeviation <= -(profile.latePathDeviation ?? 0.90)
    && vwapMomentum30 <= -(profile.latePathVwap30 ?? 0.05);
  // Heavy opening volume can flatten cumulative VWAP long after price has
  // entered a persistent decline. Use the already-observed 90-minute price
  // path and long causal mean as a second trend shield so a small rebound
  // cannot become a buy-first order during that decline.
  const lateRecoveryDecline = broadPricePoints >= 90
    && currentDeviation <= -(profile.lateRecoveryDeviation ?? 0.90)
    && vwapMomentum30 <= -(profile.lateRecoveryVwap30 ?? 0.03)
    && longPriceMeanBias <= -(profile.lateRecoveryLongMeanBias ?? 0.15)
    && priceMomentum90 <= -(profile.lateRecoveryPrice90 ?? 0.45);
  const blocked = broadVwapDecline
    || weakSessionDecline
    || rapidDeclineUnconfirmed
    || persistentPriceDecline
    || earlyPersistentDecline
    || midPersistentDecline
    || latePersistentDecline
    || lateRecoveryDecline;
  const reason = midPersistentDecline
    ? "近30分钟价格仍明显下行，当前反弹幅度不足；此前趋势风险触发后需连续确认 8 分钟，禁止下降途中先买"
    : lateRecoveryDecline
    ? "90分钟价格路径与长周期均价仍确认下行，累计VWAP虽被早盘成交量压平，局部反弹仍只观察、禁止下跌途中买入"
    : latePersistentDecline
    ? "90分钟价格路径与30分钟VWAP仍同步下行，局部回升仅保留观察，禁止下降途中买入"
    : earlyPersistentDecline
    ? "开盘后一小时样本尚不足，价格明显低于已观察均价且十分钟急跌，仅保留止跌观察"
    : persistentPriceDecline
    ? "60/90分钟价格路径仍在下行且当前价低于长周期均价，局部反弹只保留观察"
    : broadVwapDecline
    ? "30分钟VWAP仍明显下行，当前反弹不能视为趋势反转"
    : weakSessionDecline
      ? "全天弱势且VWAP仍下行，当前仅是下降途中的局部反弹"
      : rapidDeclineUnconfirmed
        ? `10分钟急跌后仅确认${pivotAge}分钟，至少等待${profile.fallingKnifeMinPivotAge ?? 4}分钟止跌`
        : null;

  return {
    blocked,
    reason,
    broadVwapDecline,
    weakSessionDecline,
    rapidDeclineUnconfirmed,
    persistentPriceDecline,
    earlyPersistentDecline,
    midPersistentDecline,
    latePersistentDecline,
    lateRecoveryDecline,
  };
}

// Mirror the buy-side protection for reverse-T sales. Selling inventory into
// an unfinished rise commonly forces a later, higher buyback. A sell setup may
// remain visible, but it is not executable until the rising structure has had
// enough causal confirmation to turn.
export function detectRisingKnifeConflict({
  direction,
  currentDeviation,
  crossedVwap,
  vwapMomentum15,
  vwapMomentum30,
  sessionMove,
  prePivotMove10,
  pivotAge,
  pivotReversal = 0,
  priceMomentum30 = 0,
  priceMomentum60 = 0,
  priceMomentum90 = 0,
  longPriceMeanBias = 0,
  broadPricePoints = 0,
  profile = BASE_PROFILE,
}) {
  if (direction !== "SELL_FIRST" || crossedVwap || currentDeviation <= 0) {
    return {
      blocked: false,
      reason: null,
      broadVwapRise: false,
      strongSessionRise: false,
      rapidRiseUnconfirmed: false,
      lateDowntrendSell: false,
      weakSessionLateSell: false,
      earlyPersistentRise: false,
      midPersistentRise: false,
      latePersistentRise: false,
      lateRecoveryRise: false,
    };
  }

  const broadVwapRise = vwapMomentum30 >= (profile.risingKnifeVwap30 ?? 0.30);
  const strongSessionRise = sessionMove >= (profile.risingKnifeSessionMove ?? 1.00)
    && vwapMomentum15 >= 0.04;
  const rapidRiseUnconfirmed = prePivotMove10 >= (profile.risingKnifePrePivot10 ?? 0.75)
    && pivotAge < (profile.risingKnifeMinPivotAge ?? 4);
  // A reverse-T sale must precede the decline, not chase it. Cumulative VWAP
  // can remain below the current price even after the local high has passed,
  // so independently reject sales already below the long causal price mean.
  const lateDowntrendSell = broadPricePoints >= 60
    && longPriceMeanBias <= -(profile.lateSellLongMeanBias ?? 0.15)
    && (
      priceMomentum60 <= -(profile.lateSellPrice60 ?? 0.35)
      || priceMomentum90 <= -(profile.lateSellPrice90 ?? 0.45)
    );
  // A weak opening can keep cumulative VWAP artificially low for hours.
  // Being above that VWAP is not a new high when price is only near the long
  // causal mean and the last hour has not risen. Keep that late setup visible
  // but do not chase it with a reverse-T sale.
  const weakSessionLateSell = broadPricePoints >= 60
    && sessionMove <= -(profile.weakSessionSellMove ?? 1.00)
    && longPriceMeanBias <= (profile.weakSessionSellMeanPremium ?? 0.15)
    && priceMomentum60 <= (profile.weakSessionSellPrice60Rise ?? 0.15);
  const earlyPersistentRise = broadPricePoints >= 30
    && broadPricePoints <= 60
    && longPriceMeanBias >= (profile.earlyPathMeanBias ?? 0.35)
    && prePivotMove10 >= (profile.earlyPathMove10 ?? 1.50)
    && pivotAge <= (profile.earlyPathMinPivotAge ?? 8);
  const midPersistentRise = broadPricePoints >= 45
    && currentDeviation >= 0.65
    && (
      (
        longPriceMeanBias >= (profile.midPathMeanBias ?? 0.25)
        && priceMomentum30 >= (profile.midPathPrice30 ?? 0.80)
      )
      || (
        vwapMomentum30 >= (profile.latePathVwap30 ?? 0.05)
        && longPriceMeanBias >= 0.20
      )
    )
    && pivotReversal < (profile.midPathMaxPivotReversal ?? 0.30);
  const latePersistentRise = broadPricePoints >= 90
    && currentDeviation >= (profile.latePathDeviation ?? 0.90)
    && vwapMomentum30 >= (profile.latePathVwap30 ?? 0.05);
  // Mirror the late decline guard. After a weak opening, large early volume
  // can leave cumulative VWAP nearly flat even while the observed 90-minute
  // path has already recovered strongly. A small fade is not enough to sell
  // inventory into that recovery.
  const lateRecoveryRise = broadPricePoints >= 90
    && currentDeviation >= (profile.lateRecoveryDeviation ?? 0.90)
    && vwapMomentum30 >= (profile.lateRecoveryVwap30 ?? 0.03)
    && longPriceMeanBias >= (profile.lateRecoveryLongMeanBias ?? 0.15)
    && priceMomentum90 >= (profile.lateRecoveryPrice90 ?? 0.45);
  const blocked = broadVwapRise
    || strongSessionRise
    || rapidRiseUnconfirmed
    || lateDowntrendSell
    || weakSessionLateSell
    || earlyPersistentRise
    || midPersistentRise
    || latePersistentRise
    || lateRecoveryRise;
  const reason = midPersistentRise
    ? "近30分钟价格仍明显上行，当前回落幅度不足，禁止上涨途中先卖"
    : lateRecoveryRise
    ? "90分钟价格路径与长周期均价仍确认上行，累计VWAP虽被早盘成交量压平，局部回落仍只观察、禁止上涨途中卖出"
    : latePersistentRise
    ? "90分钟价格路径与30分钟VWAP仍同步上行，局部回落仅保留观察，禁止上涨途中卖出"
    : earlyPersistentRise
    ? "开盘后一小时样本尚不足，价格明显高于已观察均价且十分钟急升，仅保留转弱观察"
    : weakSessionLateSell
    ? "弱势日价格仅在长周期均价附近且近60分钟没有形成上升路径，禁止下跌途中追卖"
    : lateDowntrendSell
    ? "价格已低于长周期均价且60/90分钟路径仍下行，禁止跌后追卖"
    : broadVwapRise
    ? "30分钟VWAP仍明显上行，当前回落不能视为趋势反转"
    : strongSessionRise
      ? "全天强势且VWAP仍上行，当前仅是上涨途中的局部回落"
      : rapidRiseUnconfirmed
        ? `10分钟急升后仅确认${pivotAge}分钟，至少等待${profile.risingKnifeMinPivotAge ?? 4}分钟转弱`
        : null;

  return {
    blocked,
    reason,
    broadVwapRise,
    strongSessionRise,
    rapidRiseUnconfirmed,
    lateDowntrendSell,
    weakSessionLateSell,
    earlyPersistentRise,
    midPersistentRise,
    latePersistentRise,
    lateRecoveryRise,
  };
}

export function detectTrendContinuationConflict(input) {
  return input.direction === "BUY_FIRST"
    ? detectFallingKnifeConflict(input)
    : detectRisingKnifeConflict(input);
}

export function isLiquidEntryTime(time) {
  return (time >= "0935" && time <= "1110")
    || (time >= "1300" && time < "1430");
}

export function isTrendRiskCooling(lastBlockedMinute, nowMinute, cooldownMinutes = 8) {
  return Number.isFinite(lastBlockedMinute)
    && Number.isFinite(nowMinute)
    && nowMinute >= lastBlockedMinute
    && nowMinute - lastBlockedMinute < cooldownMinutes;
}

function evaluateStructuralStop({
  direction,
  currentPrice,
  previousPrice,
  beforePrice,
  entryPivotPrice,
  movePct,
  holdMinutes,
  hardStopPct,
  catastrophicStopPct,
  stopBreakBufferPct,
  softStopPct,
  softStopMinutes,
}) {
  const pivotBreakPrice = direction === "BUY_FIRST"
    ? entryPivotPrice * (1 - stopBreakBufferPct / 100)
    : entryPivotPrice * (1 + stopBreakBufferPct / 100);
  const adverseMomentum = direction === "BUY_FIRST"
    ? currentPrice < previousPrice && previousPrice <= beforePrice
    : currentPrice > previousPrice && previousPrice >= beforePrice;
  const structuralStopConfirmed = direction === "BUY_FIRST"
    ? currentPrice <= pivotBreakPrice && previousPrice <= pivotBreakPrice && adverseMomentum
    : currentPrice >= pivotBreakPrice && previousPrice >= pivotBreakPrice && adverseMomentum;
  const catastrophicStop = movePct <= -catastrophicStopPct;
  const stop = catastrophicStop
    || (structuralStopConfirmed && (
      movePct <= -hardStopPct
      || (holdMinutes >= softStopMinutes && movePct <= -softStopPct)
    ));
  return { stop, catastrophicStop, structuralStopConfirmed, pivotBreakPrice, adverseMomentum };
}

function sanitize(minutes) {
  return minutes
    .filter((point) => /^\d{4}$/.test(point.time) && Number.isFinite(point.price) && point.price > 0)
    .filter((point) => (point.time >= "0930" && point.time <= "1130") || (point.time >= "1300" && point.time <= "1500"))
    .map((point) => ({
      time: point.time,
      price: Number(point.price),
      volume: Math.max(0, Number(point.volume) || 0),
      ...normalizeQmtOrderFlow(point),
    }));
}

function volumeRatio(points, index, lookback = 20) {
  const start = Math.max(0, index - lookback);
  const history = points.slice(start, index).map((point) => point.volume).filter((value) => value > 0);
  const baseline = mean(history);
  return baseline > 0 ? points[index].volume / baseline : 1;
}

function cumulativeVwap(points, index) {
  let amount = 0;
  let volume = 0;
  for (let cursor = 0; cursor <= index; cursor += 1) {
    const weight = Math.max(1, points[cursor].volume);
    amount += points[cursor].price * weight;
    volume += weight;
  }
  return amount / volume;
}

function causalRegime(points, index, vwaps) {
  if (index < 20) return "range";
  const recent = points.slice(index - 9, index + 1).map((point) => point.price);
  const earlier = points.slice(index - 19, index - 9).map((point) => point.price);
  const slope = pct(mean(recent), mean(earlier));
  const vwapSlope = pct(vwaps[index], vwaps[Math.max(0, index - 10)]);
  if (slope >= 0.35 && vwapSlope >= 0.10) return "uptrend";
  if (slope <= -0.35 && vwapSlope <= -0.10) return "downtrend";
  return "range";
}

// Classify the broader intraday cycle before choosing a T direction.  Unlike
// a local peak/valley confirmation, this vote combines several observations
// that are already fixed at minute `index`: VWAP slope, price/VWAP bias,
// session/reference move and recent price slope.  It deliberately returns
// `range` when the evidence is mixed so the engine never invents a trend just
// to create a trade.
function causalCyclePreference(points, index, vwaps, previousClose = null) {
  if (index < 30) return "range";
  // End the broad-cycle sample before the eight-minute local pivot window.
  // Otherwise a buy signal near a valley mechanically looks like a down-cycle
  // and a sell signal near a peak looks like an up-cycle. This anchor is fully
  // causal: every value was known before the local reversal was confirmed.
  const anchorIndex = Math.max(20, index - 8);
  const anchorPrice = points[anchorIndex].price;
  const anchorVwap = vwaps[anchorIndex];
  const vwap15 = pct(anchorVwap, vwaps[Math.max(0, anchorIndex - 15)]);
  const vwap30 = pct(anchorVwap, vwaps[Math.max(0, anchorIndex - 30)]);
  const priceBias = pct(anchorPrice, anchorVwap);
  const sessionMove = pct(anchorPrice, points[0].price);
  const referenceMove = previousClose ? pct(anchorPrice, previousClose) : sessionMove;
  const recent = points.slice(Math.max(0, anchorIndex - 9), anchorIndex + 1).map((point) => point.price);
  const earlier = points.slice(Math.max(0, anchorIndex - 19), Math.max(1, anchorIndex - 9)).map((point) => point.price);
  const recentSlope = earlier.length ? pct(mean(recent), mean(earlier)) : 0;

  const upVotes = [
    vwap15 >= 0.04,
    vwap30 >= 0.08,
    priceBias >= 0.15,
    recentSlope >= 0.15,
    Math.max(sessionMove, referenceMove) >= 0.40,
  ].filter(Boolean).length;
  const downVotes = [
    vwap15 <= -0.04,
    vwap30 <= -0.08,
    priceBias <= -0.15,
    recentSlope <= -0.15,
    Math.min(sessionMove, referenceMove) <= -0.40,
  ].filter(Boolean).length;

  if (upVotes >= 3 && upVotes >= downVotes + 2) return "uptrend";
  if (downVotes >= 3 && downVotes >= upVotes + 2) return "downtrend";
  return "range";
}

// A persistent 30/45-minute move is a veto only. It must not promote a mixed
// market into a new trade direction, but it does prevent selling first during
// an established rebound or buying first during an established decline.
function causalPersistentDirection(points, index) {
  if (index < 60) return "range";
  const currentPrice = points[index].price;
  const momentum30 = pct(currentPrice, points[index - 30].price);
  const momentum45 = pct(currentPrice, points[index - 45].price);
  const momentum60 = pct(currentPrice, points[index - 60].price);
  const local8 = pct(currentPrice, points[index - 8].price);
  // A short pullback after a long rise (or rebound after a long decline) must
  // not erase the already-established direction. This function is a veto,
  // not an entry generator, and reads only points available at `index`.
  if (momentum30 >= 0.30
    && momentum45 >= 0.45
    && momentum60 >= 0.55
    && local8 >= -0.45) return "uptrend";
  if (momentum30 <= -0.30
    && momentum45 <= -0.45
    && momentum60 <= -0.55
    && local8 <= 0.45) return "downtrend";
  return "range";
}

// Afternoon executions need a separate short-horizon veto. A 60/90-minute
// classifier can legitimately return "range" after a morning reversal even
// while the current 30-minute price path and VWAP are still moving one way.
// This check only blocks the counter-trend order; the candidate remains
// visible for review.
function causalAfternoonTrendConflict({
  session,
  time,
  direction,
  vwapMomentum30,
  priceMomentum30,
}) {
  if (session !== "afternoon" || time < "1400") return false;
  return direction === "BUY_FIRST"
    ? vwapMomentum30 <= -0.05 && priceMomentum30 <= 0.10
    : vwapMomentum30 >= 0.05 && priceMomentum30 >= -0.10;
}

// The afternoon remains available to the observation layer, but V4 does not
// open a new formal cycle after lunch. Across independent fixtures the morning
// retained positive expectancy while afternoon executions were unstable.
// Existing cycles can still close after lunch.
function causalFormalEntryWindowConflict(time) {
  return time >= "1300";
}

// A small move around yesterday's close is not a real opening gap. Keep its
// reversal as an observation, but require a material, already-observed
// displacement before the opening module may create an executable order.
function causalOpeningDisplacementConflict(opening, referenceMove, minimumPct = 1) {
  return opening && Math.abs(referenceMove) < minimumPct;
}

// Opening-gap repair is executable only after the observed tape confirms the
// repair/fade. A low-open buy that has already chased too far above VWAP stays
// a candidate. A high-open reverse-T must still be on the expensive side of
// VWAP after its observed pullback; selling only after price has fallen below
// fair value is a late, directionally inverted entry.
function causalOpeningQualityConflict({
  opening,
  direction,
  deviation,
  sessionMove = 0,
  pivotAge = Infinity,
  maxRepairPremiumPct = 0.15,
  minRepairSessionMove = 0.60,
  maxRepairPremiumPivotAge = 1,
  requireFadeVwapCross = true,
}) {
  if (!opening) return false;
  if (direction === "BUY_FIRST") {
    if (deviation > maxRepairPremiumPct) return true;
    // A low-open repair may briefly trade above cumulative VWAP, but only
    // when the recovery is already material and the causal pivot has just
    // been confirmed. Otherwise this is a late chase near the local high.
    return deviation > 0
      && (sessionMove < minRepairSessionMove || pivotAge > maxRepairPremiumPivotAge);
  }
  return requireFadeVwapCross && deviation < maxRepairPremiumPct;
}

// An opening repair is actionable only while the reversal is still fresh.
// A signal arriving many minutes after the observed pivot is a chase, even
// when the current price happens to remain close to VWAP.
function causalOpeningRepairAgeConflict({
  opening,
  direction,
  pivotAge,
  deviation,
  maxPivotAge = 4,
}) {
  return Boolean(
    opening
    && direction === "BUY_FIRST"
    && Number.isFinite(pivotAge)
    && Number.isFinite(deviation)
    && deviation >= 0
    && pivotAge > maxPivotAge,
  );
}

// A strong positive overnight gap can still collapse intraday. Buying the
// first deep VWAP deviation while both the short VWAP slope and the tape are
// falling catches a falling knife. Keep it visible as an observation, but do
// not create an executable positive-T order until the tape stabilises.
function causalHighGapCollapseConflict({
  direction,
  sessionMove,
  referenceMove,
  deviation,
  vwapMomentum15,
  minSessionMove = 3,
  minReferenceMove = 2,
  maxDeviation = -0.70,
  maxVwapMomentum15 = -0.10,
}) {
  return Boolean(
    direction === "BUY_FIRST"
    && sessionMove >= minSessionMove
    && referenceMove >= minReferenceMove
    && deviation <= maxDeviation
    && vwapMomentum15 <= maxVwapMomentum15,
  );
}

// A generic range label must not hide an already-observed broad decline.
// If both VWAP slopes and the 30-minute price path are still falling, and
// price remains materially below its longer causal mean, a local bounce is
// observation-only. This prevents slow falling-knife positive-T entries
// without using any point after the current minute.
function causalBroadDowntrendBuyConflict({
  opening,
  direction,
  crossedVwap,
  priceMomentum30,
  vwapMomentum15,
  vwapMomentum30,
  longPriceMeanBias,
  maxPriceMomentum30 = -0.40,
  maxVwapMomentum15 = -0.05,
  maxVwapMomentum30 = -0.05,
  maxLongMeanBias = -0.40,
}) {
  return Boolean(
    !opening
    && direction === "BUY_FIRST"
    && !crossedVwap
    && priceMomentum30 <= maxPriceMomentum30
    && vwapMomentum15 <= maxVwapMomentum15
    && vwapMomentum30 <= maxVwapMomentum30
    && longPriceMeanBias <= maxLongMeanBias,
  );
}

function causalTrendImpulseConflict({
  opening,
  direction,
  crossedVwap,
  vwapMomentum15,
  priceMomentum30,
  prePivotMove10,
  pivotReversal,
}) {
  if (opening || crossedVwap) return false;
  // A three-minute bounce after a steep move is not enough to declare that
  // the impulse has ended.  The old pivot-reversal exemption let exactly
  // those falling-knife buys (and rising-knife sells) through.  Require the
  // already-observed 15-minute VWAP to stop moving against the order first.
  const opposingVwap = direction === "BUY_FIRST"
    ? vwapMomentum15 <= -0.08
    : vwapMomentum15 >= 0.08;
  const broadImpulse = direction === "BUY_FIRST"
    ? priceMomentum30 <= -0.70
    : priceMomentum30 >= 0.70;
  const sharpPrePivotImpulse = direction === "BUY_FIRST"
    ? prePivotMove10 <= -1.20
    : prePivotMove10 >= 1.20;
  // A confirmed pullback from a local peak is valid sell evidence. Keep that
  // sell-side escape hatch, but never apply it to a falling-knife buy.
  const confirmedSellPeak = direction === "SELL_FIRST" && pivotReversal >= 0.30;
  return !confirmedSellPeak && opposingVwap && (broadImpulse || sharpPrePivotImpulse);
}

// A wide VWAP deviation inside a still-directional 30-minute path is not
// enough by itself. When price has not crossed VWAP, require a meaningful
// already-observed recovery from the local pivot before taking the opposite
// side. This covers slower falling/rising knives without future points.
function causalWeakRecoveryConflict({
  opening,
  direction,
  crossedVwap,
  deviation,
  vwapMomentum30,
  priceMomentum30,
  prePivotMove10,
  pivotReversal,
  longPriceMeanBias = 0,
  broadPricePoints = 0,
}) {
  if (opening || crossedVwap) return false;
  const inDirectionalExtension = direction === "BUY_FIRST"
    ? deviation <= -0.65 && vwapMomentum30 <= -0.15
    : deviation >= 0.65 && vwapMomentum30 >= 0.15;
  const recoveryConfirmed = direction === "BUY_FIRST"
    ? pivotReversal >= 0.30 && (prePivotMove10 >= 0 || priceMomentum30 >= 0.50)
    : pivotReversal >= 0.30
      || (prePivotMove10 <= 0 && priceMomentum30 <= -0.50);
  if (inDirectionalExtension && !recoveryConfirmed) return true;

  // Slow one-way paths were previously able to slip between the fixed
  // ±0.15% VWAP threshold and the broad-trend gate. These checks use only
  // values known at the current minute. They keep an unfinished decline from
  // becoming a positive-T buy and a strong 30-minute rise from becoming an
  // early reverse-T sale.
  if (broadPricePoints < 45 || Math.abs(deviation) < 0.65) return false;
  if (direction === "BUY_FIRST") {
    const broadVwapStillFalling = vwapMomentum30 <= -0.10 && pivotReversal < 0.30;
    const slowDeclineStillFalling = vwapMomentum30 <= -0.05
      && priceMomentum30 <= -0.25
      && longPriceMeanBias <= -0.25
      && pivotReversal < 0.40;
    return broadVwapStillFalling || slowDeclineStillFalling;
  }
  return priceMomentum30 >= 1.50
    && longPriceMeanBias >= 0.60
    && prePivotMove10 >= 0
    && pivotReversal < 0.40;
}

// A local 8-minute turn does not prove that the broader move has ended.
// Formal mean-reversion orders need the already-observed 30-minute path to
// stop running against them. This is a hard veto, not a weighted score.
function causalThirtyMinuteTrendShieldConflict({
  opening,
  direction,
  crossedVwap,
  deviation,
  priceMomentum30,
  longPriceMeanBias,
  broadPricePoints,
  minOpeningDeviation = 0.45,
  minDeviation = 0.65,
  maxBuyPriceMomentum30 = 0,
  maxBuyLongMeanBias = 0,
  maxSellPriceMomentum30 = 1,
}) {
  if (crossedVwap) return false;
  if (Math.abs(deviation) < (opening ? minOpeningDeviation : minDeviation)) return true;
  if (opening || broadPricePoints < 45) return false;
  if (direction === "BUY_FIRST") {
    return priceMomentum30 < maxBuyPriceMomentum30
      || longPriceMeanBias < maxBuyLongMeanBias;
  }
  return priceMomentum30 > maxSellPriceMomentum30;
}

// A mean-reversion T must start on the economically correct side of VWAP.
// Opening gap-repair labels remain useful observations, but cannot turn a
// sell below VWAP or a buy above VWAP into an executable order.
function causalVwapDirectionConflict(direction, deviation, tolerance = 0.30) {
  return direction === "BUY_FIRST"
    ? deviation > tolerance
    : deviation < -tolerance;
}

// V4.1 shadow only: a generic "range" label is not permission to trade both
// sides.  Require a completed, already-observed history of real oscillation
// around VWAP.  The last eight points are excluded because they form the local
// pivot currently being confirmed; this prevents the candidate from proving
// its own range evidence and keeps the check strictly causal.
function causalRangeEvidence(points, index, vwaps, policy = {}) {
  const excludedPivotPoints = Math.max(3, Math.round(policy.shadowPivotExclusion ?? 8));
  const lookback = Math.max(20, Math.round(policy.shadowRangeLookback ?? 45));
  const sideBias = Math.max(0.05, policy.shadowRangeSideBias ?? 0.25);
  const crossingBias = Math.max(0.02, policy.shadowRangeCrossingBias ?? 0.10);
  const minimumCrossings = Math.max(1, Math.round(policy.shadowRangeMinCrossings ?? 2));
  const minimumAmplitude = Math.max(0.20, policy.shadowRangeMinAmplitude ?? 1.00);
  const maximumVwapDrift = Math.max(0.05, policy.shadowRangeMaxVwapDrift ?? 0.35);
  const end = index - excludedPivotPoints;
  if (end < 35) return { confirmed: false, crossings: 0, amplitude: 0, vwapDrift: 0 };
  const start = Math.max(0, end - lookback);
  const biases = [];
  const prices = [];
  for (let cursor = start; cursor <= end; cursor += 1) {
    biases.push(pct(points[cursor].price, vwaps[cursor]));
    prices.push(points[cursor].price);
  }
  let crossings = 0;
  let lastSide = 0;
  for (const bias of biases) {
    const side = bias >= crossingBias ? 1 : bias <= -crossingBias ? -1 : 0;
    if (!side) continue;
    if (lastSide && side !== lastSide) crossings += 1;
    lastSide = side;
  }
  const amplitude = pct(Math.max(...prices), Math.min(...prices));
  const vwapDrift = Math.abs(pct(vwaps[end], vwaps[start]));
  const visitedBothSides = Math.min(...biases) <= -sideBias && Math.max(...biases) >= sideBias;
  return {
    confirmed: crossings >= minimumCrossings
      && visitedBothSides
      && amplitude >= minimumAmplitude
      && vwapDrift <= maximumVwapDrift,
    crossings,
    amplitude,
    vwapDrift,
  };
}

function directionScore(points, index, direction, vwap, ratio) {
  if (index < 6) return 0;
  const prices = points.map((point) => point.price);
  const current = prices[index];
  const previous = prices[index - 1];
  const before = prices[index - 2];
  const recent = prices.slice(index - 5, index + 1);
  let score = 0;
  if (direction === "BUY_FIRST") {
    const low = Math.min(...recent);
    if (current > previous && previous >= before) score += 1;
    if (current > Math.max(previous, before)) score += 1;
    if (pct(current, low) >= 0.25) score += 1;
    if (pct(current, prices[index - 3]) > 0) score += 1;
    if (current < vwap * 1.0025) score += 1;
    if (ratio >= 0.65 && ratio <= 3) score += 1;
  } else {
    const high = Math.max(...recent);
    if (current < previous && previous <= before) score += 1;
    if (current < Math.min(previous, before)) score += 1;
    if (pct(high, current) >= 0.25) score += 1;
    if (pct(current, prices[index - 3]) < 0) score += 1;
    if (current > vwap * 0.9975) score += 1;
    if (ratio >= 0.8 && ratio <= 3) score += 1;
  }
  return score;
}

function openingDirection(points, index, previousClose, vwap) {
  if (!previousClose || index < 5) return null;
  const open = points[0].price;
  const gap = pct(open, previousClose);
  const current = points[index].price;
  const previous = points[index - 1].price;
  const lastThree = points.slice(index - 2, index + 1);
  const fiveMinuteBase = points[Math.max(0, index - 5)].price;
  const sessionToNow = points.slice(0, index + 1).map((point) => point.price);
  const recentMomentum = pct(current, fiveMinuteBase);
  const shortMomentum = pct(current, points[Math.max(0, index - 3)].price);
  const recoveredFromLow = pct(current, Math.min(...sessionToNow));
  const fadedFromHigh = pct(Math.max(...sessionToNow), current);
  const aboveVwap = lastThree.filter((point) => point.price > vwap).length;
  const belowVwap = lastThree.filter((point) => point.price < vwap).length;

  // The first 15 minutes carry much of the opening auction's price discovery.
  // From 09:36 to 09:44 allow a small 1/6-position probe only after two
  // consecutive prices confirm the gap repair/fade, price crosses cumulative
  // VWAP, and the already-observed three-minute turn is large enough.  This is
  // deliberately causal: it never waits for or backfills a later peak/valley.
  const earlyOpening = index >= 6 && index < 15;
  const lastTwo = points.slice(index - 1, index + 1);
  if (earlyOpening
    && gap <= -0.30
    && lastTwo.every((point) => point.price > open)
    && current > vwap
    && current > previous
    && shortMomentum >= 0.22
    && recoveredFromLow >= 0.40
    && current <= previousClose * 1.001) {
    return { direction: "BUY_FIRST", regimeOverride: false, label: "早盘低开修复" };
  }
  if (earlyOpening
    && gap >= 0.30
    && lastTwo.every((point) => point.price < open)
    && current > vwap * 1.0015
    && current < previous
    && shortMomentum <= -0.22
    && fadedFromHigh >= 0.40
    && current >= previousClose * 0.999) {
    return { direction: "SELL_FIRST", regimeOverride: false, label: "早盘高开回落" };
  }

  // A near-flat auction can still produce a tradeable opening swing. Promote
  // only the stronger version during the early probe window; weaker flat-open
  // turns remain observations below. This covers stocks whose first ten
  // minutes expand sharply even though the auction itself was nearly flat.
  if (earlyOpening
    && Math.abs(gap) < 0.30
    && lastThree[2].price > lastThree[1].price
    && lastThree[1].price >= lastThree[0].price
    && aboveVwap >= 2
    && shortMomentum >= 0.28
    && recoveredFromLow >= 0.55
    && current <= vwap * 1.007) {
    return { direction: "BUY_FIRST", regimeOverride: false, candidateOnly: true, label: "平开早盘转强观察" };
  }
  if (earlyOpening
    && Math.abs(gap) < 0.30
    && lastThree[2].price < lastThree[1].price
    && lastThree[1].price <= lastThree[0].price
    && belowVwap >= 2
    && shortMomentum <= -0.28
    && fadedFromHigh >= 0.55
    && current >= vwap * 0.993) {
    return { direction: "SELL_FIRST", regimeOverride: false, candidateOnly: true, label: "平开早盘转弱观察" };
  }

  // From 09:45 onward require three consecutive, already-observed
  // confirmations before overriding a lagging opening regime label. No
  // session high/low after the current minute is read.
  if (index >= 15
    && gap <= -0.30
    && lastThree.every((point) => point.price > open)
    && aboveVwap >= 2
    && current > previous
    && recentMomentum >= 0.35
    && recoveredFromLow >= 0.55) {
    return {
      direction: "BUY_FIRST",
      regimeOverride: false,
      candidateOnly: true,
      label: "低开修复候选",
    };
  }
  if (index >= 15
    && gap >= 0.30
    && lastThree.every((point) => point.price < open)
    && belowVwap >= 2
    && current < previous
    && recentMomentum <= -0.35
    && fadedFromHigh >= 0.55) {
    return {
      direction: "SELL_FIRST",
      regimeOverride: false,
      candidateOnly: true,
      label: "高开回落候选",
    };
  }

  // A flat open can still produce a real intraday reversal. Keep these as
  // observation candidates first: useful to the live desk, but not promoted
  // merely because hindsight later reveals a wide swing.
  if (Math.abs(gap) < 0.30
    && lastThree[2].price > lastThree[1].price
    && lastThree[1].price >= lastThree[0].price
    && aboveVwap >= 2
    && shortMomentum >= 0.20
    && recoveredFromLow >= 0.45
    && current <= vwap * 1.0045) {
    return { direction: "BUY_FIRST", regimeOverride: false, candidateOnly: true, label: "平开低位转强" };
  }
  if (Math.abs(gap) < 0.30
    && lastThree[2].price < lastThree[1].price
    && lastThree[1].price <= lastThree[0].price
    && belowVwap >= 2
    && shortMomentum <= -0.20
    && fadedFromHigh >= 0.45
    && current >= vwap * 0.9955) {
    return { direction: "SELL_FIRST", regimeOverride: false, candidateOnly: true, label: "平开冲高转弱" };
  }
  return null;
}

function estimatedEdgePct(points, index, direction, vwap) {
  const current = points[index].price;
  const recent = points.slice(Math.max(0, index - 20), index + 1).map((point) => point.price);
  if (direction === "BUY_FIRST") return Math.max(pct(vwap, current), pct(Math.max(...recent), current) * 0.55);
  return Math.max(pct(current, vwap), pct(current, Math.min(...recent)) * 0.55);
}

function orderCosts(side, price, quantity, options) {
  const turnover = price * quantity;
  const commission = Math.max(options.minCommission ? 5 : 0, turnover * options.feeRate / 100);
  const stamp = side === "卖出" ? turnover * 0.0005 : 0;
  return commission + stamp;
}

function slipFor(price, options) {
  return options.slippageMode === "tick" ? options.slippage : price * options.slippage / 100;
}

function emptyResult(capital, status, diagnostics = {}) {
  return { net: 0, gross: 0, fees: 0, executionCost: 0, maxDrawdown: 0, trades: 0, wins: 0, days: 0, curve: [capital], curveTimes: [], cycleNets: [], candidateCycles: [], openCandidate: null, startTime: "", status, actions: [], observations: [], diagnostics, gateAudit: null };
}

// Research-only counterfactual audit. It runs after the causal replay has
// finished and cannot feed any value back into entry or exit decisions.
// A rejected candidate is called "favourable" only when the already-known
// entry price would have reached its own after-cost required edge within the
// next 30 tradable minutes.
function buildGateAudit(points, rejectedCandidates) {
  const gateStats = {};
  let favourableRejected = 0;

  for (const candidate of rejectedCandidates) {
    const future = points.slice(candidate.index + 1, candidate.index + 31);
    if (!future.length) continue;
    const prices = future.map((point) => point.price);
    const mfePct = candidate.direction === "BUY_FIRST"
      ? pct(Math.max(...prices), candidate.price)
      : pct(candidate.price, Math.min(...prices));
    const maePct = candidate.direction === "BUY_FIRST"
      ? Math.max(0, -pct(Math.min(...prices), candidate.price))
      : Math.max(0, -pct(candidate.price, Math.max(...prices)));
    const favourable = mfePct >= candidate.requiredEdge;
    if (favourable) favourableRejected += 1;

    for (const gate of candidate.failedGates) {
      const current = gateStats[gate] ?? {
        rejected: 0,
        soleReject: 0,
        favourable: 0,
        soleFavourable: 0,
        mfePctSum: 0,
        maePctSum: 0,
      };
      current.rejected += 1;
      current.favourable += favourable ? 1 : 0;
      current.mfePctSum += mfePct;
      current.maePctSum += maePct;
      if (candidate.failedGates.length === 1) {
        current.soleReject += 1;
        current.soleFavourable += favourable ? 1 : 0;
      }
      gateStats[gate] = current;
    }
  }

  const gates = Object.fromEntries(Object.entries(gateStats).map(([gate, stats]) => [
    gate,
    {
      rejected: stats.rejected,
      soleReject: stats.soleReject,
      favourable: stats.favourable,
      favourableRate: stats.rejected ? stats.favourable / stats.rejected : 0,
      soleFavourable: stats.soleFavourable,
      soleFavourableRate: stats.soleReject ? stats.soleFavourable / stats.soleReject : 0,
      averageMfePct: stats.rejected ? stats.mfePctSum / stats.rejected : 0,
      averageMaePct: stats.rejected ? stats.maePctSum / stats.rejected : 0,
    },
  ]));

  return {
    mode: "research-only-post-replay",
    horizonMinutes: 30,
    rejectedCandidateMinutes: rejectedCandidates.length,
    auditedCandidateMinutes: rejectedCandidates.filter((candidate) => candidate.index + 1 < points.length).length,
    favourableRejected,
    gates,
  };
}

// Candidate points are an observation layer, not simulated orders. Pair only
// a later, independently emitted opposite-side candidate. The entry marker is
// never moved or rewritten, and an unpaired candidate stays explicitly open
// instead of receiving a fabricated end-of-day exit.
function buildCandidateObservationCycles(observations = []) {
  const candidates = observations
    .map((observation, index) => ({ observation, index }))
    .filter(({ observation }) => observation?.stage === "candidate"
      && Number.isFinite(observation.price)
      && (observation.direction === "正T" || observation.direction === "反T"))
    .sort((left, right) => left.observation.time.localeCompare(right.observation.time) || left.index - right.index)
    .map(({ observation }) => observation);
  const cycles = [];
  let open = null;
  for (const candidate of candidates) {
    if (!open) {
      open = candidate;
      continue;
    }
    if (candidate.direction === open.direction) continue;
    const grossPct = open.direction === "正T"
      ? pct(candidate.price, open.price)
      : pct(open.price, candidate.price);
    cycles.push({
      id: cycles.length + 1,
      direction: open.direction,
      entryTime: open.time,
      entryPrice: open.price,
      entryLabel: open.direction === "正T" ? "候补买入" : "候补卖出",
      exitTime: candidate.time,
      exitPrice: candidate.price,
      exitLabel: open.direction === "正T" ? "候补卖出" : "候补买回",
      grossPct,
      favorable: grossPct > 0,
      status: grossPct > 0 ? "观察有利" : grossPct < 0 ? "观察不利" : "观察持平",
    });
    open = null;
  }
  return {
    cycles,
    open: open ? {
      direction: open.direction,
      time: open.time,
      price: open.price,
      label: open.direction === "正T" ? "候补买入待卖出" : "候补卖出待买回",
      status: "候补未闭环",
    } : null,
  };
}

/**
 * @param {{time:string,price:number,volume:number}[]} minutes
 * @param {{capital:number,baseShares:number,sellable:number,feeRate:number,slippage:number,minCommission:boolean,slippageMode:"percent"|"tick",forceCloseTime:string,profile?:string,profileOverrides?:Record<string,number>,minimumNetProfitAmount?:number,minimumGrossSpreadAmount?:number,previousClose?:number|null,randomValue?:number,strategyVersion?:string,gateAudit?:boolean,volatilityMode?:"fixed"|"causal-realized"}} options
 */
export function runSmartTReplay(minutes, options) {
  const points = sanitize(minutes);
  const profile = { ...(PROFILES[options.profile] ?? PROFILES["平衡档"]), ...(options.profileOverrides ?? {}) };
  const normalQuantity = roundLot(Math.min(options.baseShares, options.sellable) / 3);
  const openingQuantity = roundLot(Math.min(options.baseShares, options.sellable) / 6);
  // Gate only on data already available at the current decision window.
  // Requiring a future end-of-array length here made a 09:45 signal appear
  // in the full-day replay but disappear from the same 09:45 live prefix.
  // A missing simulated position must block orders, not market analysis.  The
  // desk and replay still need to expose causal candidate points and their
  // blockers when baseShares/sellable is zero.  Quantity is checked again at
  // the execution gate below, so no order can be created without a 100-share
  // lot.
  if (points.length < 6) return emptyResult(options.capital, "真实分时样本不足，未生成交易");

  // A live monitor and a full-day single-stock replay must evaluate every
  // causal minute after the opening-noise window. Starting from a random
  // later point hid valid early-session reversals (for example, a 09:35
  // recovery followed by a 09:50 fade) even though no future data was used.
  // Start the causal watch layer after three completed one-minute points.
  // 09:30 starts data collection; 09:33 is therefore the earliest minute at
  // which a VWAP displacement may be shown. Formal opening orders still keep
  // their independent 09:36+ confirmation gate in `openingDirection`.
  const revealStart = Math.min(points.length - 1, 3);
  const vwaps = points.map((_, index) => cumulativeVwap(points, index));
  let cash = options.capital;
  let peak = cash;
  let maxDrawdown = 0;
  let gross = 0;
  let fees = 0;
  let executionCost = 0;
  let wins = 0;
  let consecutiveLosses = 0;
  let lastExitMinute = -10_000;
  let position = null;
  let cycleState = createTCycleState();
  let bestMove = 0;
  let bestProjectedNetPct = Number.NEGATIVE_INFINITY;
  let bestProjectedNet = Number.NEGATIVE_INFINITY;
  let bestGrossSpreadAmount = Number.NEGATIVE_INFINITY;
  let candidates = 0;
  let costBlocked = 0;
  let cashBlocked = 0;
  let regimeBlocked = 0;
  let cycleConflicts = 0;
  let shadowDirectionBlocked = 0;
  let shadowLunchRestartBlocked = 0;
  let shadowQualityBlocked = 0;
  let strongTrendBlocked = 0;
  let strongSellTrendBlocked = 0;
  let strongBuyTrendBlocked = 0;
  let fallingKnifeBlocked = 0;
  let risingKnifeBlocked = 0;
  let counterTrendQualityBlocked = 0;
  let scoreBlocked = 0;
  let structureBlocked = 0;
  let qualityBlocked = 0;
  let timingBlocked = 0;
  let candidateOnlyBlocked = 0;
  let openingChaseBlocked = 0;
  let openingRepairAgeBlocked = 0;
  let highGapCollapseBlocked = 0;
  let broadDowntrendBuyBlocked = 0;
  let openingUsed = 0;
  let openingRegimeOverrides = 0;
  let lastObservationMinute = -10_000;
  const lastQualifiedObservationByDirection = new Map();
  const lastTrendContinuationRiskMinuteByDirection = new Map();
  let orderFlowAvailablePoints = 0;
  let orderFlowBlocked = 0;
  let buybackFlowBlocked = 0;
  let divergenceObservations = 0;
  let divergenceEvidence = 0;
  let divergenceCombined = 0;
  let divergenceConflicts = 0;
  let volatilityAdaptivePoints = 0;
  let volatilityScaleSum = 0;
  let volatilityScaleMin = Number.POSITIVE_INFINITY;
  let volatilityScaleMax = Number.NEGATIVE_INFINITY;
  let realisedVolatilityPctSum = 0;
  const actions = [];
  const observations = [];
  const rejectedGateCandidates = [];
  const observationCounts = { morning: 0, afternoon: 0 };
  const deviationWatchByDirection = new Map();
  const cycleNets = [];
  const curve = [cash];
  const curveTimes = [points[revealStart].time];

  for (let index = revealStart; index < points.length; index += 1) {
    const point = points[index];
    const nowMinute = minutesFromOpen(point.time);
    cycleState = refreshTCycleState(cycleState, nowMinute, profile.cooldown);
    const vwap = vwaps[index];
    const ratio = volumeRatio(points, index);
    const regime = causalRegime(points, index, vwaps);
    const cyclePreference = causalCyclePreference(points, index, vwaps, options.previousClose);
    const volatility = options.volatilityMode === "causal-realized"
      ? causalVolatilityScale(points, index, {
        window: profile.volatilityWindow ?? 30,
        referencePct: profile.realisedVolatilityReferencePct ?? 0.12,
        minScale: profile.volatilityMinScale ?? 0.80,
        maxScale: profile.volatilityMaxScale ?? 1.30,
        minSamples: profile.volatilityMinSamples ?? 10,
      })
      : { scale: 1, realisedPct: 0, samples: 0 };
    const volatilityScale = volatility.scale;
    const effectiveDeviation = profile.deviation * volatilityScale;
    const effectiveReversal = profile.reversal * volatilityScale;
    if (options.volatilityMode === "causal-realized"
      && volatility.samples >= (profile.volatilityMinSamples ?? 10)) {
      volatilityAdaptivePoints += 1;
      volatilityScaleSum += volatilityScale;
      volatilityScaleMin = Math.min(volatilityScaleMin, volatilityScale);
      volatilityScaleMax = Math.max(volatilityScaleMax, volatilityScale);
      realisedVolatilityPctSum += volatility.realisedPct;
    }

    // The morning session is the main T-trading opportunity window. Surface a
    // large displacement from cumulative VWAP immediately, before a reversal
    // is confirmed, so the desk can prepare without pretending the current
    // point is already a known peak or valley. This marker is causal, never
    // executable and never backfilled to an earlier minute.
    const deviation = pct(point.price, vwap);
    const watchWindow = (point.time >= "0933" && point.time <= "1110") || (point.time >= "1300" && point.time <= "1430");
    const watchDeviation = Math.max(0.35, effectiveDeviation * 0.65);
    const watchDirection = deviation <= -watchDeviation
      ? "BUY_FIRST"
      : deviation >= watchDeviation
        ? "SELL_FIRST"
        : null;
    const previousDeviationWatch = watchDirection
      ? deviationWatchByDirection.get(watchDirection)
      : null;
    const session = point.time >= "1300" ? "afternoon" : "morning";
    const deviationWatchIsDistinct = !previousDeviationWatch || (
      nowMinute - previousDeviationWatch.minute >= 30
      && (
        previousDeviationWatch.session !== session
        || Math.abs(deviation) >= previousDeviationWatch.absoluteDeviation + 0.15
      )
    );
    if (!position
      && watchWindow
      && watchDirection
      && deviationWatchIsDistinct
      && observations.length < MAX_DAILY_OBSERVATIONS
      && observationCounts[session] < MAX_SESSION_OBSERVATIONS) {
      const edge = estimatedEdgePct(points, index, watchDirection, vwap);
      observations.push({
        time: point.time,
        price: point.price,
        direction: watchDirection === "BUY_FIRST" ? "正T" : "反T",
        score: 0,
        threshold: profile.score,
        edge,
        executable: false,
        stage: "watch",
        pairGap: null,
        pivotTime: point.time,
        pivotPrice: point.price,
        pivotLabel: watchDirection === "BUY_FIRST" ? "当前低位偏离" : "当前高位偏离",
        pivotAssessment: "unconfirmed",
        confirmationLabel: watchDirection === "BUY_FIRST" ? "低位偏离" : "高位偏离",
        blockers: [
          "价格仅达到 VWAP 偏离观察线",
          watchDirection === "BUY_FIRST"
            ? "等待止跌、量能回升和微型结构转强"
            : "等待滞涨、量能转弱和微型结构转弱",
        ],
        reason: `${watchDirection === "BUY_FIRST" ? "向下" : "向上"}偏离 VWAP ${Math.abs(deviation).toFixed(2)}%；${ratio >= 1.8 ? "倍量" : "量比"} ${ratio.toFixed(2)}×，先预警、不执行`,
      });
      deviationWatchByDirection.set(watchDirection, {
        minute: nowMinute,
        session,
        absoluteDeviation: Math.abs(deviation),
      });
      observationCounts[session] += 1;
      lastObservationMinute = nowMinute;
    }

    const liquidEntryWindow = isLiquidEntryTime(point.time);
    if (!position && liquidEntryWindow && nowMinute - lastExitMinute >= profile.cooldown) {
      // Continue evaluating and explaining candidates after the configured
      // trade limit is reached. The limit blocks execution only; otherwise a
      // successful morning cycle made the afternoon chart look inactive.
      const executionQuotaAvailable = cycleNets.length < profile.maxCycles && consecutiveLosses < 2;
      const opening = point.time <= "1000";
      const openingSignal = opening ? openingDirection(points, index, options.previousClose, vwap) : null;
      let direction = openingSignal?.direction ?? null;
      const recent = points.slice(Math.max(0, index - 6), index + 1).map((item) => item.price);
      const recovered = pct(point.price, Math.min(...recent));
      const faded = pct(Math.max(...recent), point.price);
      if (!opening && deviation <= -effectiveDeviation && recovered >= effectiveReversal) direction = "BUY_FIRST";
      if (!opening && deviation >= effectiveDeviation && faded >= effectiveReversal) direction = "SELL_FIRST";

      if (direction) {
        candidates += 1;
        const score = directionScore(points, index, direction, vwap, ratio);
        const rawRegimeConflict = (direction === "BUY_FIRST" && regime === "downtrend") || (direction === "SELL_FIRST" && regime === "uptrend");
        // Global direction principle: buy-first (positive T) is preferred in
        // an up-cycle; sell-first (reverse T) is preferred in a down-cycle.
        // Counter-cycle setups need an extra, already-confirmed local turn;
        // otherwise they remain observations. Range cycles keep both sides.
        const cycleConflict = (direction === "BUY_FIRST" && cyclePreference === "downtrend")
          || (direction === "SELL_FIRST" && cyclePreference === "uptrend");
        const persistentDirection = causalPersistentDirection(points, index);
        const persistentDirectionConflict = (direction === "BUY_FIRST" && persistentDirection === "downtrend")
          || (direction === "SELL_FIRST" && persistentDirection === "uptrend");
        const v41Shadow = options.strategyVersion === "V4.1-shadow";
        const rangeEvidence = v41Shadow
          ? causalRangeEvidence(points, index, vwaps, profile)
          : { confirmed: true, crossings: 0, amplitude: 0, vwapDrift: 0 };
        // The first V4.1 audit keeps trend-following branches observational.
        // On the frozen 1,000 stock-day sample, only the already-confirmed
        // two-sided VWAP range branch retained a positive after-cost result.
        // Trend branches must earn their own out-of-sample gate before they
        // are allowed to create shadow fills.
        const shadowAllowAlignedTrend = (profile.shadowAllowAlignedTrend ?? 0) >= 1;
        const shadowDirectionAllowed = (cyclePreference === "range" && rangeEvidence.confirmed)
          || (shadowAllowAlignedTrend && !cycleConflict && cyclePreference !== "range");
        const lunchRestartWindow = point.time >= "1300" && point.time < "1330";
        const shadowDirectionEnabled = direction === "BUY_FIRST"
          ? (profile.shadowAllowBuyFirst ?? 1) >= 1
          : (profile.shadowAllowSellFirst ?? 1) >= 1;
        const shadowDirectionConflict = v41Shadow && (!shadowDirectionAllowed || !shadowDirectionEnabled);
        const shadowAllowAfternoon = (profile.shadowAllowAfternoon ?? 0) >= 1;
        const shadowMorningStart = profile.shadowMorningStartMinute ?? 15;
        const shadowMorningEnd = profile.shadowMorningEndMinute ?? 100;
        const shadowAfternoonStart = profile.shadowAfternoonStartMinute ?? 150;
        const shadowAfternoonEnd = profile.shadowAfternoonEndMinute ?? 200;
        const shadowInMorningWindow = nowMinute >= shadowMorningStart && nowMinute <= shadowMorningEnd;
        const shadowInAfternoonWindow = shadowAllowAfternoon
          && nowMinute >= shadowAfternoonStart
          && nowMinute <= shadowAfternoonEnd;
        const shadowLunchRestartConflict = v41Shadow && lunchRestartWindow && !shadowInAfternoonWindow;
        const shadowEntryWindowConflict = v41Shadow && !shadowInMorningWindow && !shadowInAfternoonWindow;
        const shadowLocationThreshold = Math.max(
          profile.shadowLocationFloor ?? 0.35,
          effectiveDeviation * (profile.shadowLocationFactor ?? 0.65),
        );
        const shadowLocationConflict = v41Shadow && (direction === "BUY_FIRST"
          ? deviation > -shadowLocationThreshold
          : deviation < shadowLocationThreshold);
        const shadowParticipationConflict = v41Shadow && ratio < (profile.shadowMinParticipation ?? 0.90);
        const shadowQualityConflict = shadowEntryWindowConflict || shadowLocationConflict || shadowParticipationConflict;
        const shadowConflict = shadowDirectionConflict || shadowLunchRestartConflict || shadowQualityConflict;
        if (shadowDirectionConflict) shadowDirectionBlocked += 1;
        if (shadowLunchRestartConflict) shadowLunchRestartBlocked += 1;
        if (shadowQualityConflict) shadowQualityBlocked += 1;
        const vwapMomentum15 = index >= 15 ? pct(vwap, vwaps[index - 15]) : 0;
        const vwapMomentum30 = index >= 30 ? pct(vwap, vwaps[index - 30]) : 0;
        const priceMomentum30 = index >= 30 ? pct(point.price, points[index - 30].price) : 0;
        const priceMomentum60 = index >= 60 ? pct(point.price, points[index - 60].price) : 0;
        const priceMomentum90 = index >= 90 ? pct(point.price, points[index - 90].price) : 0;
        const priorPriceMomentum30 = index >= 60
          ? pct(points[index - 30].price, points[index - 60].price)
          : 0;
        const priorPriceMomentum60 = index >= 90
          ? pct(points[index - 30].price, points[index - 90].price)
          : 0;
        const broadPriceWindow = points.slice(Math.max(0, index - 89), index + 1);
        const broadPricePoints = broadPriceWindow.length;
        const longPriceMean = mean(broadPriceWindow.map((item) => item.price));
        const longPriceMeanBias = pct(point.price, longPriceMean);
        const sessionMove = pct(point.price, points[0].price);
        const referenceMove = options.previousClose
          ? pct(point.price, options.previousClose)
          : sessionMove;
        // Direction and location must remain economically coherent. Opening
        // gap repair/fade labels may stay visible, but cannot execute after
        // crossing to the wrong side of VWAP.
        const vwapDirectionConflict = causalVwapDirectionConflict(
          direction,
          deviation,
          opening ? (direction === "BUY_FIRST" ? 0.49 : -0.08) : 0.08,
        );
        const openingDisplacementConflict = causalOpeningDisplacementConflict(
          opening,
          referenceMove,
        );
        // The short regime label can lag. Combine the causal 30-minute VWAP
        // slope with already-observed 60/90-minute price paths so a local
        // three-minute turn cannot buy a persistent decline or sell a
        // persistent rise.
        const broadTrendConflict = direction === "BUY_FIRST"
          ? vwapMomentum30 <= -0.06
            && ((priceMomentum60 <= -0.20
                && priorPriceMomentum30 <= -0.08
                && longPriceMeanBias <= -0.12)
              || (priceMomentum90 <= -0.35 && priorPriceMomentum60 <= -0.15))
          : vwapMomentum30 >= 0.06
            && ((priceMomentum60 >= 0.20
                && priorPriceMomentum30 >= 0.08
                && longPriceMeanBias >= 0.12)
              || (priceMomentum90 >= 0.35 && priorPriceMomentum60 >= 0.15));
        const pivotWindowStart = Math.max(0, index - 8);
        const pivotWindow = points.slice(pivotWindowStart, index + 1);
        const pivotPrice = direction === "SELL_FIRST"
          ? Math.max(...pivotWindow.map((item) => item.price))
          : Math.min(...pivotWindow.map((item) => item.price));
        const pivotOffset = pivotWindow.findIndex((item) => item.price === pivotPrice);
        const pivotIndex = pivotWindowStart + Math.max(0, pivotOffset);
        const pivotPoint = points[pivotIndex];
        const pivotAge = index - pivotIndex;
        const prePivotMove10 = pct(
          pivotPrice,
          points[Math.max(0, pivotIndex - 10)].price,
        );
        const pivotVwap = vwaps[pivotIndex] ?? vwap;
        const pivotVwapDeviation = pct(pivotPrice, pivotVwap);
        const pivotReversal = direction === "SELL_FIRST"
          ? pct(pivotPrice, point.price)
          : pct(point.price, pivotPrice);
        const crossedVwap = crossedVwapCausally({
          direction,
          pivotDeviation: pivotVwapDeviation,
          currentDeviation: deviation,
        });
        const openingQualityConflict = causalOpeningQualityConflict({
          opening,
          direction,
          deviation,
          sessionMove,
          pivotAge,
          maxRepairPremiumPct: profile.maxOpeningRepairPremiumPct,
          minRepairSessionMove: profile.minOpeningRepairSessionMove,
          maxRepairPremiumPivotAge: profile.maxOpeningRepairPremiumPivotAge,
          requireFadeVwapCross: profile.requireOpeningFadeVwapCross,
        });
        const openingRepairAgeConflict = causalOpeningRepairAgeConflict({
          opening,
          direction,
          pivotAge,
          deviation,
          maxPivotAge: profile.maxOpeningRepairPivotAge,
        });
        const highGapCollapseConflict = causalHighGapCollapseConflict({
          direction,
          sessionMove,
          referenceMove,
          deviation,
          vwapMomentum15,
        });
        const broadDowntrendBuyConflict = causalBroadDowntrendBuyConflict({
          opening,
          direction,
          crossedVwap,
          priceMomentum30,
          vwapMomentum15,
          vwapMomentum30,
          longPriceMeanBias,
        });
        const localMomentum3 = pct(point.price, points[Math.max(0, index - 3)].price);
        // A VWAP displacement is only a location, not a reversal. A formal
        // order also needs the already-observed three-minute move to point in
        // the intended direction while the 15-minute VWAP slope is no longer
        // pushing hard against it. Candidates remain visible when this fails.
        // All inputs are fixed at or before the current minute.
        const executionMomentumConfirmed = direction === "BUY_FIRST"
          ? localMomentum3 >= 0.03 && vwapMomentum15 >= -0.20
          : localMomentum3 <= -0.03 && vwapMomentum15 <= 0.20;
        // A reversal entry must be confirmed by a turn that has already
        // happened after an observed 8-minute pivot.  The old rule asked a
        // buy-at-a-valley to already be above its price 30 minutes earlier,
        // which confused the prevailing trend with the local turn and vetoed
        // legitimate causal recoveries.  This replacement never looks past
        // the current minute.
        const structuralConfirmation = opening || (
          pivotReversal >= effectiveReversal
          && vwapMomentum15 >= (direction === "BUY_FIRST" ? -0.20 : -Infinity)
          && vwapMomentum15 <= (direction === "SELL_FIRST" ? 0.20 : Infinity)
          && ratio >= (direction === "BUY_FIRST" ? profile.minBuyVolumeRatio : profile.minSellVolumeRatio)
          && ratio < 3
          && (direction === "BUY_FIRST" ? localMomentum3 >= profile.minMomentum3 : localMomentum3 <= -profile.minMomentum3)
        ) || (
          // Some liquid large caps reverse on ordinary volume after an
          // unusually wide deviation. Requiring both high relative volume
          // and the strict VWAP slope discarded these otherwise clear turns.
          // This alternative remains causal and deliberately requires either
          // an extra confirmation point or a materially wider displacement.
          !opening
          && pivotReversal >= effectiveReversal
          && ratio >= 0.35
          && ratio < 3
          && (score >= profile.score + 1 || Math.abs(deviation) >= effectiveDeviation + 0.18)
        );
        // A fully confirmed local turn may neutralise only the short regime
        // label.  It never overrides a persistent one-way session veto.
        const localRegimeBreak = !opening
          && structuralConfirmation
          && score >= profile.score
          && (crossedVwap || pivotReversal >= Math.max(0.32, effectiveReversal + 0.10));
        const shortTrendConflict = direction === "SELL_FIRST"
          ? sessionMove >= 1.20 && vwapMomentum15 >= 0.08 && point.price >= vwap * 1.002
          : sessionMove <= -1.20 && vwapMomentum15 <= -0.08 && point.price <= vwap * 0.998;
        // A small local pullback is not enough to reverse a persistent one-way
        // session.  The 30-minute VWAP slope is deliberately causal and keeps a
        // late, shallow dip above VWAP from becoming a formal counter-trend T.
        const persistentSessionConflict = direction === "SELL_FIRST"
          ? sessionMove >= 1.35 && vwapMomentum30 >= 0.10 && point.price >= vwap * 1.0035
          : sessionMove <= -1.35 && vwapMomentum30 <= -0.10 && point.price <= vwap * 0.9965;
        // Cumulative VWAP can lag after a fast directional expansion.  Protect
        // against treating a shallow two- or three-minute counter move as a
        // reversal while price is still extended on the strong side of VWAP.
        // This gate is causal: session move, current VWAP and current regime
        // are all fixed at the decision minute.
        const extendedSessionConflict = direction === "SELL_FIRST"
          ? sessionMove >= 1.50 && point.price >= vwap * 1.005 && regime !== "downtrend"
          : sessionMove <= -1.50 && point.price <= vwap * 0.995 && regime !== "uptrend";
        // A gap can make the move from today's open look flat even though the
        // stock remains strongly extended versus yesterday's close. Use the
        // known previous close as a second causal anchor so a small afternoon
        // fade cannot be mistaken for a safe reverse-T sale on a strong day.
        const referenceTrendConflict = direction === "SELL_FIRST"
          ? referenceMove >= 1.50 && vwapMomentum30 >= 0.10 && point.price >= vwap * 1.005
          : referenceMove <= -1.50 && vwapMomentum30 <= -0.10 && point.price <= vwap * 0.995;
        // A local three-minute turn is not enough when the broader intraday
        // VWAP is still accelerating in the opposite direction. These gates
        // use only values fixed at the current minute. The asymmetric sell
        // threshold is intentional: selling inventory into a strong A-share
        // rise carries additional sell-fly risk.
        const directionalTrendConflict = direction === "SELL_FIRST"
          ? sessionMove >= (profile.strongSellSessionMove ?? 0.90)
            && vwapMomentum30 >= (profile.strongSellVwap30 ?? 0.30)
            && point.price >= vwap * 1.002
          : sessionMove <= -(profile.strongBuySessionMove ?? 0.60)
            && vwapMomentum30 <= -(profile.strongBuyVwap30 ?? 0.30)
            && point.price <= vwap * 0.998;
        const strongSessionConflict = shortTrendConflict
          || persistentSessionConflict
          || extendedSessionConflict
          || referenceTrendConflict
          || directionalTrendConflict;
        if (strongSessionConflict) {
          strongTrendBlocked += 1;
          if (direction === "SELL_FIRST") strongSellTrendBlocked += 1;
          if (direction === "BUY_FIRST") strongBuyTrendBlocked += 1;
        }
        const trendContinuationRisk = detectTrendContinuationConflict({
          direction,
          currentDeviation: deviation,
          crossedVwap,
          vwapMomentum15,
          vwapMomentum30,
          sessionMove,
          prePivotMove10,
          pivotAge,
          pivotReversal,
          priceMomentum30,
          priceMomentum60,
          priceMomentum90,
          longPriceMeanBias,
          broadPricePoints,
          profile,
        });
        const trendContinuationNeedsCooldown = direction === "BUY_FIRST"
          ? trendContinuationRisk.blocked && (
            trendContinuationRisk.broadVwapDecline
            || trendContinuationRisk.weakSessionDecline
            || trendContinuationRisk.rapidDeclineUnconfirmed
            || trendContinuationRisk.persistentPriceDecline
            || trendContinuationRisk.earlyPersistentDecline
            || trendContinuationRisk.latePersistentDecline
            || trendContinuationRisk.lateRecoveryDecline
          )
          : trendContinuationRisk.blocked && (
            trendContinuationRisk.broadVwapRise
            || trendContinuationRisk.strongSessionRise
            || trendContinuationRisk.rapidRiseUnconfirmed
            || trendContinuationRisk.lateDowntrendSell
            || trendContinuationRisk.weakSessionLateSell
            || trendContinuationRisk.earlyPersistentRise
            || trendContinuationRisk.latePersistentRise
            || trendContinuationRisk.lateRecoveryRise
          );
        if (trendContinuationRisk.blocked) {
          if (direction === "BUY_FIRST") fallingKnifeBlocked += 1;
          else risingKnifeBlocked += 1;
        }
        if (trendContinuationNeedsCooldown) {
          lastTrendContinuationRiskMinuteByDirection.set(direction, nowMinute);
        }
        const recentTrendContinuationRisk = isTrendRiskCooling(
          lastTrendContinuationRiskMinuteByDirection.get(direction),
          nowMinute,
          8,
        );
        // The broad cycle is a hard execution gate for every V4 variant.
        // A local rebound inside an established down-cycle is not yet a
        // positive-T entry, and a local fade inside an up-cycle is not yet a
        // reverse-T sale. Both setups remain visible in the observation layer,
        // but they cannot create a formal order until the causal cycle vote
        // changes. This prevents a short local turn from buying a falling
        // trend (or selling a rising trend) without using future data.
        if (cycleConflict) cycleConflicts += 1;
        // An opening-gap repair may override a lagging short regime label, but
        // it must never bypass the broad-cycle direction or a persistent
        // one-way trend veto.
        const regimeConflict = cycleConflict
          || (persistentDirectionConflict && !localRegimeBreak)
          || vwapDirectionConflict
          || broadTrendConflict
          || strongSessionConflict
          || ((rawRegimeConflict && !localRegimeBreak) && !openingSignal?.regimeOverride);
        if (((rawRegimeConflict && !localRegimeBreak) || strongSessionConflict) && openingSignal?.regimeOverride) openingRegimeOverrides += 1;
        if (regimeConflict) regimeBlocked += 1;
        let edge = estimatedEdgePct(points, index, direction, vwap);
        if (opening && options.previousClose) {
          const gapRecoverySpace = direction === "BUY_FIRST"
            ? pct(options.previousClose, point.price)
            : pct(point.price, options.previousClose);
          edge = Math.max(edge, gapRecoverySpace);
        }
        const plannedQuantity = opening ? openingQuantity : normalQuantity;
        let quantity = plannedQuantity;
        if (direction === "BUY_FIRST") {
          const estimatedEntry = point.price + slipFor(point.price, options);
          while (quantity >= 100 && estimatedEntry * quantity + orderCosts("买入", estimatedEntry, quantity, options) > options.capital) quantity -= 100;
          if (quantity < 100) cashBlocked += 1;
        }
        const approximateCosts = quantity >= 100
          ? ((orderCosts("买入", point.price, quantity, options) + orderCosts("卖出", point.price, quantity, options)) / (point.price * quantity) * 100) + (options.slippageMode === "tick" ? options.slippage / point.price * 200 : options.slippage * 2)
          : Number.POSITIVE_INFINITY;
        const minimumNetProfitAmount = Math.max(0, Number(options.minimumNetProfitAmount) || 0);
        const minimumGrossSpreadAmount = Math.max(0, Number(options.minimumGrossSpreadAmount) || 0);
        const minimumNetProfitPct = quantity >= 100
          ? minimumNetProfitAmount / Math.max(1, point.price * quantity) * 100
          : Number.POSITIVE_INFINITY;
        const minimumGrossSpreadPct = minimumGrossSpreadAmount / Math.max(0.01, point.price) * 100;
        const candidateRequiredEdge = Math.max(
          profile.candidateNetPct + approximateCosts,
          minimumNetProfitPct + approximateCosts,
          minimumGrossSpreadPct,
        );
        // Entry still uses the profile's economic-viability estimate so live
        // opportunities do not disappear merely because a local edge model is
        // conservative. The completed leg may take profit only after the
        // independently calculated after-cost target is actually reached.
        // Every opening-window order must already cover the selected after-cost
        // target. 09:25 only forms a plan and 09:36-09:44 uses a smaller size;
        // neither is allowed to lower the economic bar simply to create trades.
        const requiredEdge = opening
          ? Math.max(profile.targetNetPct + approximateCosts, minimumNetProfitPct + approximateCosts, minimumGrossSpreadPct)
          : candidateRequiredEdge;
        const recentRange = pct(Math.max(...recent), Math.min(...recent));
        const rewardRisk = edge / Math.max(0.18, recentRange * 0.28);
        const candidateScoreFloor = Math.max(2, profile.score - 1);
        const oppositeDirection = direction === "BUY_FIRST" ? "SELL_FIRST" : "BUY_FIRST";
        const oppositeCandidate = lastQualifiedObservationByDirection.get(oppositeDirection) ?? null;
        const pairGap = oppositeCandidate
          ? (direction === "BUY_FIRST"
              ? pct(oppositeCandidate.price, point.price)
              : pct(point.price, oppositeCandidate.price))
          : null;
        const pairEconomicallyDistinct = !oppositeCandidate || pairGap >= candidateRequiredEdge;
        const directionFlipConfirmed = confirmCandidateDirectionFlip({
          oppositeCandidate,
          pairEconomicallyDistinct,
          nowMinute,
          cooldown: profile.cooldown,
          minimumFlipMinutes: profile.candidateFlipMinutes,
          structuralConfirmation,
          executionMomentumConfirmed,
        });
        const candidateQualified = score >= candidateScoreFloor
          && edge >= candidateRequiredEdge
          && rewardRisk >= 1.2
          && pairEconomicallyDistinct;
        if (candidateQualified) {
          lastQualifiedObservationByDirection.set(direction, {
            direction,
            price: point.price,
            minute: nowMinute,
            time: point.time,
          });
        }
        // Keep the candidate layer wider than the execution layer. A setup
        // may be worth watching even when the prevailing trend still blocks
        // a trade; the blocker remains visible and `executable` stays false.
        const turnConfirmed = candidateQualified
          && !regimeConflict
          && structuralConfirmation
          && pivotReversal >= effectiveReversal
          && (crossedVwap || ratio >= 0.9);
        const pivotAssessment = strongSessionConflict ? "strong" : turnConfirmed ? "confirmed" : "unconfirmed";
        const pivotLabel = direction === "SELL_FIRST"
          ? (strongSessionConflict ? "强势高位参考" : turnConfirmed ? "此前高位已转弱" : "此前高位参考")
          : (strongSessionConflict ? "弱势低位参考" : turnConfirmed ? "此前低位已转强" : "此前低位参考");
        const confirmationLabel = direction === "SELL_FIRST"
          ? (strongSessionConflict ? "高位候选" : turnConfirmed ? "转弱确认" : "回落观察")
          : (strongSessionConflict ? "低位候选" : turnConfirmed ? "转强确认" : "反弹观察");
        // A causal sell confirmation must arrive after the observed peak, but
        // it must not chase a decline that has already surrendered most of the
        // available T spread. Opening-gap overrides keep their own stricter
        // multi-minute rules and are intentionally exempt here.
        const entryTimingValid = opening || direction === "BUY_FIRST" || pivotReversal <= profile.maxSellPullback;
        // Opening gaps can reverse violently. Once the already-observed move
        // away from the local opening pivot is too large, keep the setup on
        // screen but do not chase it with a formal order.
        const openingChaseConflict = opening && pivotReversal > (profile.maxOpeningChasePct ?? 0.90);
        // A local turn against a still-rising/falling 30-minute VWAP needs
        // participation. Without enough relative volume it is usually only a
        // pause in the prevailing move, not a tradable reversal. This gate is
        // causal and deliberately keeps the setup in the candidate layer.
        const counterTrendQualityConflict = direction === "SELL_FIRST"
          ? vwapMomentum30 >= (profile.counterTrendVwap30 ?? Number.POSITIVE_INFINITY)
            && sessionMove >= (profile.counterTrendSessionMove ?? Number.POSITIVE_INFINITY)
            && ratio < (profile.counterTrendMinVolumeRatio ?? 0)
          : vwapMomentum30 <= -(profile.counterTrendVwap30 ?? Number.POSITIVE_INFINITY)
            && sessionMove <= -(profile.counterTrendSessionMove ?? Number.POSITIVE_INFINITY)
            && ratio < (profile.counterTrendMinVolumeRatio ?? 0);
        // A small afternoon rebound/fade is often only a pause inside the
        // prevailing one-way move. Keep it visible as a candidate, but do not
        // execute while the causal 30-minute price path and VWAP slope still
        // agree against the proposed trade.
        const afternoonTrendConflict = causalAfternoonTrendConflict({
          session,
          time: point.time,
          direction,
          vwapMomentum30,
          priceMomentum30,
        });
        const formalEntryWindowConflict = causalFormalEntryWindowConflict(point.time);
        const trendImpulseConflict = causalTrendImpulseConflict({
          opening,
          direction,
          crossedVwap,
          vwapMomentum15,
          priceMomentum30,
          prePivotMove10,
          pivotReversal,
        });
        const weakRecoveryConflict = causalWeakRecoveryConflict({
          opening,
          direction,
          crossedVwap,
          deviation,
          vwapMomentum30,
          priceMomentum30,
          prePivotMove10,
          pivotReversal,
          longPriceMeanBias,
          broadPricePoints,
        });
        const thirtyMinuteTrendShieldConflict = causalThirtyMinuteTrendShieldConflict({
          opening,
          direction,
          crossedVwap,
          deviation,
          priceMomentum30,
          longPriceMeanBias,
          broadPricePoints,
        });
        const orderFlow = evaluateQmtOrderFlow(points, index, direction);
        // Divergence is deliberately shadow-only. It may explain or classify
        // an existing V4 candidate, but it cannot create an order or override
        // the trend, VWAP, structure, cost or state-machine gates.
        const divergenceAlignedEvidence = evaluateIntradayDivergence(points, index, direction);
        const divergenceOpposingEvidence = evaluateIntradayDivergence(points, index, oppositeDirection);
        const divergenceShadow = {
          status: divergenceAlignedEvidence.aligned
            ? "aligned"
            : divergenceOpposingEvidence.aligned
              ? "conflict"
              : "neutral",
          aligned: divergenceAlignedEvidence,
          opposing: divergenceOpposingEvidence,
        };
        if (orderFlow.available) orderFlowAvailablePoints += 1;
        if (orderFlow.available && !orderFlow.pass) orderFlowBlocked += 1;
        if (edge < requiredEdge || rewardRisk < profile.minRewardRisk) costBlocked += 1;
        if (score < profile.score) scoreBlocked += 1;
        if (!structuralConfirmation) structureBlocked += 1;
        if (!executionMomentumConfirmed) qualityBlocked += 1;
        if (!entryTimingValid) timingBlocked += 1;
        if (openingChaseConflict) openingChaseBlocked += 1;
        if (openingRepairAgeConflict) openingRepairAgeBlocked += 1;
        if (highGapCollapseConflict) highGapCollapseBlocked += 1;
        if (broadDowntrendBuyConflict) broadDowntrendBuyBlocked += 1;
        if (counterTrendQualityConflict) counterTrendQualityBlocked += 1;
        if (openingSignal?.candidateOnly) candidateOnlyBlocked += 1;

        const executionGates = {
          executionQuota: executionQuotaAvailable,
          openingCandidateOnly: !openingSignal?.candidateOnly,
          openingDisplacement: !openingDisplacementConflict,
          openingQuality: !openingQualityConflict,
          openingRepairAge: !openingRepairAgeConflict,
          openingChase: !openingChaseConflict,
          highGapCollapse: !highGapCollapseConflict,
          broadDowntrendBuy: !broadDowntrendBuyConflict,
          counterTrendQuality: !counterTrendQualityConflict,
          formalEntryWindow: !formalEntryWindowConflict,
          afternoonTrend: !afternoonTrendConflict,
          trendImpulse: !trendImpulseConflict,
          weakRecovery: !weakRecoveryConflict,
          thirtyMinuteTrendShield: !thirtyMinuteTrendShieldConflict,
          trendContinuation: !trendContinuationRisk.blocked && !recentTrendContinuationRisk,
          shadowPolicy: !shadowConflict,
          quantity: quantity >= 100,
          score: score >= profile.score,
          structure: structuralConfirmation,
          momentum: executionMomentumConfirmed,
          directionFlip: directionFlipConfirmed,
          regime: !regimeConflict,
          edge: edge >= requiredEdge,
          rewardRisk: rewardRisk >= profile.minRewardRisk,
          timing: entryTimingValid,
          orderFlow: orderFlow.pass,
          cycleReady: cycleState.phase === "READY",
          openingQuota: !opening || openingUsed < 2,
        };
        const failedGateNames = Object.entries(executionGates)
          .filter(([, passed]) => !passed)
          .map(([gate]) => gate);
        const executable = failedGateNames.length === 0;
        if (options.gateAudit && !executable) {
          rejectedGateCandidates.push({
            index,
            time: point.time,
            direction,
            price: point.price,
            requiredEdge,
            failedGates: failedGateNames,
          });
        }
        if (nowMinute - lastObservationMinute >= 8
          && observations.length < MAX_DAILY_OBSERVATIONS
          && observationCounts[session] < MAX_SESSION_OBSERVATIONS) {
          const blockers = [];
          if (score < profile.score) blockers.push(`确认分 ${score}/${profile.score}`);
          if (!structuralConfirmation) blockers.push("量价结构未确认");
          if (!executionMomentumConfirmed) blockers.push("3分钟反转或15分钟VWAP斜率未确认");
          if (!directionFlipConfirmed) blockers.push(oppositeCandidate?.direction === "SELL_FIRST"
            ? "此前候补卖点尚未失效，等待充分回落并确认转强后再切换正T"
            : "此前候补买点尚未失效，等待充分反弹并确认转弱后再切换反T");
          if (cycleConflict) blockers.push(cyclePreference === "uptrend"
            ? "上行周期只观察反T，优先等待正T机会"
            : "下行周期只观察正T，优先等待反T机会");
          if (shadowDirectionConflict) blockers.push(cyclePreference === "range"
            ? "震荡结构尚未形成双向穿越 VWAP 的历史证据"
            : "趋势分支尚未通过样本外验证，影子版暂只执行已确认震荡回归");
          if (shadowLunchRestartConflict) blockers.push("午后重启前30分钟仅观察，等待连续行情重新形成");
          if (shadowEntryWindowConflict) blockers.push("影子版正式入场仅开放 09:45–11:10，其他时段保留观察");
          if (shadowLocationConflict) blockers.push(direction === "BUY_FIRST"
            ? "价格已离开 VWAP 下方低吸区，不追正T"
            : "价格已离开 VWAP 上方高抛区，不追反T");
          if (shadowParticipationConflict) blockers.push(`量比 ${ratio.toFixed(2)}× 未达到影子版 0.90× 参与门槛`);
          if (strongSessionConflict) blockers.push(direction === "SELL_FIRST"
            ? "强势结构未转弱，价格仍受 VWAP 或上行趋势支撑"
            : "弱势结构未扭转，价格尚未站稳 VWAP 或关键参考位");
          else if (regimeConflict) blockers.push("趋势方向冲突");
          if (edge < requiredEdge) blockers.push(`净价差 ${edge.toFixed(2)}% 未过成本线`);
          if (rewardRisk < profile.minRewardRisk) blockers.push(`盈亏比 ${rewardRisk.toFixed(2)} 未达 ${profile.minRewardRisk.toFixed(2)}`);
          if (!entryTimingValid) blockers.push(`已离此前高位回落 ${pivotReversal.toFixed(2)}%，不在低位追卖`);
          if (openingChaseConflict) blockers.push(`开盘局部反转已走 ${pivotReversal.toFixed(2)}%，超过追单上限，保留观察但不执行`);
          if (counterTrendQualityConflict) blockers.push("30分钟均价线趋势尚未反转，反向量能不足，保留候选但不执行");
          if (afternoonTrendConflict) blockers.push(direction === "BUY_FIRST"
            ? "午后30分钟价格与VWAP仍同步下行，仅观察反弹，不在下跌途中买入"
            : "午后30分钟价格与VWAP仍同步上行，仅观察回落，不在上涨途中卖出");
          if (broadDowntrendBuyConflict) blockers.push("30分钟价格路径与VWAP仍同步下行，正T买入仅保留观察");
          if (weakRecoveryConflict) blockers.push("Directional extension has not formed a confirmed causal reversal");
          if (trendContinuationRisk.blocked) blockers.push(trendContinuationRisk.reason);
          else if (recentTrendContinuationRisk) blockers.push("此前广义下行/上行风险刚触发，需连续确认 8 分钟后才允许新开仓");
          if (quantity < 100) blockers.push("可用资金或股数不足");
          if (!executionQuotaAvailable) blockers.push(consecutiveLosses >= 2 ? "当日连续失败已达 2 次，仅保留观察" : "已达到当日正式闭环上限，仅保留观察");
          if (openingSignal?.candidateOnly) blockers.push("平开波段先进入候选观察，等待正式过滤确认");
          if (openingDisplacementConflict) blockers.push("开盘相对昨收偏离不足 1.00%，仅保留候选观察");
          if (openingQualityConflict) blockers.push(direction === "BUY_FIRST"
            ? "低开修复尚未形成有效量价确认，仅保留候选观察"
            : "高开回落尚未跌穿 VWAP，仅保留候选观察");
          if (orderFlow.available && !orderFlow.pass) blockers.push(`QMT order flow ${orderFlow.score}/${orderFlow.required}`);
          divergenceObservations += 1;
          if (divergenceShadow.status === "aligned") divergenceEvidence += 1;
          if (divergenceAlignedEvidence.combined) divergenceCombined += 1;
          if (divergenceShadow.status === "conflict") divergenceConflicts += 1;
          observations.push({
            time: point.time,
            price: point.price,
            direction: direction === "BUY_FIRST" ? "正T" : "反T",
            score,
            threshold: profile.score,
            edge,
            executable,
            stage: candidateQualified ? "candidate" : "watch",
            pairGap,
            pivotTime: pivotPoint.time,
            pivotPrice,
            pivotVwap,
            pivotVwapDeviation,
            vwap,
            vwapDeviation: deviation,
            pivotLabel,
            pivotAssessment,
            confirmationLabel,
            cyclePreference,
            cycleAligned: !cycleConflict,
            rangeEvidence,
            divergenceShadow,
            strategyVersion: options.strategyVersion ?? "V4",
            cycleGuidance: cyclePreference === "uptrend"
              ? "上行周期优先正T"
              : cyclePreference === "downtrend"
                ? "下行周期优先倒T"
                : "震荡周期双向观察",
            blockers,
            reason: describeVwapConfirmation({
              direction,
              pivotDeviation: pivotVwapDeviation,
              currentDeviation: deviation,
              volumeRatio: ratio,
            }),
          });
          observationCounts[session] += 1;
          lastObservationMinute = nowMinute;
        }

        if (executable) {
          const firstSide = direction === "BUY_FIRST" ? "买入" : "卖出";
          const slip = slipFor(point.price, options);
          const executed = direction === "BUY_FIRST" ? point.price + slip : point.price - slip;
          const firstFee = orderCosts(firstSide, executed, quantity, options);
          const transition = openTCycle(cycleState, {
            direction,
            price: executed,
            quantity,
            sellable: options.sellable,
            cash,
            minute: nowMinute,
          });
          if (!transition.ok) continue;
          const trigger = openingSignal
            ? `${openingSignal.label ?? (direction === "BUY_FIRST" ? "低开转强" : "高开转弱")}；开盘价与 VWAP 方向确认`
            : direction === "BUY_FIRST"
              ? `价格偏离 VWAP ${Math.abs(deviation).toFixed(2)}% 后回升 ${recovered.toFixed(2)}%`
              : `价格偏离 VWAP ${Math.abs(deviation).toFixed(2)}% 后回落 ${faded.toFixed(2)}%，距此前已观察高位 ${pivotReversal.toFixed(2)}%`;
          const flipReason = oppositeCandidate
            ? `；此前 ${oppositeCandidate.time} ${oppositeCandidate.direction === "SELL_FIRST" ? "候补卖点" : "候补买点"}仅为观察、没有成交，当前已形成 ${pairGap.toFixed(2)}% 反向价差并确认${direction === "BUY_FIRST" ? "转强" : "转弱"}`
            : "";
          const entryReason = `${trigger}；信号评分 ${score}/${profile.score}，预估空间 ${edge.toFixed(2)}%，成本门槛 ${requiredEdge.toFixed(2)}%，量比 ${ratio.toFixed(2)}${flipReason}${orderFlow.available ? `；${orderFlow.reason}` : ""}`;
          fees += firstFee;
          executionCost += Math.abs(executed - point.price) * quantity;
          position = {
            direction,
            rawEntry: point.price,
            entry: executed,
            quantity,
            entryTime: point.time,
            entryIndex: index,
            entryPivotPrice: pivotPrice,
            firstFee,
            cycleId: cycleNets.length + 1,
            opening,
            entryReason,
            favorableVwapSeen: false,
            volatilityScale,
            entryRealisedVolatilityPct: volatility.realisedPct,
            effectiveDeviation,
            effectiveReversal,
          };
          cycleState = transition.state;
          actions.push({
            time: point.time,
            side: firstSide,
            price: executed,
            quantity,
            curveIndex: curve.length,
            direction: direction === "BUY_FIRST" ? "正T" : "反T",
            cycleId: position.cycleId,
            reason: entryReason,
            meta: {
              phase: "entry",
              score,
              edge,
              rewardRisk,
              ratio,
              deviation,
              pivotReversal,
              pivotAge,
              prePivotMove10,
              crossedVwap,
              trendContinuationRisk,
              divergenceShadow,
              localMomentum3,
              executionMomentumConfirmed,
              vwapMomentum15,
              vwapMomentum30,
              priceMomentum30,
              priceMomentum60,
              priceMomentum90,
              longPriceMeanBias,
              broadPricePoints,
              sessionMove,
              referenceMove,
              regime,
              cyclePreference,
              rangeEvidence,
              strategyVersion: options.strategyVersion ?? "V4",
              volatilityMode: options.volatilityMode ?? "fixed",
              volatilityScale,
              realisedVolatilityPct: volatility.realisedPct,
              effectiveDeviation,
              effectiveReversal,
              opening,
            },
          });
          bestMove = 0;
          bestProjectedNetPct = Number.NEGATIVE_INFINITY;
          bestProjectedNet = Number.NEGATIVE_INFINITY;
          bestGrossSpreadAmount = Number.NEGATIVE_INFINITY;
          if (opening) openingUsed += 1;
        }
      }
    }

    if (position) {
      const hold = nowMinute - minutesFromOpen(position.entryTime);
      const move = position.direction === "BUY_FIRST" ? pct(point.price, position.rawEntry) : pct(position.rawEntry, point.price);
      bestMove = Math.max(bestMove, move);
      if (position.direction === "BUY_FIRST" && point.price >= vwap) position.favorableVwapSeen = true;
      if (position.direction === "SELL_FIRST" && point.price <= vwap) position.favorableVwapSeen = true;
      const projectedSecondSide = position.direction === "BUY_FIRST" ? "卖出" : "买入";
      const projectedSlip = slipFor(point.price, options);
      const projectedExit = position.direction === "BUY_FIRST" ? point.price - projectedSlip : point.price + projectedSlip;
      const projectedSecondFee = orderCosts(projectedSecondSide, projectedExit, position.quantity, options);
      const projectedGross = position.direction === "BUY_FIRST"
        ? (point.price - position.rawEntry) * position.quantity
        : (position.rawEntry - point.price) * position.quantity;
      const projectedExecution = (Math.abs(position.entry - position.rawEntry) + Math.abs(projectedExit - point.price)) * position.quantity;
      const projectedNet = projectedGross - projectedExecution - position.firstFee - projectedSecondFee;
      const projectedNetPct = projectedNet / Math.max(1, position.rawEntry * position.quantity) * 100;
      const grossSpreadAmount = position.direction === "BUY_FIRST"
        ? point.price - position.rawEntry
        : position.rawEntry - point.price;
      bestProjectedNetPct = Math.max(bestProjectedNetPct, projectedNetPct);
      bestProjectedNet = Math.max(bestProjectedNet, projectedNet);
      bestGrossSpreadAmount = Math.max(bestGrossSpreadAmount, grossSpreadAmount);
      // Exit on the first already-observed minute that reaches the selected
      // after-cost target. This is causal and never waits for a future peak.
      const buybackOrderFlow = position.direction === "SELL_FIRST"
        ? evaluateQmtOrderFlow(points, index, "BUYBACK")
        : { available: false, pass: true };
      const minHoldMinutes = profile.minHoldMinutes ?? 3;
      const holdingConfirmed = hold >= minHoldMinutes;
      const maxTargetNetPct = profile.maxTargetNetPct ?? 1.00;
      const minimumNetProfitAmount = Math.max(0, Number(options.minimumNetProfitAmount) || 0);
      const minimumGrossSpreadAmount = Math.max(0, Number(options.minimumGrossSpreadAmount) || 0);
      const absoluteProfitSatisfied = projectedNet >= minimumNetProfitAmount
        && grossSpreadAmount >= minimumGrossSpreadAmount;
      const economicTakeProfit = holdingConfirmed && absoluteProfitSatisfied && projectedNetPct >= maxTargetNetPct;
      if (economicTakeProfit && buybackOrderFlow.available && !buybackOrderFlow.pass) buybackFlowBlocked += 1;
      const takeProfit = economicTakeProfit && buybackOrderFlow.pass;
      // Freeze the same causal scale that armed the entry.  Entry and stop
      // thresholds therefore widen/narrow together and cannot drift apart as
      // later volatility changes.
      const entryVolatilityScale = position.volatilityScale ?? 1;
      const hardStopPct = (profile.hardStopPct ?? 0.85) * entryVolatilityScale;
      const catastrophicStopPct = Math.max(
        hardStopPct,
        (profile.catastrophicStopPct ?? 1.35) * entryVolatilityScale,
      );
      const stopBreakBufferPct = Math.max(
        0,
        (profile.stopBreakBufferPct ?? 0.10) * entryVolatilityScale,
      );
      const softStopPct = (profile.softStopPct ?? 0.48) * entryVolatilityScale;
      const softStopMinutes = profile.softStopMinutes ?? (position.opening ? 10 : 8);
      const timeExitMinutes = profile.timeExitMinutes ?? 32;
      // Protect an already-observed profit without pretending that the
      // intraday high was tradable. The trail becomes active only after the
      // current position has reached a configured favourable move; it exits
      // on the first later minute whose after-cost P/L is still positive and
      // whose pullback from that observed best move is large enough.
      const trailActivationPct = profile.trailActivationPct ?? profile.targetNetPct;
      const trailRetracePct = profile.trailRetracePct ?? 0.18;
      const trailMinNetPct = profile.trailMinNetPct ?? Math.max(0.05, profile.targetNetPct - 0.18);
      const previousPrice = points[Math.max(0, index - 1)]?.price ?? point.price;
      const beforePrice = points[Math.max(0, index - 2)]?.price ?? previousPrice;
      const stopDecision = evaluateStructuralStop({
        direction: position.direction,
        currentPrice: point.price,
        previousPrice,
        beforePrice,
        entryPivotPrice: position.entryPivotPrice,
        movePct: move,
        holdMinutes: hold,
        hardStopPct,
        catastrophicStopPct,
        stopBreakBufferPct,
        softStopPct,
        softStopMinutes,
      });
      const { stop, catastrophicStop, structuralStopConfirmed, pivotBreakPrice, adverseMomentum } = stopDecision;
      const profitRetrace = bestProjectedNetPct - projectedNetPct;
      const absoluteProfitObserved = bestProjectedNet >= minimumNetProfitAmount
        && bestGrossSpreadAmount >= minimumGrossSpreadAmount;
      const profitProtectionArmed = Number.isFinite(trailActivationPct)
        && bestProjectedNetPct >= trailActivationPct
        && absoluteProfitObserved;
      const profitFloorBroken = profitProtectionArmed && projectedNetPct <= trailMinNetPct;
      const trailingProfit = holdingConfirmed && !takeProfit
        && profitProtectionArmed
        && projectedNet > 0
        && (profitFloorBroken || (profitRetrace >= trailRetracePct && (adverseMomentum || profitRetrace >= trailRetracePct * 1.5)));
      const timeExit = hold >= timeExitMinutes && !takeProfit && !trailingProfit;
      const forceExit = point.time >= options.forceCloseTime;
      if (takeProfit || trailingProfit || stop || timeExit || forceExit) {
        const secondSide = position.direction === "BUY_FIRST" ? "卖出" : "买入";
        const slip = slipFor(point.price, options);
        const executed = position.direction === "BUY_FIRST" ? point.price - slip : point.price + slip;
        const transition = closeTCycle(cycleState, {
          side: position.direction === "BUY_FIRST" ? "SELL" : "BUY",
          price: executed,
          minute: nowMinute,
          forced: forceExit || stop || timeExit,
          minHoldMinutes,
        });
        if (!transition.ok) continue;
        const secondFee = orderCosts(secondSide, executed, position.quantity, options);
        fees += secondFee;
        executionCost += Math.abs(executed - point.price) * position.quantity;
        const cycleGross = position.direction === "BUY_FIRST" ? (point.price - position.rawEntry) * position.quantity : (position.rawEntry - point.price) * position.quantity;
        const cycleExecution = (Math.abs(position.entry - position.rawEntry) + Math.abs(executed - point.price)) * position.quantity;
        const cycleNet = cycleGross - cycleExecution - position.firstFee - secondFee;
        gross += cycleGross;
        cash += cycleNet;
        cycleNets.push(cycleNet);
        if (cycleNet > 0) { wins += 1; consecutiveLosses = 0; } else consecutiveLosses += 1;
        const exitReason = forceExit
          ? `到达 ${options.forceCloseTime.slice(0,2)}:${options.forceCloseTime.slice(2)} 尾盘强制恢复底仓线`
          : stop
            ? `止损退出：${catastrophicStop ? "达到极端风险线" : "连续跌破/突破入场前确认拐点且走势继续恶化"}；本循环浮动 ${move.toFixed(2)}%，持有 ${hold} 分钟`
            : takeProfit
              ? `扣费净止盈（上限）：持有 ${hold} 分钟，当前预计净收益率 ${projectedNetPct.toFixed(2)}%，已达到 ${maxTargetNetPct.toFixed(2)}% 上限；按本分钟已出现价格执行`
              : trailingProfit
                ? `扣费净止盈（回撤保护）：持有 ${hold} 分钟，净收益曾达到 ${bestProjectedNetPct.toFixed(2)}%，回吐 ${profitRetrace.toFixed(2)}% 且出现反向确认，按当前预计净收益 ${projectedNetPct.toFixed(2)}% 退出`
              : `时间退出：持有 ${hold} 分钟达到 ${timeExitMinutes} 分钟上限`;
        actions.push({
          time: point.time,
          side: secondSide,
          price: executed,
          quantity: position.quantity,
          curveIndex: curve.length,
          direction: position.direction === "BUY_FIRST" ? "正T" : "反T",
          cycleId: position.cycleId,
          reason: exitReason,
          meta: {
            phase: "exit",
            hold,
            move,
            bestMove,
            projectedNetPct,
            takeProfit,
            trailingProfit,
            stop,
            catastrophicStop,
            structuralStopConfirmed,
            pivotBreakPrice,
            timeExit,
            forceExit,
            volatilityMode: options.volatilityMode ?? "fixed",
            volatilityScale: position.volatilityScale ?? 1,
            entryRealisedVolatilityPct: position.entryRealisedVolatilityPct ?? 0,
          },
        });
        cycleState = transition.state;
        position = null;
        lastExitMinute = nowMinute;
      }
    }

    const mark = position ? (position.direction === "BUY_FIRST" ? (point.price - position.entry) : (position.entry - point.price)) * position.quantity - position.firstFee : 0;
    const equity = cash + mark;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0);
    curve.push(equity);
    curveTimes.push(point.time);
  }

  const candidateObservationState = buildCandidateObservationCycles(observations);
  const status = cycleNets.length
    ? `Smart-T V4 因果盲测完成：正/反 T、开盘试单、趋势、量价、成本与连续亏损风控均已启用。`
    : `Smart-T V4 本次未形成可执行闭环：候选 ${candidates}，资金拦截 ${cashBlocked}，趋势拦截 ${regimeBlocked}，成本/盈亏比拦截 ${costBlocked}。`;
  const gateAudit = options.gateAudit ? buildGateAudit(points, rejectedGateCandidates) : null;
  return { net: cash - options.capital, gross, fees, executionCost, maxDrawdown, trades: cycleNets.length, wins, days: 1, curve, curveTimes, cycleNets, candidateCycles: candidateObservationState.cycles, openCandidate: candidateObservationState.open, startTime: points[revealStart].time, status, actions, observations, diagnostics: { candidates, observations: observations.length, candidateCycles: candidateObservationState.cycles.length, openCandidates: candidateObservationState.open ? 1 : 0, morningObservations: observationCounts.morning, afternoonObservations: observationCounts.afternoon, cashBlocked, costBlocked, regimeBlocked, cycleConflicts, shadowDirectionBlocked, shadowLunchRestartBlocked, shadowQualityBlocked, strongTrendBlocked, strongSellTrendBlocked, strongBuyTrendBlocked, fallingKnifeBlocked, risingKnifeBlocked, counterTrendQualityBlocked, scoreBlocked, structureBlocked, qualityBlocked, timingBlocked, candidateOnlyBlocked, openingChaseBlocked, openingRepairAgeBlocked, highGapCollapseBlocked, broadDowntrendBuyBlocked, openingRegimeOverrides, consecutiveLosses, orderFlowAvailablePoints, orderFlowBlocked, buybackFlowBlocked, divergenceObservations, divergenceEvidence, divergenceCombined, divergenceConflicts, volatilityAdaptivePoints, volatilityScaleAvg: volatilityAdaptivePoints ? volatilityScaleSum / volatilityAdaptivePoints : 1, volatilityScaleMin: volatilityAdaptivePoints ? volatilityScaleMin : 1, volatilityScaleMax: volatilityAdaptivePoints ? volatilityScaleMax : 1, realisedVolatilityPctAvg: volatilityAdaptivePoints ? realisedVolatilityPctSum / volatilityAdaptivePoints : 0, cyclePhase: cycleState.phase }, gateAudit };
}

export {
  PROFILES,
  buildCandidateObservationCycles,
  causalCyclePreference,
  causalAfternoonTrendConflict,
  causalFormalEntryWindowConflict,
  causalOpeningDisplacementConflict,
  causalOpeningQualityConflict,
  causalOpeningRepairAgeConflict,
  causalHighGapCollapseConflict,
  causalBroadDowntrendBuyConflict,
  causalTrendImpulseConflict,
  causalThirtyMinuteTrendShieldConflict,
  causalWeakRecoveryConflict,
  causalPersistentDirection,
  causalVwapDirectionConflict,
  causalRangeEvidence,
  confirmCandidateDirectionFlip,
  evaluateStructuralStop,
  minutesFromOpen,
};
