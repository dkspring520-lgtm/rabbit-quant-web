export const CONTRACT_VERSION = "OBSERVED_PRICE_REWARD_CONTRACT_V0.12.15";
export const REWARD_OBJECTIVE = "F2_NORMALIZED_PORTFOLIO_RETURN";
export const HORIZON_TYPE = "NEXT_OBSERVATION";
export const ATTRIBUTION_TYPE = "POSITION_INTERVAL";
export const ACCOUNTING_MODE = "ACCOUNTING_CLOSED";
export const NO_ACTION_MODE = "OBSERVED_PORTFOLIO_MOVEMENT";
export const BLOCKED_ACTION_MODE = "FEASIBILITY_AWARE";
export const OBSERVED_PRICE_CONTRACT_ID = "OBSERVED_PRICE_RESEARCH_CONTRACT_V1";

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

function accountValue(account, state) {
  const cash = finite(account?.cash);
  const position = finite(account?.position);
  const price = finite(state?.marketState?.price ?? state?.marketState?.observedReferencePrice);
  if (cash === null || position === null || price === null || price <= 0) return null;
  return cash + position * price;
}

export function calculateObservedPriceReward({ preActionState, postActionState, actionResult = {}, executionResult = actionResult, epsilon = 1e-9, terminal = false } = {}) {
  const pre = preActionState?.accountState ?? preActionState?.account ?? preActionState;
  const post = postActionState?.accountState ?? postActionState?.account ?? postActionState;
  const preValue = accountValue(pre, preActionState);
  const postValue = accountValue(post, postActionState);
  const status = String(executionResult?.status ?? actionResult?.status ?? "").toUpperCase();
  const blocked = status === "REJECTED" || status === "BLOCKED" || status === "INVALID" || actionResult?.feasible === false || actionResult?.actionFeasibility === "INFEASIBLE";
  const rewardValue = blocked || preValue === null || postValue === null ? null : (postValue - preValue) / Math.max(Math.abs(preValue), epsilon);
  return {
    rewardValue,
    attributionType: ATTRIBUTION_TYPE,
    horizonType: HORIZON_TYPE,
    accountingMode: ACCOUNTING_MODE,
    contractVersion: CONTRACT_VERSION,
    validationStatus: blocked ? "BLOCKED_FEASIBILITY_AWARE" : rewardValue === null ? (terminal ? "INVALID_TERMINAL_INPUT" : "INVALID_REWARD_INPUT") : "VALID",
    objective: REWARD_OBJECTIVE,
    noActionMode: NO_ACTION_MODE,
    blockedActionMode: BLOCKED_ACTION_MODE,
    observedPriceContractId: OBSERVED_PRICE_CONTRACT_ID,
    terminal: Boolean(terminal),
    accountingClosed: true,
    feeDeductedAtRewardLayer: false,
    slippageDeductedAtRewardLayer: false,
    executionStatus: status || null,
    blockedExecution: blocked,
    prePortfolioValue: preValue,
    postPortfolioValue: postValue
  };
}
