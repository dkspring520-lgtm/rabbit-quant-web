const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const roundPrice = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const finitePositive = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeTime = value => String(value ?? "").replace(/\D/g, "").slice(-4);
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const finite = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function weightedVwap(points) {
  const weighted = points.reduce((sum, point) => sum + point.price * Math.max(0, point.volume), 0);
  const volume = points.reduce((sum, point) => sum + Math.max(0, point.volume), 0);
  return volume > 0 ? weighted / volume : average(points.map(point => point.price));
}

function minuteOrdinal(time) {
  const normalized = normalizeTime(time);
  if (!/^\d{4}$/.test(normalized)) return null;
  const hour = Number(normalized.slice(0, 2));
  const minute = Number(normalized.slice(2));
  return Number.isInteger(hour) && Number.isInteger(minute) ? hour * 60 + minute : null;
}

function normalizeGateMinute(point) {
  const activeBuyVolume = finite(point?.activeBuyVolume);
  const activeSellVolume = finite(point?.activeSellVolume);
  const activeTotal = (activeBuyVolume ?? 0) + (activeSellVolume ?? 0);
  const suppliedOfi = finite(point?.ofi ?? point?.activeBuyImbalance);
  return {
    time: normalizeTime(point?.time),
    price: finite(point?.price),
    volume: Math.max(0, finite(point?.volume) ?? 0),
    ofi: suppliedOfi ?? (activeBuyVolume !== null && activeSellVolume !== null && activeTotal > 0
      ? (activeBuyVolume - activeSellVolume) / activeTotal
      : null),
    marketPrice: finite(point?.marketPrice),
    sectorPrice: finite(point?.sectorPrice),
  };
}

function deriveOpeningTapeDirection(openingRows) {
  if (openingRows.length < 5 || openingRows[0].time > "0931" || openingRows.at(-1).time < "0935") return null;
  const open = openingRows[0];
  const latest = openingRows.at(-1);
  const vwap = weightedVwap(openingRows);
  const tapeMovePct = ((latest.price / open.price) - 1) * 100;
  const vwapBiasPct = vwap ? ((latest.price / vwap) - 1) * 100 : 0;
  const sameDirection = Math.sign(tapeMovePct) === Math.sign(vwapBiasPct) || Math.abs(tapeMovePct) >= 0.18;
  if (Math.abs(tapeMovePct) < 0.08 || !sameDirection) return null;
  return {
    direction: tapeMovePct > 0 ? "正T" : "反T",
    confidence: Math.round(clamp(52 + Math.abs(tapeMovePct) * 35, 52, 70)),
    tapeMovePct,
    vwapBiasPct,
  };
}

function findStrictDirectionReversal({ rows, openingRows, anchorDirection }) {
  const reversalDirection = anchorDirection === "正T" ? "反T" : "正T";
  const directionSign = reversalDirection === "正T" ? 1 : -1;
  const openingHigh = Math.max(...openingRows.map(point => point.price));
  const openingLow = Math.min(...openingRows.map(point => point.price));
  const openingVolume = average(openingRows.map(point => point.volume).filter(value => value > 0));
  const afterOpen = rows.filter(point => point.time > "0935");

  for (let end = 4; end < afterOpen.length; end += 1) {
    const window = afterOpen.slice(end - 4, end + 1);
    const ordinals = window.map(point => minuteOrdinal(point.time));
    const continuous = ordinals.every((ordinal, index) => index === 0 || ordinal === ordinals[index - 1] + 1);
    if (!continuous) continue;

    const vwapConfirmed = window.every(point => {
      const pointIndex = rows.indexOf(point);
      const vwap = weightedVwap(rows.slice(0, pointIndex + 1));
      return vwap && directionSign * (point.price / vwap - 1) >= 0.0002;
    });
    const ofiConfirmed = window.every(point => point.ofi !== null && directionSign * point.ofi >= 0.05);
    const latest = window.at(-1);
    const rangeBreakConfirmed = reversalDirection === "正T"
      ? latest.price >= openingHigh * 1.0005
      : latest.price <= openingLow * 0.9995;
    const recentVolume = average(window.map(point => point.volume).filter(value => value > 0));
    const volumeRatio = openingVolume && recentVolume ? recentVolume / openingVolume : null;
    const volumeConfirmed = volumeRatio !== null && volumeRatio >= 1.15;
    const first = window[0];
    const marketReturn = first.marketPrice && latest.marketPrice ? latest.marketPrice / first.marketPrice - 1 : null;
    const sectorReturn = first.sectorPrice && latest.sectorPrice ? latest.sectorPrice / first.sectorPrice - 1 : null;
    const environmentConfirmed = marketReturn !== null && sectorReturn !== null
      && directionSign * marketReturn >= 0.0005
      && directionSign * sectorReturn >= 0.0005;
    const checks = {
      continuousVwap: Boolean(vwapConfirmed),
      continuousOfi: ofiConfirmed,
      openingRangeBreak: rangeBreakConfirmed,
      volumeExpansion: volumeConfirmed,
      marketSector: environmentConfirmed,
    };
    if (Object.values(checks).every(Boolean)) {
      return {
        direction: reversalDirection,
        confirmedAt: latest.time,
        checks,
        volumeRatio: Number(volumeRatio.toFixed(2)),
        marketReturnPct: Number((marketReturn * 100).toFixed(2)),
        sectorReturnPct: Number((sectorReturn * 100).toFixed(2)),
      };
    }
  }
  return null;
}

/**
 * Build Zijin Mining's pre-open research range from information observable at
 * the call-auction timestamp. It never consumes continuous-auction minutes.
 *
 * The result is deliberately an observation card, not an executable order.
 */
export function buildZijinPreopenPricePlan({
  phase = "preauction",
  asOfTime = null,
  previousClose = null,
  indicativePrice = null,
  bookImbalance = null,
  activeBuyRatio = null,
  atrPct = null,
  spreadBps = null,
  l2Connected = false,
  l2Stale = true,
} = {}) {
  const normalizedTime = String(asOfTime ?? "").replace(/\D/g, "").slice(-4);
  if (!["preauction", "auction", "auction-result"].includes(phase)) {
    return {
      active: false,
      ready: false,
      status: "inactive",
      asOfTime: normalizedTime || null,
      reason: "09:30 后切换为实时分时因果区间。",
    };
  }

  if (phase !== "auction-result") {
    const stage = phase === "preauction"
      ? "等待 09:15 集合竞价开始"
      : normalizedTime >= "0920"
        ? "不可撤单阶段形成中，09:25 锁定结果"
        : "可撤单试探阶段，仅观察变化，不采用大单结论";
    return {
      active: true,
      ready: false,
      status: "forming",
      asOfTime: normalizedTime || null,
      reason: stage,
    };
  }

  const reference = finitePositive(previousClose);
  const anchor = finitePositive(indicativePrice);
  if (!reference || !anchor) {
    return {
      active: true,
      ready: false,
      status: "degraded",
      asOfTime: normalizedTime || "0925",
      reason: "09:25竞价价或昨收缺失，不生成精确区间；09:30后等待真实成交。",
    };
  }

  const imbalance = Number.isFinite(Number(bookImbalance))
    ? clamp(Number(bookImbalance), -1, 1)
    : null;
  const buyRatio = Number.isFinite(Number(activeBuyRatio))
    ? clamp(Number(activeBuyRatio), 0, 1)
    : null;
  const orderFlowBias = clamp(
    (imbalance ?? 0) * 0.55 + (buyRatio == null ? 0 : (buyRatio - 0.5) * 0.9),
    -0.75,
    0.75,
  );
  const validAtrPct = Number.isFinite(Number(atrPct)) && Number(atrPct) > 0
    ? clamp(Number(atrPct), 0.08, 3)
    : null;
  const costFloor = Math.max(0.1, reference * 0.0032);
  const volatilityMove = validAtrPct == null ? 0 : anchor * validAtrPct / 100 * 0.55;
  const auctionGapMove = Math.abs(anchor - reference) * 0.22;
  const projectedMove = clamp(
    Math.max(anchor * 0.0035, volatilityMove, auctionGapMove, costFloor * 0.72),
    Math.max(0.06, anchor * 0.0025),
    anchor * 0.012,
  );
  const flowShift = projectedMove * orderFlowBias * 0.18;

  let buyLow = roundPrice(anchor - projectedMove * 0.78 + flowShift);
  let buyHigh = roundPrice(anchor - projectedMove * 0.34 + flowShift);
  let sellLow = roundPrice(anchor + projectedMove * 0.34 + flowShift);
  let sellHigh = roundPrice(anchor + projectedMove * 0.82 + flowShift);
  if (sellLow - buyHigh < costFloor) {
    const midpoint = (buyHigh + sellLow) / 2;
    buyHigh = roundPrice(midpoint - costFloor / 2);
    buyLow = roundPrice(Math.min(buyLow, buyHigh - projectedMove * 0.4));
    sellLow = roundPrice(midpoint + costFloor / 2);
    sellHigh = roundPrice(Math.max(sellHigh, sellLow + projectedMove * 0.4));
  }

  const gapPct = (anchor / reference - 1) * 100;
  const flowLabel = orderFlowBias >= 0.16 ? "L2承接偏强" : orderFlowBias <= -0.16 ? "L2抛压偏强" : "L2方向中性";
  const position = gapPct <= -0.1
    ? orderFlowBias >= 0.08 ? "低开修复预案" : "低开承压预案"
    : gapPct >= 0.1
      ? orderFlowBias <= -0.08 ? "高开转弱预案" : "高开偏强预案"
      : orderFlowBias >= 0.12 ? "平开偏强预案" : orderFlowBias <= -0.12 ? "平开偏弱预案" : "平开分歧预案";
  // This is deliberately conservative: a directional permission exists only
  // when the auction gap and auction order flow agree. It is not an order.
  const shadowDirection = gapPct <= -0.1 && orderFlowBias >= 0.08
    ? "正T"
    : gapPct >= 0.1 && orderFlowBias <= -0.08
      ? "反T"
      : null;
  const l2Usable = l2Connected && !l2Stale;
  const orderFlowInputs = Number(imbalance != null) + Number(buyRatio != null);
  const spreadPenalty = Number.isFinite(Number(spreadBps)) && Number(spreadBps) > 12 ? 6 : 0;
  const confidence = Math.round(clamp(
    48 + (l2Usable ? 10 : 0) + orderFlowInputs * 6 + (validAtrPct == null ? 0 : 5) - spreadPenalty,
    42,
    75,
  ));

  return {
    active: true,
    ready: true,
    status: l2Usable ? "preopen-ready" : "degraded",
    asOfTime: normalizedTime || "0925",
    anchorPrice: roundPrice(anchor),
    gapPct: Number(gapPct.toFixed(2)),
    buyRange: [buyLow, buyHigh],
    sellRange: [sellLow, sellHigh],
    expectedGrossSpread: roundPrice(sellLow - buyHigh),
    minimumGrossSpread: roundPrice(costFloor),
    confidence,
    position,
    shadowDirection,
    source: l2Usable ? `09:25竞价结果 · ${flowLabel}` : "09:25竞价结果 · L2降级",
    reason: `按09:25已知竞价结果生成；${flowLabel}。区间只用于开盘观察，09:30后由真实成交重新计算。`,
  };
}

/**
 * Freeze the 09:25 direction as a shadow-only permission, then require the
 * first continuous-auction tape to agree before it can explain a candidate.
 * It never changes Smart-T V4 actions or account state.
 */
export function evaluateZijinPreopenGate({ plan = null, minutes = [] } = {}) {
  const rows = Array.isArray(minutes)
    ? minutes
      .map(normalizeGateMinute)
      .filter(point => /^\d{4}$/.test(point.time) && Number.isFinite(point.price) && point.price > 0 && point.time >= "0930")
      .sort((left, right) => left.time.localeCompare(right.time))
    : [];
  const latest = rows.at(-1) ?? null;
  const openingRows = rows.filter(point => point.time <= "0935");
  const planDirection = plan?.ready ? plan.shadowDirection ?? null : null;
  const tapeAnchor = deriveOpeningTapeDirection(openingRows);
  const direction = planDirection ?? tapeAnchor?.direction ?? null;
  const anchorSource = planDirection ? "09:25竞价" : tapeAnchor ? "09:30-09:35开盘走势" : null;
  const base = {
    mode: "shadow-only",
    predictedDirection: direction,
    anchorDirection: direction,
    anchorSource,
    allowedDirections: [],
    confirmationCount: 0,
    requiredConfirmations: 3,
    asOfTime: latest?.time ?? plan?.asOfTime ?? null,
    expiresAt: "1501",
    executable: false,
    affectsV4: false,
  };

  if (!latest) {
    return {
      ...base,
      phase: direction ? "observed" : "unavailable",
      status: direction ? "observed" : "unavailable",
      reason: direction ? `${anchorSource}初判 ${direction}，09:30 后等待真实连续竞价。` : "尚无可冻结的开盘方向。",
    };
  }
  if (latest.time < "0935") {
    return {
      ...base,
      phase: "forming",
      status: "forming",
      reason: direction
        ? `${anchorSource}初判 ${direction}；09:35 前只收集连续竞价，不放行候选。`
        : "正在收集09:30-09:35开盘走势，尚未冻结全天方向锚。",
    };
  }
  if (!direction) {
    return { ...base, phase: "unavailable", status: "unavailable", reason: "09:25竞价与开盘走势均未形成可审计方向，全天方向锚保持中性。" };
  }

  const open = openingRows[0];
  const confirmationLatest = openingRows.at(-1);
  const vwap = weightedVwap(openingRows);
  const reference = openingRows[Math.max(0, openingRows.length - 4)] ?? open;
  const earlyVolumes = openingRows.slice(0, Math.min(3, openingRows.length)).map(point => point.volume).filter(Number.isFinite);
  const recentVolumes = openingRows.slice(-Math.min(3, openingRows.length)).map(point => point.volume).filter(Number.isFinite);
  const directionSign = direction === "正T" ? 1 : -1;
  const tapeMovePct = ((confirmationLatest.price / open.price) - 1) * 100;
  const impulsePct = ((confirmationLatest.price / reference.price) - 1) * 100;
  const vwapBiasPct = vwap ? ((confirmationLatest.price / vwap) - 1) * 100 : 0;
  const volumeRatio = average(recentVolumes) && average(earlyVolumes)
    ? average(recentVolumes) / average(earlyVolumes)
    : null;
  const checks = {
    anchor: planDirection ? plan.confidence >= 55 : Boolean(tapeAnchor),
    tape: directionSign * tapeMovePct >= -0.12,
    vwap: directionSign * vwapBiasPct >= -0.08,
    impulse: directionSign * impulsePct >= -0.04,
    volume: volumeRatio == null || volumeRatio >= 0.58,
  };
  const confirmationCount = Object.values(checks).filter(Boolean).length;
  const metrics = {
    tapeMovePct: Number(tapeMovePct.toFixed(2)),
    vwapBiasPct: Number(vwapBiasPct.toFixed(2)),
    impulsePct: Number(impulsePct.toFixed(2)),
    volumeRatio: volumeRatio == null ? null : Number(volumeRatio.toFixed(2)),
    checks,
  };
  if (confirmationCount >= base.requiredConfirmations) {
    const reversal = findStrictDirectionReversal({ rows, openingRows, anchorDirection: direction });
    if (reversal) {
      return {
        ...base,
        phase: "reversed",
        status: "reversed",
        allowedDirections: [reversal.direction],
        confirmationCount,
        metrics,
        reversal,
        reason: `全天方向锚原为${direction}；${reversal.confirmedAt.slice(0, 2)}:${reversal.confirmedAt.slice(2)}通过VWAP、OFI、开盘区间、量能及大盘板块联合确认，切换为${reversal.direction}。`,
      };
    }
    return {
      ...base,
      phase: "confirmed",
      status: "confirmed",
      allowedDirections: [direction],
      confirmationCount,
      metrics,
      reason: `${anchorSource}方向已冻结（${confirmationCount}/5），全天仅为${direction}候选提供影子许可。`,
    };
  }
  return {
    ...base,
    phase: "invalidated",
    status: "blocked",
    confirmationCount,
    metrics,
    reason: `${anchorSource}初判${direction}未获09:35开盘走势确认（${confirmationCount}/5），全天方向候选均降级观察。`,
  };
}

/**
 * Translate the frozen pre-open gate into a small, audit-friendly permission
 * object.  The caller decides whether this is shadow-only or formally
 * enforced; this helper never turns a research signal into an order.
 */
export function resolveZijinPreopenDirectionPermission({
  gate = null,
  direction = null,
  time = null,
} = {}) {
  const normalizedTime = normalizeTime(time);
  const normalizedDirection = ["正T", "反T"].includes(direction) ? direction : null;
  const expiresAt = normalizeTime(gate?.expiresAt) || "1501";
  const gateStatus = gate?.status || "unavailable";
  const active = Boolean(
    normalizedDirection
    && normalizedTime >= "0935"
    && normalizedTime < expiresAt
    && ["confirmed", "reversed"].includes(gateStatus),
  );
  const allowedDirections = Array.isArray(gate?.allowedDirections)
    ? gate.allowedDirections.filter(item => ["正T", "反T"].includes(item))
    : [];
  const allowed = active && ["confirmed", "reversed"].includes(gateStatus) && allowedDirections.includes(normalizedDirection);
  const wouldBlock = active && !allowed;

  return {
    mode: gate?.mode || "shadow-only",
    active,
    wouldBlock,
    allowed,
    direction: normalizedDirection,
    predictedDirection: gate?.predictedDirection || null,
    allowedDirections,
    status: gateStatus,
    confirmationCount: Number(gate?.confirmationCount) || 0,
    expiresAt,
    source: gate?.anchorSource === "09:30-09:35开盘走势" ? "opening-tape-all-day-anchor" : "preopen-l2-all-day-anchor",
    reason: !normalizedDirection
      ? "候选方向缺失，盘前许可仅保留审计记录"
      : !active
        ? gateStatus === "expired"
          ? "全天方向锚已于收盘失效"
          : gateStatus === "blocked"
            ? "盘前方向未获09:35多源确认，候选保持中性观察"
            : "盘前方向许可尚未进入09:35后的确认窗口"
        : allowed
          ? `${gateStatus === "reversed" ? "严格反转" : "全天方向锚"}已确认：允许${normalizedDirection}候选进入影子对照`
          : `盘前许可仅允许${allowedDirections.join("/") || "无方向"}，影子对照应阻断${normalizedDirection}`,
  };
}
