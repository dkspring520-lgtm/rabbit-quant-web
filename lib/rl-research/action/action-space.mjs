export const RL_ACTIONS = Object.freeze(["WAIT", "BUY_SMALL", "BUY", "SELL_PART", "SELL_ALL"]);
export function normalizeRLAction(action) { const value = String(action ?? "WAIT").toUpperCase(); return RL_ACTIONS.includes(value) ? value : "WAIT"; }
