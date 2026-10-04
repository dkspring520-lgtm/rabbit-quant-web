export const DATASET_CONTRACT_VERSION = "OFFLINE_RL_DATASET_CONTRACT_V0.12.16";
export const DATASET_CONTRACT_STATUS = "PROPOSAL_ONLY";
export const TRANSITION_SCHEMA = "(state, action, reward, next_state, done)";

export const DATASET_SCHEMA = Object.freeze({
  state: {
    account: ["cash", "position", "sellablePosition", "averageCost", "observedReferencePrice", "portfolioValue"],
    marketContext: "causal market context features only"
  },
  action: ["actionType", "requestedQuantity", "executedQuantity", "executionStatus"],
  reward: ["reward", "rewardFormulaVersion", "attributionType"],
  nextState: { account: ["cash", "position", "sellablePosition", "averageCost", "observedReferencePrice", "portfolioValue"] },
  done: "boolean; terminal transition has nextState null"
});

export function auditDatasetContractRecord(record) {
  const errors = [];
  const state = record?.state ?? {};
  const account = state.accountState ?? state.account ?? {};
  const market = state.marketState ?? {};
  const action = record?.action ?? {};
  const next = record?.nextState;
  if (!record || typeof record !== "object") errors.push("record_missing");
  if (!Object.hasOwn(record ?? {}, "state")) errors.push("state_missing");
  if (!Object.hasOwn(record ?? {}, "reward")) errors.push("reward_missing");
  if (typeof record?.done !== "boolean") errors.push("done_not_boolean");
  if (record?.done === true && next !== null) errors.push("terminal_next_state_must_be_null");
  if (record?.done === false && next === null) errors.push("nonterminal_next_state_missing");
  if (account.sellablePosition !== undefined && account.position !== undefined && Number(account.sellablePosition) > Number(account.position)) errors.push("sellable_exceeds_position");
  const futureFeatureKeys = ["futurePrice", "forwardReturn1", "forwardReturn3", "forwardReturn5", "forwardReturn10", "futurePortfolioValue", "futureExecution"];
  for (const key of futureFeatureKeys) if (Object.hasOwn(market, key) || Object.hasOwn(account, key)) errors.push(`future_feature:${key}`);
  const status = String(action.executionStatus ?? record.executionResult?.status ?? "").toUpperCase();
  const blocked = status === "REJECTED" || status === "BLOCKED" || status === "INVALID" || record.blockedExecution === true;
  const blockedEncoding = blocked ? (record.reward === null || record.reward === undefined || record.blockedAction === true) : true;
  if (!blockedEncoding) errors.push("blocked_action_encoding");
  return { valid: errors.length === 0, errors, checks: { noFutureFeatureLeakage: !errors.some(e => e.startsWith("future_feature:")), rewardTimestampAlignment: Boolean(record?.timestamp), tPlusOneSellableConsistency: !errors.includes("sellable_exceeds_position"), blockedActionEncoding: blockedEncoding, terminalStateEncoding: !(record?.done === true && next !== null) } };
}
