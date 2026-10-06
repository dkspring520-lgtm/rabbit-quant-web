export const DEFAULT_STATE_OPTIONS = Object.freeze({ minimumDwell: 2, confirmationDwell: 2, invalidationDwell: 2 });

const valid = snapshot => snapshot?.validity === "VALID" && snapshot?.valid === true;
const f = (snapshot, group, key) => { const value = snapshot?.[group]?.[key]; return Number.isFinite(Number(value)) ? Number(value) : null; };

export function classifyCandidate(snapshot, previousState = null) {
  if (!snapshot || snapshot.validity === "INVALID") return { state: "INVALID", reasons: ["feature snapshot invalid"] };
  if (!valid(snapshot)) return { state: "TRANSITION", reasons: ["feature warmup; candidate confirmation blocked"] };
  const velocity = f(snapshot, "momentum", "shortMomentum") ?? f(snapshot, "trend", "trendSlope");
  const acceleration = f(snapshot, "momentum", "momentumAcceleration");
  const position = f(snapshot, "position", "rangePosition");
  const upExhaustion = snapshot.exhaustion?.upwardExhaustionCandidate === true;
  const downExhaustion = snapshot.exhaustion?.downwardExhaustionCandidate === true;
  const volumeExpansion = snapshot.volume?.volumeExpansion === true;
  if (previousState === "HIGH_LEVEL_EXHAUSTION" && velocity <= 0) return { state: "WAIT_CONFIRMATION", reasons: ["high-level exhaustion followed by causal pullback observation"] };
  if (previousState === "WAIT_CONFIRMATION" && velocity < 0) return { state: "COUNTER_T_CANDIDATE", reasons: ["pullback confirmation after high-level exhaustion"] };
  if (previousState === "LOW_LEVEL_EXHAUSTION" && velocity >= 0) return { state: "REBOUND", reasons: ["low-level exhaustion followed by causal rebound observation"] };
  if (previousState === "REBOUND" && velocity > 0) return { state: "WAIT_CONFIRMATION", reasons: ["rebound requires persistence before candidate classification"] };
  if (previousState === "WAIT_CONFIRMATION" && velocity > 0 && (position ?? .5) < .55) return { state: "POSITIVE_T_CANDIDATE", reasons: ["rebound confirmation after low-level exhaustion"] };
  if (upExhaustion && velocity > 0) return { state: "HIGH_LEVEL_EXHAUSTION", reasons: ["positive momentum with negative acceleration at high range position"] };
  if (downExhaustion && velocity < 0) return { state: "LOW_LEVEL_EXHAUSTION", reasons: ["negative momentum with improving acceleration at low range position"] };
  if (velocity > 0 && acceleration > 0) return { state: "UP_ACCELERATION", reasons: ["positive momentum is accelerating"] };
  if (velocity < 0 && acceleration < 0) return { state: "DOWN_ACCELERATION", reasons: ["negative momentum is accelerating"] };
  if (velocity > 0 && (position ?? 0.5) >= 0.55) return { state: "UPTREND", reasons: ["positive causal momentum and upper-range location"] };
  if (velocity < 0 && (position ?? 0.5) <= 0.45) return { state: "DOWNTREND", reasons: ["negative causal momentum and lower-range location"] };
  if (velocity > 0) return { state: "REBOUND", reasons: ["positive momentum after lower-range observation"] };
  if (velocity < 0) return { state: "PULLBACK", reasons: ["negative momentum after upper-range observation"] };
  if (volumeExpansion && snapshot.structure?.consolidationCandidate) return { state: "RANGE", reasons: ["causal consolidation with volume observation"] };
  return { state: "NO_T_ENVIRONMENT", reasons: ["no multi-dimensional T structure candidate"] };
}

export function transitionState(previousState, candidate, context = {}) {
  const previous = previousState?.state ?? previousState ?? "NO_T_ENVIRONMENT";
  const candidateState = candidate?.state ?? "INVALID";
  if (candidateState === "INVALID") return { state: "INVALID", event: "INVALID_DEPENDENCY", confirmed: false, dwell: 0 };
  if (!previous || previous === candidateState) return { state: candidateState, event: previous === candidateState ? "HOLD" : "ENTRY", confirmed: true, dwell: Number(context.dwell ?? 1) };
  const dwell = Number(context.dwell ?? 1);
  const minimum = Number(context.minimumDwell ?? DEFAULT_STATE_OPTIONS.minimumDwell);
  if (dwell < minimum && !["INVALID", "HIGH_LEVEL_EXHAUSTION", "LOW_LEVEL_EXHAUSTION"].includes(candidateState)) return { state: previous, event: "HYSTERESIS_HOLD", confirmed: false, dwell };
  return { state: candidateState, event: ["HIGH_LEVEL_EXHAUSTION", "LOW_LEVEL_EXHAUSTION"].includes(candidateState) ? "CONFIRMATION_REQUIRED" : "EXIT_ENTRY", confirmed: !["HIGH_LEVEL_EXHAUSTION", "LOW_LEVEL_EXHAUSTION"].includes(candidateState), dwell };
}
