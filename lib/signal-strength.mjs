const validScore = value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

// Scores measure confirmation, while the existing historical probability
// measures a price-path hit. Neither is a net trading win rate.
export function signalStrengthPresentation({ score = null, historicalProbability = null } = {}) {
  if (validScore(historicalProbability)) return {
    label: `命中 ${Math.round(historicalProbability)}%`,
    detail: "历史相似走势命中率，不是扣费后的交易胜率",
  };
  if (validScore(score)) return {
    label: `${Math.round(score)}分`,
    detail: `确认评分 ${Math.round(score)}/100；历史胜率待校准`,
  };
  return { label: "待评分", detail: "确认数据不足；历史胜率待校准" };
}

export function observationConfirmationScore(observation, strategy) {
  if (validScore(observation?.confirmationScore)) return observation.confirmationScore;
  if (strategy === "v29") {
    const votes = observation?.score;
    return typeof votes === "number" && Number.isFinite(votes) && votes >= 0 && votes <= 4
      ? Math.round(votes / 4 * 100) : null;
  }
  if (strategy === "closure") {
    const breakdown = observation?.scoreBreakdown;
    const values = [breakdown?.direction, breakdown?.location, breakdown?.trigger];
    return values.every(validScore) ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  }
  return null;
}
