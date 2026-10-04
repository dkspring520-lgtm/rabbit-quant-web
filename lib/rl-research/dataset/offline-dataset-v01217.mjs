export const DATASET_VERSION = "OFFLINE_RL_DATASET_V0.12.17";
export const DATASET_STATUS = "PROPOSAL_ONLY";

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

function accountState(snapshot) {
  return {
    cash: finite(snapshot?.cash),
    position: finite(snapshot?.position),
    sellablePosition: finite(snapshot?.sellablePosition),
    todayBought: finite(snapshot?.todayBought),
    averageCost: finite(snapshot?.averageCost)
  };
}

function observedPrice(state) { return finite(state?.marketState?.price ?? state?.marketState?.observedReferencePrice); }
function portfolioValue(account, price) { return account.cash === null || account.position === null || price === null ? null : account.cash + account.position * price; }

export function buildOfflineDatasetRecord({ transition, rewardArtifact } = {}) {
  if (!transition || !rewardArtifact) throw new Error("DATASET_INPUTS_REQUIRED");
  if (transition.timestamp !== rewardArtifact.timestamp) throw new Error("REWARD_TIMESTAMP_MISMATCH");
  const preAccount = accountState(transition.preActionAccountState);
  const postAccount = accountState(transition.postActionAccountState);
  const prePrice = observedPrice({ marketState: transition.marketState });
  const postPrice = rewardArtifact.observedReferencePrice ?? prePrice;
  return {
    datasetVersion: DATASET_VERSION,
    episodeId: transition.episodeId,
    transitionId: rewardArtifact.transitionId,
    timestamp: transition.timestamp,
    state: { accountState: preAccount, marketState: { price: prePrice, features: transition.marketState?.features ?? {} } },
    action: { actionType: transition.expertAction, requestedQuantity: transition.executionResult?.quantity ?? null, executedQuantity: transition.executionResult?.status === "FILLED" ? transition.executionResult.quantity : 0, executionStatus: transition.executionResult?.status ?? null },
    reward: { reward: rewardArtifact.reward, rewardFormulaVersion: rewardArtifact.rewardFormulaVersion, attributionType: rewardArtifact.attributionType },
    nextState: transition.done ? null : { accountState: postAccount, marketState: { price: postPrice, features: {} } },
    done: Boolean(transition.done),
    terminalReason: transition.done ? "EPISODE_TERMINAL" : null,
    rewardSource: "REWARD_ARTIFACT",
    accountingMode: rewardArtifact.accountingMode,
    observedExpertBehavior: transition.observedExpertBehavior ?? true
  };
}

export function validateOfflineDatasetRecord(record) {
  const errors = [];
  if (record?.rewardSource !== "REWARD_ARTIFACT") errors.push("reward_source");
  if (!record?.state || !record?.action || !record?.reward) errors.push("schema");
  if (record?.state?.accountState?.sellablePosition > record?.state?.accountState?.position) errors.push("t1_sellable_position");
  if (record?.done && record.nextState !== null) errors.push("terminal_next_state");
  if (!record?.done && record.nextState === null) errors.push("nonterminal_missing_next_state");
  const status = String(record?.action?.executionStatus ?? "").toUpperCase();
  if (["REJECTED", "BLOCKED", "INVALID"].includes(status) && record.reward.reward !== null) errors.push("blocked_reward_encoding");
  return { valid: errors.length === 0, errors, rewardMatchesArtifact: record?.rewardSource === "REWARD_ARTIFACT", noFutureFeatureLeakage: !Object.keys(record?.state?.marketState?.features ?? {}).some(k => k.startsWith("future") || k.startsWith("forward")), t1Consistent: !errors.includes("t1_sellable_position"), blockedActionPreserved: !errors.includes("blocked_reward_encoding"), terminalEncoded: !errors.includes("terminal_next_state") };
}
