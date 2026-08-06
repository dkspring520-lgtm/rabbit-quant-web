const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const roundPrice = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const finitePositive = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeTime = value => String(value ?? "").replace(/\D/g, "").slice(-4);
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function weightedVwap(points) {
  const weighted = points.reduce((sum, point) => sum + point.price * Math.max(0, point.volume), 0);
  const volume = points.reduce((sum, point) => sum + Math.max(0, point.volume), 0);
  return volume > 0 ? weighted / volume : average(points.map(point => point.price));
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
  const direction = plan?.ready ? plan.shadowDirection ?? null : null;
  const rows = Array.isArray(minutes)
    ? minutes
      .map(point => ({ time: normalizeTime(point?.time), price: Number(point?.price), volume: Number(point?.volume) }))
      .filter(point => /^\d{4}$/.test(point.time) && Number.isFinite(point.price) && point.price > 0 && point.time >= "0930")
      .sort((left, right) => left.time.localeCompare(right.time))
    : [];
  const latest = rows.at(-1) ?? null;
  const base = {
    mode: "shadow-only",
    predictedDirection: direction,
    allowedDirections: [],
    confirmationCount: 0,
    requiredConfirmations: 3,
    asOfTime: latest?.time ?? plan?.asOfTime ?? null,
    expiresAt: "1000",
    executable: false,
    affectsV4: false,
  };

  if (!plan?.ready || !direction) {
    return { ...base, phase: "unavailable", status: "unavailable", reason: "未冻结可审计的 09:25 同向竞价结论，早盘只保留常规观察。" };
  }
  if (!latest) {
    return { ...base, phase: "observed", status: "observed", reason: `09:25 初判 ${direction}，09:30 后等待真实连续竞价。` };
  }
  if (latest.time >= "1000") {
    return { ...base, phase: "expired", status: "expired", reason: "盘前方向影子许可已于 10:00 到期，后续只使用实时因果层。" };
  }

  const open = rows[0];
  const vwap = weightedVwap(rows);
  const reference = rows[Math.max(0, rows.length - 4)] ?? open;
  const earlyVolumes = rows.slice(0, Math.min(3, rows.length)).map(point => point.volume).filter(Number.isFinite);
  const recentVolumes = rows.slice(-Math.min(3, rows.length)).map(point => point.volume).filter(Number.isFinite);
  const directionSign = direction === "正T" ? 1 : -1;
  const tapeMovePct = ((latest.price / open.price) - 1) * 100;
  const impulsePct = ((latest.price / reference.price) - 1) * 100;
  const vwapBiasPct = vwap ? ((latest.price / vwap) - 1) * 100 : 0;
  const volumeRatio = average(recentVolumes) && average(earlyVolumes)
    ? average(recentVolumes) / average(earlyVolumes)
    : null;
  const checks = {
    auction: plan.confidence >= 55,
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
  if (latest.time < "0935") {
    return {
      ...base,
      phase: "forming",
      status: "forming",
      confirmationCount,
      metrics,
      reason: `09:25 初判 ${direction}；${latest.time.slice(0, 2)}:${latest.time.slice(2)} 前只收集连续竞价，不放行候选。`,
    };
  }
  if (confirmationCount >= base.requiredConfirmations) {
    return {
      ...base,
      phase: "confirmed",
      status: "confirmed",
      allowedDirections: [direction],
      confirmationCount,
      metrics,
      reason: `09:25 初判与开盘真实走势同向（${confirmationCount}/5），仅为 ${direction} 候选提供影子许可。`,
    };
  }
  return {
    ...base,
    phase: "invalidated",
    status: "blocked",
    confirmationCount,
    metrics,
    reason: `09:25 初判 ${direction} 未获开盘真实走势确认（${confirmationCount}/5），影子许可已拒绝。`,
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
  const expiresAt = normalizeTime(gate?.expiresAt) || "1000";
  const gateStatus = gate?.status || "unavailable";
  const active = Boolean(
    normalizedDirection
    && normalizedTime >= "0935"
    && normalizedTime < expiresAt
    && ["confirmed", "blocked"].includes(gateStatus),
  );
  const allowedDirections = Array.isArray(gate?.allowedDirections)
    ? gate.allowedDirections.filter(item => ["正T", "反T"].includes(item))
    : [];
  const allowed = active && gateStatus === "confirmed" && allowedDirections.includes(normalizedDirection);
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
    source: "preopen-l2-tape-vwap-volume",
    reason: !normalizedDirection
      ? "候选方向缺失，盘前许可仅保留审计记录"
      : !active
        ? gateStatus === "expired"
          ? "盘前方向许可已到期，后续只使用实时因果层"
          : "盘前方向许可尚未进入09:35后的确认窗口"
        : allowed
          ? `盘前方向许可已确认：允许${normalizedDirection}候选进入影子对照`
          : gateStatus === "blocked"
            ? "盘前方向未获09:35多源确认，影子对照应阻断该候选"
            : `盘前许可仅允许${allowedDirections.join("/") || "无方向"}，影子对照应阻断${normalizedDirection}`,
  };
}
