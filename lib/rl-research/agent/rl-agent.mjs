import { normalizeRLAction } from "../action/action-space.mjs";
export class RLShadowAgent {
  constructor({ modelVersion = "rl-shadow-v1" } = {}) { this.modelVersion = modelVersion; }
  suggest(state) { const trend = String(state?.trend ?? "SIDEWAYS").toUpperCase(); const sentiment = JSON.stringify(state?.sentiment ?? "").toLowerCase(); const sellPressure = Number(state?.factorFeatures?.sellPressure ?? 0); const action = trend === "DOWN" || sellPressure > 0.7 || sentiment.includes("overheat") ? "SELL_PART" : trend === "UP" && !sentiment.includes("panic") ? "BUY_SMALL" : "WAIT"; return Object.freeze({ action: normalizeRLAction(action), modelVersion: this.modelVersion, shadowOnly: true, executable: false }); }
}
