const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function explainTrainingRejection(experiment, latest = {}) {
  if (!experiment?.hypotheses?.length) {
    return {
      headline: "还没有形成可比较的样本外成绩",
      reasons: ["训练数据仍在整理，或本轮假设尚未产生足够交易。"],
      next: latest.nextAction || "等待新假设或真实外部因子后再启动新一轮。",
    };
  }
  if (experiment.qualifiedHypothesisIds?.length) {
    return {
      headline: "已有候选通过，但还不能直接用于正式买卖",
      reasons: ["下一步仍需一次封存盲测、服务器影子观察和人工评审。"],
      next: latest.nextAction || "申请最终盲测和影子观察。",
    };
  }

  const hypotheses = experiment.hypotheses;
  const totalTrades = hypotheses.reduce((total, item) => total + (item.outerQuarters ?? []).reduce((sum, quarter) => sum + finite(quarter.trades), 0), 0);
  const bestWinRate = Math.max(...hypotheses.map(item => finite(item.outOfSampleWinRate)));
  const bestNet = Math.max(...hypotheses.map(item => finite(item.evaluation?.metrics?.meanNetPct, -Infinity)));
  const bestStressNet = Math.max(...hypotheses.map(item => finite(item.evaluation?.metrics?.meanStressNetPct, -Infinity)));
  const bestQuarterRatio = Math.max(...hypotheses.map(item => finite(item.evaluation?.metrics?.positiveQuarterRatio)));
  const lowestPbo = Math.min(...hypotheses.map(item => finite(item.evaluation?.metrics?.pbo, 1)));
  const bestDsr = Math.max(...hypotheses.map(item => finite(item.evaluation?.metrics?.deflatedSharpeProbability)));
  const reasons = [];

  if (totalTrades < 40) reasons.push(`样本外只有 ${totalTrades} 笔交易，数量太少，暂时不能把胜率当规律。`);
  if (bestWinRate < 0.65) reasons.push(`最好一组样本外胜率 ${(bestWinRate * 100).toFixed(1)}%，低于 65% 研究门槛。`);
  if (bestNet <= 0) reasons.push(`表现最好的一组扣除费用后平均仍为 ${bestNet.toFixed(4)}%，长期期望没有转正。`);
  else if (bestStressNet <= 0) reasons.push(`普通费用下略有利润，但把滑点调到压力水平后降为 ${bestStressNet.toFixed(4)}%，不够抗实盘误差。`);
  if (bestQuarterRatio < 0.65) reasons.push(`最好一组仅 ${(bestQuarterRatio * 100).toFixed(0)}% 的季度赚钱，换一段行情就容易失效。`);
  if (lowestPbo > 0.2) reasons.push(`最低过拟合风险仍有 ${(lowestPbo * 100).toFixed(1)}%，参数可能只是碰巧适合这批历史数据。`);
  if (bestDsr < 0.95) reasons.push(`多次试验后的统计可信度只有 ${(bestDsr * 100).toFixed(1)}%，还不足以证明优势不是运气。`);

  return {
    headline: bestNet <= 0 ? "扣掉费用后仍没有稳定赚钱" : "有局部利润，但稳定性和可信度还不够",
    reasons: reasons.slice(0, 4),
    next: latest.nextAction || "只允许加入新假设或真实外部因子后再训练，不再用原数据反复调参。",
  };
}
