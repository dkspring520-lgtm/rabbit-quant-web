const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const roundPrice = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const finitePositive = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

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
    source: l2Usable ? `09:25竞价结果 · ${flowLabel}` : "09:25竞价结果 · L2降级",
    reason: `按09:25已知竞价结果生成；${flowLabel}。区间只用于开盘观察，09:30后由真实成交重新计算。`,
  };
}
