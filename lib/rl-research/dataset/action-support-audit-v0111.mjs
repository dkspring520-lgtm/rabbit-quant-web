import { createHash } from "node:crypto";
export const ACTIONS = Object.freeze(["WAIT", "BUY_SMALL", "BUY", "SELL_PART", "SELL_ALL"]);
export function classifySupport({ action, sourceCount, joinedCount, trajectoryCount, datasetCount, filledCount = 0, attemptedCount = 0, cancelledCount = 0 }) {
  if (action === "WAIT" && sourceCount > 0 && attemptedCount > 0 && filledCount === 0 && cancelledCount === attemptedCount) return "SUPPORTED_NOOP";
  if (sourceCount === 0 && joinedCount === 0 && trajectoryCount === 0 && datasetCount === 0) return "UNSEEN_IN_EXPERT_POLICY";
  if (sourceCount > 0 && joinedCount === sourceCount && trajectoryCount > 0 && datasetCount > 0 && filledCount > 0) return sourceCount < 2000 ? "RARE_SUPPORTED" : "SUPPORTED";
  if (sourceCount > 0 && attemptedCount > 0 && filledCount === 0) return "BLOCKED_BY_EXECUTION";
  return "PRESERVED_BUT_INCOMPLETE";
}
export function actionSupportRows(actions = ACTIONS, counts = {}) { return actions.map(action => { const row = counts[action] ?? {}; return { action, ...row, support: classifySupport({ ...row, action }) }; }); }
export const deterministicHash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
