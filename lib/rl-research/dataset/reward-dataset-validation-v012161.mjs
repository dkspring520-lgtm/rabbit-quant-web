export const VALIDATION_VERSION = "OFFLINE_RL_DATASET_VALIDATION_V0.12.16.1";

const futureKeys = new Set(["futurePrice", "nextObservationPrice", "futureVolume", "terminalReward", "episodeOutcome", "forwardReturn1", "forwardReturn3", "forwardReturn5", "forwardReturn10"]);

function containsFuture(value, path = "", hits = []) {
  if (!value || typeof value !== "object") return hits;
  for (const [key, child] of Object.entries(value)) {
    const current = path ? `${path}.${key}` : key;
    if (futureKeys.has(key)) hits.push(current);
    if (child && typeof child === "object") containsFuture(child, current, hits);
  }
  return hits;
}

export function validateDatasetContractRecord(record) {
  const errors = [];
  const state = record?.state ?? {};
  const nextState = record?.nextState ?? null;
  const action = record?.action ?? {};
  const rewardSource = record?.rewardSource ?? "";
  const futureFeatureHits = containsFuture(state);
  if (futureFeatureHits.length) errors.push(...futureFeatureHits.map(key => `state_future_field:${key}`));
  if (!record?.timestamp || !record?.rewardTimestamp || record.timestamp !== record.rewardTimestamp) errors.push("reward_timestamp_misaligned");
  if (record?.nextTimestamp && record.nextTimestamp <= record.timestamp) errors.push("next_timestamp_not_forward");
  if (rewardSource !== "REWARD_ARTIFACT") errors.push("reward_source_not_artifact");
  const account = state.accountState ?? {};
  for (const key of ["cash", "position", "sellablePosition", "todayBought"]) if (!(key in account)) errors.push(`t1_field_missing:${key}`);
  if (Number.isFinite(Number(account.sellablePosition)) && Number.isFinite(Number(account.position)) && Number(account.sellablePosition) > Number(account.position)) errors.push("sellable_exceeds_position");
  const executionStatus = String(action.executionStatus ?? record.executionResult?.status ?? "").toUpperCase();
  const blocked = executionStatus === "REJECTED" || executionStatus === "BLOCKED" || executionStatus === "INVALID" || action.blocked === true;
  if (blocked && ![null, undefined].includes(record.reward) && action.executed !== true) errors.push("blocked_action_encoded_as_reward");
  if (record.done === true && nextState !== null) errors.push("terminal_next_state_present");
  if (typeof record.done !== "boolean") errors.push("done_not_terminal_boolean");
  return { valid: errors.length === 0, errors, checks: { stateLeakage: !errors.some(e => e.startsWith("state_future_field:")), transitionAlignment: !errors.includes("reward_timestamp_misaligned") && !errors.includes("next_timestamp_not_forward"), rewardAlignment: rewardSource === "REWARD_ARTIFACT", tPlusOne: !errors.some(e => e.startsWith("t1_field_missing:")) && !errors.includes("sellable_exceeds_position"), blockedAction: !errors.includes("blocked_action_encoded_as_reward"), terminal: !errors.includes("terminal_next_state_present") && !errors.includes("done_not_terminal_boolean") } };
}
