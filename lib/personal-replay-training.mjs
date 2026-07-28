const MIN_COMMISSION = 5;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeTrainingQuantity(value) {
  const quantity = Math.floor(finite(value) / 100) * 100;
  return Math.max(100, quantity);
}

export function trainingExecutionPrice({ side, marketPrice, slippage = 0.02, slippageMode = "percent" }) {
  const price = finite(marketPrice);
  if (price <= 0) return null;
  const impact = Math.max(0, finite(slippage));
  if (slippageMode === "tick") {
    return Number(Math.max(0.01, price + (side === "buy" ? impact : -impact)).toFixed(6));
  }
  const multiplier = side === "buy" ? 1 + impact / 100 : 1 - impact / 100;
  return Number(Math.max(0.01, price * multiplier).toFixed(6));
}

export function trainingOrderFee({ side, price, quantity, feeRate = 0.025, minCommission = true }) {
  const gross = Math.max(0, finite(price)) * Math.max(0, finite(quantity));
  const commission = gross * Math.max(0, finite(feeRate)) / 100;
  const brokerage = minCommission ? Math.max(MIN_COMMISSION, commission) : commission;
  const stampDuty = side === "sell" ? gross * 0.0005 : 0;
  return brokerage + stampDuty;
}

export function executePersonalTrainingOrder({
  side,
  quantity,
  marketPrice,
  cash,
  shares,
  feeRate = 0.025,
  slippage = 0.02,
  slippageMode = "percent",
  minCommission = true,
}) {
  const normalizedSide = side === "sell" ? "sell" : "buy";
  const normalizedQuantity = normalizeTrainingQuantity(quantity);
  const executionPrice = trainingExecutionPrice({ side: normalizedSide, marketPrice, slippage, slippageMode });
  if (!executionPrice) return { ok: false, error: "当前分钟没有可执行价格" };
  const fee = trainingOrderFee({ side: normalizedSide, price: executionPrice, quantity: normalizedQuantity, feeRate, minCommission });
  const gross = executionPrice * normalizedQuantity;
  const currentCash = Math.max(0, finite(cash));
  const currentShares = Math.max(0, Math.floor(finite(shares)));
  if (normalizedSide === "buy" && gross + fee > currentCash + 1e-8) return { ok: false, error: "训练资金不足，无法按该数量买入" };
  if (normalizedSide === "sell" && normalizedQuantity > currentShares) return { ok: false, error: "训练持仓不足，无法卖出超过当前持仓的数量" };
  return {
    ok: true,
    cash: normalizedSide === "buy" ? currentCash - gross - fee : currentCash + gross - fee,
    shares: normalizedSide === "buy" ? currentShares + normalizedQuantity : currentShares - normalizedQuantity,
    action: { side: normalizedSide, quantity: normalizedQuantity, marketPrice: finite(marketPrice), executionPrice, gross, fee },
  };
}

export function summarizePersonalTraining({ initialCash, initialShares, initialPrice, cash, shares, markPrice, actions = [] }) {
  const initialEquity = Math.max(0, finite(initialCash)) + Math.max(0, finite(initialShares)) * Math.max(0, finite(initialPrice));
  const equity = Math.max(0, finite(cash)) + Math.max(0, finite(shares)) * Math.max(0, finite(markPrice));
  const fees = actions.reduce((total, action) => total + Math.max(0, finite(action?.fee)), 0);
  return { initialEquity, equity, net: equity - initialEquity, fees, actionCount: actions.length };
}

export function scorePersonalTrainingActions(actions, minutes, horizon = 10) {
  const normalizedMinutes = Array.isArray(minutes) ? minutes : [];
  const normalizedHorizon = Math.max(1, Math.floor(finite(horizon, 10)));
  return (Array.isArray(actions) ? actions : []).map((action) => {
    const index = Math.floor(finite(action?.minuteIndex, -1));
    const start = finite(action?.marketPrice);
    const future = normalizedMinutes[index + normalizedHorizon];
    if (!future || start <= 0) return { ...action, evaluated: false, directionCorrect: null, changePct: null };
    const changePct = (finite(future.price) - start) / start * 100;
    const directionCorrect = action.side === "buy" ? changePct > 0 : changePct < 0;
    return { ...action, evaluated: true, directionCorrect, changePct };
  });
}
