import { calculateZijinFactorSnapshot } from "./zijin-factor-research.mjs";
import { evaluateZijinOpeningPlaybook } from "./zijin-opening-playbook.mjs";

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
    name: "紫金矿业智能体",
    shortName: "紫金专属",
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

/**
 * Route one stock to its dedicated research agent without changing V4.
 * The evaluator is causal: it only reads the minute prefix provided by the caller.
 */
export function evaluateStockAgent({ code, minutes = [], previousClose = null } = {}) {
  const agent = resolveStockAgent(code);
  if (agent.id !== STOCK_AGENTS.zijin.id) return null;
  if (!Array.isArray(minutes) || !minutes.length) {
    return emptyEvaluation(agent, "尚无有效分钟数据；紫金专属研究保持等待，不生成买卖成交。");
  }

  const latestTime = String(minutes.at(-1)?.time || "").replace(/:/g, "").slice(0, 4);
  if (!latestTime) return emptyEvaluation(agent, "最新分钟时间无效，保持等待。");

  if (latestTime <= "1030") {
    const opening = evaluateZijinOpeningPlaybook(minutes, { previousClose });
    return {
      agent,
      phase: "opening",
      status: opening.status,
      direction: opening.direction,
      score: opening.score,
      asOfTime: opening.asOfTime,
      title: opening.status === "candidate"
        ? `${opening.direction}早盘候选`
        : opening.status === "blocked"
          ? "早盘异常波动暂停"
          : opening.status === "waiting"
            ? "正在积累早盘样本"
            : "早盘结构继续观察",
      reasons: opening.reasons,
      metrics: {
        rangePct: opening.metrics.openingRangePct,
        vwapBiasPct: opening.metrics.distanceToVwapPct,
        momentumPct: opening.direction === "正T"
          ? opening.metrics.recoveryFromLowPct
          : opening.metrics.pullbackFromHighPct,
        volumeRatio: opening.metrics.volumeRatio,
      },
      executable: false,
      affectsV4: false,
    };
  }

  const factor = calculateZijinFactorSnapshot(minutes, previousClose);
  return {
    agent,
    phase: "intraday",
    status: factor.status,
    direction: factor.directionLabel,
    score: factor.score,
    asOfTime: factor.asOfTime,
    title: factor.status === "candidate"
      ? `${factor.directionLabel}因子候选`
      : factor.status === "waiting"
        ? "正在积累全天样本"
        : `${factor.directionLabel || "双向"}因子继续观察`,
    reasons: [
      `${factor.label}；当前距 VWAP ${factor.vwapBiasPct >= 0 ? "+" : ""}${factor.vwapBiasPct.toFixed(2)}%，最近3分钟动量 ${factor.momentum3Pct >= 0 ? "+" : ""}${factor.momentum3Pct.toFixed(2)}%。`,
      factor.volumeRatio == null
        ? "有效成交量基线不足，保持观察。"
        : `最近成交量比 ${factor.volumeRatio.toFixed(2)}×，日内振幅 ${factor.rangePct.toFixed(2)}%。`,
      "该智能体尚未通过样本外验证，仅输出专属候选与解释，不生成正式成交。",
    ],
    metrics: {
      rangePct: factor.rangePct,
      vwapBiasPct: factor.vwapBiasPct,
      momentumPct: factor.momentum3Pct,
      volumeRatio: factor.volumeRatio,
    },
    executable: false,
    affectsV4: false,
  };
}
