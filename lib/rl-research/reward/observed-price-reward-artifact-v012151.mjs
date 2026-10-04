import { calculateObservedPriceReward } from "./observed-price-reward-contract-v01215.mjs";

export const ARTIFACT_VERSION = "OFFLINE_RL_REWARD_ARTIFACT_V0.12.15.1";

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

export function buildRewardArtifactRecord({ episodeId, transitionId, timestamp, action, preActionState, postActionState, actionResult, executionResult, terminal = false } = {}) {
  const reward = calculateObservedPriceReward({ preActionState, postActionState, actionResult, executionResult, terminal });
  const pre = preActionState?.accountState ?? preActionState?.account ?? preActionState;
  const post = postActionState?.accountState ?? postActionState?.account ?? postActionState;
  const observedReferencePrice = finite(postActionState?.marketState?.price ?? postActionState?.marketState?.observedReferencePrice ?? preActionState?.marketState?.price ?? preActionState?.marketState?.observedReferencePrice);
  return {
    artifactVersion: ARTIFACT_VERSION,
    episodeId,
    transitionId,
    timestamp,
    action,
    preActionState,
    postActionState,
    cash: finite(post?.cash),
    position: finite(post?.position),
    sellablePosition: finite(post?.sellablePosition),
    averageCost: finite(post?.averageCost),
    observedReferencePrice,
    portfolioValueStart: reward.prePortfolioValue,
    portfolioValueEnd: reward.postPortfolioValue,
    reward: reward.rewardValue,
    rewardFormulaVersion: "F2_NORMALIZED_PORTFOLIO_RETURN_V0.12.15",
    attributionType: reward.attributionType,
    horizonType: reward.horizonType,
    accountingMode: reward.accountingMode,
    validationStatus: reward.validationStatus,
    feeDeductedAtRewardLayer: false,
    slippageDeductedAtRewardLayer: false,
    blockedExecution: reward.blockedExecution,
    terminal: reward.terminal
  };
}

export function validateRewardArtifactRecord(record) {
  const required = ["episodeId", "transitionId", "timestamp", "action", "preActionState", "postActionState", "cash", "position", "sellablePosition", "averageCost", "observedReferencePrice", "portfolioValueStart", "portfolioValueEnd", "reward", "rewardFormulaVersion", "attributionType", "horizonType", "accountingMode"];
  const missing = required.filter(key => !(key in (record ?? {})));
  const valuesFinite = [record?.portfolioValueStart, record?.portfolioValueEnd, record?.reward].every(Number.isFinite);
  const formulaMatches = Number.isFinite(record?.portfolioValueStart) && Number.isFinite(record?.portfolioValueEnd) && Number.isFinite(record?.reward) && Math.abs(record.reward - ((record.portfolioValueEnd - record.portfolioValueStart) / Math.abs(record.portfolioValueStart))) < 1e-12;
  return { valid: missing.length === 0 && valuesFinite && formulaMatches && record.accountingMode === "ACCOUNTING_CLOSED" && record.feeDeductedAtRewardLayer === false && record.slippageDeductedAtRewardLayer === false, missing, valuesFinite, formulaMatches, accountingClosed: record?.accountingMode === "ACCOUNTING_CLOSED", noDoubleFee: record?.feeDeductedAtRewardLayer === false, noDoubleSlippage: record?.slippageDeductedAtRewardLayer === false };
}
