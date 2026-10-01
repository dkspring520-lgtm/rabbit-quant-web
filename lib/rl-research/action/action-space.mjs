export const RL_ACTIONS = Object.freeze(["WAIT", "BUY_SMALL", "BUY", "SELL_PART", "SELL_ALL"]);
export function normalizeRLAction(action) { const value = String(action ?? "WAIT").toUpperCase(); return RL_ACTIONS.includes(value) ? value : "WAIT"; }

export const POSITION_DELTA_ACTIONS = Object.freeze([1, 0.5, 0, -0.25, -1]);
export function normalizePositionDeltaAction(action) {
  const legacy = { BUY: 1, BUY_SMALL: 0.5, WAIT: 0, SELL_PART: -0.25, SELL_ALL: -1 };
  const value = typeof action === "string" && legacy[action.toUpperCase()] !== undefined ? legacy[action.toUpperCase()] : Number(action);
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, Number(value))) : 0;
}
