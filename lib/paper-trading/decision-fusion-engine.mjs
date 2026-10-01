const ACTIONS = Object.freeze(["BUY", "BUY_SMALL", "WAIT", "HOLD", "SELL_PART", "SELL_ALL"]);
const clamp = value => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
const positionRatio = Object.freeze({ BUY: 1, BUY_SMALL: 0.25, WAIT: 0, HOLD: 0, SELL_PART: 0.25, SELL_ALL: 1 });
import { buildStrategyContributions } from "../strategy-attribution.mjs";

export class DecisionFusionEngine {
  constructor({ modelVersion = "decision-fusion-v1" } = {}) { this.modelVersion = modelVersion; }

  decide(strategySignals = [], context = {}) {
    const signals = (Array.isArray(strategySignals) ? strategySignals : []).filter(signal => ACTIONS.includes(String(signal?.action).toUpperCase())).map(signal => ({ ...signal, action: String(signal.action).toUpperCase(), confidence: clamp(signal.confidence) }));
    if (!signals.length) return Object.freeze({ decisionId: context.decisionId ?? "decision-empty", inputSignals: [], finalDecision: "WAIT", decisionScore: 0, confidence: 0, positionRatio: 0, reason: "没有有效策略信号，等待确认", supportingReasons: [], opposingReasons: [], timestamp: null, modelVersion: context.modelVersion ?? this.modelVersion, affectsPaperExecution: false, canAutoTrade: false });
    const weights = { trend: 1, sentiment: 1, factor: 1, risk: 1 };
    const totals = Object.fromEntries(ACTIONS.map(action => [action, 0]));
    for (const signal of signals) totals[signal.action] += signal.confidence * (weights[signal.dimension] ?? 1);
    const ordered = ACTIONS.map(action => [action, totals[action]]).sort((a, b) => b[1] - a[1] || ACTIONS.indexOf(a[0]) - ACTIONS.indexOf(b[0]));
    const [winner, winningScore] = ordered[0] ?? ["WAIT", 0]; const secondScore = ordered[1]?.[1] ?? 0;
    const decisionScore = signals.length ? Number((winningScore / signals.length * 100).toFixed(2)) : 0;
    const confidence = signals.length ? Number(clamp((winningScore - secondScore) / Math.max(1, winningScore)).toFixed(4)) : 0;
    const support = signals.filter(signal => signal.action === winner).map(signal => signal.reason).filter(Boolean);
    const oppose = signals.filter(signal => signal.action !== winner).map(signal => signal.reason).filter(Boolean);
    const timestamp = signals.map(signal => signal.timestamp).filter(Boolean).sort().at(-1) ?? null;
    const decisionId = context.decisionId ?? `decision-${signals.map(signal => `${signal.strategyId}:${signal.action}:${signal.timestamp ?? ""}`).join("|")}`;
    return Object.freeze({ decisionId, inputSignals: structuredClone(signals), contributions: buildStrategyContributions(signals, { decisionId }), finalDecision: winner || "WAIT", decisionScore, confidence, positionRatio: positionRatio[winner] ?? 0, reason: support.length ? support.join("；") : "没有足够策略证据，等待确认", supportingReasons: support, opposingReasons: oppose, timestamp, modelVersion: context.modelVersion ?? this.modelVersion, trend: context.trend ?? null, sentiment: context.sentiment ?? null, factor: context.factor ?? null, risk: context.risk ?? null, affectsPaperExecution: false, canAutoTrade: false });
  }
}
