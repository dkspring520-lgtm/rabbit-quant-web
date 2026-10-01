const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export function calculateRLReward({ tradeProfit = 0, fees = 0, slippage = 0, drawdown = 0, overtrade = 0, invalid = false, weights = {} } = {}) { const reward = finite(tradeProfit) - finite(fees) - finite(slippage) - finite(drawdown) * finite(weights.drawdownPenalty ?? 1) - finite(overtrade) * finite(weights.overtradePenalty ?? 1) - (invalid ? finite(weights.invalidPenalty ?? 1) : 0); return Number(reward.toFixed(8)); }

export function calculateRateReward({ futureReturnRate = 0, feeRate = 0, slippageRate = 0, drawdownRate = 0, tradePenalty = 0, invalid = false } = {}) {
  const reward = finite(futureReturnRate) - finite(feeRate) - finite(slippageRate) - finite(drawdownRate) - finite(tradePenalty) - (invalid ? 1 : 0);
  return Number(reward.toFixed(8));
}
