/**
 * Causal intraday Smart-T replay engine.
 *
 * Every decision only receives points at or before the current minute. The
 * engine never reads the session close, final high/low or a future indicator.
 */

const PROFILES = {
  "稳健档": { score: 6, cooldown: 10, minNetPct: 0.55, maxCycles: 1, deviation: 0.90, reversal: 0.32 },
  "平衡档": { score: 4, cooldown: 8, minNetPct: 0.42, maxCycles: 1, deviation: 0.70, reversal: 0.22 },
  "灵敏档": { score: 5, cooldown: 5, minNetPct: 0.32, maxCycles: 2, deviation: 0.65, reversal: 0.22 },
  "量化学习": { score: 6, cooldown: 8, minNetPct: 0.42, maxCycles: 1, deviation: 0.78, reversal: 0.26 },
};

const minutesFromOpen = (time) => {
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  return hour * 60 + minute;
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

  // A gap alone is not a signal. Wait until at least 09:45 and require three
  // consecutive, already-observed confirmations before overriding a lagging
  // opening regime label. No session high/low after the current minute is read.
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
  if (points.length < 30 || normalQuantity < 100) return emptyResult(options.capital, "真实分时样本或可卖底仓不足，未生成交易");

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
        const momentum30 = index >= 30 ? pct(point.price, points[index - 30].price) : 0;
        const vwapMomentum15 = index >= 15 ? pct(vwap, vwaps[index - 15]) : 0;
        const sessionMove = pct(point.price, points[0].price);
        const strongSessionConflict = direction === "SELL_FIRST"
          ? sessionMove >= 1.20 && vwapMomentum15 >= 0.08 && point.price >= vwap * 1.002
          : sessionMove <= -1.20 && vwapMomentum15 <= -0.08 && point.price <= vwap * 0.998;
        if (strongSessionConflict) strongTrendBlocked += 1;
        const regimeConflict = (rawRegimeConflict || strongSessionConflict) && !openingSignal?.regimeOverride;
        if ((rawRegimeConflict || strongSessionConflict) && openingSignal?.regimeOverride) openingRegimeOverrides += 1;
        const structuralConfirmation = opening || (
          direction === "BUY_FIRST"
            ? momentum30 >= 0.25 && vwapMomentum15 >= -0.20 && ratio >= 0.80 && ratio < 3
            : momentum30 <= -0.25 && vwapMomentum15 <= 0.20 && ratio >= 0.90 && ratio < 3
        );
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
        const requiredEdge = profile.minNetPct + approximateCosts;
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
          || pairGap >= requiredEdge;
        const candidateQualified = score >= candidateScoreFloor
          && edge >= requiredEdge
          && rewardRisk >= 1.2
          && !regimeConflict
          && pairEconomicallyDistinct;
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
        const turnConfirmed = candidateQualified
          && !regimeConflict
          && structuralConfirmation
          && pivotReversal >= profile.reversal
          && (crossedVwap || ratio >= 0.9);
        const pivotAssessment = strongSessionConflict ? "strong" : turnConfirmed ? "confirmed" : "unconfirmed";
        const pivotLabel = direction === "SELL_FIRST"
          ? (strongSessionConflict ? "强峰参考" : turnConfirmed ? "弱峰参考" : "峰值参考")
          : (strongSessionConflict ? "弱谷参考" : turnConfirmed ? "强谷参考" : "谷值参考");
        const confirmationLabel = direction === "SELL_FIRST"
          ? (strongSessionConflict ? "强势未破" : turnConfirmed ? "转弱确认" : "回落观察")
          : (strongSessionConflict ? "弱势未破" : turnConfirmed ? "转强确认" : "反弹观察");
        if (edge < requiredEdge || rewardRisk < 1.5) costBlocked += 1;

        const executable = !openingSignal?.candidateOnly && quantity >= 100 && score >= profile.score && structuralConfirmation && !regimeConflict && edge >= requiredEdge && rewardRisk >= 1.5 && (!opening || openingUsed < 2);
        if (nowMinute - lastObservationMinute >= 8 && observations.length < 3) {
          const blockers = [];
          if (score < profile.score) blockers.push(`确认分 ${score}/${profile.score}`);
          if (!structuralConfirmation) blockers.push("量价结构未确认");
          if (strongSessionConflict) blockers.push("单边趋势与 VWAP 尚未破坏");
          else if (regimeConflict) blockers.push("趋势方向冲突");
          if (edge < requiredEdge) blockers.push(`净价差 ${edge.toFixed(2)}% 未过成本线`);
          if (rewardRisk < 1.5) blockers.push(`盈亏比 ${rewardRisk.toFixed(2)} 未达 1.5`);
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
              : `价格偏离 VWAP ${Math.abs(deviation).toFixed(2)}% 后回落 ${faded.toFixed(2)}%`;
          const entryReason = `${trigger}；信号评分 ${score}/${profile.score}，预估空间 ${edge.toFixed(2)}%，成本门槛 ${requiredEdge.toFixed(2)}%，量比 ${ratio.toFixed(2)}`;
          fees += firstFee;
          executionCost += Math.abs(executed - point.price) * quantity;
          position = { direction, rawEntry: point.price, entry: executed, quantity, entryTime: point.time, entryIndex: index, firstFee, cycleId: cycleNets.length + 1, opening, entryReason };
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
      const profitableFloor = Math.max(profile.minNetPct, 0.35);
      const profitArmed = bestMove >= Math.max(0.55, profitableFloor + 0.20);
      const trailingDistance = Math.min(0.35, Math.max(0.18, bestMove * 0.28));
      const trailingTakeProfit = profitArmed && bestMove - move >= trailingDistance && move >= profitableFloor;
      const vwapProfitExit = profitArmed && move >= profitableFloor && (
        position.direction === "BUY_FIRST" ? point.price < vwap * 0.999 : point.price > vwap * 1.001
      );
      const takeProfit = trailingTakeProfit || vwapProfitExit;
      const stop = move <= -0.85 || (hold >= (position.opening ? 10 : 8) && move <= -0.48);
      const timeExit = hold >= 32 && (!profitArmed || move < profitableFloor);
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
              ? `利润保护止盈：最佳浮动 ${bestMove.toFixed(2)}%，从滚动高点回撤 ${(bestMove - move).toFixed(2)}%，当前仍保留 ${move.toFixed(2)}% 浮盈`
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
  return { net: cash - options.capital, gross, fees, executionCost, maxDrawdown, trades: cycleNets.length, wins, days: 1, curve, curveTimes, cycleNets, startTime: points[revealStart].time, status, actions, observations, diagnostics: { candidates, observations: observations.length, cashBlocked, costBlocked, regimeBlocked, strongTrendBlocked, openingRegimeOverrides, consecutiveLosses } };
}

export { PROFILES };
