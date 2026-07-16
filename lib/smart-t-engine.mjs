/**
 * Causal intraday Smart-T replay engine.
 *
 * Every decision only receives points at or before the current minute. The
 * engine never reads the session close, final high/low or a future indicator.
 */

const PROFILES = {
  // candidateNetPct controls the wider observation layer. targetNetPct is the
  // actual after-cost profit target used by formal entries and exits.
  "稳健档": { score: 6, cooldown: 10, candidateNetPct: 0.55, targetNetPct: 0.74, maxCycles: 1, deviation: 0.90, reversal: 0.32, maxSellPullback: 0.42, minBuyVolumeRatio: 0.80, minSellVolumeRatio: 0.90, minMomentum3: 0.12, minRewardRisk: 1.50 },
  // Keep execution quality stable: benchmarked wider gates raised frequency
  // but turned the same real-minute sample negative after costs.
  "平衡档": { score: 4, cooldown: 8, candidateNetPct: 0.42, targetNetPct: 0.69, maxCycles: 1, deviation: 0.70, reversal: 0.22, maxSellPullback: 0.36, minBuyVolumeRatio: 0.80, minSellVolumeRatio: 0.90, minMomentum3: 0.12, minRewardRisk: 1.50 },
  "灵敏档": { score: 5, cooldown: 5, candidateNetPct: 0.32, targetNetPct: 0.64, maxCycles: 2, deviation: 0.65, reversal: 0.22, maxSellPullback: 0.32, minBuyVolumeRatio: 0.75, minSellVolumeRatio: 0.85, minMomentum3: 0.10, minRewardRisk: 1.40 },
  "量化学习": { score: 6, cooldown: 8, candidateNetPct: 0.42, targetNetPct: 0.69, maxCycles: 1, deviation: 0.78, reversal: 0.26, maxSellPullback: 0.38, minBuyVolumeRatio: 0.80, minSellVolumeRatio: 0.90, minMomentum3: 0.12, minRewardRisk: 1.50 },
};

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
const roundLot = (shares) => Math.max(0, Math.floor(shares / 100) * 100);

function sanitize(minutes) {
  return minutes
    .filter((point) => /^\d{4}$/.test(point.time) && Number.isFinite(point.price) && point.price > 0)
    .filter((point) => (point.time >= "0930" && point.time <= "1130") || (point.time >= "1300" && point.time <= "1500"))
    .map((point) => ({ time: point.time, price: Number(point.price), volume: Math.max(0, Number(point.volume) || 0) }));
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
    && current < vwap
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
    return { direction: "BUY_FIRST", regimeOverride: true };
  }
  if (index >= 15
    && gap >= 0.30
    && lastThree.every((point) => point.price < open)
    && belowVwap >= 2
    && current < previous
    && recentMomentum <= -0.35
    && fadedFromHigh >= 0.55) {
    return { direction: "SELL_FIRST", regimeOverride: true };
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
  return { net: 0, gross: 0, fees: 0, executionCost: 0, maxDrawdown: 0, trades: 0, wins: 0, days: 0, curve: [capital], curveTimes: [], cycleNets: [], startTime: "", status, actions: [], observations: [], diagnostics };
}

/**
 * @param {{time:string,price:number,volume:number}[]} minutes
 * @param {{capital:number,baseShares:number,sellable:number,feeRate:number,slippage:number,minCommission:boolean,slippageMode:"percent"|"tick",forceCloseTime:string,profile?:string,previousClose?:number|null,randomValue?:number}} options
 */
export function runSmartTReplay(minutes, options) {
  const points = sanitize(minutes);
  const profile = PROFILES[options.profile] ?? PROFILES["平衡档"];
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
  const revealStart = Math.min(points.length - 1, 5);
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
  let bestMove = 0;
  let candidates = 0;
  let costBlocked = 0;
  let cashBlocked = 0;
  let regimeBlocked = 0;
  let strongTrendBlocked = 0;
  let strongSellTrendBlocked = 0;
  let strongBuyTrendBlocked = 0;
  let scoreBlocked = 0;
  let structureBlocked = 0;
  let timingBlocked = 0;
  let candidateOnlyBlocked = 0;
  let openingUsed = 0;
  let openingRegimeOverrides = 0;
  let lastObservationMinute = -10_000;
  let lastQualifiedObservation = null;
  const actions = [];
  const observations = [];
  const cycleNets = [];
  const curve = [cash];
  const curveTimes = [points[revealStart].time];

  for (let index = revealStart; index < points.length; index += 1) {
    const point = points[index];
    const nowMinute = minutesFromOpen(point.time);
    const vwap = vwaps[index];
    const ratio = volumeRatio(points, index);
    const regime = causalRegime(points, index, vwaps);

    const liquidEntryWindow = (point.time >= "0935" && point.time <= "1110") || (point.time >= "1300" && point.time <= "1330");
    if (!position && cycleNets.length < profile.maxCycles && consecutiveLosses < 2 && liquidEntryWindow && nowMinute - lastExitMinute >= profile.cooldown) {
      const opening = point.time <= "1000";
      const openingSignal = opening ? openingDirection(points, index, options.previousClose, vwap) : null;
      let direction = openingSignal?.direction ?? null;
      const deviation = pct(point.price, vwap);
      const recent = points.slice(Math.max(0, index - 6), index + 1).map((item) => item.price);
      const recovered = pct(point.price, Math.min(...recent));
      const faded = pct(Math.max(...recent), point.price);
      if (!opening && deviation <= -profile.deviation && recovered >= profile.reversal) direction = "BUY_FIRST";
      if (!opening && deviation >= profile.deviation && faded >= profile.reversal) direction = "SELL_FIRST";

      if (direction) {
        candidates += 1;
        const score = directionScore(points, index, direction, vwap, ratio);
        const rawRegimeConflict = (direction === "BUY_FIRST" && regime === "downtrend") || (direction === "SELL_FIRST" && regime === "uptrend");
        const vwapMomentum15 = index >= 15 ? pct(vwap, vwaps[index - 15]) : 0;
        const vwapMomentum30 = index >= 30 ? pct(vwap, vwaps[index - 30]) : 0;
        const sessionMove = pct(point.price, points[0].price);
        const pivotWindowStart = Math.max(0, index - 8);
        const pivotWindow = points.slice(pivotWindowStart, index + 1);
        const pivotPrice = direction === "SELL_FIRST"
          ? Math.max(...pivotWindow.map((item) => item.price))
          : Math.min(...pivotWindow.map((item) => item.price));
        const pivotOffset = pivotWindow.findIndex((item) => item.price === pivotPrice);
        const pivotPoint = points[pivotWindowStart + Math.max(0, pivotOffset)];
        const pivotReversal = direction === "SELL_FIRST"
          ? pct(pivotPrice, point.price)
          : pct(point.price, pivotPrice);
        const crossedVwap = direction === "SELL_FIRST"
          ? pivotPrice > vwap && point.price <= vwap
          : pivotPrice < vwap && point.price >= vwap;
        const localMomentum3 = pct(point.price, points[Math.max(0, index - 3)].price);
        // A reversal entry must be confirmed by a turn that has already
        // happened after an observed 8-minute pivot.  The old rule asked a
        // buy-at-a-valley to already be above its price 30 minutes earlier,
        // which confused the prevailing trend with the local turn and vetoed
        // legitimate causal recoveries.  This replacement never looks past
        // the current minute.
        const structuralConfirmation = opening || (
          pivotReversal >= profile.reversal
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
          && pivotReversal >= profile.reversal
          && ratio >= 0.35
          && ratio < 3
          && (score >= profile.score + 1 || Math.abs(deviation) >= profile.deviation + 0.18)
        );
        // A fully confirmed local turn may neutralise only the short regime
        // label.  It never overrides a persistent one-way session veto.
        const localRegimeBreak = !opening
          && structuralConfirmation
          && score >= profile.score
          && (crossedVwap || pivotReversal >= Math.max(0.32, profile.reversal + 0.10));
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
        const strongSessionConflict = shortTrendConflict || persistentSessionConflict || extendedSessionConflict;
        if (strongSessionConflict) {
          strongTrendBlocked += 1;
          if (direction === "SELL_FIRST") strongSellTrendBlocked += 1;
          if (direction === "BUY_FIRST") strongBuyTrendBlocked += 1;
        }
        const regimeConflict = ((rawRegimeConflict && !localRegimeBreak) || strongSessionConflict) && !openingSignal?.regimeOverride;
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
        const candidateRequiredEdge = profile.candidateNetPct + approximateCosts;
        // Entry still uses the profile's economic-viability estimate so live
        // opportunities do not disappear merely because a local edge model is
        // conservative. The completed leg may take profit only after the
        // independently calculated after-cost target is actually reached.
        // Every opening-window order must already cover the selected after-cost
        // target. 09:25 only forms a plan and 09:36-09:44 uses a smaller size;
        // neither is allowed to lower the economic bar simply to create trades.
        const requiredEdge = opening
          ? profile.targetNetPct + approximateCosts
          : candidateRequiredEdge;
        const recentRange = pct(Math.max(...recent), Math.min(...recent));
        const rewardRisk = edge / Math.max(0.18, recentRange * 0.28);
        const candidateScoreFloor = Math.max(2, profile.score - 1);
        const pairGap = lastQualifiedObservation
          ? (direction === "BUY_FIRST"
              ? pct(lastQualifiedObservation.price, point.price)
              : pct(point.price, lastQualifiedObservation.price))
          : null;
        const pairEconomicallyDistinct = !lastQualifiedObservation
          || lastQualifiedObservation.direction === direction
          || pairGap >= candidateRequiredEdge;
        const candidateQualified = score >= candidateScoreFloor
          && edge >= candidateRequiredEdge
          && rewardRisk >= 1.2
          && pairEconomicallyDistinct;
        // Keep the candidate layer wider than the execution layer. A setup
        // may be worth watching even when the prevailing trend still blocks
        // a trade; the blocker remains visible and `executable` stays false.
        const turnConfirmed = candidateQualified
          && !regimeConflict
          && structuralConfirmation
          && pivotReversal >= profile.reversal
          && (crossedVwap || ratio >= 0.9);
        const pivotAssessment = strongSessionConflict ? "strong" : turnConfirmed ? "confirmed" : "unconfirmed";
        const pivotLabel = direction === "SELL_FIRST"
          ? (strongSessionConflict ? "强势高位参考" : turnConfirmed ? "此前高位已转弱" : "此前高位参考")
          : (strongSessionConflict ? "弱势低位参考" : turnConfirmed ? "此前低位已转强" : "此前低位参考");
        const confirmationLabel = direction === "SELL_FIRST"
          ? (strongSessionConflict ? "强势未破" : turnConfirmed ? "转弱确认" : "回落观察")
          : (strongSessionConflict ? "弱势未破" : turnConfirmed ? "转强确认" : "反弹观察");
        // A causal sell confirmation must arrive after the observed peak, but
        // it must not chase a decline that has already surrendered most of the
        // available T spread. Opening-gap overrides keep their own stricter
        // multi-minute rules and are intentionally exempt here.
        const entryTimingValid = opening || direction === "BUY_FIRST" || pivotReversal <= profile.maxSellPullback;
        if (edge < requiredEdge || rewardRisk < profile.minRewardRisk) costBlocked += 1;
        if (score < profile.score) scoreBlocked += 1;
        if (!structuralConfirmation) structureBlocked += 1;
        if (!entryTimingValid) timingBlocked += 1;
        if (openingSignal?.candidateOnly) candidateOnlyBlocked += 1;

        const executable = !openingSignal?.candidateOnly && quantity >= 100 && score >= profile.score && structuralConfirmation && !regimeConflict && edge >= requiredEdge && rewardRisk >= profile.minRewardRisk && entryTimingValid && (!opening || openingUsed < 2);
        if (nowMinute - lastObservationMinute >= 8 && observations.length < 3) {
          const blockers = [];
          if (score < profile.score) blockers.push(`确认分 ${score}/${profile.score}`);
          if (!structuralConfirmation) blockers.push("量价结构未确认");
          if (strongSessionConflict) blockers.push("单边趋势与 VWAP 尚未破坏");
          else if (regimeConflict) blockers.push("趋势方向冲突");
          if (edge < requiredEdge) blockers.push(`净价差 ${edge.toFixed(2)}% 未过成本线`);
          if (rewardRisk < profile.minRewardRisk) blockers.push(`盈亏比 ${rewardRisk.toFixed(2)} 未达 ${profile.minRewardRisk.toFixed(2)}`);
          if (!entryTimingValid) blockers.push(`已离此前高位回落 ${pivotReversal.toFixed(2)}%，不在低位追卖`);
          if (quantity < 100) blockers.push("可用资金或股数不足");
          if (openingSignal?.candidateOnly) blockers.push("平开波段先进入候选观察，等待正式过滤确认");
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
            pivotLabel,
            pivotAssessment,
            confirmationLabel,
            blockers,
            reason: direction === "BUY_FIRST"
              ? `价格向下偏离 VWAP ${Math.abs(deviation).toFixed(2)}% 后出现回升`
              : `价格向上偏离 VWAP ${Math.abs(deviation).toFixed(2)}% 后出现回落`,
          });
          if (candidateQualified) lastQualifiedObservation = { direction, price: point.price };
          lastObservationMinute = nowMinute;
        }

        if (executable) {
          const firstSide = direction === "BUY_FIRST" ? "买入" : "卖出";
          const slip = slipFor(point.price, options);
          const executed = direction === "BUY_FIRST" ? point.price + slip : point.price - slip;
          const firstFee = orderCosts(firstSide, executed, quantity, options);
          const trigger = openingSignal
            ? `${openingSignal.label ?? (direction === "BUY_FIRST" ? "低开转强" : "高开转弱")}；开盘价与 VWAP 方向确认`
            : direction === "BUY_FIRST"
              ? `价格偏离 VWAP ${Math.abs(deviation).toFixed(2)}% 后回升 ${recovered.toFixed(2)}%`
              : `价格偏离 VWAP ${Math.abs(deviation).toFixed(2)}% 后回落 ${faded.toFixed(2)}%，距此前已观察高位 ${pivotReversal.toFixed(2)}%`;
          const entryReason = `${trigger}；信号评分 ${score}/${profile.score}，预估空间 ${edge.toFixed(2)}%，成本门槛 ${requiredEdge.toFixed(2)}%，量比 ${ratio.toFixed(2)}`;
          fees += firstFee;
          executionCost += Math.abs(executed - point.price) * quantity;
          position = { direction, rawEntry: point.price, entry: executed, quantity, entryTime: point.time, entryIndex: index, firstFee, cycleId: cycleNets.length + 1, opening, entryReason, favorableVwapSeen: false };
          actions.push({ time: point.time, side: firstSide, price: executed, quantity, curveIndex: curve.length, direction: direction === "BUY_FIRST" ? "正T" : "反T", cycleId: position.cycleId, reason: entryReason });
          bestMove = 0;
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
      // Exit on the first already-observed minute that reaches the selected
      // after-cost target. This is causal and never waits for a future peak.
      const takeProfit = projectedNetPct >= profile.targetNetPct;
      const stop = move <= -0.85 || (hold >= (position.opening ? 10 : 8) && move <= -0.48);
      const timeExit = hold >= 32 && !takeProfit;
      const forceExit = point.time >= options.forceCloseTime;
      if (takeProfit || stop || timeExit || forceExit) {
        const secondSide = position.direction === "BUY_FIRST" ? "卖出" : "买入";
        const slip = slipFor(point.price, options);
        const executed = position.direction === "BUY_FIRST" ? point.price - slip : point.price + slip;
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
            ? `止损退出：本循环浮动 ${move.toFixed(2)}%，持有 ${hold} 分钟`
            : takeProfit
              ? `扣费净止盈：当前预计净收益率 ${projectedNetPct.toFixed(2)}%，已达到 ${profile.targetNetPct.toFixed(2)}% 目标；按本分钟已出现价格执行`
              : `时间退出：持有 ${hold} 分钟达到 32 分钟上限`;
        actions.push({ time: point.time, side: secondSide, price: executed, quantity: position.quantity, curveIndex: curve.length, direction: position.direction === "BUY_FIRST" ? "正T" : "反T", cycleId: position.cycleId, reason: exitReason });
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

  const status = cycleNets.length
    ? `Smart-T V4 因果盲测完成：正/反 T、开盘试单、趋势、量价、成本与连续亏损风控均已启用。`
    : `Smart-T V4 本次未形成可执行闭环：候选 ${candidates}，资金拦截 ${cashBlocked}，趋势拦截 ${regimeBlocked}，成本/盈亏比拦截 ${costBlocked}。`;
  return { net: cash - options.capital, gross, fees, executionCost, maxDrawdown, trades: cycleNets.length, wins, days: 1, curve, curveTimes, cycleNets, startTime: points[revealStart].time, status, actions, observations, diagnostics: { candidates, observations: observations.length, cashBlocked, costBlocked, regimeBlocked, strongTrendBlocked, strongSellTrendBlocked, strongBuyTrendBlocked, scoreBlocked, structureBlocked, timingBlocked, candidateOnlyBlocked, openingRegimeOverrides, consecutiveLosses } };
}

export { PROFILES, minutesFromOpen };
