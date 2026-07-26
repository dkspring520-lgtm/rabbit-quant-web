import { buildCausalReferencePoints } from "./causal-reference-points.mjs";

const RESEARCH_ONLY_BLOCKER = "紫金专属研究候选：未通过正式执行门槛，不下单、不计胜率或收益";

function researchObservationLabel(point) {
  const sourceLabel = String(point.confirmationLabel ?? "");
  // Keep chart labels compact. Research-only status lives in the point data,
  // not in every label drawn over the price line.
  if (sourceLabel.includes("低位")) return "低位观察";
  if (sourceLabel.includes("高位")) return "高位观察";
  return point.direction === "正T" ? "反弹观察" : "回落观察";
}

/**
 * 紫金矿业回放专用的候选标记层。
 *
 * 这只是把已经因果确认的观察参考以更容易识别的“候选买/卖点”展示出来，
 * 不改变 Smart-T 的交易决策、诊断计数或收益计算。真正由引擎产生的候选
 * 保持原样；自动补全的标记永远带 coverageOnly，供研究和复盘使用。
 */
export function buildZijinReplayCandidates(minutes, observations = []) {
  return buildCausalReferencePoints(minutes, observations).map((point) => {
    // Engine candidates have passed the strategy's own direction-flip and
    // cooldown checks, so their meaning and label must remain untouched.
    if (point.stage === "candidate") return point;
    return {
      ...point,
      // These are coverage/research observations, not engine candidates. They
      // stay on the replay chart but never enter candidate-cycle statistics.
      stage: "watch",
      coverageOnly: true,
      confirmationLabel: researchObservationLabel(point),
      blockers: [RESEARCH_ONLY_BLOCKER, ...(point.blockers ?? [])],
      reason: `${point.reason}；紫金专属研究候选，仅供回放观察`,
    };
  });
}
