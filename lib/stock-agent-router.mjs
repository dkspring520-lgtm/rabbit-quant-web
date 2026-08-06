import {
  calculateZijinFactorSnapshot,
  calculateZijinTrendContinuationRisk,
} from "./zijin-factor-research.mjs";
import { evaluateZijinOpeningPlaybook } from "./zijin-opening-playbook.mjs";
import { summarizeZijinOrderFlow } from "./qmt-orderflow-confirmation.mjs";
import { evaluateZijinStructure } from "./zijin-structure-engine.mjs";
import { evaluateZijinLargeOrder } from "./zijin-large-order-confirmation.mjs";
import { evaluateZijinRepairCandidate } from "./zijin-repair-candidate.mjs";
import { resolveZijinPreopenDirectionPermission } from "./zijin-preopen-price-plan.mjs";

export const STOCK_AGENTS = Object.freeze({
  smartT: Object.freeze({
    id: "smart-t-v4",
    code: "*",
    name: "Smart-T 融合策略 V4",
    shortName: "V4",
    mode: "formal",
    badge: "正式策略",
    canExecute: true,
    affectsV4: true,
  }),
  zijin: Object.freeze({
    id: "zijin-agent",
    code: "601899",
    name: "紫金矿业研究模型（未毕业）",
    shortName: "紫金研究",
    mode: "research-only",
    badge: "研究观察版",
    canExecute: false,
    affectsV4: false,
  }),
});

export function resolveStockAgent(code) {
  return String(code || "") === STOCK_AGENTS.zijin.code
    ? STOCK_AGENTS.zijin
    : STOCK_AGENTS.smartT;
}

function emptyEvaluation(agent, message) {
  return {
    agent,
    phase: "waiting",
    status: "waiting",
    direction: null,
    score: 0,
    asOfTime: null,
    title: "等待真实分钟数据",
    reasons: [message],
    metrics: { rangePct: 0, vwapBiasPct: 0, momentumPct: 0, volumeRatio: null },
    executable: false,
    affectsV4: false,
  };
}

function attachZijinPreopenPermission(evaluation, preopenGate) {
  const permission = resolveZijinPreopenDirectionPermission({
    gate: preopenGate,
    direction: evaluation.direction,
    time: evaluation.asOfTime,
  });
  const blockedCandidate = evaluation.status === "candidate" && permission.active && permission.wouldBlock;
  return {
    ...evaluation,
    status: blockedCandidate ? "watch" : evaluation.status,
    title: blockedCandidate ? `${evaluation.title} · 方向许可观察` : evaluation.title,
    reasons: permission.active ? [...evaluation.reasons, permission.reason] : evaluation.reasons,
    metrics: { ...evaluation.metrics, preopenPermission: permission },
  };
}

/**
 * Route one stock to its dedicated research agent without changing V4.
 * The evaluator is causal: it only reads the minute prefix provided by the caller.
 */
export function evaluateStockAgent({
  code,
  minutes = [],
  previousClose = null,
  historicalBars = [],
  sameTimeMedianNotional = null,
  preopenGate = null,
} = {}) {
  const agent = resolveStockAgent(code);
  if (agent.id !== STOCK_AGENTS.zijin.id) return null;
  if (!Array.isArray(minutes) || !minutes.length) {
    return emptyEvaluation(agent, "尚无有效分钟数据；紫金研究模型保持等待，不生成买卖成交。");
  }

  const latestTime = String(minutes.at(-1)?.time || "").replace(/:/g, "").slice(0, 4);
  const orderFlow = summarizeZijinOrderFlow(minutes.at(-1));
  const structure = evaluateZijinStructure({minutes, historicalBars});
  const largeOrder = evaluateZijinLargeOrder({
    minutes,
    structure,
    sameTimeMedianNotional,
  });
  const repair = evaluateZijinRepairCandidate(minutes);
  const largeOrderState = largeOrder.stateMachine?.state;
  const largeOrderDirection = largeOrderState === "positive-t-confirmed"
    ? "正T"
    : largeOrderState === "reverse-t-confirmed"
      ? "反T"
      : null;
  const largeOrderCandidate = Boolean(
    largeOrderDirection
    && (largeOrderDirection === "正T"
      ? structure.permissions?.positiveT !== false
      : structure.permissions?.reverseT !== false),
  );
  const repairRiskBlocked = structure.permissions?.positiveT === false
    || largeOrder.absorption
    || largeOrder.directionConflict;
  if (latestTime && repair.status === "candidate" && !repairRiskBlocked) {
    return attachZijinPreopenPermission({
      agent,
      phase: "intraday",
      status: "candidate",
      direction: "正T",
      score: repair.score,
      asOfTime: repair.asOfTime,
      title: repair.title,
      reasons: [
        ...repair.reasons,
        "该信号属于紫金专属修复候选，不直接生成正式成交；后续结果进入5/15/30分钟前瞻标签。",
      ],
      metrics: {
        rangePct: repair.metrics.rangePct,
        vwapBiasPct: repair.metrics.vwapBiasPct,
        momentumPct: repair.metrics.momentum3Pct,
        volumeRatio: repair.metrics.pullbackVolumeRatio,
        orderFlow,
        structure,
        largeOrder,
        repair,
      },
      executable: false,
      affectsV4: false,
    }, preopenGate);
  }
  const repairWatch = latestTime
    && repair.status === "watch"
    && repair.hardConditions?.deepVwapDiscount
    && repair.checks?.secondBottom
    && repair.checks?.lowZoneWatch;
  if (repairWatch) {
    return attachZijinPreopenPermission({
      agent,
      phase: "intraday",
      status: "watch",
      direction: "正T",
      score: repair.score,
      asOfTime: repair.asOfTime,
      title: repairRiskBlocked ? `${repair.title}·方向受限` : repair.title,
      reasons: [
        ...repair.reasons,
        ...(repairRiskBlocked
          ? ["多周期方向或订单流风险尚未解除，只跟踪磨底进度，不升级为候选。"]
          : []),
        "低位本身不是买点；二次探底、抛压衰减、L2回流与局部突破会按阶段逐级确认。",
      ],
      metrics: {
        rangePct: repair.metrics.rangePct,
        vwapBiasPct: repair.metrics.vwapBiasPct,
        momentumPct: repair.metrics.momentum3Pct,
        volumeRatio: repair.metrics.pullbackVolumeRatio,
        orderFlow,
        structure,
        largeOrder,
        repair,
      },
      executable: false,
      affectsV4: false,
    }, preopenGate);
  }
  if (!latestTime) return emptyEvaluation(agent, "最新分钟时间无效，保持等待。");

  if (latestTime <= "1030") {
    const opening = evaluateZijinOpeningPlaybook(minutes, { previousClose });
    const trendContinuationRisk = opening.direction
      ? calculateZijinTrendContinuationRisk(minutes, opening.direction)
      : null;
    const directionDisagreement = Boolean(
      largeOrderCandidate
      && opening.direction
      && opening.direction !== largeOrderDirection,
    );
    const hardBlocked = opening.status === "candidate" && (
      trendContinuationRisk?.blocked
      || largeOrder.absorption
      || largeOrder.directionConflict
      || directionDisagreement
      || (opening.direction === "正T" && structure.permissions?.positiveT === false)
      || (opening.direction === "反T" && structure.permissions?.reverseT === false)
    );
    const promotedByLargeOrder = largeOrderCandidate
      && !hardBlocked
      && !directionDisagreement
      && opening.status !== "blocked";
    const selectedDirection = promotedByLargeOrder ? largeOrderDirection : opening.direction;
    return attachZijinPreopenPermission({
      agent,
      phase: "opening",
      status: hardBlocked ? "watch" : promotedByLargeOrder ? "candidate" : opening.status,
      direction: selectedDirection,
      score: promotedByLargeOrder ? Math.max(opening.score, largeOrder.score) : opening.score,
      asOfTime: promotedByLargeOrder ? largeOrder.asOfTime : opening.asOfTime,
      title: hardBlocked
        ? `${opening.direction || largeOrderDirection || "早盘"}硬门禁`
        : promotedByLargeOrder
          ? `${largeOrderDirection}大单回踩确认`
        : opening.status === "candidate"
        ? `${opening.direction}早盘候选`
        : opening.status === "blocked"
          ? "早盘异常波动暂停"
          : opening.status === "waiting"
            ? "正在积累早盘样本"
            : "早盘结构继续观察",
      reasons: hardBlocked
        ? [
          `硬门禁：${directionDisagreement ? "早盘方向与大单回踩方向冲突" : largeOrder.absorption ? largeOrder.reason : largeOrder.directionConflict ? "大单方向与多周期结构冲突" : trendContinuationRisk?.reason || "当前大方向不允许该类做T"}。`,
          "下跌延续不先买、上涨延续不先卖；等待实时反转确认后再重新评估。",
          ...opening.reasons,
        ]
        : [
          ...(promotedByLargeOrder ? [`${largeOrder.stateMachine.label}；触发价 ¥${largeOrder.stateMachine.triggerPrice.toFixed(2)}，大单成本约 ¥${largeOrder.stateMachine.costPrice.toFixed(2)}。`] : []),
          ...opening.reasons,
          orderFlow.reason,
          `大单状态：${largeOrder.stateMachine?.label || largeOrder.label}`,
        ],
      metrics: {
        rangePct: opening.metrics.openingRangePct,
        vwapBiasPct: opening.metrics.distanceToVwapPct,
        momentumPct: opening.direction === "正T"
          ? opening.metrics.recoveryFromLowPct
          : opening.metrics.pullbackFromHighPct,
        volumeRatio: opening.metrics.volumeRatio,
        trendContinuationRisk,
        orderFlow,
        structure,
        largeOrder,
        repair,
      },
      executable: false,
      affectsV4: false,
    }, preopenGate);
  }

  const factor = calculateZijinFactorSnapshot(minutes, previousClose);
  const promotedByLargeOrder = largeOrderCandidate
    && !largeOrder.absorption
    && !largeOrder.directionConflict;
  const factorL2Blocked = factor.status === "candidate" && !orderFlow.available;
  const intradayStatus = largeOrder.absorption || largeOrder.directionConflict || factorL2Blocked
    ? "watch"
    : promotedByLargeOrder
      ? "candidate"
      : factor.status;
  return attachZijinPreopenPermission({
    agent,
    phase: "intraday",
    status: intradayStatus,
    direction: promotedByLargeOrder ? largeOrderDirection : factor.directionLabel,
    score: promotedByLargeOrder ? Math.max(factor.score, largeOrder.score) : factor.score,
    asOfTime: promotedByLargeOrder ? largeOrder.asOfTime : factor.asOfTime,
    title: promotedByLargeOrder
      ? `${largeOrderDirection}大单回踩确认`
      : factor.status === "candidate"
      ? `${factor.directionLabel}因子候选`
      : factor.status === "waiting"
        ? "正在积累全天样本"
        : `${factor.directionLabel || "双向"}因子继续观察`,
    reasons: [
      ...(factorL2Blocked
        ? ["价格与量能已形成因子候选，但缺少同分钟真实 L2 订单流确认，降为观察，不生成候选提醒。"]
        : []),
      ...(promotedByLargeOrder
        ? [`${largeOrder.stateMachine.label}；触发价 ¥${largeOrder.stateMachine.triggerPrice.toFixed(2)}，大单成本约 ¥${largeOrder.stateMachine.costPrice.toFixed(2)}。`]
        : []),
      `${factor.label}；当前距 VWAP ${factor.vwapBiasPct >= 0 ? "+" : ""}${factor.vwapBiasPct.toFixed(2)}%，最近3分钟动量 ${factor.momentum3Pct >= 0 ? "+" : ""}${factor.momentum3Pct.toFixed(2)}%。`,
      ...(factor.trendContinuationRisk?.blocked
        ? [`硬门禁：${factor.trendContinuationRisk.reason}。`]
        : []),
      factor.volumeRatio == null
        ? "有效成交量基线不足，保持观察。"
        : `最近成交量比 ${factor.volumeRatio.toFixed(2)}×，日内振幅 ${factor.rangePct.toFixed(2)}%。`,
      `多周期方向：${structure.direction} ${structure.directionScore >= 0 ? "+" : ""}${structure.directionScore}；因果缠论：${structure.chan.location}；威科夫：${structure.wyckoff.phase}。`,
      `大单状态：${largeOrder.stateMachine?.label || largeOrder.label}；${largeOrder.reason}。`,
      "该智能体尚未通过样本外验证，仅输出专属候选与解释，不生成正式成交。",
    ],
    metrics: {
      rangePct: factor.rangePct,
      vwapBiasPct: factor.vwapBiasPct,
      momentumPct: factor.momentum3Pct,
      volumeRatio: factor.volumeRatio,
      trendContinuationRisk: factor.trendContinuationRisk,
      orderFlow,
      structure,
      largeOrder,
      repair,
    },
    executable: false,
    affectsV4: false,
  }, preopenGate);
}
